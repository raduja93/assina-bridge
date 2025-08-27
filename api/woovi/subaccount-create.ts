// api/woovi/subaccount-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/**
 * CONFIG
 * - Preferimos WOOVI_API_TOKEN. Mantemos fallback para WOOVI_APP_ID pra compatibilidade.
 */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID;

/**
 * CORS (ajuste para prod quando lançar)
 */
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Api-Key");
}

/** Utils */
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const isEmail = (s?: string) => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Handler */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "missing_api_token",
      hint: "Defina WOOVI_API_TOKEN (ou, provisoriamente, WOOVI_APP_ID) no Vercel."
    });
  }

  try {
    const body = (req.body || {}) as any;

    // Do seu fluxo
    const businessId: string | undefined = body.businessId; // opcional: id da academia no AssinaPix
    const name: string | undefined = body.name;
    const pixKey: string | undefined = body.pixKey;

    // Opcionais (se quiser enviar à Woovi)
    const email: string | undefined = body.email;
    const phone: string | undefined = body.phone;
    const taxID: string | undefined = body.taxID; // CPF/CNPJ
    const address = body.address || undefined;    // { zipcode, street, number, ... }

    // Validações mínimas
    if (!name || !pixKey) {
      return res.status(400).json({
        ok: false,
        error: "missing_fields",
        need: ["name", "pixKey"],
      });
    }
    if (email && !isEmail(email)) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }

    // Payload para Woovi
    const payload: Record<string, any> = {
      name,
      pixKey,
      metadata: {
        source: "assinapix",
        businessId: businessId || null,
      },
    };

    if (email)   payload.email = email;
    if (phone)   payload.phone = onlyDigits(phone);
    if (taxID)   payload.taxID = onlyDigits(taxID);
    if (address) payload.address = address;

    // Idempotência recomendada
    const idemKey =
      (req.headers["idempotency-key"] as string) ||
      (businessId ? `subacct-${businessId}` : undefined);

    const r = await axios.post(`${WOOVI_BASE}/subaccount`, payload, {
      headers: {
        // Alguns ambientes aceitam Authorization simples, outros preferem X-Api-Key:
        Authorization: WOOVI_API_TOKEN,
        "X-Api-Key": WOOVI_API_TOKEN,
        "Content-Type": "application/json",
        ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
      },
      // timeout: 15000,
      validateStatus: () => true, // deixamos passar p/ normalizar retorno/erros
    });

    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status).json({
        ok: false,
        error: "woovi_subaccount_create_fail",
        detail: r.data ?? null,
      });
    }

    return res.status(200).json({ ok: true, data: r.data });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subaccount_create_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({
      ok: false,
      error: "woovi_subaccount_create_fail",
      detail,
    });
  }
}
