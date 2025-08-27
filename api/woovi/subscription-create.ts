// api/woovi/subscription-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const BASE = (process.env.WOOVI_BASE_URL || "https://api.woovi.com").replace(/\/+$/,"");
const DEFAULT_APP_ID = process.env.WOOVI_APP_ID || "";
const API_TOKEN = process.env.WOOVI_API_TOKEN || "";

const required = (cond: any, code: string, hint?: string) => {
  if (!cond) {
    const payload: any = { ok: false, error: code };
    if (hint) payload.hint = hint;
    const err: any = new Error(code);
    err.status = 400;
    err.payload = payload;
    throw err;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  try {
    // Body esperado
    const {
      businessId,
      name,
      value,                   // em centavos (ex: 5500 = R$55,00)
      customer,                // { name, taxID, email, phone, address{...} }
      correlationID,
      comment,
      frequency = "MONTHLY",   // DAILY|WEEKLY|MONTHLY|YEARLY (exemplo)
      type = "PIX_RECURRING",
      pixRecurringOptions,     // { journey: "ONLY_RECURRENCY"|"PAYMENT_ON_APPROVAL"|"PUSH_NOTIFICATION"|"PAYMENT_WITH_OFFER_TO_RECURRENCY", retryPolicy: "NON_PERMITED"|"THREE_RETRIES_7_DAYS" }
      dayGenerateCharge,       // número do dia do mês que gera
      dayDue,                  // número do dia do vencimento
      // opcional: forçar appId específico (ex: subconta)
      appIdOverride
    } = (req.body || {}) as any;

    // Validações mínimas
    required(API_TOKEN, "missing_api_token", "Defina WOOVI_API_TOKEN no Vercel");
    const appId = String(appIdOverride || DEFAULT_APP_ID || "");
    required(appId, "missing_app_id", "Defina WOOVI_APP_ID no Vercel ou envie appIdOverride no body");
    required(name, "missing_name");
    required(Number.isFinite(Number(value)), "missing_value", "value em centavos (ex: 5500)");
    required(customer?.taxID, "missing_customer_taxID");
    required(customer?.name, "missing_customer_name");
    required(frequency, "missing_frequency");
    required(type === "PIX_RECURRING", "type_must_be_PIX_RECURRING");
    required(pixRecurringOptions?.journey, "missing_journey");
    required(dayGenerateCharge, "missing_dayGenerateCharge");
    required(dayDue, "missing_dayDue");

    // Monta payload conforme docs Woovi
    const payload: any = {
      name: String(name),
      value: Number(value),
      customer: {
        name: String(customer.name),
        taxID: String(customer.taxID),
        ...(customer.email ? { email: String(customer.email) } : {}),
        ...(customer.phone ? { phone: String(customer.phone) } : {}),
        ...(customer.address ? { address: customer.address } : {})
      },
      ...(correlationID ? { correlationID: String(correlationID) } : {}),
      ...(comment ? { comment: String(comment) } : {}),
      frequency: String(frequency),
      type: "PIX_RECURRING",
      pixRecurringOptions: {
        journey: String(pixRecurringOptions.journey),
        ...(pixRecurringOptions.retryPolicy ? { retryPolicy: String(pixRecurringOptions.retryPolicy) } : {})
      },
      dayGenerateCharge: Number(dayGenerateCharge),
      dayDue: Number(dayDue),
    };

    // Cabeçalhos Woovi (App ID + Token)
    const headers = {
      "Content-Type": "application/json",
      "X-APP-ID": appId,
      Authorization: `Bearer ${API_TOKEN}`,
    };

    // Endpoint Woovi
    const url = `${BASE}/api/v1/subscriptions`;

    const r = await axios.post(url, payload, { headers });

    // Normaliza resposta
    const data = r.data || {};
    const sub = data?.subscription || data; // algumas respostas aninham em subscription

    return res.status(200).json({
      ok: true,
      subscriptionId: sub?.id || sub?._id || null,
      recurrencyId: sub?.pixRecurring?.recurrencyId || null,
      journey: sub?.pixRecurring?.journey || null,
      status: sub?.pixRecurring?.status || sub?.status || null,
      emv: sub?.pixRecurring?.emv || sub?.emv || null, // copia-e-cola (quando houver)
      raw: data,
    });
  } catch (err: any) {
    const status = err?.response?.status || err?.status || 500;
    const detail = err?.response?.data || err?.payload || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_create_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok: false, error: "woovi_subscription_create_fail", detail });
  }
}
