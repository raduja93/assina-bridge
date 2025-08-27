// api/woovi/_diag-auth.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

function mask(s?: string) {
  if (!s) return null;
  if (s.length <= 8) return "********";
  return s.slice(0,4) + "…" + s.slice(-4);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const base = (process.env.WOOVI_API_BASE || "https://api.woovi.com/api/v1").replace(/\/+$/,"");
  const token = process.env.WOOVI_API_TOKEN || "";
  const appId = process.env.WOOVI_APP_ID || "";
  res.status(200).json({
    ok: true,
    WOOVI_API_BASE: base,
    WOOVI_API_TOKEN_present: !!token,
    WOOVI_API_TOKEN_sample: mask(token),
    WOOVI_APP_ID_present: !!appId,
    WOOVI_APP_ID_sample: mask(appId),
  });
}
