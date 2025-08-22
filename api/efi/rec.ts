// api/efi/rec.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient"; // cliente axios com mTLS + OAuth

// ============================
// C O R S  (Lovable + seus domínios)
// ============================
function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || "";

  // 1) aceita qualquer preview/sandbox do Lovable
  if (origin.endsWith(".lovable.app") || origin.endsWith(".sandbox.lovable.dev")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  // 2) aceita seus domínios fixos (ajuste conforme necessário)
  else if (
    origin === "https://assinapix-manager.vercel.app" ||
    origin === "https://app.assinapix.com.br"
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
function moneyFromCents(cents: unknown): string {
  const n = Number(cents || 0);
  return (n / 100).toFixed(2); // "30.00"
}

function normalizeCPF(raw: unknown): string {
  return String(raw || "").replace(/\D/g, "").slice(0, 11);
}

function normalizePeriodicity(raw: unknown): string {
  const v = String(raw || "").trim().toLowerCase();
  // mapeia os comuns do seu app → Efí (ajuste se necessário)
  if (["mensal", "monthly", "mes"].includes(v)) return "MENSAL";
  if (["semanal", "weekly", "semana"].includes(v)) return "SEMANAL";
  if (["anual", "annual", "ano"].includes(v)) return "ANUAL";
  if (["diario", "diária", "daily", "dia"].includes(v)) return "DIARIO";
  // fallback seguro
  return String(raw || "MENSAL").toUpperCase();
}

// monta o body esperado pelo POST /v2/rec (Pix Automático)
function toEfiRecurrenceBody(input: any) {
  // permite override total (caso você queira enviar o body pronto do frontend)
  if (input?.efiOverride && typeof input.efiOverride === "object") {
    return input.efiOverride;
  }

  const nome = input?.subscriber?.name || "";
  const cpf = normalizeCPF(input?.subscriber?.cpf);
  const periodicidade = normalizePeriodicity(input?.periodicity);
  const valorRec = moneyFromCents(input?.amount_cents);
  const objeto = input?.description || "Assinatura recorrente";

  // dataInicial: hoje (YYYY-MM-DD). Se vier do frontend, respeita.
  const dataInicial =
    input?.start_date ||
    new Date().toISOString().slice(0, 10);

  const body: any = {
    vinculo: {
      // use o planId como "contrato" para rastrear de qual plano veio
      ...(input?.planId ? { contrato: input.planId } : {}),
      devedor: { cpf, nome },
      objeto
    },
    calendario: {
      dataInicial,
      periodicidade // "MENSAL" | "SEMANAL" | "ANUAL" | "DIARIO" (ajuste conforme produto contratado)
      // opcional: dataFinal
      // ...(input?.end_date ? { dataFinal: input.end_date } : {})
    },
    valor: { valorRec } // string com 2 casas decimais
    // opcional: politicaRetentativa, ativacao, etc. — inclua aqui se o seu produto exigir
  };

  return body;
}

// ============================
// H A N D L E R
// ============================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    // 1) validação mínima do payload do app (campos que você já coleta)
    const body = req.body as any;
    const sub = body?.subscriber || {};
    if (!sub?.name || !sub?.cpf || !body?.amount_cents || !body?.periodicity) {
      setCors(req, res);
      return res.status(400).json({
        ok: false,
        error: "missing_fields",
        need: ["subscriber.name", "subscriber.cpf", "amount_cents", "periodicity"],
      });
    }

    // 2) monta o payload do /v2/rec exatamente como a Efí espera
    const efiBody = toEfiRecurrenceBody(body);

    // 3) endpoint da Efí (permite override por ENV; default = /v2/rec)
    const path = (process.env.EFI_REC_CREATE_PATH || "/v2/rec").trim();
    if (!path.startsWith("/")) {
      setCors(req, res);
      return res.status(500).json({
        ok: false,
        error: "bad_env",
        detail: "EFI_REC_CREATE_PATH deve começar com '/'. Ex.: /v2/rec",
      });
    }

    // 4) chama a Efí (mTLS + OAuth via efi())
    const api = await efi();
    // se precisar depurar Content-Length, descomente:
    // api.defaults.headers.common["Accept-Encoding"] = "identity";

    const resp = await api.post(path, efiBody);

    // 5) devolve para o frontend
    setCors(req, res);
    return res.status(200).json({
      ok: true,
      data: resp.data, // geralmente inclui idRec, status, dados de ativação/loc etc.
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("efi_rec_error", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok: false, error: "efi_rec_create_fail", detail });
  }
}
