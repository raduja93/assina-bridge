// api/woovi/webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

/** ===== CORS ===== */
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

/** ===== ENV ===== */
const WEBHOOK_SECRET = process.env.WOOVI_WEBHOOK_SECRET || "";

/** ===== Helpers ===== */
async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function normalizeSig(s?: string) {
  if (!s) return "";
  // remove prefixos tipo "sha256=..."
  const i = s.indexOf("=");
  return i > -1 ? s.slice(i + 1).trim() : s.trim();
}

function computeHmac(raw: Buffer, secret: string) {
  const h = crypto.createHmac("sha256", secret).update(raw);
  return {
    hex: h.digest("hex"),
    // para comparar também em base64 quando o provedor enviar assim
    base64: crypto.createHmac("sha256", secret).update(raw).digest("base64"),
  };
}

export const config = {
  api: {
    bodyParser: false, // IMPORTANTÍSSIMO: queremos o raw body
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  try {
    const trace = crypto.randomBytes(6).toString("hex"); // simples trace id
    const raw = await readRawBody(req);

    // tente ambos headers (legado e novo)
    const sigHeader =
      (req.headers["x-woovi-signature"] as string) ||
      (req.headers["x-openpix-signature"] as string) ||
      "";

    const provided = normalizeSig(sigHeader);

    if (WEBHOOK_SECRET) {
      const { hex, base64 } = computeHmac(raw, WEBHOOK_SECRET);
      const ok = safeEqual(provided, hex) || safeEqual(provided, base64);
      if (!ok) {
        console.error("[woovi:webhook] invalid_signature", { trace, providedLen: provided.length });
        return res.status(400).json({ ok: false, error: "invalid_signature", trace });
      }
    }

    // Só depois de validar, parseamos o JSON
    let evt: any = {};
    try {
      evt = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      console.error("[woovi:webhook] bad_json", { trace });
      return res.status(400).json({ ok: false, error: "invalid_json", trace });
    }

    // Logs resumidos/úteis:
    const type = evt?.type || evt?.event || "unknown";
    const data = evt?.data || {};
    const correlationID =
      data?.subscription?.correlationID ||
      data?.correlationID ||
      null;
    const recurrencyId =
      data?.pixRecurring?.recurrencyId ||
      data?.recurrencyId ||
      null;
    const chargeId = data?.charge?.id || null;

    console.log("[woovi:webhook] recv", {
      trace, type, correlationID, recurrencyId, chargeId,
    });

    // TODO:
    // - Persistir evt (ex.: tabela woovi_webhooks)
    // - Atualizar subscriptions/charges por correlationID/recurrencyId/chargeId
    // - Se for pagamento aprovado, disparar workflow de repasse

    return res.status(200).json({ ok: true, trace });
  } catch (err: any) {
    console.error("[woovi:webhook] fail", err?.message || err);
    return res.status(500).json({ ok: false, error: "woovi_webhook_fail" });
  }
}
