// api/efi/cob-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

// CORS simples (ajuste domínios de prod quando for lançar)
function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app"
    // o === "https://app.assinapix.com"
  ) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const COB_BASE = (process.env.EFI_COB_BASE || "/v2/cob").trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { chave, valor, devedor, calendario, solicitacaoPagador } = (req.body || {}) as any;

    // validações mínimas
    if (!chave) return res.status(400).json({ ok:false, error:"missing_chave" });
    if (!valor?.original) return res.status(400).json({ ok:false, error:"missing_valor_original" });
    if (!devedor?.cpf || !devedor?.nome) {
      return res.status(400).json({ ok:false, error:"missing_devedor", need:["devedor.cpf","devedor.nome"] });
    }

    // COBR: cobrança IMEDIATA → POST /v2/cob
    // doc típica: chave, valor.original (string), devedor{cpf,nome}, calendario{expiracao?}, solicitacaoPagador?
    const payload = {
      chave,
      valor: { original: String(valor.original) },         // ex "55.00"
      devedor: { cpf: String(devedor.cpf), nome: String(devedor.nome) },
      ...(calendario?.expiracao ? { calendario: { expiracao: calendario.expiracao } } : {}),
      ...(solicitacaoPagador ? { solicitacaoPagador } : {})
    };

    const api = await efi();
    const r = await api.post(COB_BASE, payload);          // POST /v2/cob

    // Retorna dados úteis
    const data = r.data || {};
    return res.status(200).json({
      ok: true,
      txid: data?.txid ?? null,
      location: data?.loc?.location ?? null,
      copiaECola: data?.pixCopiaECola ?? data?.dadosQR?.pixCopiaECola ?? null,
      raw: data
    });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("cob_create_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"cob_create_fail", detail });
  }
}
