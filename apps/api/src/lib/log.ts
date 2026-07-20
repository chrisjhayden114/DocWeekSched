/**
 * Tiny structured logger — JSON lines to console, no framework.
 * Prefer this over bare console.* so request IDs travel with every line.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogMeta = Record<string, unknown> & { requestId?: string };

export function log(level: LogLevel, message: string, meta: LogMeta = {}): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta,
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}
