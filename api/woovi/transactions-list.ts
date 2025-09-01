// api/woovi/transactions-list.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

/** ===== Config ===== */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/, "");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || process.env.WOOVI_APP_ID;

/** ===== CORS ===== */
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

/** ===== Handler ===== */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok: false, error: "missing_api_token" });
  }

  try {
    // Aceita query params: start, end, customer, charge, status, page, limit
    const { start, end, customer, charge, status, page, limit } = req.query;

    const r = await axios.get(`${WOOVI_BASE}/transactions`, {
      headers: {
        Authorization: WOOVI_API_TOKEN as string,
        "X-Api-Key": WOOVI_API_TOKEN as string,
        "Content-Type": "application/json",
      },
      params: {
        start,
        end,
        customer,
        charge,
        status,
        page,
        limit,
      },
    });

    return res.status(200).json({ ok: true, data: r.data });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_transactions_list_fail", status, detail);
    return res.status(status).json({ ok: false, error: "woovi_transactions_list_fail", detail });
  }
}
