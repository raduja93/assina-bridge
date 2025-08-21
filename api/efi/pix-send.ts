import type { VercelRequest, VercelResponse } from '@vercel/node';
import { efiClient } from '../../lib/efiClient';

function authOk(req: VercelRequest): boolean {
  const header = req.headers['authorization'] || '';
  const expected = `Bearer ${process.env.BRIDGE_TOKEN}`;
  return header === expected;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const { keyType, keyValue, amount, description } = req.body || {};
    if (!keyType || !keyValue || !amount) {
      return res.status(400).json({ error: 'keyType, keyValue e amount são obrigatórios' });
    }

    const client = await efiClient();

    // Envio de Pix (repasse). Para alguns PSPs, basta informar a 'chave' e 'valor'.
    const body: any = {
      valor: (Number(amount) / 100).toFixed(2),
      chave: String(keyValue),
      descricao: description ? String(description).slice(0, 100) : 'Repasse AssinaPix'
    };

    // Idempotency-Key ajuda a não duplicar envios acidentais
    const idempotency = `repasse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const sendResp = await client.post('/v2/pix', body, {
      headers: { 'Idempotency-Key': idempotency }
    });

    // Alguns PSPs retornam endToEndId (e2eid) ou algo similar
    const endToEndId = sendResp.data?.endToEndId || sendResp.data?.e2eid || null;

    return res.status(200).json({
      endToEndId,
      status: 'SUBMITTED',
      raw: sendResp.data
    });
  } catch (err: any) {
    const details = err?.response?.data || err?.message || String(err);
    if (process.env.DEBUG_LOG) console.error('[efi/pix-send] error:', details);
    return res.status(500).json({ error: 'efi_pix_send_failed', details });
  }
}
