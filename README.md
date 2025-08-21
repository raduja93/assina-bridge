# AssinaPix — EFÍ Bridge (Vercel Serverless)

Bridge em **Node/TypeScript** para conversar com a **API Pix da EFÍ (Gerencianet)** usando **mTLS**,
exposto como **Serverless Functions** na **Vercel**.

Ele oferece **duas rotas** protegidas por **Bearer Token**:

- `POST /api/efi/charge` → cria **cobrança Pix** (retorna **Pix Copia e Cola** e **QR base64**)
- `POST /api/efi/pix-send` → faz **repasse** (envia Pix) para a **chave** da academia
- `GET  /api/health` → simples checagem (sem auth)

> **Importante:** os caminhos/nomes de campos da EFÍ podem variar por ambiente e escopo.
> Este projeto é um **esqueleto funcional** — ajuste os endpoints conforme a documentação da sua conta EFÍ.

---

## 1) Como usar (passo a passo)

### A) Preparar certificado EFÍ (mTLS) em base64
- Se você possui **arquivo .p12/.pfx**:
  - Converta para base64 e copie o conteúdo resultante para a env `EFI_CERT_P12_BASE64`
  - Se houver senha, use `EFI_CERT_PASSWORD`
- Se você possui **CRT + KEY**:
  - Converta cada um para base64 e use `EFI_CERT_CRT_BASE64` e `EFI_CERT_KEY_BASE64`

> **No Windows (PowerShell)**:
> ```powershell
> [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\certificado.p12")) > cert.p12.b64
> ```
> **No macOS/Linux**:
> ```bash
> base64 -w0 caminho/do/certificado.p12 > cert.p12.b64
> ```

### B) Variáveis de ambiente (Vercel → Project Settings → Environment Variables)
Copie do arquivo `.env.example` e preencha os valores reais:

- `EFI_BASE_URL` — URL base da API Pix EFÍ (ex.: `https://api-pix-h.efipay.com.br` para homolog)
- `EFI_CLIENT_ID` — Client ID da sua aplicação EFÍ
- `EFI_CLIENT_SECRET` — Client Secret da sua aplicação EFÍ
- **Escolha um dos formatos de certificado**:
  - `EFI_CERT_P12_BASE64` **(opcional)** e `EFI_CERT_PASSWORD` **(se houver)**
  - **ou** `EFI_CERT_CRT_BASE64` e `EFI_CERT_KEY_BASE64`
- `BRIDGE_TOKEN` — um segredo forte (será exigido no header Authorization)
- `PIX_CHAVE` — **sua chave Pix** (EVP/email/celular/cnpj) da **conta-mestra** para emissão das cobranças
- (opcional) `DEBUG_LOG=true` para logs extras

### C) Deploy
1. Publique este repo no GitHub (ou importe direto na Vercel)
2. Na **Vercel**, crie um projeto selecionando este repositório
3. Adicione as **Environment Variables**
4. Deploy. As rotas ficarão disponíveis como:
   - `https://SEU-PROJETO.vercel.app/api/efi/charge`
   - `https://SEU-PROJETO.vercel.app/api/efi/pix-send`
   - `https://SEU-PROJETO.vercel.app/api/health`

### D) Testar (curl/Postman)

**Criar cobrança Pix**
```bash
curl -X POST "https://SEU-PROJETO.vercel.app/api/efi/charge"   -H "Authorization: Bearer $BRIDGE_TOKEN"   -H "Content-Type: application/json"   -d '{"amount": 9900, "description":"Mensalidade Plano X"}'
```

**Enviar repasse**
```bash
curl -X POST "https://SEU-PROJETO.vercel.app/api/efi/pix-send"   -H "Authorization: Bearer $BRIDGE_TOKEN"   -H "Content-Type: application/json"   -d '{"keyType":"evp","keyValue":"CHAVE-PIX-DA-ACADEMIA","amount":9900,"description":"Repasse Plano X"}'
```

> Se retornar JSON com `copiaECola`/`imagemQrcode` no charge e `endToEndId` no pix-send, está ok.

---

## 2) Integração com o seu Supabase (Edge Functions)

- Guarde na Edge Function:
  - `BRIDGE_URL` → `https://SEU-PROJETO.vercel.app`
  - `BRIDGE_TOKEN` → mesmo segredo configurado na Vercel
- Chame os endpoints via `fetch` com `Authorization: Bearer ...`
- Salve os retornos em suas tabelas (`charges`, `event_logs`, etc.)

---

## 3) Segurança

- **NUNCA** exponha o `BRIDGE_TOKEN` no frontend; use apenas no backend.
- Restrinja o uso do Bridge ao seu IP/infra (se quiser, adicione validação de origem).
- Valide e registre webhooks da EFÍ no seu backend principal (Supabase Edge Function).

---

## 4) Observações

- Endpoints típicos Pix:
  - Criar **cobrança imediata**: `POST /v2/cob`
  - Obter **payload do QR**: `GET /v2/loc/{id}/qrcode`
  - **Enviar Pix** (repasse): `POST /v2/pix`
- Os nomes/estruturas podem variar por conta/ambiente. Consulte sua doc EFÍ.

Boa sorte e bons pagamentos! 💚
