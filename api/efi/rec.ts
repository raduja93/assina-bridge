// api/efi/rec.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

// --- CORS (suporta várias origens) ---
function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS || "";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
function setCors(req: VercelRequest, res: VercelResponse) {
  const allowed = parseAllowedOrigins();
  const origin = (req.headers.origin as string) || "";
  const isDev = process.env.NODE_ENV !== "production";

  // se estiver em dev, libera qualquer origin que chegar
  const allow = allowed.includes(origin) ? origin : (isDev ? origin || "*" : "");
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
// --------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);

  // responde preflight
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    setCors(req, res);
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const { planId, businessId, subscriber, amount_cents, periodicity, description } =
      (req.body as any) || {};

    if (!subscriber?.name || !subscriber?.cpf || !amount_cents || !periodicity) {
      setCors(req, res);
      return res.status(400).json({
        ok: false,
        error: "missing_fields",
        need: ["subscriber.name", "subscriber.cpf", "amount_cents", "periodicity"],
      });
    }

    // por enquanto apenas ecoa os dados
    setCors(req, res);
    return res.status(200).json({
      ok: true,
      message: "Bridge recebeu os dados. Próximo passo: plugar chamada Efí aqui.",
      received: { planId, businessId, subscriber, amount_cents, periodicity, description },
    });
  } catch (e: any) {
    console.error("rec_fail", e);
    setCors(req, res);
    return res.status(500).json({ ok: false, error: "rec_fail" });
  }
}

