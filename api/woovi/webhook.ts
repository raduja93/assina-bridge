// api/woovi/webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/** ================= CORS ================= */
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

/** =============== HMAC helpers =============== */
// mapear nomes de evento Woovi -> variáveis de ambiente
const EVENT_ENV_KEYS: Record<string, string> = {
  PIX_AUTOMATIC_APPROVED: "WOOVI_WEBHOOK_SECRET_PIX_AUTOMATIC_APPROVED",
  PIX_AUTOMATIC_REJECTED: "WOOVI_WEBHOOK_SECRET_PIX_AUTOMATIC_REJECTED",
  PIX_AUTOMATIC_COBR_CREATED: "WOOVI_WEBHOOK_SECRET_PIX_AUTOMATIC_COBR_CREATED",
  PIX_AUTOMATIC_COBR_APPROVED: "WOOVI_WEBHOOK_SECRET_PIX_AUTOMATIC_COBR_APPROVED",
  PIX_AUTOMATIC_COBR_REJECTED: "WOOVI_WEBHOOK_SECRET_PIX_AUTOMATIC_COBR_REJECTED",
  PIX_AUTOMATIC_COBR_COMPLETED: "WOOVI_WEBHOOK_SECRET_PIX_AUTOMATIC_COBR_COMPLETED",
  "OPENPIX:CHARGE_CREATED": "WOOVI_WEBHOOK_SECRET_OPENPIX_CHARGE_CREATED",
  "OPENPIX:CHARGE_COMPLETED": "WOOVI_WEBHOOK_SECRET_OPENPIX_CHARGE_COMPLETED",
  "OPENPIX:TRANSACTION_RECEIVED": "WOOVI_WEBHOOK_SECRET_OPENPIX_TRANSACTION_RECEIVED",
};

