// api/woovi/webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/* ========= ENV ========= */
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Segredos por evento (cada webhook da Woovi tem um HMAC próprio)
const SECRET_BY_EVENT: Record<string, string | undefined> = {
  "PIX_AUTOMATIC_APPROVED":        process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_APPROVED,
  "PIX_AUTOMATIC_REJECTED":        process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_REJECTED,
  "PIX_AUTOMATIC_COBR_CREATED":    process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_COBR_CREATED,
  "PIX_AUTOMATIC_COBR_APPROVED":   process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_COBR_APPROVED,
  "PIX_AUTOMATIC_COBR_REJECTED":   process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_COBR_REJECTED,
  "PIX_AUTOMATIC_COBR_COMPLETED":  process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_COBR_COMPLETED,
  "OPENPIX:CHARGE_CREATED":        process.env.WOOVI_WH_SECRET_OPENPIX_CHARGE_CREATED,
  "OPENPIX:CHARGE_COMPLETED":      process.env.WOOVI_WH_SECRET_OPENPIX_CHARGE_COMPLETED,
  "OPENPIX:TRANSACTION_RECEIVED":  process.env.WOOVI_WH_SECRET_OPENPIX_TRANSACTION_RECEIVED,
};

/* ========= CORS ========= */
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Woovi-Signature");
}

/* ========= HMAC ========= */
function hmac(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}
function safeEq(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/* ========= HTTP config ========= */
export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

/* ========= Helpers (extração dos campos usuais) ========= */
function pickCorrelationId(evt: any): string | undefined {
  return (
    evt?.data?.subscription?.correlationID ??
    evt?.data?.charge?.correlationID ??
    evt?.data?.correlationID ??
    evt?.correlationID
  );
}
function pickSubscriptionGlobalId(evt: any): string | undefined {
  return evt?.data?.subscription?.globalID ?? evt?.data?.globalID;
}
function pickRecurrencyId(evt: any): string | undefined {
  return (
    evt?.data?.pixRecurring?.recurrencyId ??
    evt?.data?.pixAutomatic?.recurrencyId ??
    evt?.data?.recurrencyId
  );
}
function pickChargeId(evt: any): string | undefined {
  return evt?.data?.charge?.id ?? evt?.data?.cob?.id ?? evt?.data?.id;
}
function pickAmountCents(evt: any): number | undefined {
  const v =
    evt?.data?.charge?.value ??
    evt?.data?.value ??
    evt?.data?.amount ??
    evt?.amount;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/* ========= Mapeamento de status internos ========= */
function mapSubscriptionStatus(eventType: string): string | undefined {
  switch (eventType) {
    case "PIX_AUTOMATIC_APPROVED":       return "APPROVED";
    case "PIX_AUTOMATIC_REJECTED":       return "REJECTED";
    case "PIX_AUTOMATIC_COBR_CREATED":   return "CHARGE_CREATED";
    case "PIX_AUTOMATIC_COBR_APPROVED":  return "CHARGE_APPROVED";
    case "PIX_AUTOMATIC_COBR_REJECTED":  return "CHARGE_REJECTED";
    case "PIX_AUTOMATIC_COBR_COMPLETED": return "CHARGE_COMPLETED";
    default: return undefined;
  }
}
function mapChargeStatus(eventType: string): string | undefined {
  switch (eventType) {
    case "PIX_AUTOMATIC_COBR_CREATED":
    case "OPENPIX:CHARGE_CREATED":
      return "CREATED";
    case "PIX_AUTOMATIC_COBR_APPROVED":
      return "APPROVED";
    case "PIX_AUTOMATIC_COBR_REJECTED":
      return "REJECTED";
    case "PIX_AUTOMATIC_COBR_COMPLETED":
    case "OPENPIX:CHARGE_COMPLETED":
      return "COMPLETED";
    default: return undefined;
  }
}

/* ========= Handler ========= */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  try {
    const rawBody = JSON.stringify(req.body || {});
    const evt = (req.body || {}) as any;
    const type = String(evt?.type || "");
    const signature = (req.headers["x-woovi-signature"] as string) || "";

    if (!type) return res.status(400).json({ ok:false, error:"missing_event_type" });
    const secret = SECRET_BY_EVENT[type];
    if (!secret) return res.status(400).json({ ok:false, error:"unconfigured_event_secret", type });
    if (!signature) return res.status(400).json({ ok:false, error:"missing_signature_header" });

    const expected = hmac(rawBody, secret);
    if (!safeEq(expected, signature)) {
      return res.status(400).json({ ok:false, error:"invalid_signature" });
    }

    // --------- Persistência do evento (audit) ----------
    const nowIso = new Date().toISOString();
    const correlationID = pickCorrelationId(evt);
    const subGlobalID   = pickSubscriptionGlobalId(evt);
    const recurrencyId  = pickRecurrencyId(evt);
    const chargeId      = pickChargeId(evt);
    const amountCents   = pickAmountCents(evt);
    const webhookRow = {
      event_type: type,
      event_id: String(evt?.data?.id ?? "") || null,
      correlation_id: correlationID ?? null,
      subscription_global_id: subGlobalID ?? null,
      recurrency_id: recurrencyId ?? null,
      charge_id: chargeId ?? null,
      amount_cents: amountCents ?? null,
      status: mapChargeStatus(type) ?? mapSubscriptionStatus(type) ?? null,
      payload: evt,
      signature,
      received_at: nowIso,
    };

    // Salva em woovi_webhooks (sem RLS; somente service role)
    await supa.from("woovi_webhooks").insert(webhookRow).throwOnError();

    // --------- Atualização de assinatura ---------
    const subStatus = mapSubscriptionStatus(type);
    if (correlationID && subStatus) {
      const subUpdate: any = {
        status: subStatus,
        last_event_at: nowIso,
      };
      if (subGlobalID)  subUpdate.woovi_global_id = subGlobalID;
      if (recurrencyId) subUpdate.woovi_recurrency_id = recurrencyId;

      // Atualiza por correlation_id (multi-tenant seguro via RLS do app)
      await supa
        .from("subscriptions")
        .update(subUpdate)
        .eq("correlation_id", correlationID)
        .throwOnError();
    }

    // --------- Upsert de cobrança/pagamento ---------
    const chargeStatus = mapChargeStatus(type);
    if (chargeId) {
      const chargeRow: any = {
        charge_id: chargeId,
        correlation_id: correlationID ?? null,
        amount_cents: amountCents ?? null,
        status: chargeStatus ?? null,
        last_event_at: nowIso,
      };
      if (chargeStatus === "COMPLETED") {
        chargeRow.paid_at = nowIso;
      }

      // upsert por charge_id
      await supa
        .from("charges")
        .upsert(chargeRow, { onConflict: "charge_id" })
        .throwOnError();
    }

    console.log("[woovi:webhook] OK", { type, correlationID, chargeId, recurrencyId });
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("woovi_webhook_fail", err?.response?.data || err?.message || err);
    return res.status(500).json({ ok:false, error:"woovi_webhook_fail" });
  }
}
