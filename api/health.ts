// api/health.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../lib/efiClient"; // <- caminho corrigido

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const api = await efi();
    await api.get("/status").catch(() => null); // ok mesmo se /status não existir
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error(err?.response?.data || err);
    return res.status(err?.response?.status || 500).json(err?.response?.data || { error: "health_fail" });
  }
}
