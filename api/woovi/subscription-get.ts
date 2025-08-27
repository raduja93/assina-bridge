// api/woovi/subscription-get.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN || ""; // Bearer (PAT)
const WOOVI_APP_ID   = process.env.WOOVI_APP_ID   || "";   // clientId (appID)

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-app-id");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Pelo menos um dos dois precisa existir; idealmente os dois.
  if (!WOOVI_API_TOKEN && !WOOVI_APP_ID) {
    return res.status(500).json({ ok:false, error:"missing_credentials", hint:"Defina WOOVI_API_TOKEN (Bearer) e WOOVI_APP_ID (clientId)" });
  }

  try {
    const q = req.method === "GET" ? req.query : (req.body || {});
    const id = (Array.isArray(q.id) ? q.id[0] : q.id) as string | undefined; // globalID (ex: UGF5…)
    const correlationID = (Array.isArray(q.correlationID) ? q.correlationID[0] : q.correlationID) as string | undefined;

    if (!id && !correlationID) {
      return res.status(400).json({ ok:false, error:"missing_param", need:["id (globalID) OR correlationID"] });
    }

    // Monta headers “robustos”: Bearer + x-app-id. (Alguns endpoints retornam “appID inválido”
    // se não receberem o clientId.)
    const headers: Record<string,string> = {
      "Content-Type": "application/json",
    };
    if (WOOVI_API_TOKEN) headers.Authorization = `Bearer ${WOOVI_API_TOKEN}`;
    if (WOOVI_APP_ID)    headers["x-app-id"]   = WOOVI_APP_ID;

    // Fallback: se não houver token por algum motivo, envia Authorization com appId (alguns gateways aceitam)
    if (!WOOVI_API_TOKEN && WOOVI_APP_ID) {
      headers.Authorization = WOOVI_APP_ID;
    }

    let r;
    if (id) {
      // GET por globalID
      r = await axios.get(`${WOOVI_BASE}/subscriptions/${encodeURIComponent(id)}`, { headers });
    } else {
      // GET por correlationID
      r = await axios.get(`${WOOVI_BASE}/subscriptions`, { headers, params: { correlationID } });
    }

    return res.status(200).json({ ok:true, data: r.data });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subscription_get_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subscription_get_fail", detail });
  }
}
