// api/woovi/subscription-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ========= CORS ========= */
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

/** ========= ENV ========= */
const WOOVI_BASE = process.env.WOOVI_BASE_URL || "https://api.woovi.com";
const WOOVI_TOKEN = process.env.WOOVI_API_KEY || "";
if (!WOOVI_TOKEN) console.warn("WOOVI_API_KEY ausente.");

/** ========= HTTP client ========= */
function woovi() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${WOOVI_TOKEN}`,
  };
  return axios.create({ baseURL: WOOVI_BASE, headers, timeout: 20000 });
}

/** Helpers */
const cents = (n: any) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const input = (req.body || {}) as {
      // obrigatórios
      value?: number;                 // em centavos
      customer?: {
        name?: string;
        taxID?: string;               // CPF puro (somente dígitos) – a Woovi mapeia como BR:CPF internamente
        email?: string;
        phone?: string;               // E.164 (ex.: 5511999999999)
        address?: {
          zipcode?: string;
          street?: string;
          number?: string;
          neighborhood?: string;
          city?: string;
          state?: string;
          complement?: string;
        }
      };
      // controle
      correlationID?: string;         // ex.: STORE_{businessId}
      comment?: string;
      frequency?: "MONTHLY"|"WEEKLY"|"YEARLY"|"SEMIANNUAL";
      type?: "PIX_RECURRING";
      pixRecurringOptions?: {
        journey?: "ONLY_RECURRENCY"|"PAYMENT_ON_APPROVAL"|"PUSH_NOTIFICATION"|"PAYMENT_WITH_OFFER_TO_RECURRENCY";
        retryPolicy?: "NON_PERMITED"|"THREE_RETRIES_7_DAYS";
      };
      dayGenerateCharge?: number;     // 1..28 (pra mensal)
      dayDue?: number;                // dia de vencimento
      // multi-tenant
      subaccountId?: string;          // se a Woovi exigir para vincular à subconta
    };

    // validações mínimas
    const value = cents(input.value);
    if (value === null) {
      return res.status(400).json({ ok:false, error:"invalid_value", hint:"value em centavos (inteiro >= 0)" });
    }
    if (!input.customer?.address?.zipcode) {
      return res.status(400).json({ ok:false, error:"missing_customer_address", need:["customer.address.*"] });
    }

    const payload: any = {
      name: input.comment || "Pix Automático",
      value,
      customer: {
        name: input.customer?.name,
        taxID: (input.customer?.taxID || "").replace(/\D/g, ""),
        email: input.customer?.email,
        phone: input.customer?.phone,
        address: {
          zipcode: input.customer?.address?.zipcode,
          street: input.customer?.address?.street,
          number: input.customer?.address?.number,
          neighborhood: input.customer?.address?.neighborhood,
          city: input.customer?.address?.city,
          state: input.customer?.address?.state,
          complement: input.customer?.address?.complement,
        },
      },
      correlationID: input.correlationID,         // ex.: STORE_{businessId}
      comment: input.comment || "Assinatura AssinaPix",
      frequency: input.frequency || "MONTHLY",
      type: "PIX_RECURRING",
      pixRecurringOptions: {
        journey: input.pixRecurringOptions?.journey || "ONLY_RECURRENCY", // J2 padrão
        retryPolicy: input.pixRecurringOptions?.retryPolicy || "NON_PERMITED",
      },
      dayGenerateCharge: input.dayGenerateCharge, // obrigatório pela doc (defina hoje p/ J3)
      dayDue: input.dayDue || 3,
    };

    // se você precisar passar subconta (caso Woovi exija no header ou body):
    // payload.subaccountId = input.subaccountId;

    const api = woovi();
    const r = await api.post("/api/v1/subscriptions", payload);

    return res.status(200).json({ ok:true, data:r.data });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_create_fail", status, detail);
    return res.status(status).json({ ok:false, error:"woovi_subscription_create_fail", detail });
  }
}
