// api/webhook/cobr.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WEBHOOK_COBR_SECRET = process.env.WEBHOOK_COBR_SECRET!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // 1) autenticação simples por segredo compartilhado
  const provided =
    (req.headers["x-webhook-token"] as string) ||
    (req.query["token"] as string) ||
    "";
  if (!WEBHOOK_COBR_SECRET || provided !== WEBHOOK_COBR_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // 2) idempotência: tenta usar um id do provedor, senão gera hash estável do corpo
  const body = req.body ?? {};
  const eventIdHeader = (req.headers["x-event-id"] as string) || "";
  const rawId =
    eventIdHeader ||
    body.id ||
    body.event_id ||
    body.eventId ||
    body.charge_id ||
    body.cobranca_id ||
    body.e2eid ||
    body.txid ||
    "";
  const eventId = rawId || createStableId(body);

  try {
    // 3) registra evento (se já existir, dedupe)
    const { error: insertErr } = await supabase
      .from("pix_cobr_webhooks")
      .insert([{ event_id: eventId, payload: body, source: "efi" }], {
        returning: "minimal",
      });

    if (insertErr && insertErr.code !== "23505") {
      console.error("db_insert_failed", insertErr);
      return res.status(500).json({ error: "db_insert_failed" });
    }
    if (insertErr && insertErr.code === "23505") {
      return res.status(200).json({ ok: true, dedup: true, event_id: eventId });
    }

    // 4) (opcional) promoção imediata: extraia campos se você já souber o shape
    // Exemplo genérico — adapte quando confirmar nomes do payload da Efí:
    // const status =
    //   body.status || body.cobranca?.status || body.situacao || null;
    // const txid =
    //   body.txid || body.cobranca?.txid || body.identificador || null;
    // const e2eid = body.e2eid || body.pix?.e2eid || null;
    // const valor =
    //   body.valor || body.cobranca?.valor || body.pix?.valor || null;
    //
    // if (txid && status) {
    //   await supabase
    //     .from("pix_charges")
    //     .update({
    //       status:
    //         status === "pago" || status === "CONCLUIDA" ? "paid" :
    //         status === "expirado" || status === "EXPIRADA" ? "expired" :
    //         status.toString().toLowerCase(),
    //       ...(e2eid ? { e2eid } : {}),
    //       ...(valor ? { amount_cents: Math.round(Number(valor) * 100) } : {}),
    //       updated_at: new Date().toISOString(),
    //     })
    //     .eq("txid", txid);
    // }

    // 5) marca como processado (ou deixe para um job de processamento)
    await supabase
      .from("pix_cobr_webhooks")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("event_id", eventId);

    return res.status(200).json({ ok: true, event_id: eventId });
  } catch (e) {
    console.error("webhook_cobr_fail", e);
    return res.status(500).json({ error: "webhook_cobr_fail" });
  }
}

// util: id estável quando o provedor não envia id
function createStableId(obj: unknown) {
  try {
    const json = JSON.stringify(obj || {});
    let h = 0;
    for (let i = 0; i < json.length; i++) h = (Math.imul(31, h) + json.charCodeAt(i)) | 0;
    return `hash_${Math.abs(h)}`;
  } catch {
    return `hash_${Date.now()}`;
  }
}

