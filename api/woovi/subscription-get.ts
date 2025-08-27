// api/woovi/subscription-get.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

const WOOVI_BASE = process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1";
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN;

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok: false, error: "missing_WOOVI_API_TOKEN" });
  }

  try {
    const q = req.method === "GET" ? req.query : (req.body || {});
    const id = (q.id || q.correlationID || "").toString().trim();

    if (!id) {
      return res.status(400).json({
        ok: false,
        error: "missing_id",
        hint: "passe ?id={correlationID} ou body {id:...}",
      });
    }

    const r = await axios.get(`${WOOVI_BASE}/subscriptions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${WOOVI_API_TOKEN}` },
    });

    return res.status(200).json({ ok: true, data: r.data });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_get_fail", status, detail);
    return res.status(status).json({ ok: false, error: "woovi_subscription_get_fail", detail });
  }
}
