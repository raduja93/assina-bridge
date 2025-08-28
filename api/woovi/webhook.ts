// api/woovi/webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

/* ========== CORS ========== */
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

/* ========== Mapa de segredos por evento ========== */
/** Configure no Vercel as ENV abaixo (valores fornecidos por você). */
const SECRET_BY_EVENT: Record<string, string | undefined> = {
  // Pix Automático (BCB)
  "PIX_AUTOMATIC_APPROVED":        process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_APPROVED,
  "PIX_AUTOMATIC_REJECTED":        process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_REJECTED,
  "PIX_AUTOMATIC_COBR_CREATED":    process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_COBR_CREATED,
  "PIX_AUTOMATIC_COBR_APPROVED":   process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_COBR_APPROVED,
  "PIX_AUTOMATIC_COBR_REJECTED":   process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_COBR_REJECTED,
  "PIX_AUTOMATIC_COBR_COMPLETED":  process.env.WOOVI_WH_SECRET_PIX_AUTOMATIC_COBR_COMPLETED,

  // OpenPix (cobranças avulsas / transações)
  "OPENPIX:CHARGE_CREATED":        process.env.WOOVI_WH_SECRET_OPENPIX_CHARGE_CREATED,
  "OPENPIX:CHARGE_COMPLETED":      process.env.WOOVI_WH_SECRET_OPENPIX_CHARGE_COMPLETED,
  "OPENPIX:TRANSACTION_RECEIVED":  process.env.WOOVI_WH_SECRET_OPENPIX_TRANSACTION_RECEIVED,
};

/* ========== Utils ========== */
function sign(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}
function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/** Dica: aumente o limit se precisar de payloads maiores */
export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  try {
    // No Vercel, o body já vem parseado; usamos JSON.stringify para recompor o raw.
    const rawBody = JSON.stringify(req.body || {});
    const evt = (req.body || {}) as any;
    const eventType: string = String(evt?.type || "");

    const headerSig = (req.headers["x-woovi-signature"] as string) || "";
    const secret = SECRET_BY_EVENT[eventType];

    if (!eventType) {
      return res.status(400).json({ ok:false, error:"missing_event_type" });
    }
    if (!secret) {
      // Melhor falhar explicitamente quando não houver segredo mapeado
      return res.status(400).json({ ok:false, error:"unconfigured_event_secret", eventType });
    }
    if (!headerSig) {
      return res.status(400).json({ ok:false, error:"missing_signature_header" });
    }

    const expected = sign(rawBody, secret);
    if (!safeEqual(expected, headerSig)) {
      return res.status(400).json({ ok:false, error:"invalid_signature" });
    }

    // ✅ Assinatura ok – registre log mínimo e responda 200 rápido
    console.log("[woovi:webhook] OK", { type: eventType, id: evt?.data?.id ?? null });

    // TODO: aqui você pode:
    // - persistir em Supabase (woovi_webhooks)
    // - atualizar assinaturas/pagamentos pelo correlationID
    // - disparar repasse automático quando necessário

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("woovi_webhook_fail", err?.response?.data || err?.message || err);
    return res.status(500).json({ ok:false, error:"woovi_webhook_fail" });
  }
}
