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
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Idempotency-Key, X-Api-Key, X-Debug-Log"
  );
}

/** ====== Utils ====== */
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** Converte reais (ex.: 55 ou "55.00") para centavos. Se já vier em centavos (value), use esse. */
const toCents = (v: any) => {
  if (v == null || v === "") return NaN;
  const n = Number(String(v).replace(",", "."));
  if (!isFinite(n) || n <= 0) return NaN;
  return Math.round(n * 100);
};

const toInt = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

/** Dia do mês "hoje" em America/Sao_Paulo (1..31) */
const todayDayOfMonthSP = (now: Date = new Date()) => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", day: "2-digit" });
  return Number(fmt.format(now));
};

/** Extrai o dia do mês de uma data respeitando America/Sao_Paulo */
const dayFromISO_SP = (s?: string) => {
  if (!s) return NaN;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (isNaN(d.getTime())) return NaN;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", day: "2-digit" });
  return Number(fmt.format(d));
};

/** Normaliza journey para o formato esperado pela Woovi */
function normalizeJourney(input?: string, firstPaymentNow?: boolean): "only_recurrency" | "page_on_approval" {
  const s = String(input || "").trim().toLowerCase();
  if (s === "page_on_approval" || s === "pay_on_approval" || s === "payment_on_approval") return "page_on_approval";
  if (s === "only_recurrency" || s === "only_recurring" || s === "onlyrecurrency") return "only_recurrency";
  return firstPaymentNow ? "page_on_approval" : "only_recurrency";
}

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

  const debugEcho = String(req.headers["x-debug-log"] || "") === "1";

  try {
    const body = (req.body || {}) as any;

    // EXIGIR correlationID do front SEMPRE
    const frontCID = typeof body.correlationID === "string" ? body.correlationID.trim() : "";
    if (!frontCID) {
      return res.status(400).json({
        ok: false,
        error: "missing_correlationID",
        hint: "Envie correlationID (string não vazia) no payload do front."
      });
    }

    // Dois formatos de entrada:
    const isSimplified =
      "planName" in body || "valueReais" in body || "dueDate" in body || "firstPaymentNow" in body;

    let payload: any;

    if (isSimplified) {
      const customer = buildCustomer(body.customer);
      if (!customer) {
        return res.status(400).json({
          ok:false, error:"missing_customer",
          need:["customer.name (string)", "customer.taxID (cpf/cnpj)"]
        });
      }

      // value em centavos OU valueReais (R$)
      let value: number | undefined;
      if (Number.isFinite(body.value) && Number(body.value) > 0) {
        value = Math.trunc(Number(body.value));
      } else {
        value = toCents(body.valueReais);
      }
      if (!Number.isFinite(value) || (value as number) <= 0) {
        return res.status(400).json({
          ok:false, error:"invalid_value",
          hint:"Envie valueReais (ex.: 55.00) ou value em centavos (> 0)"
        });
      }

      const name = String(body.planName || body.name || "Assinatura Pix Automático").trim();
      if (!name) return res.status(400).json({ ok:false, error:"missing_name" });

      const frequency = body.frequency || "MONTHLY";
      const retryPolicy =
        body.retryPolicy ||
        body.pixRecurringOptions?.retryPolicy ||
        "NON_PERMITED";

      const firstPaymentNow = !!body.firstPaymentNow;

      // journey em snake_case esperado pela Woovi
      const journey = normalizeJourney(body.pixRecurringOptions?.journey, firstPaymentNow);

      // dia do mês, seguindo a regra da jornada
      let genDay: number;
      let dueDay: number;

      if (journey === "page_on_approval") {
        // regra Woovi: dayGenerateCharge TEM que ser hoje (SP)
        genDay = todayDayOfMonthSP();
        dueDay = genDay;
      } else {
        // only_recurrency: tenta usar dueDate; se não vier, usa hoje (SP)
        const fromDue = dayFromISO_SP(body.dueDate);
        genDay = Number.isFinite(fromDue) ? fromDue : todayDayOfMonthSP();

        const rawDue = Number(body.dayDue);
        dueDay = Number.isFinite(rawDue) ? Math.trunc(rawDue) : genDay;
      }

      payload = {
        name,
        value,
        customer,
        correlationID: frontCID, // <- usa EXATAMENTE o que veio do front
        comment: body.comment || "Assinatura via AssinaPix",
        frequency,
        type: "PIX_RECURRING",
        pixRecurringOptions: { journey, retryPolicy },
        dayGenerateCharge: genDay,
        dayDue: dueDay,
      };

      console.log("🧭 Woovi rec payload check (simplified)", {
        journey,
        genDay,
        dueDay,
        nowSP: todayDayOfMonthSP(),
        dueDateFromFront: body.dueDate
      });

    } else {
      // RAW
      const customer = buildCustomer(body.customer);
      if (!customer) {
        return res.status(400).json({ ok:false, error:"missing_customer_fields" });
      }

      const value = Number.isFinite(body.value) && Number(body.value) > 0
        ? Math.trunc(Number(body.value))
        : toCents(body.valueReais);

      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ ok:false, error:"invalid_value", hint:"value (centavos) ou valueReais" });
      }

      const name = String(body.name || "Assinatura Pix Automático").trim();
      if (!name) return res.status(400).json({ ok:false, error:"missing_name" });

      const frequency   = body.frequency || "MONTHLY";
      const retryPolicy = body.retryPolicy || body.pixRecurringOptions?.retryPolicy || "NON_PERMITED";
      const journey     = normalizeJourney(body.pixRecurringOptions?.journey, /*firstPaymentNow*/ false);

      let genDay: number;
      let dueDay: number;

      if (journey === "page_on_approval") {
        genDay = todayDayOfMonthSP();
        dueDay = genDay;
      } else {
        const requestedGen = toInt(body.dayGenerateCharge);
        if (Number.isFinite(requestedGen!)) {
          genDay = requestedGen!;
        } else {
          const fromDue = dayFromISO_SP(body.dueDate);
          genDay = Number.isFinite(fromDue) ? fromDue : todayDayOfMonthSP();
        }
        const requestedDue = toInt(body.dayDue);
        dueDay = Number.isFinite(requestedDue!) ? requestedDue! : genDay;
      }

      payload = {
        name,
        value,
        customer,
        correlationID: frontCID, // <- usa EXATAMENTE o que veio do front
        comment: body.comment || "Assinatura via AssinaPix",
        frequency,
        type: body.type || "PIX_RECURRING",
        pixRecurringOptions: { journey, retryPolicy },
        dayGenerateCharge: genDay,
        dayDue: dueDay,
      };

      console.log("🧭 Woovi rec payload check (raw)", {
        journey,
        genDay,
        dueDay,
        nowSP: todayDayOfMonthSP(),
        dueDateFromFront: body.dueDate,
        dayGenerateChargeFromFront: body.dayGenerateCharge,
        dayDueFromFront: body.dayDue
      });
    }

    // Idempotency por correlationID vindo do front
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

    const resp = { ok:true, data:r.data };
    if (debugEcho) {
      return res.status(200).json({ ...resp, _debug: { sentPayload: payload, idemKey } });
    }
    return res.status(200).json(resp);

  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_create_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subscription_create_fail", detail });
  }
}
