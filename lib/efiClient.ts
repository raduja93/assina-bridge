// lib/efiClient.ts
import https from "https";
import axios, { AxiosInstance } from "axios";

const p12 = process.env.EFI_CERT_P12_BASE64!;
const passphrase = process.env.EFI_CERT_P12_PASSWORD || "";
const baseURL = process.env.EFI_BASE_URL!;
const clientId = process.env.EFI_CLIENT_ID!;
const clientSecret = process.env.EFI_CLIENT_SECRET!;
const scopes = (process.env.EFI_SCOPES || "").trim();

const agent = new https.Agent({
  pfx: Buffer.from(p12, "base64"),
  passphrase,
  keepAlive: true,
});

let cached: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 90 > now) return cached.token;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const { data } = await axios.post(
    `${baseURL}/oauth/token`,
    { grant_type: "client_credentials", ...(scopes ? { scope: scopes } : {}) },
    {
      httpsAgent: agent,
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      timeout: 15000,
    }
  );
  cached = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return cached.token;
}

export async function efi(): Promise<AxiosInstance> {
  const token = await getAccessToken(); // /oauth/token exige cert + Basic Auth
  return axios.create({
    baseURL,
    httpsAgent: agent,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
    // Se você PRECISAR do Content-Length sempre:
    // headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity" },
  });
}

