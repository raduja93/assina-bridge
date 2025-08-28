// api/woovi/subscriptions-list.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ===== Config ===== */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID;

/** ===== CORS ===== */
function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app" ||
    o === "https://assinapix.com" ||
    o.endsWith(".assinapix.com")
  ) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).send("Method Not Allowed");

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok:false, error:"missing_api_token" });
  }

  try {
    // Aceita filtros por query (GET) ou body (POST)
    const src = req.method === "GET" ? (req.query || {}) : ((req.body || {}) as any);

    // paginação básica (Woovi retorna pageInfo; algumas contas aceitam skip/limit)
    const params: Record<string, any> = {};
    if (src.skip  != null) params.skip  = Number(src.skip);
    if (src.limit != null) params.limit = Number(src.limit);

    // filtros opcionais práticos (não documentados oficialmente, mas comuns)
    // ex.: status=ACTIVE|CANCELLED, contains=texto em correlationID, customerTaxId, etc.
    if (src.status) params.status = String(src.status);
    if (src.contains) params.contains = String(src.contains);
    if (src.correlationID) params.correlationID = String(src.correlationID);

    const r = await axios.get(`${WOOVI_BASE}/subscriptions`, {
      headers: {
        // Woovi: token cru (sem "Bearer")
        Authorization: WOOVI_API_TOKEN as string,
        "X-Api-Key":  WOOVI_API_TOKEN as string, // alguns ambientes exigem também
      },
      params,
      // validateStatus: () => true, // destravar se quiser tratar status manualmente
    });

    return res.status(200).json({ ok:true, data:r.data });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscriptions_list_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subscriptions_list_fail", detail });
  }
}
