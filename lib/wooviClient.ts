// lib/wooviClient.ts
import axios from "axios";
import { logInfo, logError, redact } from "./logger";

const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID;

export function wooviApi(reqId?: string) {
  if (!WOOVI_API_TOKEN) {
    throw new Error("missing WOOVI_API_TOKEN/WOOVI_APP_ID");
  }

  const api = axios.create({
    baseURL: WOOVI_BASE,
    headers: {
      Authorization: WOOVI_API_TOKEN,   // sem "Bearer", Woovi aceita plain
      "X-Api-Key": WOOVI_API_TOKEN,
      "Content-Type": "application/json",
    },
    timeout: 20000,
    validateStatus: () => true, // vamos tratar manualmente
  });

  // Interceptor de request
  api.interceptors.request.use((cfg) => {
    const out = {
      reqId,
      method: cfg.method,
      url: (cfg.baseURL || "") + (cfg.url || ""),
      headers: { ...(cfg.headers as any) },
      data: cfg.data,
    };
    logInfo("[WOOVI] → request", out);
    return cfg;
  });

  // Interceptor de response
  api.interceptors.response.use(
    (resp) => {
      const out = {
        reqId,
        status: resp.status,
        url: resp.config?.url,
        data: resp.data,
      };
      logInfo("[WOOVI] ← response", out);
      return resp;
    },
    (err) => {
      const out = {
        reqId,
        message: err?.message,
        cfg: {
          url: err?.config?.url,
          method: err?.config?.method,
          data: err?.config?.data,
          headers: err?.config?.headers,
        },
        resp: {
          status: err?.response?.status,
          data: err?.response?.data,
        },
      };
      logError("[WOOVI] ← error", out);
      return Promise.reject(err);
    }
  );

  return api;
}
