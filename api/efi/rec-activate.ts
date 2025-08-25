import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

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

const REC_BASE  = (process.env.EFI_REC_GET_PATH || "/v2/rec").trim();
const RETRIES   = Number(process.env.REC_ACTIVATE_RETRIES || 3);
const DELAY_MS  = Number(process.env.REC_ACTIVATE_RETRY_MS || 900);
const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms));
const txidOk = (s?: string) => !!s && /^[A-Za-z0-9]{26,35}$/.test(String(s));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  try {
    const { idRec, txid } = (req.body || {}) as { idRec?: string; txid?: string };
    if (!idRec) return res.status(400).json({ ok:false, error:"missing_idRec" });
    if (!txidOk(txid)) {
      return res.status(400).json({
        ok:false, error:"invalid_txid_format",
        hint:"txid deve ser A–Z a–z 0–9, com 26–35 caracteres"
      });
    }

    const api = await efi();

    // 1) PATCH /v2/rec/:idRec (SEM wrapper 'rec')
    const patchPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
    const patchBody = { ativacao: { dadosJornada: { txid } } };
    console.log("REC_ACTIVATE PATCH", patchPath, JSON.stringify(patchBody));
    const rPatch = await api.patch(patchPath, patchBody);

    if (rPatch.status < 200 || rPatch.status >= 300) {
      return res.status(rPatch.status).json({ ok:false, error:"patch_not_2xx", detail:rPatch.data || null });
    }

    // 2) GET /v2/rec/:idRec (poll curto p/ loc/dadosQR)
    const getPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
    let data: any = null;
    for (let i=0; i<=RETRIES; i++) {
      const r = await api.get(getPath);
      data = r.data || {};
      const hasLink  = !!data?.loc?.location;
      const hasCopia = !!data?.dadosQR?.pixCopiaECola;
      if (hasLink || hasCopia || i === RETRIES) break;
      await sleep(DELAY_MS);
    }

    return res.status(200).json({
      ok: true,
      idRec,
      status: data?.status ?? null,
      link: data?.loc?.location ?? null,
      copiaECola: data?.dadosQR?.pixCopiaECola ?? null,
      jornadaTxid: data?.ativacao?.dadosJornada?.txid ?? txid,
      raw: data
    });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("rec_activate_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"rec_activate_fail", detail });
  }
}