function hmacHex(secret: string, data: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

function validateSignature(eventType: string, raw: string, signature?: string): { ok: boolean; used: string | null } {
  // No painel a chave aparece como "openpix_xxx=", mas a assinatura enviada vem como HEX no header.
  // Aqui assumimos que o header `x-woovi-signature` é hex (padrão). Validamos contra:
  // 1) segredo específico do evento (se existir), 2) fallback DEFAULT (se existir).
  if (!signature) return { ok: false, used: null };
  const secretsToTry: string[] = [];

  const perEventEnv = EVENT_ENV_KEYS[eventType];
  if (perEventEnv && process.env[perEventEnv]) secretsToTry.push(process.env[perEventEnv] as string);
  if (process.env.WOOVI_WEBHOOK_SECRET_DEFAULT) secretsToTry.push(process.env.WOOVI_WEBHOOK_SECRET_DEFAULT as string);

  if (secretsToTry.length === 0) {
    // Se você não configurou nenhum segredo, não bloqueie (apenas marque sig_ok=false)
    return { ok: false, used: null };
  }

  try {
    const sigBuf = Buffer.from(signature, "hex");
    for (const sec of secretsToTry) {
      const calc = hmacHex(sec, raw);
      const calcBuf = Buffer.from(calc, "hex");
      if (sigBuf.length === calcBuf.length && crypto.timingSafeEqual(sigBuf, calcBuf)) {
        return { ok: true, used: sec };
      }
    }
    return { ok: false, used: null };
  } catch {
    return { ok: false, used: null };
  }
}

/** =============== Supabase =============== */
const SB_URL = process.env.SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

/** =============== Utils =============== */
const onlyDigits = (s: any) => String(s ?? "").replace(/\D/g, "");

function getEventType(evt: any): string {
  return (
    evt?.event ||
    evt?.type ||
    evt?.topic ||
    "" // ex.: PIX_AUTOMATIC_APPROVED, OPENPIX:CHARGE_CREATED, etc.
  );
}

function getCorrelationId(evt: any): string | null {
  return (
    evt?.correlationID ||
    evt?.customer?.correlationID ||
    evt?.pixRecurring?.correlationID ||
    null
  );
}

function deriveEventId(req: VercelRequest, evt: any, raw: string): string {
  // tente cabeçalho/ids explícitos; se não houver, usa sha256 do corpo
  return (
    (req.headers["x-woovi-event-id"] as string) ||
    evt?.eventId ||
    evt?.id ||
    evt?.globalID ||
    evt?.cobr?.identifierId ||     // COBR
    evt?.charge?.id ||             // CHARGE
    crypto.createHash("sha256").update(raw).digest("hex")
  );
}

/** =============== Vercel body limit =============== */
export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

/** =============== Handler =============== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  if (!SB_URL || !SB_KEY) {
    return res.status(500).json({ ok: false, error: "missing_supabase_env" });
  }

  try {
    // No Vercel, req.body já está parseado; reconstruímos o JSON string para HMAC
    const evt = (req.body || {}) as any;
    const raw = JSON.stringify(evt);
    const eventType = getEventType(evt);
    const signature = (req.headers["x-woovi-signature"] as string) || "";
    const { ok: sigOk } = validateSignature(eventType, raw, signature);

    const eventId = deriveEventId(req, evt, raw);
    const correlationID = getCorrelationId(evt);
    const nowIso = new Date().toISOString();

    // ===== 1) Persistir o webhook (idempotente por event_id) =====
    // Requer índice único parcial (WHERE event_id IS NOT NULL) OU onConflict:event_id
    const { error: insErr } = await sb
      .from("woovi_webhooks")
      .upsert(
        {
          event_id: eventId,
          event_type: eventType,
          correlation_id: correlationID,
          payload: evt,
          signature: signature || null,
          sig_ok: sigOk,
          received_at: nowIso,
        },
        { onConflict: "event_id" }
      );

    if (insErr) {
      console.error("supabase insert webhook error", insErr);
      return res.status(500).json({ ok: false, error: "db_insert_webhook_fail", detail: insErr });
    }

    // ===== 2) Upsert em subscriptions por correlation_id =====
    if (correlationID) {
      const subUpdates: Record<string, any> = {
        correlation_id: correlationID,
        last_event_at: nowIso,
        last_payload: evt,
      };

      // status da recorrência
      if (evt?.pixRecurring?.status) {
        subUpdates.status = String(evt.pixRecurring.status);
      }
      // recurrencyId
      if (evt?.pixRecurring?.recurrencyId) {
        subUpdates.pix_recurring_recurrency_id = String(evt.pixRecurring.recurrencyId);
      }
      // valor em centavos (alguns eventos trazem)
      if (Number.isFinite(evt?.value)) {
        subUpdates.value_cents = Math.trunc(Number(evt.value));
      }
      // client taxid (se vier)
      const tax = onlyDigits(evt?.customer?.taxID?.taxID || evt?.customer?.taxID);
      if (tax) subUpdates.customer_taxid = tax;

      const { error: upSubErr } = await sb
        .from("subscriptions")
        .upsert(subUpdates, { onConflict: "correlation_id" });

      if (upSubErr) console.error("subscriptions upsert error", upSubErr);
    }

    // ===== 3) Upsert em charges (COBR / CHARGE) =====
    // PIX_AUTOMATIC_COBR_* => evt.cobr
    if (evt?.cobr?.installmentId || evt?.cobr?.identifierId) {
      const installmentId = String(evt.cobr.installmentId || evt.cobr.identifierId);
      const chargeRow: Record<string, any> = {
        installment_id: installmentId,
        identifier_id: evt.cobr.identifierId || null,
        subscription_correlation_id: correlationID,
        value_cents: Number.isFinite(evt.cobr.value) ? Math.trunc(Number(evt.cobr.value)) : null,
        status: evt.cobr.status || null,
        description: evt.cobr.description || null,
        created_at_woovi: evt.cobr.createdAt || null,
        last_event_at: nowIso,
        last_payload: evt,
      };

      const { error: upCobrErr } = await sb
        .from("charges")
        .upsert(chargeRow, { onConflict: "installment_id" });

      if (upCobrErr) console.error("charges upsert (cobr) error", upCobrErr);
    }

    // OPENPIX:CHARGE_* => evt.charge (se sua conta emitir cobranças avulsas)
    if (evt?.charge?.id) {
      const chargeId = String(evt.charge.id);
      const chargeRow: Record<string, any> = {
        installment_id: chargeId, // reutilizamos a coluna como PK lógico
        identifier_id: evt.charge.identifier || null,
        subscription_correlation_id: correlationID,
        value_cents: Number.isFinite(evt.charge.value) ? Math.trunc(Number(evt.charge.value)) : null,
        status: evt.charge.status || null,
        description: evt.charge.comment || evt.charge.description || null,
        created_at_woovi: evt.charge.createdAt || null,
        last_event_at: nowIso,
        last_payload: evt,
      };

      const { error: upChgErr } = await sb
        .from("charges")
        .upsert(chargeRow, { onConflict: "installment_id" });

      if (upChgErr) console.error("charges upsert (charge) error", upChgErr);
    }

    // ===== 4) Fim =====
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("woovi_webhook_fail", err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, error: "woovi_webhook_fail" });
  }
}
