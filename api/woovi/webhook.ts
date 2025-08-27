// api/woovi/webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Woovi-Signature");
}

/** ========= Assinatura (opcional) ========= */
const WEBHOOK_SECRET = process.env.WOOVI_WEBHOOK_SECRET || "";

function isValidSignature(rawBody: string, signature?: string): boolean {
  if (!WEBHOOK_SECRET) return true; // se não configurou, pula validação
  if (!signature) return false;
  const h = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  // compare em tempo constante
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(signature));
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    // rawBody para assinatura (no Vercel, body já vem parseado; recupere a string do req se necessário)
    const raw = JSON.stringify(req.body || {});
    const sig = (req.headers["x-woovi-signature"] as string) || "";

    if (!isValidSignature(raw, sig)) {
      return res.status(400).json({ ok:false, error:"invalid_signature" });
    }

    const evt = req.body || {};
    // Exemplos de campos úteis (dependem da Woovi):
    // evt.type, evt.data.subscription, evt.data.charge, evt.data.pixRecurring, evt.data.correlationID, etc.

    // TODO: aqui você:
    // - persiste o evento (woovi_webhooks)
    // - atualiza assinaturas/charges no Supabase pelo correlationID/subaccountId/ids
    // - dispara o "repasse" (Pix out) quando cair um pagamento (se for o seu flow)

    return res.status(200).json({ ok:true });
  } catch (err:any) {
    console.error("woovi_webhook_fail", err?.response?.data || err?.message);
    return res.status(500).json({ ok:false, error:"woovi_webhook_fail" });
  }
}
