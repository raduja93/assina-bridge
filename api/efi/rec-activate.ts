// api/efi/rec-activate.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

// ---------- CORS (libere lovable em dev; feche em prod) ----------
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

const REC_BASE = (process.env.EFI_REC_GET_PATH || "/v2/rec").trim(); // GET/PATCH base
const DEFAULT_TIPO_JORNADA =
  (process.env.EFI_REC_TIPO_JORNADA || "").trim() || undefined; // ex.: JORNADA_3
const MAX_RETRIES = Number(process.env.REC_ACTIVATE_RETRIES || 3);
const RETRY_MS = Number(process.env.REC_ACTIVATE_RETRY_MS || 800);

const needsRecWrapper = (detail: any) => {
  try {
    const v = detail?.violacoes || detail?.violations || [];
    return v.some((it: any) =>
      String(it?.propriedade || it?.property || "").startsWith("body.rec")
    );
  } catch { return false; }
};

const is2xx = (s: number) => s >= 200 && s < 300;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const idRec = String((req.body as any)?.idRec || "");
  const txid = (req.body as any)?.txid as string | undefined;
  const tipoJornada =
    ((req.body as any)?.tipoJornada as string | undefined) || DEFAULT_TIPO_JORNADA;

  if (!idRec) return res.status(400).json({ ok: false, error: "missing_idRec" });

  try {
    const api = await efi();
    const patchPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;

    // Monta o corpo "sem wrapper" (forma A)
    const bodyA: any = {};
    if (txid || tipoJornada) {
      bodyA.ativacao = { dadosJornada: {} as any };
      if (txid) bodyA.ativacao.dadosJornada.txid = txid;
      if (tipoJornada) bodyA.ativacao.dadosJornada.tipoJornada = tipoJornada;
    }

    // Monta o corpo "com wrapper rec" (forma B)
    const bodyB = bodyA?.ativacao
      ? { rec: { ativacao: bodyA.ativacao } }
      : {};

    // 1) PATCH tentando primeiro SEM wrapper
    let patched = false;
    if (Object.keys(bodyA).length > 0) {
      try {
        console.log("REC_ACTIVATE PATCH(A) no-wrapper", patchPath, JSON.stringify(bodyA));
        const r = await api.patch(patchPath, bodyA);
        if (!is2xx(r.status)) {
          return res.status(r.status).json({ ok: false, error: "patch_not_2xx", detail: r.data || null });
        }
        patched = true;
      } catch (e: any) {
        const status = e?.response?.status || 500;
        const detail = e?.response?.data || { message: e?.message || "unknown_error" };
        console.error("PATCH(A) fail", status, detail);
        // Se o erro indicar necessidade de wrapper "rec", tenta forma B
        if (needsRecWrapper(detail) && Object.keys(bodyB).length > 0) {
          console.log("REC_ACTIVATE PATCH(B) with-wrapper", patchPath, JSON.stringify(bodyB));
          const r2 = await api.patch(patchPath, bodyB);
          if (!is2xx(r2.status)) {
            return res.status(r2.status).json({ ok: false, error: "patch_not_2xx", detail: r2.data || null });
          }
          patched = true;
        } else {
          // Se não indicar wrapper, devolve o erro original do PATCH(A)
          return res.status(status).json({ ok: false, error: "rec_activate_fail", detail });
        }
      }
    } else {
      console.log("REC_ACTIVATE: skipping PATCH (no txid/tipoJornada provided)");
    }

    // 2) GET /v2/rec/:idRec (retry curto esperando loc/dadosQR)
    const getPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
    console.log("REC_ACTIVATE GET", getPath, "patched?", patched);

    let data: any = null;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      const r = await api.get(getPath);
      data = r.data || {};
      const hasLink = Boolean(data?.loc?.location);
      const hasCopia = Boolean(data?.dadosQR?.pixCopiaECola);
      if (hasLink || hasCopia || i === MAX_RETRIES) break;
      await sleep(RETRY_MS);
    }

    return res.status(200).json({
      ok: true,
      idRec,
      status: data?.status || null,
      link: data?.loc?.location || null,                 // URL para abrir/compartilhar/gerar QR
      copiaECola: data?.dadosQR?.pixCopiaECola || null,  // EMV (quando disponível)
      jornadaTxid: data?.ativacao?.dadosJornada?.txid || null,
      raw: data, // útil p/ auditoria; remova se preferir
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("rec_activate_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok: false, error: "rec_activate_fail", detail });
  }
}
