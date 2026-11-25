import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DiagnosticsManager } from "../src/main/diagnosticsManager";

const directories: string[] = [];

async function createManager(): Promise<DiagnosticsManager> {
  const directory = await mkdtemp(join(tmpdir(), "aihub-diagnostics-"));
  directories.push(directory);
  const manager = new DiagnosticsManager(join(directory, "state", "logs"), join(directory, "config", "logging-settings.json"));
  await manager.initialize();
  return manager;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("DiagnosticsManager", () => {
  it("initializes secure defaults and persists logging settings", async () => {
    const manager = await createManager();
    const status = await manager.getStatus();
    expect(status.settings).toEqual({
      level: "info",
      fileEnabled: true,
      maxFileSizeMb: 10,
      maxFiles: 7,
      retentionDays: 7
    });
    const settingsPath = join(status.directory, "..", "..", "config", "logging-settings.json");
    const loaded = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(loaded.level).toBe("info");
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);

    await manager.updateSettings({
      level: "debug",
      fileEnabled: true,
      maxFileSizeMb: 5,
      maxFiles: 3,
      retentionDays: 14
    });
    expect(manager.getSettings().level).toBe("debug");
    expect(manager.getSettings().maxFiles).toBe(3);
  });

  it("writes structured entries and redacts common secrets", async () => {
    const manager = await createManager();
    manager.log("info", "auth", "api_key=secret-value Authorization: Bearer abc.def.ghi");
    manager.log("debug", "test", "debug detail");
    await manager.flush();

    const entries = await manager.getRecentLogs(20);
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("info");
    expect(entries[0].message).not.toContain("secret-value");
    expect(entries[0].message).not.toContain("abc.def.ghi");
    expect(entries[0].message).toContain("[REDACTED]");
  });

  it("filters log levels and supports disabling file output", async () => {
    const manager = await createManager();
    manager.log("info", "test", "visible");
    await manager.updateSettings({ ...manager.getSettings(), level: "debug", fileEnabled: false });
    manager.log("debug", "test", "not written to disk");
    await manager.flush();

    expect((await manager.getRecentLogs(20)).map((entry) => entry.message)).toContain("visible");
    expect(await manager.getRecentLogs(20, "debug")).toHaveLength(0);
  });

  it("rotates files after the configured size and enforces the file count", async () => {
    const manager = await createManager();
    await manager.updateSettings({
      level: "info",
      fileEnabled: true,
      maxFileSizeMb: 1,
      maxFiles: 2,
      retentionDays: 7
    });
    manager.log("info", "test", "x".repeat(1_050_000));
    await manager.flush();
    manager.log("info", "test", "second entry forces rotation");
    await manager.flush();

    const status = await manager.getStatus();
    expect(status.rotatedFiles).toBe(1);
    expect((await manager.getRecentLogs(5)).at(-1)?.message).toBe("second entry forces rotation");
  });

  it("exports logs and creates a diagnostic report", async () => {
    const manager = await createManager();
    manager.log("warn", "test", "example warning");
    await manager.flush();
    const directory = join((await manager.getStatus()).directory, "..");
    const exportPath = join(directory, "export.log");
    const reportPath = join(directory, "diagnostics.txt");

    await manager.exportLogs(exportPath);
    await manager.createDiagnosticReport(reportPath, { appVersion: "test", platform: "linux" });

    expect(await readFile(exportPath, "utf8")).toContain("example warning");
    expect(await readFile(reportPath, "utf8")).toContain("AIHub Studio diagnostic report");
    expect((await stat(exportPath)).mode & 0o777).toBe(0o600);
  });

  it("rejects out-of-range rotation settings", async () => {
    const manager = await createManager();
    await expect(manager.updateSettings({
      ...manager.getSettings(),
      maxFileSizeMb: 0
    })).rejects.toThrow("Logging settings are invalid");
  });
});
