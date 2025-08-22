// api/efi/health.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const api = await efi();
    // endpoint leve; se /status não existir, simplesmente devolva ok:
    await api.get("/status").catch(() => null);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error(err?.response?.data || err);
    return res.status(err?.response?.status || 500).json(err?.response?.data || { error: "health_fail" });
  }
}
