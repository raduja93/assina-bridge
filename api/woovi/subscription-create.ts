// api/woovi/subscription-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ====== Config ====== */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN; // (obrigatório) Bearer token

// Endereço "dummy" padrão (sobrescrevível por env JSON: WOOVI_DEFAULT_ADDRESS_JSON)
const DEFAULT_ADDRESS = (() => {
  try {
    return JSON.parse(process.env.WOOVI_DEFAULT_ADDRESS_JSON || "{}");
  } catch { return {}; }
})() as Record<string, string>;

const FALLBACK_ADDRESS: Record<string,string> = {
  zipcode:   DEFAULT_ADDRESS.zipcode   || "01001000",
  street:    DEFAULT_ADDRESS.street    || "Rua Teste",
  number:    DEFAULT_ADDRESS.number    || "123",
  neighborhood: DEFAULT_ADDRESS.neighborhood || "Centro",
  city:      DEFAULT_ADDRESS.city      || "São Paulo",
  state:     DEFAULT_ADDRESS.state     || "SP",
  country:   DEFAULT_ADDRESS.country   || "BR",
};

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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
}

/** ====== Utils ====== */
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const toInt = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};
const todayDayOfMonth = () => Number(new Date().toISOString().slice(8,10)); // 1..31

/** ====== Handler ====== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok:false, error:"missing_WOOVI_API_TOKEN" });
  }

  try {
    const body = (req.body || {}) as any;

    // Regras mínimas
    const businessId: string | undefined = body.businessId; // id do seu tenant (AssinaPix)
    const name: string | undefined       = body.name;
    const value: number | undefined      = toInt(body.value);
    const frequency: string | undefined  = body.frequency || "MONTHLY";
    const type: string | undefined       = body.type || "PIX_RECURRING";
    const pixRecurringOptions = body.pixRecurringOptions || {};
    const retryPolicy: string | undefined = pixRecurringOptions.retryPolicy || "NON_PERMITED";
    const journey: string | undefined     = pixRecurringOptions.journey || "ONLY_RECURRENCY";

    if (!businessId) return res.status(400).json({ ok:false, error:"missing_businessId" });
    if (!name)       return res.status(400).json({ ok:false, error:"missing_name" });
    if (!value && value !== 0) return res.status(400).json({ ok:false, error:"missing_value_cents" });

    // Customer mín: name + taxID (CPF/CNPJ). Woovi exige address ao criar cliente novo.
    const cust = body.customer || {};
    const custName = (cust.name || "").trim();
    const taxID    = onlyDigits(cust.taxID);
    if (!custName || !taxID) {
      return res.status(400).json({ ok:false, error:"missing_customer_name_or_taxID" });
    }

    // Address: se faltar, injetamos placeholder
    const addressIn = cust.address || {};
    const address = {
      zipcode:      addressIn.zipcode      || FALLBACK_ADDRESS.zipcode,
      street:       addressIn.street       || FALLBACK_ADDRESS.street,
      number:       addressIn.number       || FALLBACK_ADDRESS.number,
      neighborhood: addressIn.neighborhood || FALLBACK_ADDRESS.neighborhood,
      city:         addressIn.city         || FALLBACK_ADDRESS.city,
      state:        addressIn.state        || FALLBACK_ADDRESS.state,
      country:      addressIn.country      || FALLBACK_ADDRESS.country,
    };

    // dayGenerateCharge / dayDue
    const dayGenerate = toInt(body.dayGenerateCharge) ?? todayDayOfMonth();
    const dayDue      = toInt(body.dayDue) ?? dayGenerate;

    // correlationID
    const suppliedCID: string | undefined = body.correlationID;
    const correlationID = suppliedCID || `STORE-${businessId}-${Date.now()}`;

    // comment opcional
    const comment: string | undefined = body.comment;

    // Monta payload para a Woovi
    const payload: any = {
      name,
      value,                           // em centavos
      customer: {
        name: custName,
        taxID,                         // só números
        ...(cust.email ? { email: String(cust.email) } : {}),
        ...(cust.phone ? { phone: `+${onlyDigits(cust.phone)}` } : {}),
        address,
      },
      correlationID,
      frequency,
      type,
      pixRecurringOptions: {
        journey,
        retryPolicy,
      },
      dayGenerateCharge: dayGenerate,
      dayDue: dayDue,
    };
    if (comment) payload.comment = comment;

    // Idempotency por correlationID
    const idemKey = (req.headers["idempotency-key"] as string) || `subs-${correlationID}`;

    // Chamada à Woovi
    const r = await axios.post(
      `${WOOVI_BASE}/subscriptions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WOOVI_API_TOKEN}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idemKey,
        },
        // timeout: 15000,
      }
    );

    return res.status(200).json({ ok:true, data: r.data });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_create_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subscription_create_fail", detail });
  }
}
