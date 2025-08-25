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
    const b = (req.body || {}) as any;

    // Se o cliente JÁ mandou { cobr: { ... } }, use direto
    let cobr: any | null = null;
    let txid: string | undefined = undefined;

    if (b && typeof b === "object" && b.cobr && typeof b.cobr === "object") {
      cobr = b.cobr;
      txid = b.txid;
    } else {
      // Modo "plano": montamos o wrapper {cobr:{...}}
      txid = b.txid;
      const idRec = b.idRec as string | undefined;
      const original = b?.valor?.original;
      const dataDeVencimento = b?.calendario?.dataDeVencimento;
      const validadeAposVencimento = b?.calendario?.validadeAposVencimento;

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

      // IMPORTANTE: NÃO enviar 'devedor' na COBR (o recebedor/devedor já vem da REC)
      cobr = {
        idRec: String(idRec),
        valor: { original: String(original) },
        calendario: {
          dataDeVencimento: String(dataDeVencimento),
          ...(validadeAposVencimento ? { validadeAposVencimento: Number(validadeAposVencimento) } : {}),
        },
        ...(b?.infoAdicional ? { infoAdicional: String(b.infoAdicional) } : {}),
        ...(b?.multa ? { multa: b.multa } : {}),
        ...(b?.juros ? { juros: b.juros } : {}),
        ...(b?.abatimento ? { abatimento: b.abatimento } : {}),
        ...(b?.desconto ? { desconto: b.desconto } : {}),
      };
    }

    const api = await efi();

    // Log de depuração
    console.log("SENT_COBR", JSON.stringify({ method: req.method, path: COBR_BASE, hasTxid: !!txid, body: { cobr } }));

    let r;
    if (req.method === "PUT") {
      if (!txidOk(txid)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_txid_format",
          hint: "txid deve ser A–Z a–z 0–9, com 26–35 caracteres",
        });
      }
      r = await api.put(`${COBR_BASE}/${encodeURIComponent(String(txid))}`, { cobr });
    } else {
      r = await api.post(COBR_BASE, { cobr });
    }

    const d = r.data || {};
    const copiaECola = d?.pixCopiaECola ?? d?.dadosQR?.pixCopiaECola ?? null;
    const location = d?.loc?.location ?? d?.location ?? null;

    return res.status(200).json({
      ok: true,
      txid: d?.txid ?? (txid || null),
      idRec: (cobr?.idRec ?? null),
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
