// api/efi/cobr-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app" ||
    o === "https://assinapix.com" ||
    o.endsWith(".assinapix.com")
  ) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const COBR_BASE = (process.env.EFI_COBR_BASE || "/v2/cobr").trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const body = (req.body || {}) as any;
    // Aqui EXIGE que já venha como { cobr: {...} } para não ter ambiguidade
    if (!body?.cobr?.idRec) return res.status(400).json({ ok:false, error:"missing_idRec" });
    if (!body?.cobr?.valor?.original) return res.status(400).json({ ok:false, error:"missing_valor_original" });
    if (!body?.cobr?.calendario?.dataDeVencimento) {
      return res.status(400).json({ ok:false, error:"missing_dataDeVencimento", hint:"Use YYYY-MM-DD" });
    }

    // NÃO envie devedor/chave aqui
    const cobr = {
      idRec: String(body.cobr.idRec),
      valor: { original: String(body.cobr.valor.original) },
      calendario: {
        dataDeVencimento: String(body.cobr.calendario.dataDeVencimento),
        ...(body.cobr.calendario.validadeAposVencimento
          ? { validadeAposVencimento: Number(body.cobr.calendario.validadeAposVencimento) } : {}),
      },
      ...(body.cobr.infoAdicional ? { infoAdicional: String(body.cobr.infoAdicional) } : {})
    };

    const api = await efi();
    const r = await api.post(COBR_BASE, { cobr });
    const d = r.data || {};

    return res.status(200).json({
      ok: true,
      txid: d?.txid ?? null,
      idRec: cobr.idRec,
      location: d?.loc?.location ?? d?.location ?? null,
      copiaECola: d?.pixCopiaECola ?? d?.dadosQR?.pixCopiaECola ?? null,
      raw: d,
    });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("cobr_create_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"cobr_create_fail", detail });
  }
}
