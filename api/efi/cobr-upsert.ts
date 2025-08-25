// api/efi/cobr-upsert.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { efi } from "../../lib/efiClient";

/** ====== CORS ====== */
function setCors(req: VercelRequest, res: VercelResponse) {
  const o = (req.headers.origin as string) || "";
  if (
    o.endsWith(".lovable.app") ||
    o.endsWith(".sandbox.lovable.dev") ||
    o === "https://assinapix-manager.vercel.app" ||
    o === "https://assinapix.com" ||
    o.endsWith(".assinapix.com")
  ) {
    res.setHeader("Access-Control-Allow-Origin", o);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/** ====== CONSTS ====== */
const COBR_BASE = (process.env.EFI_COBR_BASE || "/v2/cobr").trim();

/** ====== HELPERS ====== */
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const isYMD = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const txidOk = (s?: string) => !!s && /^[A-Za-z0-9]{26,35}$/.test(String(s));

function getRecebedorFromEnv() {
  const conta = (process.env.EFI_RECEBEDOR_CONTA || "").trim();
  const tipoConta = (process.env.EFI_RECEBEDOR_TIPOCONTA || "").trim(); // "CORRENTE" | "POUPANCA" | "PAGAMENTO"
  const agencia = (process.env.EFI_RECEBEDOR_AGENCIA || "").trim();
  return {
    conta,
    tipoConta,
    ...(agencia ? { agencia } : {}),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST" && req.method !== "PUT") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    // Body pode vir em dois formatos:
    // (A) sem txid (POST): { idRec, valor, calendario, ajusteDiaUtil?, recebedor?, devedor?, infoAdicional? ... }
    // (B) com txid  (PUT): { txid, idRec, valor, calendario, ajusteDiaUtil?, recebedor?, devedor?, infoAdicional? ... }
    const {
      txid,                // quando presente: usamos PUT /v2/cobr/:txid
      idRec,               // obrigatório (amarrar à recorrência)
      valor,               // { original: "55.00" } - obrigatório
      calendario,          // { dataDeVencimento: "YYYY-MM-DD", validadeAposVencimento? } - obrigatório dataDeVencimento
      ajusteDiaUtil,       // boolean (obrigatório no schema SEM txid; padrão true)
      recebedor,           // { conta: "123", tipoConta: "CORRENTE", agencia?: "0001" } - obrigatório
      devedor,             // opcional (ex.: { cpf: "...", nome?: "...", ... })
      infoAdicional,       // opcional string
      multa, juros, abatimento, desconto // opcionais
    } = (req.body || {}) as any;

    // validações comuns
    if (!idRec) {
      return res.status(400).json({ ok: false, error: "missing_idRec" });
    }
    if (!valor?.original) {
      return res.status(400).json({ ok: false, error: "missing_valor_original" });
    }
    const original = String(valor.original);

    const dataDeVencimento = calendario?.dataDeVencimento;
    if (!isYMD(dataDeVencimento)) {
      return res.status(400).json({
        ok: false,
        error: "missing_dataDeVencimento",
        hint: "Use YYYY-MM-DD",
      });
    }

    // recebedor obrigatório (conta + tipoConta). Preenche de env se não vier no body.
    const recebedorFinal = (() => {
      const r = recebedor && typeof recebedor === "object" ? recebedor : {};
      const envR = getRecebedorFromEnv();
      return {
        conta: String(r.conta || envR.conta || ""),
        tipoConta: String(r.tipoConta || envR.tipoConta || ""),
        ...(r.agencia || envR.agencia ? { agencia: String(r.agencia || envR.agencia) } : {}),
      };
    })();

    if (!recebedorFinal.conta || !recebedorFinal.tipoConta) {
      return res.status(400).json({
        ok: false,
        error: "missing_recebedor",
        need: ["recebedor.conta", "recebedor.tipoConta"],
        hint: "Preencha via body ou variáveis EFI_RECEBEDOR_CONTA / EFI_RECEBEDOR_TIPOCONTA",
      });
    }

    // devedor é opcional no COBR, mas se vier cpf, saneia
    const devedorFinal: any = {};
    if (devedor?.cpf) devedorFinal.cpf = onlyDigits(devedor.cpf);
    if (devedor?.nome) devedorFinal.nome = String(devedor.nome);
    if (devedor?.email) devedorFinal.email = String(devedor.email);
    if (devedor?.logradouro) devedorFinal.logradouro = String(devedor.logradouro);
    if (devedor?.cidade) devedorFinal.cidade = String(devedor.cidade);
    if (devedor?.uf) devedorFinal.uf = String(devedor.uf);
    if (devedor?.cep) devedorFinal.cep = onlyDigits(devedor.cep);

    // monta payload comum ao POST/PUT
    const payload: any = {
      idRec: String(idRec),
      valor: { original },
      calendario: {
        dataDeVencimento: String(dataDeVencimento),
        ...(calendario?.validadeAposVencimento != null
          ? { validadeAposVencimento: Number(calendario.validadeAposVencimento) }
          : {}),
      },
      // ajusteDiaUtil é OBRIGATÓRIO no schema SEM txid; mantemos default true
      ajusteDiaUtil: typeof ajusteDiaUtil === "boolean" ? ajusteDiaUtil : true,
      recebedor: recebedorFinal,
      ...(Object.keys(devedorFinal).length ? { devedor: devedorFinal } : {}),
      ...(infoAdicional ? { infoAdicional: String(infoAdicional) } : {}),
      ...(multa ? { multa } : {}),
      ...(juros ? { juros } : {}),
      ...(abatimento ? { abatimento } : {}),
      ...(desconto ? { desconto } : {}),
    };

    const api = await efi();

    // Se vier txid válido -> PUT /v2/cobr/:txid (upsert COM txid)
    // Senão -> POST /v2/cobr (criação SEM txid)
    let resp;
    if (req.method === "PUT" || (txid && txidOk(txid))) {
      if (!txidOk(txid)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_txid_format",
          hint: "txid deve ser A–Z a–z 0–9, com 26–35 caracteres",
        });
      }
      const url = `${COBR_BASE}/${encodeURIComponent(String(txid))}`;
      resp = await api.put(url, payload);
    } else {
      resp = await api.post(COBR_BASE, payload);
    }

    const d = resp.data || {};
    const copiaECola = d?.pixCopiaECola ?? d?.dadosQR?.pixCopiaECola ?? null;
    const location = d?.loc?.location ?? d?.location ?? null;
    const txidOut = d?.txid || txid || null;

    return res.status(200).json({
      ok: true,
      txid: txidOut,
      idRec,
      location,
      copiaECola,
      raw: d,
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err?.message || "unknown_error" };
    console.error("cobr_upsert_fail", status, detail);
    setCors(req, res);
    return res.status(status).json({ ok: false, error: "cobr_upsert_fail", detail });
  }
}
