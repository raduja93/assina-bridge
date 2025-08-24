// api/efi/rec-activate.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

// CORS: libere lovable em dev; feche em prod
function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app"
    // o === "https://app.assinapix.com" // PROD: habilite e remova os de dev
  ) {
    res.setHeader("Access-Control-Allow-Origin", o);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const REC_BASE = (process.env.EFI_REC_GET_PATH || "/v2/rec").trim();   // GET/PATCH base
const MAX_RETRIES = Number(process.env.REC_ACTIVATE_RETRIES || 4);
const RETRY_MS    = Number(process.env.REC_ACTIVATE_RETRY_MS || 900);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function isValidTxid(s?: string) {
  if (!s) return false;
  return /^[a-zA-Z0-9]{26,35}$/.test(s);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  const { idRec, txid, tipoJornada } = (req.body || {}) as {
    idRec?: string; txid?: string; tipoJornada?: string;
  };

  if (!idRec || typeof idRec !== "string") {
    return res.status(400).json({ ok:false, error:"missing_idRec" });
  }
  if (!isValidTxid(txid)) {
    return res.status(400).json({ ok:false, error:"invalid_txid_format", hint:"txid deve ser alfa-num e ter 26–35 caracteres" });
  }
  if (!REC_BASE.startsWith("/")) {
    return res.status(500).json({ ok:false, error:"bad_env_paths" });
  }

  try {
    const api = await efi();

    // 1) PATCH /v2/rec/:idRec  — SEM wrapper "rec", conforme a doc
    const patchPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
    const patchBody: any = { ativacao: { dadosJornada: { txid } } };
    // Só envie tipoJornada se sua conta exigir (não é obrigatório no PATCH):
    if (tipoJornada) patchBody.ativacao.dadosJornada.tipoJornada = tipoJornada;

    console.log("REC_ACTIVATE PATCH (no-wrapper)", patchPath, JSON.stringify(patchBody));
    const rPatch = await api.patch(patchPath, patchBody);
    if (rPatch.status < 200 || rPatch.status >= 300) {
      return res.status(rPatch.status).json({ ok:false, error:"patch_not_2xx", detail:rPatch.data || null });
    }

    // 2) GET /v2/rec/:idRec (retry curto p/ loc/dadosQR aparecerem)
    const getPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
    console.log("REC_ACTIVATE GET", getPath);

    let data: any = null;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      const r = await api.get(getPath);
      data = r.data || {};
      const hasLink  = Boolean(data?.loc?.location);
      const hasCopia = Boolean(data?.dadosQR?.pixCopiaECola);
      if (hasLink || hasCopia || i === MAX_RETRIES) break;
      await sleep(RETRY_MS);
    }

    return res.status(200).json({
      ok: true,
      idRec,
      status: data?.status || null,
      link: data?.loc?.location || null,                 // URL para abrir/compartilhar (gera QR)
      copiaECola: data?.dadosQR?.pixCopiaECola || null,  // EMV “copia e cola” (quando disponível)
      jornadaTxid: data?.ativacao?.dadosJornada?.txid || txid || null,
      raw: data, // útil p/ auditoria; remova se não quiser retornar
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("rec_activate_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"rec_activate_fail", detail });
  }
}
