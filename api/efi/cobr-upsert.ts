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
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "PUT" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    // Aceita body em ambos PUT/POST (POST útil p/ clients que não conseguem PUT)
    const {
      txid,
      idRec,                                  // << vínculo com a recorrência
      valor,                                  // { original: "55.00" }
      devedor,                                // { cpf: "..." , nome: "..." }
      calendario,                             // { dataDeVencimento: "YYYY-MM-DD" }
      solicitacaoPagador,                     // opcional
      multa, juros, abatimento, desconto      // opcionais
    } = (req.body || {}) as any;

    // ---- validações mínimas
    if (!txidOk(txid)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_txid_format",
        hint: "txid deve ser A–Z a–z 0–9, com 26–35 caracteres",
      });
    }
    if (!idRec) return res.status(400).json({ ok: false, error: "missing_idRec" });

    const original = valor?.original;
    if (!original) return res.status(400).json({ ok: false, error: "missing_valor_original" });

    const cpf = onlyDigits(devedor?.cpf);
    const nome = (devedor?.nome || "").trim();
    if (!cpf || !nome) {
      return res.status(400).json({
        ok: false,
        error: "missing_devedor",
        need: ["devedor.cpf", "devedor.nome"],
      });
    }

    const dataDeVencimento = calendario?.dataDeVencimento;
    if (!dataDeVencimento) {
      return res.status(400).json({
        ok: false,
        error: "missing_dataDeVencimento",
        hint: "Use YYYY-MM-DD",
      });
    }

    // ---- monta payload COBR (Pix Automático)
    // Observação: para COBR a Efí não exige 'chave' (diferente de COB).
    // O vínculo com a recorrência é feito por 'idRec'.
    const payload: any = {
      idRec: String(idRec),
      valor: { original: String(original) },
      devedor: { cpf: String(cpf), nome: String(nome) },
      calendario: { dataDeVencimento: String(dataDeVencimento) },
      ...(solicitacaoPagador ? { solicitacaoPagador: String(solicitacaoPagador) } : {}),
      ...(multa ? { multa } : {}),
      ...(juros ? { juros } : {}),
      ...(abatimento ? { abatimento } : {}),
      ...(desconto ? { desconto } : {}),
    };

    const api = await efi();

    // upsert por txid
    const url = `${COBR_BASE}/${encodeURIComponent(String(txid))}`;
    const r = await api.put(url, payload);
    const d = r.data || {};

    // Normaliza retorno útil
    const copiaECola =
      d?.pixCopiaECola ?? d?.dadosQR?.pixCopiaECola ?? null;
    const location =
      d?.loc?.location ?? d?.location ?? null;

    return res.status(200).json({
      ok: true,
      txid: d?.txid ?? txid,
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
