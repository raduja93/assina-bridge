// api/woovi/subaccount-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ========= CORS ========= */
function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app" ||
    o === "https://assinapix.com" ||
    o.endsWith(".assinapix.com")
  ) {
    res.setHeader("Access-Control-Allow-Origin", o);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/** ========= ENV ========= */
const WOOVI_BASE = process.env.WOOVI_BASE_URL || "https://api.woovi.com";
const WOOVI_TOKEN = process.env.WOOVI_API_KEY || ""; // se for X-API-KEY, troque no axiosConfig
if (!WOOVI_TOKEN) {
  console.warn("WOOVI_API_KEY ausente nas variáveis de ambiente.");
}

/** ========= HTTP client ========= */
function woovi() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${WOOVI_TOKEN}`, // ajuste para X-API-KEY se necessário
  };
  return axios.create({ baseURL: WOOVI_BASE, headers, timeout: 20000 });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { name, pixKey, businessId } = (req.body || {}) as {
      name?: string;
      pixKey?: string;
      businessId?: string;
    };

    if (!name)  return res.status(400).json({ ok:false, error:"missing_name" });
    if (!pixKey) return res.status(400).json({ ok:false, error:"missing_pixKey" });

    const correlationId = businessId ? `STORE_${businessId}` : undefined;

    const api = woovi();
    // endpoint da doc: /api/v1/subaccount
    const r = await api.post("/api/v1/subaccount", {
      name,
      pixKey,
      ...(correlationId ? { correlationID: correlationId } : {}),
    });

    return res.status(200).json({ ok: true, data: r.data });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subaccount_create_fail", status, detail);
    return res.status(status).json({ ok:false, error:"woovi_subaccount_create_fail", detail });
  }
}
