export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  // TODO: Persist structured logs locally without leaking raw audio.
  // eslint-disable-next-line no-console
  console[level](`[tele_coach] ${message}`, context ?? {});
}
