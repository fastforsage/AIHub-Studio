import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DiagnosticsStatus, LogEntry, LogLevel, LoggingSettings } from "../shared/diagnosticsApi";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const DEFAULT_SETTINGS: LoggingSettings = {
  level: "info",
  fileEnabled: true,
  maxFileSizeMb: 10,
  maxFiles: 7,
  retentionDays: 7
};
const LOG_FILE = "aihub-studio.log";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSettings(value: unknown): LoggingSettings {
  if (!isRecord(value) ||
      !["debug", "info", "warn", "error"].includes(String(value.level)) ||
      typeof value.fileEnabled !== "boolean" ||
      typeof value.maxFileSizeMb !== "number" || !Number.isInteger(value.maxFileSizeMb) ||
      value.maxFileSizeMb < 1 || value.maxFileSizeMb > 100 ||
      typeof value.maxFiles !== "number" || !Number.isInteger(value.maxFiles) ||
      value.maxFiles < 1 || value.maxFiles > 30 ||
      typeof value.retentionDays !== "number" || !Number.isInteger(value.retentionDays) ||
      value.retentionDays < 1 || value.retentionDays > 90) {
    throw new Error("Logging settings are invalid");
  }
  return {
    level: value.level as LogLevel,
    fileEnabled: value.fileEnabled,
    maxFileSizeMb: value.maxFileSizeMb,
    maxFiles: value.maxFiles,
    retentionDays: value.retentionDays
  };
}

function redact(input: string): string {
  return input
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)["']?\s*:\s*["']?)(?:Bearer\s+)?[^"',}\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)Bearer\s+[^\s,;]+/gi, "$1Bearer [REDACTED]")
    .replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|key|api_key|access_token)=)[^&\s]+/gi, "$1[REDACTED]");
}

