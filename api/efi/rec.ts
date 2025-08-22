// api/efi/rec.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient"; // seu cliente mTLS + OAuth (axios instance)

// ============================
// C O R S  (Lovable + seus domínios)
// ============================
function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || "";

  // 1) aceita qualquer preview/sandbox do Lovable
  if (origin.endsWith(".lovable.app") || origin.endsWith(".sandbox.lovable.dev")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  // 2) aceita seus domínios fixos (ajuste conforme necessário)
  else if (
    origin === "https://assinapix-manager.vercel.app" ||
    origin === "https://app.assinapix.com.br"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ============================
// H A N D L E R
// ============================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    // ----------------------------
    // 1) Validação de entrada básica (para UX melhor)
    //    -> mantemos flexível: se você for usar /cob/{txid}, exigimos 'txid'
    //    -> se usar EFI_REC_CREATE_PATH (POST custom), passamos o body "as is"
    // ----------------------------
    const body = req.body as any;

    // variáveis de modo/config
    const REC_CREATE_PATH = (process.env.EFI_REC_CREATE_PATH || "").trim(); // ex.: "/v2/solicrec"
    const USE_COB_PUT = process.env.EFI_COB_PUT === "1";                    // quando quiser PUT /cob/{txid}

    if (!REC_CREATE_PATH && !USE_COB_PUT) {
      setCors(req, res);
      return res.status(501).json({
        ok: false,
        error: "not_configured",
        detail:
          "Defina EFI_REC_CREATE_PATH (POST custom) ou EFI_COB_PUT=1 (PUT /cob/{txid}) nas variáveis de ambiente.",
      });
    }

    // validações por modo
    if (USE_COB_PUT) {
      if (!body?.txid) {
        setCors(req, res);
        return res.status(400).json({
          ok: false,
          error: "missing_txid",
          need: ["txid"],
          note: "Para usar PUT /cob/{txid}, forneça 'txid' no body e o payload EXATO que a Efí exige.",
        });
      }
      // OBS: o restante do body deve ser exatamente o JSON do /cob (doc oficial Efí)
    } else {
      if (!REC_CREATE_PATH.startsWith("/")) {
        setCors(req, res);
        return res.status(400).json({
          ok: false,
          error: "bad_path",
          detail: "EFI_REC_CREATE_PATH deve começar com '/'. Ex.: /v2/solicrec",
        });
      }
      // aqui não validamos campos: assumimos que você envia EXATAMENTE o JSON da collection Efí
    }

    // ----------------------------
    // 2) Chamada à Efí (mTLS + OAuth via efi())
    // ----------------------------
    const api = await efi();

    // Alguns ambientes exigem desabilitar compressão pra debug de Content-Length
    // Descomente se precisar:
    // api.defaults.headers.common["Accept-Encoding"] = "identity";

    let url = "";
    let method: "post" | "put" = "post";
    let data: any = body;

    if (USE_COB_PUT) {
      url = `/cob/${encodeURIComponent(body.txid)}`;
      method = "put";
      // 'data' = body exato exigido pela Efí para /cob (EX: { calendario, valor, chave, ... })
    } else {
      url = REC_CREATE_PATH; // EX: "/v2/solicrec" ou outro endpoint de Pix Automático
      method = "post";
      // 'data' = body exato exigido pela Efí para esse endpoint
    }

    const resp = await api.request({ url, method, data });
    setCors(req, res);
    return res.status(200).json({ ok: true, data: resp.data });

  } catch (err: any) {
    // loga o erro detalhado no server (Vercel Logs)
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("efi_rec_error", status, detail);

    setCors(req, res);
    return res.status(status).json({
      ok: false,
      error: "efi_rec_create_fail",
      detail,
    });
  }
}
