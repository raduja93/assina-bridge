// api/woovi/subscription-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ====== Config ====== */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID; 

/** ====== Defaults ====== */
const FALLBACK_ADDRESS = {
  zipcode: "01001000",
  street: "Rua Exemplo",
  number: "123",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  country: "BR",
};

/** ====== Utils ====== */
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const toCents = (v: any) => {
  if (v == null || v === "") return NaN;
  const n = Number(String(v).replace(",", "."));
  if (!isFinite(n) || n <= 0) return NaN;
  return Math.round(n * 100);
};

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
    complement:   a.complement   || "",
  };
}

/** ====== Handler ====== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok:false, error:"missing_api_token" });
  }

  try {
    const b: any = req.body || {};

    // correlationID obrigatório
    const correlationID = typeof b.correlationID === "string" ? b.correlationID.trim() : "";
    if (!correlationID) {
      return res.status(400).json({ ok:false, error:"missing_correlationID" });
    }

    // customer mínimo
    if (!b?.customer?.name || !onlyDigits(b?.customer?.taxID)) {
      return res.status(400).json({ ok:false, error:"missing_customer" });
    }

    // value em centavos
    let value: number | undefined;
    if (Number.isFinite(b.value) && Number(b.value) > 0) {
      value = Math.trunc(Number(b.value));
    } else {
      value = toCents(b.valueReais);
    }
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ ok:false, error:"invalid_value" });
    }

    // monta payload com defaults
    const payload: any = {
      name: b.name ?? "Assinatura PIX recorrente",
      value,
      customer: {
        ...b.customer,
        address: ensureAddress(b.customer?.address),
      },
      correlationID,
      comment: b.comment ?? "Assinatura via AssinaPix",
      frequency: b.frequency ?? "MONTHLY",
      type: b.type ?? "PIX_RECURRING",
      pixRecurringOptions: {
        journey: b?.pixRecurringOptions?.journey ?? "ONLY_RECURRENCY",
        retryPolicy: b?.pixRecurringOptions?.retryPolicy ?? "NON_PERMITED",
      },
      dayGenerateCharge: b.dayGenerateCharge ?? new Date().getDate(),
      dayDue: b.dayDue ?? (b.dayGenerateCharge ?? new Date().getDate()),
    };

    // idem key
    const idemKey = (req.headers["idempotency-key"] as string) || `subs-${correlationID}`;

    console.log("➡️ Sending to Woovi", JSON.stringify(payload));

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
    return res.status(status).json({ ok:false, error:"woovi_subscription_create_fail", detail });
  }
}
