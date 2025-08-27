// api/woovi/subscription-get.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios, { AxiosInstance } from "axios";

/** ENV */
const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/, "");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN;   // Bearer (assinaturas)
const WOOVI_APP_ID    = process.env.WOOVI_APP_ID;      // AppID (subconta e, em algumas contas, também consultas)

/** CORS */
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function clientBearer(): AxiosInstance | null {
  if (!WOOVI_API_TOKEN) return null;
  return axios.create({
    baseURL: WOOVI_BASE,
    headers: { Authorization: `Bearer ${WOOVI_API_TOKEN}`, "Content-Type": "application/json" },
  });
}
function clientAppId(): AxiosInstance | null {
  if (!WOOVI_APP_ID) return null;
  return axios.create({
    baseURL: WOOVI_BASE,
    headers: { Authorization: WOOVI_APP_ID, "Content-Type": "application/json" },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const q = req.method === "GET" ? req.query : (req.body || {});
    const correlationID = (q.correlationID || q.correlationId || "").toString().trim();
    const subscriptionId = (q.subscriptionId || q.id || "").toString().trim();

    if (!correlationID && !subscriptionId) {
      return res.status(400).json({ ok:false, error:"missing_identifier", hint:"informe correlationID OU subscriptionId" });
    }

    const attempts: AxiosInstance[] = [];
    const cBearer = clientBearer();
    const cAppId  = clientAppId();
    if (cBearer) attempts.push(cBearer);
    if (cAppId)  attempts.push(cAppId);

    if (attempts.length === 0) {
      return res.status(500).json({
        ok:false,
        error:"missing_credentials",
        hint:"Defina ao menos um: WOOVI_API_TOKEN (Bearer) ou WOOVI_APP_ID (AppID)",
      });
    }

    let data: any = null;
    let lastErr: any = null;

    for (const cli of attempts) {
      try {
        if (subscriptionId) {
          const r = await cli.get(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
          data = r.data;
        } else {
          const r = await cli.get(`/subscriptions`, { params: { correlationID } });
          data = r.data;
        }
        lastErr = null;
        break;
      } catch (e: any) {
        lastErr = e;
        // segue para o próximo modo de auth
      }
    }

    if (!data) {
      const status = lastErr?.response?.status || 500;
      const detail = lastErr?.response?.data || { message: lastErr?.message || "unknown_error" };
      return res.status(status).json({ ok:false, error:"woovi_subscription_get_fail", detail });
    }

    const sub = data?.subscription || data?.subscriptions?.[0] || data;
    const emv = sub?.pixRecurring?.emv || null;
    const journey = sub?.pixRecurring?.journey || null;
    const recurrencyId = sub?.pixRecurring?.recurrencyId || null;
    const status = sub?.status || null;

    return res.status(200).json({
      ok: true,
      status,
      emv,
      journey,
      recurrencyId,
      raw: data,
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_get_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subscription_get_fail", detail });
  }
}
