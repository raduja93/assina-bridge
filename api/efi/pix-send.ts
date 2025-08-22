// api/efi/pix-send.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { chave, valor, descricao } = req.body; // exemplo
    const api = await efi();

    // endpoint ilustrativo para "enviar Pix" (exige escopo pix.send)
    const { data } = await api.post(`/v2/pix`, {
      chave,
      valor,
      descricao,
    });

    return res.status(200).json({ ok: true, data });
  } catch (err: any) {
    console.error(err?.response?.data || err);
    return res.status(err?.response?.status || 500).json(err?.response?.data || { error: "pix_send_fail" });
  }
}
