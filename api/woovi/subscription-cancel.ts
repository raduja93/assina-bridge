// api/woovi/subscription-cancel.ts
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
  res.setHeader("Access-Control-Allow-Methods", "PUT, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Api-Key");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["PUT","POST"].includes(req.method || "")) return res.status(405).send("Method Not Allowed");

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok:false, error:"missing_api_token" });
  }

  try {
    // aceita: ?id=... ou { id: ... } — pode ser correlationID ou globalID
    const id =
      (req.query.id as string) ||
      (req.body && (req.body.id as string)) ||
      (req.body && (req.body.correlationID as string));

    if (!id) {
      return res.status(400).json({
        ok:false,
        error:"missing_id",
        hint:"Envie ?id=<correlationID|globalID> ou body { id: ... }"
      });
    }

    const url = `${WOOVI_BASE}/subscriptions/${encodeURIComponent(id)}/cancel`;

    // idempotency é opcional aqui; se quiser, reuse o próprio id
    const idemKey = (req.headers["idempotency-key"] as string) || `cancel-${id}`;

    console.log("[woovi/subscription-cancel] calling:", url);

    const r = await axios.put(url, undefined, {
      headers: {
        Authorization: WOOVI_API_TOKEN as string, // cru, sem "Bearer"
        "X-Api-Key":  WOOVI_API_TOKEN as string,  // mantemos por consistência
        "Idempotency-Key": idemKey,
      },
    });

    return res.status(200).json({ ok:true, data:r.data });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_cancel_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subscription_cancel_fail", detail });
  }
}
