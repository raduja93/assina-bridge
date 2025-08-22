// api/webhook/cobr.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
// import sua persistência (Supabase) aqui

const seen = new Set<string>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const eventId = (req.headers["x-event-id"] as string) || req.body?.id || "";
  if (!eventId) return res.status(400).json({ error: "no_event_id" });
  if (seen.has(eventId)) return res.status(200).json({ ok: true, dedup: true });
  seen.add(eventId);

  try {
    const evt = req.body;
    // if evt.status === "pago" => marcar charge como paid, somar total_paid, programar próximo ciclo
    // if evt.status === "expirado" => marcar overdue, acionar dunning
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "webhook_cobr_fail" });
  }
}

