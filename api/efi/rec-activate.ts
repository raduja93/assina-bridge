// api/efi/rec-activate.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app"
    // o === "https://app.assinapix.com" // PROD
  ) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const REC_BASE = (process.env.EFI_REC_GET_PATH || "/v2/rec").trim();
const RETRIES  = Number(process.env.REC_ACTIVATE_RETRIES || 5);
const DELAY_MS = Number(process.env.REC_ACTIVATE_RETRY_MS || 1000);
const sleep = (ms:number) => new Promise(r => setTimeout(r, ms));

// Aceita 26–35 chars alfanuméricos (EFI costuma gerar 32 hex “a–f0–9”)
const TXID_RE = /^[A-Za-z0-9]{26,35}$/;

function sanitizeTxid(raw?: string) {
  const s = String(raw ?? "")
    .trim()
    .replace(/^<|>$/g, ""); // remove <> se colou com sinais
  return s;
}

function unwrapBody(b: any) {
  if (b && typeof b === "object" && b.rec && typeof b.rec === "object") return b.rec;
  return b;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");

  try {
    const body = unwrapBody(req.body || {});
    const idRec = body?.idRec as string | undefined;
    const txid  = sanitizeTxid(body?.txid as string | undefined);

    if (!idRec) {
      return res.status(400).json({ ok:false, error:"missing_idRec" });
    }
    if (!TXID_RE.test(txid)) {
      return res.status(400).json({
        ok:false,
        error:"invalid_txid_format",
        hint:"Use o txid de uma COBR (cobrança imediata) — A–Z a–z 0–9, 26–35 caracteres. Ex.: 7d6db3... (32 chars)."
      });
    }

    const api = await efi();

    // 1) PATCH /v2/rec/:idRec (SEM wrapper 'rec')
    const patchPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
    const patchBody = { ativacao: { dadosJornada: { txid } } };
    console.log("REC_ACTIVATE PATCH", patchPath, JSON.stringify(patchBody));
    let rPatch;
    try {
      rPatch = await api.patch(patchPath, patchBody);
    } catch (e:any) {
      const status = e?.response?.status || 500;
      const detail = e?.response?.data || { message: e?.message || "patch_error" };

      // Dica específica quando a EFI reclama que NÃO é cobrança imediata
      const viol = JSON.stringify(detail);
      const notImmediate =
        typeof viol === "string" &&
        (viol.includes("não é uma cobrança imediata") || viol.toLowerCase().includes("imediata"));

      return res.status(status).json({
        ok:false,
        error:"rec_activate_fail",
        hint: notImmediate
          ? "Use o txid de uma COBR (POST /v2/cob). Não use COBV (com vencimento)."
          : undefined,
        detail
      });
    }

    if (rPatch.status < 200 || rPatch.status >= 300) {
      return res.status(rPatch.status).json({ ok:false, error:"patch_not_2xx", detail:rPatch.data || null });
    }

    // 2) GET /v2/rec/:idRec (poll curto p/ loc/dadosQR)
    const getPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
    let data: any = null;
    for (let i = 0; i <= RETRIES; i++) {
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

