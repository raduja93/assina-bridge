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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "PUT" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    /**
     * Aceitamos dois formatos (sempre com wrapper {cobr:{...}} no envio para a Efí):
     *
     *  A) POST /v2/cobr (sem txid — Efí gera):
     *     Body: { idRec, valor:{original}, calendario:{dataDeVencimento, validadeAposVencimento?},
     *             infoAdicional?, multa?, juros?, abatimento?, desconto? }
     *
     *  B) PUT /v2/cobr/:txid (com txid escolhido por você):
     *     Body: { txid, idRec, valor:{original}, calendario:{dataDeVencimento, validadeAposVencimento?},
     *             infoAdicional?, multa?, juros?, abatimento?, desconto? }
     *
     * IMPORTANTE: NÃO enviar "devedor" aqui (ele já foi definido na REC).
     */
    const b = (req.body || {}) as any;

    const txid = b.txid as string | undefined;              // só para PUT
    const idRec = b.idRec as string | undefined;
    const original = b?.valor?.original;
    const dataDeVencimento = b?.calendario?.dataDeVencimento;

    if (!idRec) {
      return res.status(400).json({ ok: false, error: "missing_idRec" });
    }
    if (!original) {
      return res.status(400).json({ ok: false, error: "missing_valor_original" });
    }
    if (!dataDeVencimento) {
      return res.status(400).json({
        ok: false,
        error: "missing_dataDeVencimento",
        hint: "Use YYYY-MM-DD",
      });
    }

    // Monta o objeto COBR (sem devedor)
    const cobr: any = {
      idRec: String(idRec),
      valor: { original: String(original) },
      calendario: {
        dataDeVencimento: String(dataDeVencimento),
        ...(b?.calendario?.validadeAposVencimento
          ? { validadeAposVencimento: Number(b.calendario.validadeAposVencimento) }
          : {}),
      },
      ...(b?.infoAdicional ? { infoAdicional: String(b.infoAdicional) } : {}),
      ...(b?.multa ? { multa: b.multa } : {}),
      ...(b?.juros ? { juros: b.juros } : {}),
      ...(b?.abatimento ? { abatimento: b.abatimento } : {}),
      ...(b?.desconto ? { desconto: b.desconto } : {}),
    };

    const api = await efi();
    let r;

    if (req.method === "PUT") {
      // PUT /v2/cobr/:txid  (txid definido por você)
      if (!txidOk(txid)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_txid_format",
          hint: "txid deve ser A–Z a–z 0–9, com 26–35 caracteres",
        });
      }
      const url = `${COBR_BASE}/${encodeURIComponent(String(txid))}`;
      r = await api.put(url, { cobr }); // <<<<<< wrapper exigido
    } else {
      // POST /v2/cobr (sem txid — Efí gera)
      r = await api.post(COBR_BASE, { cobr }); // <<<<<< wrapper exigido
    }

    const d = r.data || {};
    const copiaECola = d?.pixCopiaECola ?? d?.dadosQR?.pixCopiaECola ?? null;
    const location = d?.loc?.location ?? d?.location ?? null;

    return res.status(200).json({
      ok: true,
      txid: d?.txid ?? (txid || null),
      idRec,
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
