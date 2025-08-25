// api/efi/cobr-upsert.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

/** CORS */
function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app" ||
    o === "https://assinapix.com" ||
    o.endsWith(".assinapix.com")
  ) {
    res.setHeader("Access-Control-Allow-Origin", o);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "PUT, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const COBR_BASE = (process.env.EFI_COBR_BASE || "/v2/cobr").trim();

const txidOk = (s?: string) => !!s && /^[A-Za-z0-9]{26,35}$/.test(String(s));
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const ymdOk = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(String(s));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "PUT" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const body = (req.body || {}) as any;

    // campos aceitos para COBR (Pix Automático)
    const txid        = body.txid as string | undefined; // se vier -> PUT
    const idRec       = body.idRec as string | undefined; // obrigatório nos dois modos
    const valor       = body.valor as { original?: string } | undefined;
    const calendario  = body.calendario as { dataDeVencimento?: string; validadeAposVencimento?: number } | undefined;
    const devedor     = body.devedor as { cpf?: string; nome?: string } | undefined; // cpf opcional na Efí (alguns PSP pedem), nome opcional
    const infoAdicional = body.infoAdicional as string | undefined; // opcional

    // validações mínimas
    if (!idRec) return res.status(400).json({ ok:false, error:"missing_idRec" });
    if (!valor?.original) return res.status(400).json({ ok:false, error:"missing_valor_original" });

    const original = String(valor.original);
    const dataDeVencimento = calendario?.dataDeVencimento;
    if (!ymdOk(dataDeVencimento)) {
      return res.status(400).json({
        ok:false,
        error:"missing_dataDeVencimento",
        hint:"Use YYYY-MM-DD"
      });
    }

    // devedor é opcional na Efí para COBR, mas alguns bancos exibem melhor com CPF
    // Se vier, normaliza CPF
    const cpf = onlyDigits(devedor?.cpf);
    const nome = (devedor?.nome || "").trim();

    // monta payload final aceito pela Efí
    const payload: any = {
      idRec: String(idRec),
      valor: { original },
      calendario: {
        dataDeVencimento: String(dataDeVencimento),
        ...(typeof calendario?.validadeAposVencimento === "number"
          ? { validadeAposVencimento: calendario.validadeAposVencimento }
          : {})
      },
      ...(cpf ? { devedor: { cpf: String(cpf), ...(nome ? { nome } : {}) } } : {}),
      ...(infoAdicional ? { infoAdicionais: [{ nome: "info", valor: String(infoAdicional) }] } : {})
    };

    const api = await efi();

    // Se veio txid válido -> PUT /v2/cobr/:txid (você controla o txid)
    // Caso contrário -> POST /v2/cobr (Efí gera o txid)
    let r;
    if (txid) {
      if (!txidOk(txid)) {
        return res.status(400).json({
          ok:false,
          error:"invalid_txid_format",
          hint:"txid deve ser A–Z a–z 0–9, com 26–35 caracteres"
        });
      }
      const url = `${COBR_BASE}/${encodeURIComponent(txid)}`;
      // PUT com payload
      r = await api.put(url, payload);
    } else {
      // POST sem txid
      r = await api.post(COBR_BASE, payload);
    }

    const d = r.data || {};
    const copiaECola =
      d?.pixCopiaECola ?? d?.dadosQR?.pixCopiaECola ?? null;
    const location =
      d?.loc?.location ?? d?.location ?? null;

    return res.status(200).json({
      ok: true,
      txid: d?.txid ?? (txid || null),
      idRec,
      location,
      copiaECola,
      raw: d
    });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("cobr_upsert_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"cobr_upsert_fail", detail });
  }
}
