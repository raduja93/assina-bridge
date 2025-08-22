// api/efi/charge.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const body = req.body || {};
    // shape exemplo – ajuste conforme seus campos:
    // { customerId, valor: 9900, descricao: "Plano X", periodicidade: "mensal", ... }

    const api = await efi();

    // Ex.: criação de RECORRÊNCIA (Pix Automático) requer escopo rec.write
    // O caminho real pode variar conforme o recurso que você habilitou; ajuste:
    const { data } = await api.post(`/v2/rec`, {
      // mapeie os campos esperados pela Efí aqui
      ...body,
    });

    return res.status(200).json({ ok: true, data });
  } catch (err: any) {
    console.error(err?.response?.data || err);
    return res.status(err?.response?.status || 500).json(err?.response?.data || { error: "charge_fail" });
  }
}

