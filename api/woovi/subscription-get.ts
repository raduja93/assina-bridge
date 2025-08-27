// api/woovi/subscription-get.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ====== Config ====== */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID;

/** ====== CORS ====== */
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Api-Key");
}

/** ====== Handler ====== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok: false, error: "missing_api_token" });
  }

  try {
    const id: string | undefined = (req.query.id as string) || (req.body?.id as string);
    const correlationID: string | undefined = (req.query.correlationID as string) || (req.body?.correlationID as string);

    if (!id && !correlationID) {
      return res.status(400).json({ ok: false, error: "missing_id_or_correlationID" });
    }

    let url = "";
    if (id) {
      url = `${WOOVI_BASE}/subscriptions/${encodeURIComponent(id)}`;
    } else {
      url = `${WOOVI_BASE}/subscriptions/correlation/${encodeURIComponent(correlationID!)}`;
    }

    const r = await axios.get(url, {
      headers: {
        Authorization: WOOVI_API_TOKEN as string,
        "X-Api-Key": WOOVI_API_TOKEN as string,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json({ ok: true, data: r.data });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_get_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok: false, error: "woovi_subscription_get_fail", detail });
  }
}
