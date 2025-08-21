// lib/auth.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export function requireBearer(req: VercelRequest, res: VercelResponse) {
  const token = process.env.BRIDGE_TOKEN;
  const auth = req.headers.authorization || "";
  if (!token || auth !== `Bearer ${token}`) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}
