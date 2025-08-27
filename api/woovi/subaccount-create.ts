// api/woovi/subaccount-create.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/**
 * CONFIG
 */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_APP_ID = process.env.WOOVI_APP_ID; // <-- obrigatória: configure no Vercel

/**
 * CORS (ajuste os domínios de prod quando lançar)
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
}

/**
 * Util
 */
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const isEmail = (s?: string) => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * Handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  if (!WOOVI_APP_ID) {
    return res.status(500).json({ ok: false, error: "missing_WOOVI_APP_ID" });
  }

  try {
    const body = (req.body || {}) as any;

    // Campos do seu fluxo
    const businessId: string | undefined = body.businessId; // id interno do AssinaPix (academia)
    const name: string | undefined = body.name;
    const pixKey: string | undefined = body.pixKey;

    // Campos opcionais comuns (se quiser já enviar à Woovi)
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

    // Monta payload para a Woovi.
    // A API de subconta pode variar por conta; aqui aceitamos e repassamos campos comuns.
    // Se sua conta exigir outros campos (ex.: document/taxID, phone), já estão previstos abaixo.
    const payload: Record<string, any> = {
      name,
      pixKey,             // chave pix da academia (para identificação)
      // metadados úteis para você rastrear depois:
      metadata: {
        source: "assinapix",
        businessId: businessId || null,
      },
    };

    if (email)   payload.email = email;
    if (phone)   payload.phone = onlyDigits(phone);
    if (taxID)   payload.taxID = onlyDigits(taxID);
    if (address) payload.address = address;

    // Idempotency (opcional, mas recomendado): use o businessId para evitar duplicidade
    const idemKey =
      (req.headers["idempotency-key"] as string) ||
      (businessId ? `subacct-${businessId}` : undefined);

    const r = await axios.post(`${WOOVI_BASE}/subaccount`, payload, {
      headers: {
        Authorization: WOOVI_APP_ID,                 // <- AppID da Woovi
        "Content-Type": "application/json",
        ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
      },
      // timeout: 15000, // se quiser
    });

    return res.status(200).json({
      ok: true,
      data: r.data,
    });
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
