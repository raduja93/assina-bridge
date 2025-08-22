// api/efi/health.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import https from "https";
import axios from "axios";

const baseURL   = process.env.EFI_BASE_URL;
const clientId  = process.env.EFI_CLIENT_ID;
const clientSec = process.env.EFI_CLIENT_SECRET;
const p12       = process.env.EFI_CERT_P12_BASE64 || "";
const pass      = process.env.EFI_CERT_P12_PASSWORD || "";
const scopes    = (process.env.EFI_SCOPES || "").trim();

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    if (!baseURL || !clientId || !clientSec || !p12) {
      return res.status(400).json({
        ok: false,
        missing: {
          EFI_BASE_URL: !!baseURL,
          EFI_CLIENT_ID: !!clientId,
          EFI_CLIENT_SECRET: !!clientSec,
          EFI_CERT_P12_BASE64: !!p12,
        }
      });
    }

    const agent = new https.Agent({ pfx: Buffer.from(p12, "base64"), passphrase: pass, keepAlive: true });
    const basic = Buffer.from(`${clientId}:${clientSec}`).toString("base64");

    const { data } = await axios.post(
      `${baseURL}/oauth/token`,
      { grant_type: "client_credentials", ...(scopes ? { scope: scopes } : {}) },
      { httpsAgent: agent, headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" }, timeout: 15000 }
    );

    if (!data?.access_token) return res.status(502).json({ ok: false, error: "no_access_token" });

    return res.status(200).json({ ok: true, note: "mTLS + OAuth ok" });
  } catch (err: any) {
    console.error(err?.response?.status, err?.response?.data || err?.message || err);
    return res.status(err?.response?.status || 500).json({ ok: false, error: "efi_health_failed", detail: err?.response?.data || err?.message });
  }
}
