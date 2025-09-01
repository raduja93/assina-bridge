// api/woovi/transaction-get.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ===== Config ===== */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/, "");
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
  ) {
    res.setHeader("Access-Control-Allow-Origin", o);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
}

/** ===== Handler ===== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // aceita GET (?id=... ou ?correlationID=...) e POST (body { id } ou { correlationID })
    const id = (req.query.id as string) || (req.body?.id as string);
    const correlationID = (req.query.correlationID as string) || (req.body?.correlationID as string);

    if (!id && !correlationID) {
      return res.status(400).json({
        ok: false,
        error: "missing_id",
        hint: "Envie ?id=... ou ?correlationID=... ou body { id }"
      });
    }

    // Monta URL Woovi
    let url = `${WOOVI_BASE}/transactions`;
    if (id) url += `/${encodeURIComponent(id)}`;
    else if (correlationID) url += `?correlationID=${encodeURIComponent(correlationID)}`;

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
    console.error("woovi_transaction_get_fail", status, detail);
    return res.status(status).json({ ok: false, error: "woovi_transaction_get_fail", detail });
  }
}
