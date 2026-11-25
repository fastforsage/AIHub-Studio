export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggingSettings {
  level: LogLevel;
  fileEnabled: boolean;
  maxFileSizeMb: number;
  maxFiles: number;
  retentionDays: number;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
}

export interface DiagnosticsStatus {
  directory: string;
  currentFile: string;
  settings: LoggingSettings;
  currentFileBytes: number;
  rotatedFiles: number;
}

export interface DiagnosticsApi {
  getStatus(): Promise<DiagnosticsStatus>;
  getSettings(): Promise<LoggingSettings>;
  updateSettings(settings: LoggingSettings): Promise<LoggingSettings>;
  getRecentLogs(limit?: number, level?: LogLevel | "all"): Promise<LogEntry[]>;
  clearLogs(): Promise<void>;
  exportLogs(): Promise<string | null>;
  collectReport(): Promise<string | null>;
  openLogDirectory(): Promise<string>;
}
