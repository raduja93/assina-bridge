// api/woovi/transactions-list.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ====== Config ====== */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID; // compat

/** ====== CORS ====== */
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok:false, error:"missing_api_token" });
  }

  // paginação simples
  const limit = Number(req.query.limit ?? 100);
  const skip  = Number(req.query.skip  ?? 0);

  // candidates conhecidos/possíveis (ordem de tentativa)
  const candidates = [
    `${WOOVI_BASE}/transactions?limit=${encodeURIComponent(String(limit))}&skip=${encodeURIComponent(String(skip))}`,
    `${WOOVI_BASE}/transaction?limit=${encodeURIComponent(String(limit))}&skip=${encodeURIComponent(String(skip))}`,
    `${WOOVI_BASE}/pix/transactions?limit=${encodeURIComponent(String(limit))}&skip=${encodeURIComponent(String(skip))}`,
  ];

  const headers = {
    Authorization: WOOVI_API_TOKEN as string,
    "X-Api-Key":   WOOVI_API_TOKEN as string,
  };

  let lastErr: any = null;

  for (const url of candidates) {
    try {
      const r = await axios.get(url, { headers });
      // padroniza saída (alinha com subscriptions-list)
      return res.status(200).json({
        ok: true,
        data: r.data,
        tried: [url],
      });
    } catch (e: any) {
      lastErr = {
        status: e?.response?.status || 0,
        data: e?.response?.data ?? e?.message ?? String(e),
        url,
      };
      // se não for 404, provavelmente a rota existe mas deu outro erro → já retorna
      if (lastErr.status && lastErr.status !== 404) {
        return res.status(lastErr.status).json({
          ok:false,
          error:"woovi_transactions_list_fail",
          detail:lastErr,
        });
      }
      // se foi 404, continua tentando o próximo candidate
    }
  }

  // se chegou aqui, todas as tentativas deram 404
  return res.status(404).json({
    ok:false,
    error:"woovi_transactions_list_fail",
    detail:{
      message:"All candidate endpoints returned 404",
      tried: candidates,
      lastError: lastErr,
    }
  });
}