function formatArgument(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class DiagnosticsManager {
  private settings: LoggingSettings = { ...DEFAULT_SETTINGS };
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  private lastWriteError: string | null = null;

  constructor(
    private readonly directory: string,
    private readonly settingsPath: string
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    await mkdir(dirname(this.settingsPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.settingsPath), 0o700);
    try {
      this.settings = validateSettings(JSON.parse(await readFile(this.settingsPath, "utf8")) as unknown);
    } catch (error) {
      if (!isMissingFile(error)) throw new Error("Unable to load logging settings", { cause: error });
      await this.persistSettings(DEFAULT_SETTINGS);
      this.settings = { ...DEFAULT_SETTINGS };
    }
    this.initialized = true;
    await this.pruneExpired();
    this.log("info", "diagnostics", "Logging initialized", {
      level: this.settings.level,
      fileEnabled: this.settings.fileEnabled,
      directory: this.directory
    });
  }

  getSettings(): LoggingSettings {
    this.ensureInitialized();
    return { ...this.settings };
  }

  async updateSettings(value: LoggingSettings): Promise<LoggingSettings> {
    this.ensureInitialized();
    const next = validateSettings(value);
    await this.persistSettings(next);
    this.settings = next;
    this.log("info", "diagnostics", "Logging settings updated", next);
    await this.pruneExpired();
    return this.getSettings();
  }

  log(level: LogLevel, scope: string, message: string, metadata?: unknown): void {
    if (!this.initialized || LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.settings.level]) return;
    const timestamp = new Date().toISOString();
    const safeScope = redact(scope).slice(0, 80);
    const safeMessage = redact(metadata === undefined
      ? message
      : message + " " + formatArgument(metadata)).replace(/[\r\n]+/g, " ");
    const line = JSON.stringify({ timestamp, level, scope: safeScope, message: safeMessage });
    this.queue = this.queue.then(async () => {
      if (!this.settings.fileEnabled) return;
      await this.rotateIfNeeded(Buffer.byteLength(line + "\n", "utf8"));
      await appendFile(join(this.directory, LOG_FILE), line + "\n", { encoding: "utf8", mode: 0o600 });
      await chmod(join(this.directory, LOG_FILE), 0o600);
      await this.pruneExpired();
    }).then(() => { this.lastWriteError = null; }).catch((error: unknown) => {
      this.lastWriteError = error instanceof Error ? error.message : String(error);
    });
  }

  installConsoleCapture(): void {
    const capture = (level: LogLevel, original: (...args: any[]) => void) =>
      (...args: any[]) => {
        original(...args);
        this.log(level, "console", args.map(formatArgument).join(" "));
      };
    console.debug = capture("debug", console.debug.bind(console)) as typeof console.debug;
    console.log = capture("info", console.log.bind(console)) as typeof console.log;
    console.info = capture("info", console.info.bind(console)) as typeof console.info;
    console.warn = capture("warn", console.warn.bind(console)) as typeof console.warn;
    console.error = capture("error", console.error.bind(console)) as typeof console.error;
  }

  async getStatus(): Promise<DiagnosticsStatus> {
    this.ensureInitialized();
    await this.flush();
    let currentFileBytes = 0;
    try {
      currentFileBytes = (await stat(join(this.directory, LOG_FILE))).size;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    const files = await readdir(this.directory);
    return {
      directory: this.directory,
      currentFile: join(this.directory, LOG_FILE),
      settings: this.getSettings(),
      currentFileBytes,
      rotatedFiles: files.filter((name) => name.startsWith(LOG_FILE + ".") && Number.isInteger(Number(name.slice(LOG_FILE.length + 1))) && name.slice(LOG_FILE.length + 1).length > 0).length,
      lastWriteError: this.lastWriteError
    };
  }

  async getRecentLogs(limit = 200, level: LogLevel | "all" = "all"): Promise<LogEntry[]> {
    this.ensureInitialized();
    await this.flush();
    const safeLimit = Math.max(1, Math.min(2000, Math.trunc(limit)));
    const files = await this.listLogFiles();
    const entries: LogEntry[] = [];
    for (const file of files) {
      let content = "";
      try {
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Partial<LogEntry>;
          if (typeof parsed.timestamp !== "string" ||
              !["debug", "info", "warn", "error"].includes(String(parsed.level)) ||
              typeof parsed.scope !== "string" || typeof parsed.message !== "string") continue;
          if (level === "all" || parsed.level === level) {
            entries.push(parsed as LogEntry);
          }
        } catch {
          // Ignore incomplete lines left by an interrupted write.
        }
      }
    }
    return entries.slice(-safeLimit);
  }

  async clearLogs(): Promise<void> {
    this.ensureInitialized();
    for (const file of await this.listLogFiles()) await rm(file, { force: true });
    this.log("info", "diagnostics", "Log files cleared");
    await this.flush();
  }

  async exportLogs(destination: string): Promise<string> {
    this.ensureInitialized();
    await this.flush();
    const files = await this.listLogFiles();
    const parts: string[] = [];
    for (const file of files) {
      try {
        parts.push("===== " + file + " =====\n" + await readFile(file, "utf8"));
      } catch {
        // A rotated file may disappear while an export is being prepared.
      }
    }
    await writeFile(destination, parts.join("\n"), { encoding: "utf8", mode: 0o600 });
    await chmod(destination, 0o600);
    return destination;
  }

  async createDiagnosticReport(destination: string, metadata: Record<string, unknown>): Promise<string> {
    this.ensureInitialized();
    await this.flush();
    const status = await this.getStatus();
    const recent = await this.getRecentLogs(300);
    const report = [
      "AIHub Studio diagnostic report",
      "Created: " + new Date().toISOString(),
      "",
      "Runtime metadata:",
      JSON.stringify(metadata, null, 2),
      "",
      "Logging status:",
      JSON.stringify(status, null, 2),
      "",
      "Recent log entries (up to 300):",
      ...recent.map((entry) => JSON.stringify(entry))
    ].join("\n");
    await writeFile(destination, report + "\n", { encoding: "utf8", mode: 0o600 });
    await chmod(destination, 0o600);
    return destination;
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private ensureInitialized(): void {
    if (!this.initialized) throw new Error("DiagnosticsManager has not been initialized");
  }

  private async persistSettings(settings: LoggingSettings): Promise<void> {
    const temporaryPath = join(dirname(this.settingsPath), ".logging-settings-" + randomUUID() + ".tmp");
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(settings, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, this.settingsPath);
    await chmod(this.settingsPath, 0o600);
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    const current = join(this.directory, LOG_FILE);
    try {
      const info = await stat(current);
      const maxBytes = this.settings.maxFileSizeMb * 1024 * 1024;
      if (info.size + incomingBytes <= maxBytes) return;
      if (this.settings.maxFiles <= 1) {
        await rm(current, { force: true });
        return;
      }
      await rm(current + "." + (this.settings.maxFiles - 1), { force: true });
      for (let index = this.settings.maxFiles - 2; index >= 1; index--) {
        await rename(current + "." + index, current + "." + (index + 1)).catch(() => undefined);
      }
      await rename(current, current + ".1");
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  private async pruneExpired(): Promise<void> {
    const cutoff = Date.now() - this.settings.retentionDays * 24 * 60 * 60 * 1000;
    for (const file of await this.listLogFiles()) {
      if (file === join(this.directory, LOG_FILE)) continue;
      try {
        const suffix = Number(file.slice((join(this.directory, LOG_FILE) + ".").length));
        const info = await stat(file);
        if (suffix >= this.settings.maxFiles || info.mtimeMs < cutoff) {
          await rm(file, { force: true });
        }
      } catch {
        // Rotation and cleanup may race safely.
      }
    }
  }

  private async listLogFiles(): Promise<string[]> {
    const names: string[] = await readdir(this.directory).catch((): string[] => []);
    const rotated = names
      .filter((name) => /^aihub-studio\.log\.\d+$/.test(name))
      .sort((left, right) => Number(right.split(".").at(-1)) - Number(left.split(".").at(-1)))
      .map((name) => join(this.directory, name));
    const current = join(this.directory, LOG_FILE);
    return [...rotated, ...(names.includes(LOG_FILE) ? [current] : [])];
  }
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
