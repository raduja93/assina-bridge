// api/woovi/subscription-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ====== Config ====== */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID; // compat

// Endereço "dummy" padrão (pode sobrescrever via env JSON: WOOVI_DEFAULT_ADDRESS_JSON)
const DEFAULT_ADDRESS = (() => {
  try { return JSON.parse(process.env.WOOVI_DEFAULT_ADDRESS_JSON || "{}"); }
  catch { return {}; }
})() as Record<string, string>;

const FALLBACK_ADDRESS: Record<string,string> = {
  zipcode:      DEFAULT_ADDRESS.zipcode      || "01001000",
  street:       DEFAULT_ADDRESS.street       || "Rua Teste",
  number:       DEFAULT_ADDRESS.number       || "123",
  neighborhood: DEFAULT_ADDRESS.neighborhood || "Centro",
  city:         DEFAULT_ADDRESS.city         || "São Paulo",
  state:        DEFAULT_ADDRESS.state        || "SP",
  country:      DEFAULT_ADDRESS.country      || "BR",
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
  ) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Api-Key");
}

/** ====== Utils ====== */
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const toCents = (v: any) => {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return Math.round(v); // já é centavos
  const str = String(v).replace(",", ".");
  const num = Number(str);
  if (!isFinite(num) || num <= 0) return NaN;
  return Math.round(num * 100);
};
const toInt = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};
const dayFromISO = (s?: string) => {
  if (!s) return NaN;
  const d = new Date(s);
  return isNaN(d.getTime()) ? NaN : Number(String(d.getDate()).replace(/^0/, ""));
};
const todayDayOfMonth = () => Number(new Date().toISOString().slice(8,10)); // 1..31

function ensureAddress(addr: any) {
  const a = addr && typeof addr === "object" ? addr : {};
  return {
    zipcode:      a.zipcode      || FALLBACK_ADDRESS.zipcode,
    street:       a.street       || FALLBACK_ADDRESS.street,
    number:       a.number       || FALLBACK_ADDRESS.number,
    neighborhood: a.neighborhood || FALLBACK_ADDRESS.neighborhood,
    city:         a.city         || FALLBACK_ADDRESS.city,
    state:        a.state        || FALLBACK_ADDRESS.state,
    country:      a.country      || FALLBACK_ADDRESS.country,
  };
}

function buildCustomer(input: any) {
  if (!input || typeof input !== "object") return null;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const taxID = onlyDigits(input.taxID);
  if (!name || !taxID) return null;
  const out: any = { name, taxID, address: ensureAddress(input.address) };
  if (input.email) out.email = String(input.email);
  if (input.phone) out.phone = `+${onlyDigits(input.phone)}`;
  return out;
}

/** ====== Handler ====== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok:false, error:"missing_api_token" });
  }

  try {
    const body = (req.body || {}) as any;

    // Aceitamos dois formatos:
    // 1) SIMPLIFICADO (front manda: planName, valueReais, dueDate, firstPaymentNow, customer{name,taxID}, correlationID)
    // 2) RAW (payload "nativo" Woovi; aqui só injetamos address se faltar)
    const isSimplified =
      "planName" in body || "valueReais" in body || "dueDate" in body || "firstPaymentNow" in body;

    let payload: any;

    if (isSimplified) {
      // businessId é opcional nesse modo (pois correlationID já pode vir pronto do front)
      const correlationID = body.correlationID || `STORE-${(body.businessId || "unknown")}-${Date.now()}`;

      const customer = buildCustomer(body.customer);
      if (!customer) {
        return res.status(400).json({
          ok:false, error:"missing_customer",
          need:["customer.name (string)", "customer.taxID (cpf/cnpj)"]
        });
      }

      // valor: aceitar valueReais ou value (centavos)
      let value: number | undefined;
      if (Number.isFinite(body.value) && body.value > 0) value = Math.trunc(Number(body.value));
      else value = toCents(body.valueReais);
      if (!Number.isFinite(value) || (value as number) <= 0) {
        return res.status(400).json({ ok:false, error:"invalid_value", hint:"Envie valueReais (ex.: 55.00) ou value em centavos" });
      }

      // nome do plano
      const name = String(body.planName || body.name || "Assinatura Pix Automático").trim();

      // frequência, jornada e retry
      const frequency = body.frequency || "MONTHLY";
      const retryPolicy = (body.retryPolicy || (body.pixRecurringOptions?.retryPolicy)) || "NON_PERMITED";
      const firstPaymentNow = !!body.firstPaymentNow;
      const journey = firstPaymentNow ? "PAYMENT_ON_APPROVAL" : ((body.pixRecurringOptions?.journey) || "ONLY_RECURRENCY");

      // dia do mês: de dueDate (ISO) ou hoje se J3
      let day = dayFromISO(body.dueDate);
      if (firstPaymentNow) day = todayDayOfMonth();
      if (!Number.isFinite(day) || day < 1 || day > 31) {
        // fallback: hoje
        day = todayDayOfMonth();
      }

      payload = {
        name,
        value,
        customer,
        correlationID,
        comment: body.comment || "Assinatura via AssinaPix",
        frequency,
        type: "PIX_RECURRING",
        pixRecurringOptions: {
          journey,
          retryPolicy,
        },
        dayGenerateCharge: day,
        dayDue: day,
      };
    } else {
      // RAW: só garantimos customer + address, e campos mínimos Woovi
      const cust = buildCustomer(body.customer);
      if (!cust) {
        return res.status(400).json({ ok:false, error:"missing_customer_fields" });
      }

      const value = Number.isFinite(body.value) && body.value > 0
        ? Math.trunc(Number(body.value))
        : toCents(body.valueReais);

      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ ok:false, error:"invalid_value", hint:"value (centavos) ou valueReais" });
      }

      const name = String(body.name || "Assinatura Pix Automático").trim();
      const correlationID = body.correlationID || `STORE-${(body.businessId || "unknown")}-${Date.now()}`;

      payload = {
        name,
        value,
        customer: cust,
        correlationID,
        comment: body.comment || "Assinatura via AssinaPix",
        frequency: body.frequency || "MONTHLY",
        type: body.type || "PIX_RECURRING",
        pixRecurringOptions: body.pixRecurringOptions || { journey: "ONLY_RECURRENCY", retryPolicy: "NON_PERMITED" },
        dayGenerateCharge: toInt(body.dayGenerateCharge) ?? todayDayOfMonth(),
        dayDue: toInt(body.dayDue) ?? toInt(body.dayGenerateCharge) ?? todayDayOfMonth(),
      };
    }

    // Idempotency por correlationID (se vier do front, respeitamos)
    const idemKey = (req.headers["idempotency-key"] as string) || `subs-${payload.correlationID}`;

    // CHAMADA: token cru nos dois headers (sem "Bearer")
    const r = await axios.post(`${WOOVI_BASE}/subscriptions`, payload, {
      headers: {
        Authorization: WOOVI_API_TOKEN as string,
        "X-Api-Key":  WOOVI_API_TOKEN as string,
        "Content-Type": "application/json",
        "Idempotency-Key": idemKey,
      },
    });

    return res.status(200).json({ ok:true, data:r.data });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_create_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subscription_create_fail", detail });
  }
}
