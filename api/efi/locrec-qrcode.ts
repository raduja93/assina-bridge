// api/efi/locrec-qrcode.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const LOCREC_BASE = (process.env.EFI_LOCREC_BASE || "/v2/locrec").trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req,res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { id } = (req.body || {}) as { id?: number|string };
    if (!id) return res.status(400).json({ ok:false, error:"missing_locrec_id" });

    const api = await efi();
    // Algumas versões expõem /v2/locrec/{id}/qrcode
    const r = await api.get(`${LOCREC_BASE}/${encodeURIComponent(String(id))}/qrcode`);
    const d = r.data || {};
    return res.status(200).json({
      ok: true,
      location: d?.location ?? d?.loc?.location ?? null,
      copiaECola: d?.pixCopiaECola ?? d?.dadosQR?.pixCopiaECola ?? null,
      raw: d
    });
  } catch (err:any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("locrec_qr_fail", status, detail);
    setCors(req,res);
    return res.status(status).json({ ok:false, error:"locrec_qr_fail", detail });
  }
}
