// api/efi/cobr-upsert.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

/** =========================
 *  C O R S
 *  ========================= */
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

/** =========================
 *  C O N S T A N T E S
 *  ========================= */
const COBR_BASE = (process.env.EFI_COBR_BASE || "/v2/cobr").trim();
const txidOk = (s?: string) => !!s && /^[A-Za-z0-9]{26,35}$/.test(String(s));

/** =========================
 *  H A N D L E R
 *  ========================= */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "PUT" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    /**
     * Aceitamos dois formatos de entrada:
     *  A) Corpo "plano" (mais simples):
     *     {
     *       txid?: string,          // se ausente -> POST /v2/cobr
     *       idRec: string,
     *       calendario: { dataDeVencimento: "YYYY-MM-DD", validadeAposVencimento?: number },
     *       valor: { original: "99.90" },
     *       ajusteDiaUtil?: boolean,
     *       infoAdicional?: string,
     *       devedor?: { /* campos opcionais conforme docs *\/ },
     *       recebedor?: { /* quando aplicável *\/ },
     *       politicaRetentativa?: string
     *     }
     *
     *  B) Corpo “envolto”:
     *     { txid?: string, cobr: { ...mesmos-campos-acima... } }
     */
    const body = (req.body || {}) as any;

    const txidInput: string | undefined = body?.txid;
    const cobr = body?.cobr && typeof body.cobr === "object" ? body.cobr : body;

    // ------ validação mínima segundo a doc COBR (Pix Automático):
    // idRec, calendario.dataDeVencimento e valor.original são obrigatórios.
    const idRec = cobr?.idRec;
    const original = cobr?.valor?.original;
    const dataDeVencimento = cobr?.calendario?.dataDeVencimento;

    if (!idRec) {
      return res.status(400).json({ ok: false, error: "missing_idRec" });
    }
    if (!original) {
      return res.status(400).json({ ok: false, error: "missing_valor_original" });
    }
    if (!dataDeVencimento || !/^\d{4}-\d{2}-\d{2}$/.test(String(dataDeVencimento))) {
      return res.status(400).json({
        ok: false,
        error: "missing_dataDeVencimento",
        hint: "Use YYYY-MM-DD",
      });
    }

    // Monta o payload aceito pela Efí (apenas os campos reconhecidos)
    const payload: any = {
      idRec: String(idRec),
      calendario: {
        dataDeVencimento: String(dataDeVencimento),
        ...(cobr?.calendario?.validadeAposVencimento != null
          ? { validadeAposVencimento: Number(cobr.calendario.validadeAposVencimento) }
          : {}),
      },
      valor: { original: String(original) },
      ...(cobr?.ajusteDiaUtil != null ? { ajusteDiaUtil: Boolean(cobr.ajusteDiaUtil) } : {}),
      ...(cobr?.infoAdicional ? { infoAdicional: String(cobr.infoAdicional) } : {}),
      ...(cobr?.politicaRetentativa ? { politicaRetentativa: String(cobr.politicaRetentativa) } : {}),
      ...(cobr?.devedor ? { devedor: cobr.devedor } : {}),       // devedor é opcional segundo a doc
      ...(cobr?.recebedor ? { recebedor: cobr.recebedor } : {}), // quando aplicável pelo PSP
    };

    const api = await efi();

    // Se veio txid válido -> PUT /v2/cobr/:txid
    // Senão -> POST /v2/cobr (Efí define o txid)
    let resp;
    if (txidInput) {
      if (!txidOk(txidInput)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_txid_format",
          hint: "txid deve ser A–Z a–z 0–9, com 26–35 caracteres",
        });
      }
      const url = `${COBR_BASE}/${encodeURIComponent(String(txidInput))}`;
      resp = await api.put(url, payload);
    } else {
      resp = await api.post(COBR_BASE, payload);
    }

    const d = resp?.data || {};
    // normaliza retornos úteis
    const txidOut = d?.txid ?? txidInput ?? null;
    const location = d?.loc?.location ?? d?.location ?? null;
    const copiaECola = d?.pixCopiaECola ?? d?.dadosQR?.pixCopiaECola ?? null;

    return res.status(200).json({
      ok: true,
      txid: txidOut,
      idRec: idRec,
      location,
      copiaECola,
      raw: d,
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("cobr_upsert_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok: false, error: "cobr_upsert_fail", detail });
  }
}

