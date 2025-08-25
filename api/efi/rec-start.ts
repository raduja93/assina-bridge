// api/efi/rec-start.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

// ---------------------------
// CORS
// ---------------------------
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ---------------------------
// Helpers
// ---------------------------
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const txidOk = (s?: string) => !!s && /^[A-Za-z0-9]{26,35}$/.test(String(s));
const genTxid = () => {
  // 28 chars alfanumérico
  const base = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return ("ATV" + base).replace(/[^A-Za-z0-9]/g, "").slice(0, 28);
};
const mapPeriodicity = (p?: string) => {
  const v = String(p || "").toLowerCase();
  if (["mensal", "monthly", "mes"].includes(v)) return "MENSAL";
  if (["semanal", "weekly", "semana"].includes(v)) return "SEMANAL";
  if (["anual", "annual", "ano"].includes(v))   return "ANUAL";
  if (["diario", "diária", "daily", "dia"].includes(v)) return "DIARIO";
  return String(p || "MENSAL").toUpperCase();
};

// Bases/paths (podem ser override por env)
const COB_BASE = (process.env.EFI_COB_BASE || "/v2/cob").trim();
const REC_BASE = (process.env.EFI_REC_CREATE_PATH || "/v2/rec").trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const {
      devedor,                 // { cpf, nome }
      valorRec,                // "55.00"
      periodicidade,           // "MENSAL" | "SEMANAL" | ...
      dataInicial,             // "YYYY-MM-DD"
      objeto,                  // ex: "Assinatura PIX Automático"
      contrato,                // opcional: ID do seu plano
      txid                     // opcional: se quiser mandar o seu
    } = (req.body || {}) as any;

    // -------- validações mínimas
    const cpf = onlyDigits(devedor?.cpf);
    const nome = (devedor?.nome || "").trim();
    if (!cpf)  return res.status(400).json({ ok:false, error:"missing_devedor.cpf" });
    if (!nome) return res.status(400).json({ ok:false, error:"missing_devedor.nome" });

    if (!valorRec) return res.status(400).json({ ok:false, error:"missing_valorRec" });
    if (!dataInicial) return res.status(400).json({ ok:false, error:"missing_dataInicial" });

    const per = mapPeriodicity(periodicidade);
    const obj = objeto || "Assinatura PIX Automático";

    // -------- 1) cria COB imediata (pagamento agora)
    const tx = txidOk(txid) ? txid : genTxid();
    const api = await efi();

    const cobPayload = {
      devedor: { cpf, nome },
      valor: { original: String(valorRec) },
      calendario: { expiracao: 3600 },
      solicitacaoPagador: "Ativação Pix Automático (1ª parcela)",
    };
    // COB imediata com POST /v2/cob (sem txid)
    const rCob = await api.post(COB_BASE, cobPayload);
    const dataCob = rCob.data || {};
    const txidCob = dataCob?.txid || tx; // em geral virá um txid gerado pela Efí

    // -------- 2) cria REC com ativação referenciando o txid da COB
    const recPayload: any = {
      vinculo: {
        ...(contrato ? { contrato: String(contrato) } : {}),
        devedor: { cpf, nome },
        objeto: obj,
      },
      calendario: {
        dataInicial: String(dataInicial),
        periodicidade: per,
      },
      valor: { valorRec: String(valorRec) },
      politicaRetentativa: "NAO_PERMITE",
      ativacao: {
        dadosJornada: { txid: String(txidCob) }
      }
    };

    const rRec = await api.post(REC_BASE, recPayload);
    const dataRec = rRec.data || {};

    // -------- resposta consolidada pro seu front
    const copiaECola =
      dataCob?.pixCopiaECola ||
      dataCob?.dadosQR?.pixCopiaECola ||
      null;

    const location =
      dataCob?.loc?.location ||
      dataCob?.location ||
      null;

    return res.status(200).json({
      ok: true,
      txid: txidCob,
      idRec: dataRec?.idRec ?? null,
      recStatus: dataRec?.status ?? null,
      copiaECola,
      location,
      rawCob: dataCob,
      rawRec: dataRec
    });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("rec_start_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"rec_start_fail", detail });
  }
}
