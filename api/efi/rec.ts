// api/efi/rec.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { subscriber, amount_cents, periodicity, description } = req.body || {};
    if (!subscriber?.name || !subscriber?.cpf || !amount_cents || !periodicity) {
      return res.status(400).json({ error: "missing_fields" });
    }

    // por enquanto só confirma que recebeu (para testar o frontend)
    return res.status(200).json({
      ok: true,
      message: "Bridge recebeu os dados. Próximo passo: chamar a Efí por aqui.",
      received: { subscriber, amount_cents, periodicity, description }
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "rec_fail" });
  }
}
