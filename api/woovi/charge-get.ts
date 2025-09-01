// api/woovi/charge-get.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ====== Config ====== */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID; // compat

/** ====== CORS ====== */
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key, X-Debug-Log");
}

/** ====== Handler ====== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!WOOVI_API_TOKEN) return res.status(500).json({ ok:false, error:"missing_api_token" });

  try {
    // Aceita:
    // - GET  /api/woovi/charge-get?id=...    (id ou correlationID)
    // - POST /api/woovi/charge-get           { "id": "..." } (ou { "correlationID": "..." })
    const qid = typeof req.query.id === "string" ? req.query.id : "";
    const bid = typeof (req.body?.id) === "string" ? req.body.id : "";
    const bcid = typeof (req.body?.correlationID) === "string" ? req.body.correlationID : "";

    const id = (qid || bid || bcid || "").trim();
    if (!id) return res.status(400).json({ ok:false, error:"missing_id", hint:'Envie ?id=... ou body { "id": "..."} ou { "correlationID": "..." }' });

    // A doc permite enviar **charge ID ou correlationID** no {id} do path; faça URI-encode se necessário.  [oai_citation:1‡Woovi _ Woovi Developers.pdf](file-service://file-MrsS9DYfuLeJL11UaGccdz)
    const encoded = encodeURIComponent(id);

    const r = await axios.get(`${WOOVI_BASE}/charge/${encoded}`, {
      headers: {
        Authorization: WOOVI_API_TOKEN as string, // AppID
        "X-Api-Key":  WOOVI_API_TOKEN as string, // compat
      },
    });

    return res.status(200).json({ ok:true, data:r.data });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    return res.status(status).json({ ok:false, error:"woovi_charge_get_fail", detail });
  }
}
