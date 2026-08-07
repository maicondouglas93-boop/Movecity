# Variáveis do sistema de notificação — chave, valor e onde colocar

**Data:** 2026-08-03

Três destinos independentes. Cada bloco é autossuficiente: faça um, salve, redeploy,
confira. Não precisa fazer os três de uma vez.

As variáveis listadas foram extraídas do código (o que cada app **de fato lê**), não de
memória — nada aqui é supérfluo.

> **Sobre segredo:** as `VITE_*` do Firebase **não são segredo**. Elas vão para dentro do
> bundle que o navegador baixa, e já estão em texto claro no `firebase-messaging-sw.js`
> que está no repositório. Segurança do Firebase se faz por domínios autorizados e
> regras, não por esconder esses valores. As do **Render** (`FIREBASE_PRIVATE_KEY`) são
> segredo de verdade.

---

## 1. RENDER — backend (`movecity.onrender.com`)

Painel do Render → serviço do backend → **Environment**.

### 1.1 Adicionar (não existem hoje)

| Chave | Valor |
|---|---|
| `BASE_URL` | `https://movecity.onrender.com` |
| `FRONTEND_URL` | `https://www.moovecity.com.br` |
| `CAPTAIN_AVAILABILITY_TTL_MINUTES` | `15` |

**`FRONTEND_URL`** — origem do site/PWA (deep links nas push). Preferir o www.
CORS também libera `https://moovecity.com.br` no código (`Backend/config/corsOrigins.js`).

**`BASE_URL`** — para onde o Service Worker do motorista manda o "Aceitar" da
notificação. Regras do valor:
- **sem** barra no final
- **sem** `/api` (as rotas de corrida ficam em `/rides`, não `/api/rides`)
- confirme que é mesmo a URL pública do seu serviço no Render

Se estiver ausente, o botão "Aceitar" nem é oferecido na notificação (proposital — melhor
que um botão que falha calado). Se estiver errado, o botão aparece e falha.

**`CAPTAIN_AVAILABILITY_TTL_MINUTES`** — por quantos minutos, após o último sinal do
motorista, ele continua recebendo corridas com o app fechado. Tem padrão 15 no código,
então é opcional; defina explicitamente se quiser outro valor.

### 1.2 Conferir que já existem (o envio depende delas)

Estas são as credenciais do **Firebase Admin SDK** — sem elas o backend não consegue
enviar nenhuma push. Estão no seu `.env` local; confirme que estão também no Render:

| Chave | De onde vem |
|---|---|
| `FIREBASE_PROJECT_ID` | `movecity-12a8d` |
| `FIREBASE_CLIENT_EMAIL` | do JSON da conta de serviço (Firebase → Configurações → Contas de serviço) |
| `FIREBASE_PRIVATE_KEY` | **segredo** — mesmo JSON. Cole com os `\n` literais, como está no seu `.env` |
| `FIREBASE_STORAGE_BUCKET` | `movecity-12a8d.firebasestorage.app` |

**Como confirmar:** no log de inicialização do Render deve aparecer
`Firebase Admin SDK inicializado.` Se aparecer
`AVISO: Credenciais do Firebase não encontradas`, está faltando alguma — e nenhuma
notificação sai.

---

## 2. VERCEL — app do passageiro/motorista (`https://www.moovecity.com.br` / `movecity-six.vercel.app`)

Vercel → projeto do app → Settings → **Domains** (adicione `moovecity.com.br` e `www.moovecity.com.br`)
e **Environment Variables**.

⚠️ **Este app usa o Firebase para push *e* para o login com Google.** Se faltar
configuração aqui, o botão "Entrar com o Google" também para de funcionar.

| Chave | Valor |
|---|---|
| `VITE_FIREBASE_API_KEY` | `<configurar-no-ambiente — Firebase Console > Configurações do projeto > Geral>` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_PROJECT_ID` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_APP_ID` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_VAPID_KEY` | `<configurar-no-ambiente — Firebase Console > Cloud Messaging > Web Push certificates>` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `<configurar-no-ambiente>` *(opcional — só Analytics)* |

> Fase 1 da auditoria de production readiness (C4, 2026-08-05): os valores reais foram
> removidos deste documento — pegue-os no Firebase Console e cadastre só no painel de
> deploy. Não versione valores operacionais completos no repositório.

A `VITE_VAPID_KEY` é o que permite gerar o token de push. Sem ela, o app não gera token e
nunca recebe notificação — **sem erro visível**, só um aviso no console.

Confira também que `VITE_BASE_URL` já existe e aponta para `https://movecity.onrender.com`
(não é de notificação, mas todo o app depende dela).

---

## 3. VERCEL — painel administrativo (`movecity-admin.vercel.app`)

Vercel → projeto do admin → Settings → **Environment Variables**.

Aqui o Firebase serve **só** para push. Se faltar, o painel funciona normalmente — apenas
não recebe alertas (novo motorista, denúncia, problema de pagamento).

| Chave | Valor |
|---|---|
| `VITE_FIREBASE_API_KEY` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_PROJECT_ID` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_APP_ID` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_VAPID_KEY` | `<configurar-no-ambiente>` |

São **os mesmos valores** do bloco 2 — mesmo projeto Firebase. A diferença é que aqui
`VITE_FIREBASE_MEASUREMENT_ID` **não** é usada; não precisa cadastrar.

Confira também que `VITE_API_URL` existe e aponta para
`https://movecity.onrender.com/api` (com `/api`, diferente do backend). Se o painel já
funciona hoje, já está lá.

---

## Depois de salvar, em qualquer um dos dois projetos da Vercel

**É obrigatório fazer um redeploy.** As `VITE_*` são resolvidas em tempo de *build* e
gravadas dentro do bundle — salvar a variável sozinho não muda nada no que está no ar.

Vercel → Deployments → último deploy → menu `...` → **Redeploy**.

---

## Como conferir que funcionou

Abra o app, F12 → Console.

| O que aparece | Significa |
|---|---|
| *(nada sobre push)* | Configuração OK |
| `[Push] Configuração do Firebase ausente...` | As `VITE_FIREBASE_*` não chegaram ao build — faltou variável ou faltou redeploy |
| `[Push] Este navegador não suporta Web Push` | Configuração OK; é o navegador. No iPhone só funciona com o app instalado na tela de início (PWA) |
| `VAPID key not configured` | Faltou só a `VITE_FIREBASE_VAPID_KEY` |

No **backend**, nos logs do Render:

| O que aparece | Significa |
|---|---|
| `Firebase Admin SDK inicializado.` | Consegue enviar |
| `AVISO: Credenciais do Firebase não encontradas` | Falta `FIREBASE_*` — nada é enviado |
| `AVISO CRÍTICO: BASE_URL não configurado em produção` | Falta `BASE_URL` — o "Aceitar" não é oferecido |

---

## Resumo

| Destino | Quantas adicionar | Se faltar |
|---|---|---|
| Render | 2 novas + conferir 4 do Admin SDK | Sem `BASE_URL`: sem botão "Aceitar". Sem `FIREBASE_*`: nenhuma push é enviada |
| Vercel — passageiro/motorista | 7 (+1 opcional) | Sem push **e sem login com Google** |
| Vercel — admin | 7 | Só o painel não recebe alertas |

> Variáveis de ambiente **não substituem** os scripts de migração. Os três continuam
> pendentes — ver `docs/plans/2026-08-03-passo-a-passo-deploy.md`.
