// api/woovi/subaccount-delete.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

const WOOVI_BASE = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
const WOOVI_PRIMARY_CRED = process.env.WOOVI_APP_ID || process.env.WOOVI_API_TOKEN || "";

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
  res.setHeader("Access-Control-Allow-Methods", "DELETE, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "DELETE" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  if (!WOOVI_PRIMARY_CRED) {
    return res.status(500).json({ ok:false, error:"missing_woovi_credentials" });
  }

  try {
    const id =
      (req.query?.id as string) ||
      (req.body && typeof req.body === "object" ? (req.body as any).id : undefined);

    if (!id || typeof id !== "string" || !id.trim()) {
      return res.status(400).json({ ok:false, error:"missing_id", hint:"Envie ?id=chavepix ou body { id: \"chavepix\" }" });
    }

    // Aqui usamos a chavePix como identificador da subconta
    const url = `${WOOVI_BASE}/subaccount/${encodeURIComponent(id.trim())}`;

    const r = await axios.delete(url, {
      headers: {
        Authorization: WOOVI_PRIMARY_CRED,
        "X-Api-Key": WOOVI_PRIMARY_CRED,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json({ ok:true, id, raw:r.data ?? null });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("woovi_subaccount_delete_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok:false, error:"woovi_subaccount_delete_fail", detail });
  }
}
