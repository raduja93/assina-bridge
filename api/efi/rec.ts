import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

// --- CORS enxuto: ajuste para seus domínios fixos em prod ---
function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || "";
  if (
    origin === "https://app.assinapix.com" ||
    origin === "https://assinapix-manager.vercel.app" ||
    origin.endsWith(".lovable.app") ||           // deixe só em dev
    origin.endsWith(".sandbox.lovable.dev")      // deixe só em dev
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const PATH = (process.env.EFI_REC_CREATE_PATH || "/v2/rec").trim();

function centsToMoney(cents: unknown) {
  return (Number(cents || 0) / 100).toFixed(2);
}
function onlyDigits(s: unknown) {
  return String(s || "").replace(/\D/g, "");
}
function mapPeriodicity(p: unknown) {
  const v = String(p || "").toLowerCase();
  if (["mensal","monthly","mes"].includes(v)) return "MENSAL";
  if (["semanal","weekly","semana"].includes(v)) return "SEMANAL";
  if (["anual","annual","ano"].includes(v))   return "ANUAL";
  if (["diario","diária","daily","dia"].includes(v)) return "DIARIO";
  return String(p || "MENSAL").toUpperCase();
}

// converte formato antigo → EFI /v2/rec
function toEfiFromLegacy(input: any) {
  const nome = input?.subscriber?.name || "";
  const cpf  = onlyDigits(input?.subscriber?.cpf);
  const valorRec = centsToMoney(input?.amount_cents);
  const periodicidade = mapPeriodicity(input?.periodicity);
  const dataInicial = input?.start_date || new Date().toISOString().slice(0,10);
  const objeto = input?.description || "Assinatura recorrente";

  if (!nome || !cpf || !input?.amount_cents || !input?.periodicity) {
    throw {
      status: 400,
      payload: {
        ok: false,
        error: "missing_fields_legacy",
        need: ["subscriber.name","subscriber.cpf","amount_cents","periodicity"]
      }
    };
  }

  return {
    vinculo: {
      ...(input?.planId ? { contrato: input.planId } : {}),
      devedor: { cpf, nome },
      objeto
    },
    calendario: { dataInicial, periodicidade },
    valor: { valorRec }
  };
}

function isEfiBody(b: any) {
  return b && b.vinculo && b.calendario && b.valor;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).send("Method Not Allowed");
  if (!PATH.startsWith("/"))   return res.status(500).json({ ok:false, error:"bad_env_PATH" });

  try {
    const input = req.body || {};

    // 1) Aceita novo formato EFI (pass-through) OU converte o legado
    const bodyEfi = isEfiBody(input) ? input : toEfiFromLegacy(input);

    // 2) Chama a Efí
    const api = await efi();
    // api.defaults.headers.common["Accept-Encoding"] = "identity"; // se precisar depurar
    const resp = await api.post(PATH, bodyEfi);

    setCors(req, res);
    return res.status(200).json({ ok: true, data: resp.data });
  } catch (err: any) {
    const status = err?.status || err?.response?.status || 500;
    const detail = err?.payload || err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("efi_rec_error", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"efi_rec_create_fail", detail });
  }
}
