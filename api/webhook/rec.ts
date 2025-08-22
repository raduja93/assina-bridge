// api/webhook/rec.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WEBHOOK_REC_SECRET = process.env.WEBHOOK_REC_SECRET!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // 1) validação do segredo (sem assumir mecanismo da Efí; use um header seu)
  const provided = (req.headers["x-webhook-token"] as string) || (req.query["token"] as string) || "";
  if (!WEBHOOK_REC_SECRET || provided !== WEBHOOK_REC_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // 2) idempotência (não assumimos nome do campo; tentamos ler algo e caímos para hash)
  const body = req.body ?? {};
  const eventIdHeader = (req.headers["x-event-id"] as string) || "";
  const rawId =
    eventIdHeader ||
    body.id ||
    body.event_id ||
    body.eventId ||
    body.recurrence_id ||
    body.recorrencia_id ||
    "";

  // fallback robusto: hash simples do corpo se não veio nenhum id
  const eventId = rawId || createStableId(body);

  try {
    // 3) tenta registrar; se já existir, é dedupe
    const { error: insertErr } = await supabase
      .from("pix_rec_webhooks")
      .insert([{ event_id: eventId, payload: body, source: "efi" }], { returning: "minimal" });

    if (insertErr && insertErr.code !== "23505") {
      // 23505 = unique_violation
      console.error("insert error", insertErr);
      return res.status(500).json({ error: "db_insert_failed" });
    }
    if (insertErr && insertErr.code === "23505") {
      return res.status(200).json({ ok: true, dedup: true, event_id: eventId });
    }

    // 4) (opcional) aqui você pode já tentar extrair status/ids e atualizar suas tabelas
    // -> deixo comentado para você plugar quando conhecer o shape exato:
    // const status = body.status || body.recorrencia?.status;
    // const recId  = body.recurrenceId || body.recorrencia?.id;
    // if (status && recId) {
    //   await supabase.from("pix_recurrences").update({ status }).eq("efi_rec_id", recId);
    // }

    // marca como processado (você pode mover isso para o fim do fluxo real)
    await supabase
      .from("pix_rec_webhooks")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("event_id", eventId);

    return res.status(200).json({ ok: true, event_id: eventId });
  } catch (e) {
    console.error("webhook_rec_fail", e);
    return res.status(500).json({ error: "webhook_rec_fail" });
  }
}

// util: id estável a partir do JSON (quando o provedor não manda id)
function createStableId(obj: unknown) {
  try {
    const json = JSON.stringify(obj || {});
    // hash simples e determinístico:
    let h = 0;
    for (let i = 0; i < json.length; i++) {
      h = (Math.imul(31, h) + json.charCodeAt(i)) | 0;
    }
    return `hash_${Math.abs(h)}`;
  } catch {
    return `hash_${Date.now()}`;
  }
}


