// antes do api.post:
console.log("EFI_REC path=", PATH);
console.log("EFI_REC payload=", JSON.stringify(bodyEfi));




// api/efi/rec.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient"; // axios com mTLS + OAuth

// ============================
// C O R S
// ============================
// DEV: aceita previews Lovable. PROD: troque para domínios fixos (ex.: https://app.assinapix.com)
function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || "";

  if (
    origin.endsWith(".lovable.app") ||                 // dev
    origin.endsWith(".sandbox.lovable.dev") ||         // dev
    origin === "https://assinapix-manager.vercel.app"  // opcional
    // origin === "https://app.assinapix.com"          // PROD (descomente quando migrar)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ============================
// U T I L S
// ============================
const PATH = (process.env.EFI_REC_CREATE_PATH || "/v2/rec").trim();

function onlyDigits(s: unknown) {
  return String(s ?? "").replace(/\D/g, "");
}
function centsToMoney(cents: unknown) {
  return (Number(cents || 0) / 100).toFixed(2); // "29.90"
}
function mapPeriodicity(p: unknown) {
  const v = String(p || "").toLowerCase();
  if (["mensal", "monthly", "mes"].includes(v)) return "MENSAL";
  if (["semanal", "weekly", "semana"].includes(v)) return "SEMANAL";
  if (["anual", "annual", "ano"].includes(v)) return "ANUAL";
  if (["diario", "diária", "daily", "dia"].includes(v)) return "DIARIO";
  // fallback seguro
  return String(p || "MENSAL").toUpperCase();
}
function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}
function isEfiWrapped(b: any) {
  return b && typeof b === "object" && b.rec && typeof b.rec === "object";
}

// converte o payload LEGADO (do app) -> body do /v2/rec EMBRULHADO em { rec: {...} }
function toEfiFromLegacy(input: any) {
  const nome = input?.subscriber?.name || "";
  const cpf = onlyDigits(input?.subscriber?.cpf);
  const amount = input?.amount_cents;
  const periodicity = input?.periodicity;

  if (!nome || !cpf || !amount || !periodicity) {
    const error = {
      ok: false,
      error: "missing_fields_legacy",
      need: ["subscriber.name", "subscriber.cpf", "amount_cents", "periodicity"],
    };
    throw { status: 400, payload: error };
  }

  const valorRec = centsToMoney(amount);
  const dataInicial = input?.start_date || todayYMD();
  const objeto = input?.description || "Assinatura recorrente";

  return {
    rec: {
      vinculo: {
        ...(input?.planId ? { contrato: input.planId } : {}),
        devedor: { cpf, nome },
        objeto,
      },
      calendario: {
        dataInicial,
        periodicidade: mapPeriodicity(periodicity),
        // opcional: dataFinal
      },
      valor: { valorRec },
      // opcional: politicaRetentativa, ativacao, etc.
    },
  };
}

// ============================
// H A N D L E R
// ============================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  if (!PATH.startsWith("/")) {
    return res.status(500).json({ ok: false, error: "bad_env_PATH" });
  }

  try {
    const input = (req.body || {}) as any;

    // 1) Aceita formato EFI (wrapped) OU converte do LEGADO
    const bodyEfi = isEfiWrapped(input) ? input : toEfiFromLegacy(input);

    // 2) Chama Efí
    const api = await efi();
    // api.defaults.headers.common["Accept-Encoding"] = "identity"; // debug opcional
    const resp = await api.post(PATH, bodyEfi);

    setCors(req, res);
    return res.status(200).json({ ok: true, data: resp.data });
  } catch (err: any) {
    const status = err?.status || err?.response?.status || 500;
    const detail = err?.payload || err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("efi_rec_error", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok: false, error: "efi_rec_create_fail", detail });
  }
}
