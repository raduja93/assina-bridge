// api/efi/rec-activate.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

// CORS: deixe lovable em dev; em prod feche para seu domínio fixo
function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || "";
  if (
    origin.endsWith(".lovable.app") ||
    origin.endsWith(".sandbox.lovable.dev") ||
    origin === "https://assinapix-manager.vercel.app"
    // "https://app.assinapix.com"  // habilite em produção
  ) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const REC_BASE = (process.env.EFI_REC_GET_PATH || "/v2/rec").trim(); // GET/PATCH /v2/rec/:idRec

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { idRec, txid, tipoJornada } = req.body || {};
    if (!idRec) return res.status(400).json({ ok:false, error:"missing_idRec" });

    const api = await efi();

    // 1) PATCH /v2/rec/:idRec  (define dados da jornada se enviados)
    if (txid || tipoJornada) {
      const patchBody: any = { ativacao: { dadosJornada: {} } };
      if (txid) patchBody.ativacao.dadosJornada.txid = txid;
      if (tipoJornada) patchBody.ativacao.dadosJornada.tipoJornada = tipoJornada;
      const patchPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
      console.log("REC_ACTIVATE PATCH", patchPath, JSON.stringify(patchBody));
      await api.patch(patchPath, patchBody);
    }

    // 2) GET /v2/rec/:idRec  (pega link/QR)
    const getPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
    console.log("REC_ACTIVATE GET", getPath);
    const resp = await api.get(getPath);

    const data = resp.data || {};
    const link = data?.loc?.location || null;                // URL para abrir/compartilhar
    const copiaECola = data?.dadosQR?.pixCopiaECola || null; // texto BR Code, se disponível

    setCors(req, res);
    return res.status(200).json({
      ok: true,
      idRec,
      status: data?.status || null,
      link,
      copiaECola,
      raw: data
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("rec_activate_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"rec_activate_fail", detail });
  }
}
