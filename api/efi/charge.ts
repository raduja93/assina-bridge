import type { VercelRequest, VercelResponse } from '@vercel/node';
import { efiClient } from '../../lib/efiClient.js';

function authOk(req: VercelRequest): boolean {
  const header = req.headers['authorization'] || '';
  const expected = `Bearer ${process.env.BRIDGE_TOKEN}`;
  return header === expected;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const { amount, description } = req.body || {};
    if (!amount || !description) {
      return res.status(400).json({ error: 'amount e description são obrigatórios' });
    }
    const PIX_CHAVE = process.env.PIX_CHAVE;
    if (!PIX_CHAVE) {
      return res.status(400).json({ error: 'PIX_CHAVE não configurada no ambiente' });
    }

    const client = await efiClient();

    // 1) Criar cobrança imediata (COB)
    // Campos seguem o padrão Pix BACEN; ajuste conforme sua doc EFÍ
    const createCob = await client.post('/v2/cob', {
      calendario: { expiracao: 3600 },
      valor: { original: (Number(amount) / 100).toFixed(2) },
      chave: PIX_CHAVE,
      solicitacaoPagador: String(description).slice(0, 100)
    });

    const { txid, loc } = createCob.data || {};
    if (!loc?.id) {
      return res.status(502).json({ error: 'efi_response_unexpected', details: createCob.data });
    }

    // 2) Obter payload do QR (qrcode e imagem base64)
    const qrResp = await client.get(`/v2/loc/${loc.id}/qrcode`);
    const copiaECola = qrResp.data?.qrcode || null;
    const qrcodeBase64 = qrResp.data?.imagemQrcode || null;

    return res.status(200).json({
      id: txid,
      status: 'ATIVA',
      copiaECola,
      qrcodeBase64,
      locId: loc.id
    });
  } catch (err: any) {
    const details = err?.response?.data || err?.message || String(err);
    if (process.env.DEBUG_LOG) console.error('[efi/charge] error:', details);
    return res.status(500).json({ error: 'efi_charge_failed', details });
  }
}
