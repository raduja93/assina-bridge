// api/efi/rec.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

// ---------------- CORS --------------
function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app" ||
    o === "https://assinapix.com" ||
    o.endsWith(".assinapix.com")
  ) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ---------------- UTILS ----------------
const PATH = (process.env.EFI_REC_CREATE_PATH || "/v2/rec").trim();

function onlyDigits(s: unknown) { return String(s ?? "").replace(/\D/g, ""); }
function centsToMoney(cents: unknown) { return (Number(cents || 0) / 100).toFixed(2); }
function mapPeriodicity(p: unknown) {
  const v = String(p || "").toLowerCase();
  if (["mensal","monthly","mes"].includes(v)) return "MENSAL";
  if (["semanal","weekly","semana"].includes(v)) return "SEMANAL";
  if (["anual","annual","ano"].includes(v))    return "ANUAL";
  if (["diario","diária","daily","dia"].includes(v)) return "DIARIO";
  return String(p || "MENSAL").toUpperCase();
}
function todayYMD() { return new Date().toISOString().slice(0,10); }

function isEfiRoot(b:any){ return b && typeof b==="object" && b.vinculo && b.calendario && (b.valor || b.ativacao || typeof b.loc !== "undefined"); }
function isEfiWrapped(b:any){ return b && typeof b==="object" && b.rec && typeof b.rec==="object"; }

// Converte payload LEGADO do app -> formato Efí (sem wrapper)
function toEfiFromLegacy(input:any) {
  const nome = input?.subscriber?.name || "";
  const cpf  = onlyDigits(input?.subscriber?.cpf);
  const amount = input?.amount_cents;
  const periodicity = input?.periodicity;
  if (!nome || !cpf || !amount || !periodicity) {
    const error = {
      ok:false, error:"missing_fields_legacy",
      need:["subscriber.name","subscriber.cpf","amount_cents","periodicity"],
    };
    throw { status:400, payload:error };
  }
  const out:any = {
    vinculo: {
      ...(input?.planId ? { contrato: input.planId } : {}),
      devedor: { cpf, nome },
      objeto: input?.description || "Assinatura PIX Automático",
    },
    calendario: {
      dataInicial: input?.start_date || todayYMD(),
      periodicidade: mapPeriodicity(periodicity),
    },
    valor: { valorRec: centsToMoney(amount) },
  };
  // NÃO adiciona ativacao aqui (Jornada 3 usa loc)
  if (typeof input?.loc !== "undefined") out.loc = input.loc; // aceita loc numérico
  return out;
}

// ---------------- HANDLER ----------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  if (!PATH.startsWith("/"))  return res.status(500).json({ ok:false, error:"bad_env_PATH" });

  try {
    const input = (req.body || {}) as any;

    // 1) Normalização: raiz EFI | wrapper {rec} | legado
    let payload:any;
    if (isEfiRoot(input)) payload = { ...input };
    else if (isEfiWrapped(input)) payload = { ...input.rec };
    else payload = toEfiFromLegacy(input);

    // 2) Se vier LOC, forçamos Jornada 3: remove QUALQUER ativacao
    if (typeof payload.loc !== "undefined") {
      if (payload.ativacao) delete payload.ativacao;
    }

    // 3) GARANTIR: sem wrapper rec
    if (payload.rec) delete payload.rec;

    // 4) Debug opcional (comentar em prod)
    console.log("EFI_REC_PAYLOAD", JSON.stringify(payload));

    // 5) Chama Efí
    const api = await efi();
    const resp = await api.post(PATH, payload);

    setCors(req, res);
    return res.status(201).json({ ok:true, data: resp.data });
  } catch (err:any) {
    const status = err?.status || err?.response?.status || 500;
    const detail = err?.payload || err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("efi_rec_create_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"efi_rec_create_fail", detail });
  }
}
