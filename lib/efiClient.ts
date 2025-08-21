import https from "https";
import axios, { AxiosInstance } from "axios";

const {
  EFI_BASE_URL,
  EFI_CLIENT_ID,
  EFI_CLIENT_SECRET,
  EFI_CERT_P12_BASE64,
  EFI_CERT_PASSWORD,
  EFI_CERT_CRT_BASE64,
  EFI_CERT_KEY_BASE64,
  DEBUG_LOG
} = process.env;

function assertEnv() {
  if (!EFI_BASE_URL || !EFI_CLIENT_ID || !EFI_CLIENT_SECRET) {
    throw new Error("EFI_BASE_URL, EFI_CLIENT_ID e EFI_CLIENT_SECRET são obrigatórios.");
  }
  if (!EFI_CERT_P12_BASE64 && !(EFI_CERT_CRT_BASE64 && EFI_CERT_KEY_BASE64)) {
    throw new Error("Defina EFI_CERT_P12_BASE64 (opcionalmente com EFI_CERT_PASSWORD) ou EFI_CERT_CRT_BASE64 + EFI_CERT_KEY_BASE64.");
  }
}

function buildHttpsAgent(): https.Agent {
  if (EFI_CERT_P12_BASE64) {
    const pfx = Buffer.from(EFI_CERT_P12_BASE64, "base64");
    return new https.Agent({ pfx, passphrase: EFI_CERT_PASSWORD || "" });
  }
  const cert = Buffer.from(EFI_CERT_CRT_BASE64!, "base64");
  const key  = Buffer.from(EFI_CERT_KEY_BASE64!, "base64");
  return new https.Agent({ cert, key });
}

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function fetchAccessToken(agent: https.Agent): Promise<string> {
  const url = `${EFI_BASE_URL}/oauth/token`;
  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");

  const { data } = await axios.post(url, body, {
    httpsAgent: agent,
    auth: { username: EFI_CLIENT_ID!, password: EFI_CLIENT_SECRET! },
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const now = Date.now();
  const expiresInMs = (Number(data.expires_in) || 300) * 1000;
  const token = String(data.access_token);
  cachedToken = { access_token: token, expires_at: now + expiresInMs };

  if (DEBUG_LOG) console.log("[efiClient] novo token obtido, expira em", expiresInMs/1000, "s");
  return token;
}

export async function efiClient(): Promise<AxiosInstance> {
  assertEnv();
  const agent = buildHttpsAgent();

  let token: string;
  if (cachedToken && cachedToken.expires_at > Date.now() + 30_000) {
    token = cachedToken.access_token;
  } else {
    token = await fetchAccessToken(agent);
  }

  return axios.create({
    baseURL: EFI_BASE_URL,
    httpsAgent: agent,
    headers: { Authorization: `Bearer ${token}` }
  });
}
