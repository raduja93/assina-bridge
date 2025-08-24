// api/efi/rec-get.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || "";
  if (
    origin.endsWith(".lovable.app") ||
    origin.endsWith(".sandbox.lovable.dev") ||
    origin === "https://assinapix-manager.vercel.app"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const REC_BASE = (process.env.EFI_REC_GET_PATH || "/v2/rec").trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { idRec } = req.body as { idRec?: string };
    if (!idRec) return res.status(400).json({ ok: false, error: "missing_idRec" });

    const api = await efi();
    const r = await api.get(`${REC_BASE}/${encodeURIComponent(idRec)}`);

    const data = r.data || {};
    return res.status(200).json({
      ok: true,
      idRec,
      status: data.status || null,
      link: data?.loc?.location || null,
      copiaECola: data?.dadosQR?.pixCopiaECola || null,
      raw: data
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("rec_get_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok: false, error: "rec_get_fail", detail });
  }
}
