// api/efi/rec.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

// 1) CORS — libere apenas o seu frontend (defina ALLOWED_ORIGIN na Vercel)
const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "https://assinapix-manager.vercel.app";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 2) responde o preflight do navegador
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    // 3) validação básica do que esperamos receber do frontend
    const { planId, businessId, subscriber, amount_cents, periodicity, description } =
      (req.body as any) || {};

    if (!subscriber?.name || !subscriber?.cpf || !amount_cents || !periodicity) {
      setCors(res);
      return res.status(400).json({
        ok: false,
        error: "missing_fields",
        need: ["subscriber.name", "subscriber.cpf", "amount_cents", "periodicity"],
      });
    }

    // 4) POR ENQUANTO: só ecoa os dados (prova que a rota está ok e CORS também)
    //    >>> depois trocamos pelo POST real na Efí, aqui dentro.
    setCors(res);
    return res.status(200).json({
      ok: true,
      message:
        "Bridge recebeu os dados. Próximo passo: chamar a Efí aqui dentro deste handler.",
      received: { planId, businessId, subscriber, amount_cents, periodicity, description },
    });
  } catch (e: any) {
    console.error("rec_fail", e);
    setCors(res);
    return res.status(500).json({ ok: false, error: "rec_fail" });
  }
}
