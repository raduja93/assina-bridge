// api/webhook/rec.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
// import sua persistência (Supabase) aqui

const seen = new Set<string>(); // troque por tabela de idempotência

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const eventId = (req.headers["x-event-id"] as string) || req.body?.id || "";
  if (!eventId) return res.status(400).json({ error: "no_event_id" });
  if (seen.has(eventId)) return res.status(200).json({ ok: true, dedup: true });
  seen.add(eventId);

  try {
    const evt = req.body;
    // TODO: validar assinatura se aplicável
    // TODO: atualizar sua tabela de recorrências/assinantes no Supabase
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "webhook_rec_fail" });
  }
}

