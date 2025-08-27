// api/woovi/subscription-get.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_API_TOKEN = process.env.WOOVI_API_TOKEN; // OBRIGATÓRIA (Bearer)

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }
  if (!WOOVI_API_TOKEN) {
    return res.status(500).json({ ok:false, error:"missing_WOOVI_API_TOKEN" });
  }

  try {
    const q = req.method === "GET" ? req.query : (req.body || {});
    const id = (Array.isArray(q.id) ? q.id[0] : q.id) as string | undefined; // globalID
    const correlationID = (Array.isArray(q.correlationID) ? q.correlationID[0] : q.correlationID) as string | undefined;

    if (!id && !correlationID) {
      return res.status(400).json({ ok:false, error:"missing_param", need:["id (globalID) OR correlationID"] });
    }

    const headers = {
      Authorization: `Bearer ${WOOVI_API_TOKEN}`,
      "Content-Type": "application/json",
    };

    let r;
    if (id) {
      // GET /api/v1/subscriptions/{id}  (usa o globalID retornado na criação)
      r = await axios.get(`${WOOVI_BASE}/subscriptions/${encodeURIComponent(id)}`, { headers });
    } else {
      // GET /api/v1/subscriptions?correlationID=...
      r = await axios.get(`${WOOVI_BASE}/subscriptions`, {
        headers,
        params: { correlationID },
      });
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
