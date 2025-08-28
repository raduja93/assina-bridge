// api/woovi/webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/** ========= RAW BODY (precisa do bodyParser: false) ========= */
export const config = {
  api: { bodyParser: false },
};

/** ========= CORS ========= */
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Woovi-Signature, X-Openpix-Signature");
}

/** ========= Leitura do corpo cru ========= */
async function readRaw(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** ========= HMAC ========= */
// Mapa de segredos por evento (defina no Vercel)
// ex.: PIX_AUTOMATIC_APPROVED -> WOOVI_HMAC_PIX_AUTOMATIC_APPROVED, etc.
function secretForEvent(evt: string): string | undefined {
  const key = "WOOVI_HMAC_" + evt.replace(/[^A-Z0-9_]/g, "_");
  return process.env[key] || process.env.WOOVI_WEBHOOK_SECRET || undefined;
}

function isValidSignature(secret: string, rawBody: Buffer, sigHeader?: string): boolean {
  if (!secret) return false;
  if (!sigHeader) return false;
  // Woovi envia Base64; calculamos em hex e comparamos em timing-safe após normalizar
  // Alguns ambientes enviam como base64 ou hex – aceitamos ambos
  const hmac = crypto.createHmac("sha256", secret).update(rawBody);
  const calcHex = hmac.digest("hex");
  const calcB64 = Buffer.from(calcHex, "hex").toString("base64");
  const candidate = sigHeader.trim();

  try {
    const a = Buffer.from(candidate);
    const b = Buffer.from(calcHex);
    const c = Buffer.from(calcB64);
    return crypto.timingSafeEqual(a, b) || crypto.timingSafeEqual(a, c);
  } catch {
    return candidate === calcHex || candidate === calcB64;
  }
}

/** ========= Supabase ========= */
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

/** ========= Handler ========= */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const raw = await readRaw(req);
    const sig = (req.headers["x-openpix-signature"] as string) || (req.headers["x-woovi-signature"] as string) || "";
    const json = JSON.parse(raw.toString("utf8") || "{}");

    const eventType: string = String(json?.event || "").trim();
    const secret = secretForEvent(eventType);
    const sigOk = !!secret && isValidSignature(secret, raw, sig);

    // Para depuração: permitir gravar mesmo sem HMAC válido
    const allowUnverified = String(process.env.WOOVI_ALLOW_UNVERIFIED || "").toLowerCase() === "true";
    if (!sigOk && !allowUnverified) {
      console.warn("webhook: invalid signature", { eventType, sigPresent: !!sig, usedSecret: !!secret });
      return res.status(400).json({ ok: false, error: "invalid_signature", eventType });
    }

    // Dados úteis (ajuste para seu schema)
    const correlationID =
      json?.correlationID ||
      json?.data?.correlationID ||
      json?.customer?.taxID?.taxID ||
      json?.customer?.taxID ||
      null;

    // Gravar webhook
    if (!supabase) {
      console.error("Supabase credentials missing");
    } else {
      const insertPayload = {
        event_type: eventType,
        correlation_id: correlationID,
        signature: sig || null,
        sig_ok: sigOk,
        payload: json,
        received_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("woovi_webhooks").insert(insertPayload);
      if (error) console.error("supabase insert webhook error", error);
    }

    // Atualizações de estado básicas (exemplo)
    if (supabase && correlationID && typeof correlationID === "string") {
      // Aprovação da recorrência
      if (eventType === "PIX_AUTOMATIC_APPROVED") {
        const recurrencyId =
          json?.pixRecurring?.recurrencyId || json?.data?.pixRecurring?.recurrencyId || null;
        await supabase
          .from("subscriptions")
          .update({ status: "ACTIVE", recurrency_id: recurrencyId, last_event_at: new Date().toISOString() })
          .eq("correlation_id", correlationID);
      }

      // Cobrança criada/aprovada/paga etc. (ajuste nomes/colunas da sua tabela)
      if (eventType === "PIX_AUTOMATIC_COBR_CREATED" || eventType === "PIX_AUTOMATIC_COBR_APPROVED" || eventType === "PIX_AUTOMATIC_COBR_COMPLETED") {
        const installmentId = json?.cobr?.installmentId || json?.data?.cobr?.installmentId || null;
        const status = json?.cobr?.status || json?.data?.cobr?.status || null;
        await supabase
          .from("charges")
          .upsert({
            correlation_id: correlationID,
            installment_id: installmentId,
            woovi_status: status,
            last_event_at: new Date().toISOString(),
          }, { onConflict: "installment_id" });
      }
    }

    // Sempre 200 para evitar re-entregas infinitas (logamos sig_ok no banco)
    return res.status(200).json({ ok: true, accepted: true, event: eventType, sig_ok: sigOk });
  } catch (e: any) {
    console.error("woovi_webhook_fail", e?.message || e);
    return res.status(500).json({ ok: false, error: "woovi_webhook_fail" });
  }
}
