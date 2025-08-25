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

/** Normaliza entrada: aceita formato root ou wrapper {cobr:{...}} */
function normalizeInput(body: any) {
  const root = body || {};
  const inner = root?.cobr ?? root;

  // idRec pode vir no root ou dentro de cobr
  const idRec = String(root.idRec ?? inner.idRec ?? "").trim();

  // valor.original pode vir em ambos
  const original = String(
    inner?.valor?.original ?? root?.valor?.original ?? ""
  ).trim();

  // devedor (nome opcional)
  const devedorCpf = onlyDigits(inner?.devedor?.cpf ?? root?.devedor?.cpf);
  const devedorNome = String(
    inner?.devedor?.nome ?? root?.devedor?.nome ?? ""
  ).trim();

  // calendario.dataDeVencimento
  const dataDeVencimento = String(
    inner?.calendario?.dataDeVencimento ?? root?.calendario?.dataDeVencimento ?? ""
  ).trim();

  const solicitacaoPagador = String(
    inner?.solicitacaoPagador ?? root?.solicitacaoPagador ?? ""
  ).trim();

  const multa = inner?.multa ?? root?.multa;
  const juros = inner?.juros ?? root?.juros;
  const abatimento = inner?.abatimento ?? root?.abatimento;
  const desconto = inner?.desconto ?? root?.desconto;

  return {
    idRec,
    valor: original ? { original } : undefined,
    devedor: devedorCpf
      ? { cpf: devedorCpf, ...(devedorNome ? { nome: devedorNome } : {}) }
      : undefined,
    calendario: dataDeVencimento ? { dataDeVencimento } : undefined,
    solicitacaoPagador: solicitacaoPagador || undefined,
    multa,
    juros,
    abatimento,
    desconto,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "PUT" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const body = (req.body || {}) as any;

    // txid usado no path do PUT /v2/cobr/{txid}
    const txid = String(body.txid ?? "").trim();
    if (!txidOk(txid)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_txid_format",
        hint: "txid deve ser A–Z a–z 0–9, com 26–35 caracteres",
      });
    }

    // normaliza campos aceitando root ou wrapper {cobr:{...}}
    const norm = normalizeInput(body);

    // validações mínimas
    if (!norm.idRec) {
      return res.status(400).json({ ok: false, error: "missing_idRec" });
    }
    if (!norm.valor?.original) {
      return res.status(400).json({ ok: false, error: "missing_valor_original" });
    }
    if (!norm.calendario?.dataDeVencimento) {
      return res.status(400).json({
        ok: false,
        error: "missing_dataDeVencimento",
        hint: "Use YYYY-MM-DD"
      });
    }
    if (!norm.devedor?.cpf) {
      return res.status(400).json({
        ok: false,
        error: "missing_devedor",
        need: ["devedor.cpf"],
        hint: "devedor.nome é opcional; cpf é obrigatório"
      });
    }

    // payload final SEMPRE com wrapper { cobr: {...} } para a Efí
    const payload: any = {
      cobr: {
        idRec: norm.idRec,
        valor: norm.valor,
        devedor: norm.devedor, // nome opcional
        calendario: norm.calendario,
        ...(norm.solicitacaoPagador ? { solicitacaoPagador: norm.solicitacaoPagador } : {}),
        ...(norm.multa ? { multa: norm.multa } : {}),
        ...(norm.juros ? { juros: norm.juros } : {}),
        ...(norm.abatimento ? { abatimento: norm.abatimento } : {}),
        ...(norm.desconto ? { desconto: norm.desconto } : {}),
      },
    };

    const api = await efi();
    const url = `${COBR_BASE}/${encodeURIComponent(txid)}`; // PUT /v2/cobr/{txid}
    const r = await api.put(url, payload);
    const d = r.data || {};

    const copiaECola = d?.pixCopiaECola ?? d?.dadosQR?.pixCopiaECola ?? null;
    const location = d?.loc?.location ?? d?.location ?? null;

    return res.status(200).json({
      ok: true,
      txid: d?.txid ?? txid,
      idRec: norm.idRec,
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
