// api/woovi/subscription-cancel.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ENV */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/, "");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN; // <-- obrigatório p/ assinaturas

/** CORS */
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  if (!WOOVI_API_TOKEN) return res.status(500).json({ ok:false, error:"missing_WOOVI_API_TOKEN" });

  try {
    const { subscriptionId } = (req.body || {}) as { subscriptionId?: string };
    if (!subscriptionId) {
      return res.status(400).json({ ok:false, error:"missing_subscriptionId" });
    }

    const cli = axios.create({
      baseURL: WOOVI_BASE,
      headers: {
        Authorization: `Bearer ${WOOVI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    // fluxo comum de cancelamento:
    // POST /subscriptions/:id/cancel
    // (fallback: PATCH /subscriptions/:id { status: "CANCELED" } caso a rota de cancel não exista)
    let resp;
    try {
      resp = await cli.post(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {});
    } catch (e: any) {
      // fallback simples
      if (e?.response?.status === 404) {
        resp = await cli.patch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { status: "CANCELED" });
      } else {
        throw e;
      }
    }

    return res.status(200).json({ ok:true, data: resp.data });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_cancel_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subscription_cancel_fail", detail });
  }
}
