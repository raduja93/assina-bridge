// api/woovi/subscription-get.ts
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!WOOVI_API_TOKEN) return res.status(500).json({ ok:false, error:"missing_WOOVI_API_TOKEN" });

  try {
    // Aceita via query (GET) ou body (POST) — use o que for mais prático no seu frontend
    const q = req.method === "GET" ? req.query : req.body || {};
    const correlationID = (q.correlationID || q.correlationId || "").toString().trim();
    const subscriptionId = (q.subscriptionId || q.id || "").toString().trim();

    if (!correlationID && !subscriptionId) {
      return res.status(400).json({ ok:false, error:"missing_identifier", hint:"informe correlationID OU subscriptionId" });
    }

    const cli = axios.create({
      baseURL: WOOVI_BASE,
      headers: {
        Authorization: `Bearer ${WOOVI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      // timeout: 15000,
    });

    let data: any;

    if (subscriptionId) {
      // caminho 1: buscar por ID direto
      // GET /subscriptions/:id
      const r = await cli.get(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
      data = r.data;
    } else {
      // caminho 2: buscar por correlationID
      // GET /subscriptions?correlationID=...
      const r = await cli.get(`/subscriptions`, { params: { correlationID } });
      data = r.data;
    }

    // Normalização amigável
    const sub = data?.subscription || data?.subscriptions?.[0] || data;
    const emv = sub?.pixRecurring?.emv || null;
    const journey = sub?.pixRecurring?.journey || null;
    const recurrencyId = sub?.pixRecurring?.recurrencyId || null;
    const status = sub?.status || null;

    return res.status(200).json({
      ok: true,
      status,
      emv,
      journey,
      recurrencyId,
      raw: data,
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_get_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subscription_get_fail", detail });
  }
}
