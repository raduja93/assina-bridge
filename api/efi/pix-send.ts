// api/efi/pix-send.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efiClient } from "../../lib/efiClient.js";
import { requireBearer } from "../../lib/auth.js";

function randomIdEnvio() {
  // 24-32 chars alfanum já é suficiente como id único
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, hint: "Use POST com JSON { keyType, keyValue, amount, description }" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!requireBearer(req, res)) return;

  try {
    const { keyType, keyValue, amount, description } = req.body || {};
    if (!keyType || !keyValue || !amount) {
      return res.status(400).json({ error: "keyType, keyValue e amount (centavos) são obrigatórios" });
    }

    // chave do pagador: sua chave Pix da conta-mestra (que envia o dinheiro)
    const payerKey = process.env.EFI_PAYER_PIX_KEY || process.env.EFI_RECEIVER_PIX_KEY; // use uma das que vc configurou
    if (!payerKey) {
      return res.status(500).json({ error: "missing_payer_key", details: "Configure EFI_PAYER_PIX_KEY nas variáveis da Vercel" });
    }

    const client = await efiClient();

    // gera um id único para este envio
    const idEnvio = randomIdEnvio();

    // Body conforme doc "Requisitar envio de Pix"
    const body = {
      valor: (amount / 100).toFixed(2),
      pagador: {
        chave: payerKey,
        infoPagador: description || "Repasse AssinaPix"
      },
      favorecido: {
        // a Efí identifica o tipo de chave automaticamente (email, cpf, cnpj, telefone, evp)
        chave: keyValue
      }
    };

    // Preferir v3; se seu app ainda não tiver, pode trocar para /v2/gn/pix/
    const url = `/v3/gn/pix/${idEnvio}`;
    const sendResp = await client.put(url, body);

    return res.status(200).json({
      idEnvio,
      e2eId: sendResp.data?.e2eId || null,
      valor: sendResp.data?.valor,
      status: sendResp.data?.status || "EM_PROCESSAMENTO",
      horario: sendResp.data?.horario,
      raw: sendResp.data
    });
  } catch (err: any) {
    console.error(err?.response?.data || err);
    return res.status(500).json({ error: "efi_pix_send_failed", details: err?.response?.data || err?.message });
  }
}
