import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app"
    // o === "https://app.assinapix.com" // PROD: habilite depois
  ) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const COBV_BASE = (process.env.EFI_COBV_BASE || "/v2/cobv").trim();
const isTxid = (s?: string) => !!s && /^[A-Za-z0-9]{26,35}$/.test(String(s));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "PUT") return res.status(405).send("Method Not Allowed");

  try {
    const { txid, valor, chave, devedor, calendario } = (req.body || {}) as any;

    if (!isTxid(txid)) {
      return res.status(400).json({ ok:false, error:"invalid_txid", hint:"A–Z a–z 0–9, 26–35 caracteres" });
    }
    if (!valor?.original || !chave || !devedor?.cpf || !devedor?.nome || !calendario?.dataDeVencimento) {
      return res.status(400).json({
        ok:false,
        error:"missing_fields",
        need:["valor.original","chave","devedor.cpf","devedor.nome","calendario.dataDeVencimento"]
      });
    }

    const payload = {
      calendario: {
        dataDeVencimento: calendario.dataDeVencimento, // "YYYY-MM-DD"
        ...(calendario.validadeAposVencimento ? { validadeAposVencimento: calendario.validadeAposVencimento } : {})
      },
      valor: { original: String(valor.original) }, // "55.00"
      chave,                                       // sua chave PIX recebedora
      devedor: { cpf: String(devedor.cpf), nome: String(devedor.nome) }
    };

    const api = await efi();
    const path = `${COBV_BASE}/${encodeURIComponent(txid)}`; // PUT /v2/cobv/:txid
    console.log("COBV_UPSERT", path, JSON.stringify(payload));
    const r = await api.put(path, payload);

    return res.status(200).json({ ok:true, data:r.data });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("cobv_upsert_fail", status, detail);
    return res.status(status).json({ ok:false, error:"cobv_upsert_fail", detail });
  }
}
