// api/efi/rec-activate.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient"; // seu axios com mTLS + OAuth2

// ===== C O R S ==============================================================
function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || "";

  // DEV: liberar previews Lovable; PROD: troque para seu domínio fixo
  if (
    origin.endsWith(".lovable.app") ||
    origin.endsWith(".sandbox.lovable.dev") ||
    origin === "https://assinapix-manager.vercel.app"
    // origin === "https://app.assinapix.com" // <- habilite em produção e remova os de cima
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ===== U T I L S ============================================================
const REC_BASE = (process.env.EFI_REC_GET_PATH || "/v2/rec").trim(); // GET/PATCH base
const DEFAULT_TIPO_JORNADA =
  (process.env.EFI_REC_TIPO_JORNADA || "").trim() || undefined; // ex.: JORNADA_3
const MAX_RETRIES = Number(process.env.REC_ACTIVATE_RETRIES || 3);
const RETRY_MS = Number(process.env.REC_ACTIVATE_RETRY_MS || 800);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type ActivateBody = {
  idRec?: string;
  txid?: string;
  tipoJornada?: string;
};

// ===== H A N D L E R ========================================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const { idRec, txid, tipoJornada }: ActivateBody = (req.body || {}) as any;

  if (!idRec || typeof idRec !== "string") {
    return res.status(400).json({ ok: false, error: "missing_idRec" });
  }

  try {
    const api = await efi();

    // ---------- 1) PATCH /v2/rec/:idRec  (wrapper "rec" exigido pela Efí) ----------
    const patchPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;

    // Monta body com wrapper "rec" apenas se tivermos algo pra definir (txid/tipoJornada)
    const tj = (tipoJornada || DEFAULT_TIPO_JORNADA) as string | undefined;
    const mustPatch = Boolean(txid || tj);

    if (mustPatch) {
      const patchBody: any = {
        rec: {
          ativacao: { dadosJornada: {} as any },
        },
      };
      if (txid) patchBody.rec.ativacao.dadosJornada.txid = txid;
      if (tj) patchBody.rec.ativacao.dadosJornada.tipoJornada = tj;

      console.log("REC_ACTIVATE PATCH", patchPath, JSON.stringify(patchBody));
      const patchResp = await api.patch(patchPath, patchBody);
      // Qualquer 2xx é sucesso; algumas integrações retornam 200/204 sem corpo
      if (patchResp.status < 200 || patchResp.status >= 300) {
        return res.status(patchResp.status).json({
          ok: false,
          error: "patch_not_2xx",
          detail: patchResp.data || null,
        });
      }
    } else {
      console.log("REC_ACTIVATE: skipping PATCH (no txid/tipoJornada provided)");
    }

    // ---------- 2) GET /v2/rec/:idRec (com retry curto p/ loc/dadosQR aparecerem) ----------
    const getPath = `${REC_BASE}/${encodeURIComponent(idRec)}`;
    console.log("REC_ACTIVATE GET", getPath);

    let data: any = null;
    let tries = 0;
    while (tries <= MAX_RETRIES) {
      const getResp = await api.get(getPath);
      data = getResp.data || {};
      const hasLink = Boolean(data?.loc?.location);
      const hasCopia = Boolean(data?.dadosQR?.pixCopiaECola);

      if (hasLink || hasCopia || tries === MAX_RETRIES) break;
      tries++;
      await sleep(RETRY_MS);
    }

    const out = {
      ok: true,
      idRec,
      status: data?.status || null,
      link: data?.loc?.location || null,                 // URL para abrir/compartilhar (gera QR)
      copiaECola: data?.dadosQR?.pixCopiaECola || null,  // texto EMV “copia e cola” (quando disponível)
      jornadaTxid: data?.ativacao?.dadosJornada?.txid || null,
      raw: data, // útil para auditoria/debug; remova se não quiser retornar
    };

    setCors(req, res);
    return res.status(200).json(out);
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("rec_activate_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok: false, error: "rec_activate_fail", detail });
  }
}
