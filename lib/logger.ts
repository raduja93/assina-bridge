// lib/logger.ts
export type LogKV = Record<string, unknown>;

const SECRET_KEYS = [
  "authorization", "x-api-key", "x-woovi-key",
  "WOOVI_API_TOKEN", "WOOVI_APP_ID"
];

export function redact(v: any): any {
  if (!v) return v;
  if (typeof v === "string") {
    // oculta tokens longos
    if (v.length > 12) return v.slice(0, 4) + "…" + v.slice(-4);
    return v;
  }
  if (Array.isArray(v)) return v.map(redact);
  if (typeof v === "object") {
    const o: any = {};
    for (const k of Object.keys(v)) {
      if (SECRET_KEYS.includes(k.toLowerCase()) || /token|secret|key/i.test(k)) {
        o[k] = "[REDACTED]";
      } else {
        o[k] = redact(v[k]);
      }
    }
    return o;
  }
  return v;
}

export function logInfo(msg: string, kv?: LogKV) {
  if (kv) console.log(msg, JSON.stringify(redact(kv)));
  else console.log(msg);
}
export function logError(msg: string, kv?: LogKV) {
  if (kv) console.error(msg, JSON.stringify(redact(kv)));
  else console.error(msg);
}
