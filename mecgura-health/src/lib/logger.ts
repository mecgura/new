/**
 * Structured logger with automatic redaction.
 *
 * - development: readable, debug level.   - production: one JSON line per event, info level.
 * - Never pass request bodies, medical content, passwords or tokens. As a safety net any
 *   field whose key looks sensitive is replaced with "[REDACTED]" before it is written.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|session|api[-_]?key|credential|hash|otp|email|phone|mobile|address|dob|birth|aadhaar|diagnos|prescri|symptom|complaint|allerg|medic|note|report|result|history/i;

export function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 5) return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function threshold(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  if (configured && configured in ORDER) return ORDER[configured];
  return process.env.NODE_ENV === "production" ? ORDER.info : ORDER.debug;
}

function write(level: Level, message: string, context?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const safe = context ? (redact(context) as Record<string, unknown>) : undefined;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (process.env.NODE_ENV === "production") {
    sink(JSON.stringify({ level, time: new Date().toISOString(), message, ...safe }));
  } else {
    sink(`[${level}] ${message}`, safe ?? "");
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
};
