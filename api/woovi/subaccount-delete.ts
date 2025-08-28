// api/woovi/subaccount-delete.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ========= Config ========= */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
// Usa o que estiver disponível (token de API preferencial; se não houver, cai no APP_ID)
const WOOVI_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID || "";

/** ========= CORS ========= */
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
  res.setHeader("Access-Control-Allow-Methods", "DELETE, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
}

/** ========= Handler ========= */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "DELETE" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  if (!WOOVI_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "missing_api_token",
      hint: "Defina WOOVI_API_TOKEN (ou WOOVI_APP_ID) no Vercel. Enviaremos o valor cru em Authorization e X-Api-Key.",
    });
  }

  try {
    // id = chave Pix usada ao criar a subconta (ex.: email/EVP/telefone)
    const pixKey =
      (req.query?.id as string) ||
      ((req.body && typeof req.body === "object") ? (req.body as any).id : "");

    if (!pixKey || typeof pixKey !== "string" || !pixKey.trim()) {
      return res.status(400).json({
        ok: false,
        error: "missing_id",
        hint: 'Envie "id" (a própria chave Pix da subconta) via query ?id=... ou body { "id": "..." }.',
      });
    }

    const url = `${WOOVI_BASE}/subaccount/${encodeURIComponent(pixKey)}`;

    // IMPORTANTE: headers com token cru (sem "Bearer") em AMBOS os cabeçalhos
    const r = await axios.delete(url, {
      headers: {
        Authorization: WOOVI_TOKEN,
        "X-Api-Key":  WOOVI_TOKEN,
      },
      validateStatus: () => true,
    });

    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status).json({
        ok: false,
        error: "woovi_subaccount_delete_fail",
        detail: r.data || null,
      });
    }

    return res.status(200).json({
      ok: true,
      id: pixKey,
      data: r.data || null,
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subaccount_delete_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({
      ok: false,
      error: "woovi_subaccount_delete_fail",
      detail,
    });
  }
}
