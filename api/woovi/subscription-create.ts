// api/woovi/subscription-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID;

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Api-Key");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok: false, error: "missing_api_token" });
  }

  try {
    const body = req.body || {};

    // validações mínimas
    if (!body.businessId) {
      return res.status(400).json({ ok: false, error: "missing_businessId" });
    }
    if (!body.customer?.taxID || !body.customer?.name) {
      return res.status(400).json({ ok: false, error: "missing_customer_fields" });
    }
    if (!body.value) {
      return res.status(400).json({ ok: false, error: "missing_value" });
    }

    // payload para Woovi
    const payload = {
      name: body.name || "Assinatura Pix Automático",
      value: body.value, // em centavos
      customer: body.customer,
      correlationID: body.correlationID || `STORE-${body.businessId}`,
      comment: body.comment || "Assinatura via AssinaPix",
      frequency: body.frequency || "MONTHLY",
      type: "PIX_RECURRING",
      pixRecurringOptions: body.pixRecurringOptions || {
        journey: "ONLY_RECURRENCY", // Jornada 2 como padrão
        retryPolicy: "NON_PERMITED"
      },
      dayGenerateCharge: body.dayGenerateCharge || new Date().getDate(),
      dayDue: body.dayDue || new Date().getDate()
    };

    const r = await axios.post(`${WOOVI_BASE}/subscriptions`, payload, {
      headers: {
        Authorization: WOOVI_API_TOKEN,
        "X-Api-Key": WOOVI_API_TOKEN,
        "Content-Type": "application/json"
      },
      validateStatus: () => true
    });

    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status).json({
        ok: false,
        error: "woovi_subscription_create_fail",
        detail: r.data
      });
    }

    return res.status(200).json({ ok: true, data: r.data });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_create_fail", status, detail);
    return res.status(status).json({ ok: false, error: "woovi_subscription_create_fail", detail });
  }
}
