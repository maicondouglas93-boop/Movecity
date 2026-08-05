# Passo a passo do deploy — push + disponibilidade + ícones

**Data:** 2026-08-03
**Refere-se aos commits:** `0e1bcf9` (ícones/TukTuk) e `6cc6018` (sistema de push + despacho)

Siga na ordem. Cada passo diz o que é bloqueante e o que é opcional.

> **Antes de tudo:** o seu `Backend/.env` local aponta para o banco de **produção**
> (`mongodb+srv://...movecity.mrgjbgl.mongodb.net/`) e está com `NODE_ENV=production`.
> Isso significa que rodar os scripts da sua máquina **altera a produção diretamente**.
> É conveniente (não precisa de shell no Render), mas não tem "ensaio" — confira o passo
> antes de apertar enter.

---

## PASSO 0 — Urgente, faça agora

**Por quê:** o commit `6cc6018` já está no `main`. Se o seu Render redeploya
automaticamente a cada push, o código novo **já está no ar** — e, enquanto o passo
abaixo não rodar, todo motorista online está fora do despacho (não recebe corrida
nenhuma), porque o campo `lastSeenAt` ainda está vazio no banco.

No terminal, na raiz do projeto:

```bash
node Backend/scripts/backfill-captain-last-seen.js
```

**Saída esperada:**
```
Conectando ao banco de dados...
Conectado! Verificando motoristas online sem lastSeenAt...
Motoristas online sem lastSeenAt -> N
Backfill aplicado -> modifiedCount: N
```

Se `N` for 0, ou ninguém está online agora, ou o script já rodou. Os dois casos são OK.

> Este script é **idempotente**: rodar de novo não causa dano. Você vai rodá-lo mais uma
> vez no PASSO 4, depois que o deploy final assentar.

---

## PASSO 1 — Variáveis no Render (backend) — BLOQUEANTE

Painel do Render → seu serviço → **Environment** → adicione:

| Chave | Valor |
|---|---|
| `BASE_URL` | `https://movecity.onrender.com` |
| `CAPTAIN_AVAILABILITY_TTL_MINUTES` | `15` |

**Sobre `BASE_URL`:** confira se `https://movecity.onrender.com` é mesmo a URL pública do
seu serviço no Render (deduzi de `admin-frontend/.env.example`). Regras do valor:
- **sem** barra no final
- **sem** `/api` — as rotas de corrida ficam em `/rides`, não `/api/rides`. O Service
  Worker monta `BASE_URL + /rides/:id/accept`.

Se estiver errado, o botão "Aceitar" da notificação falha.

**Sobre o TTL (15):** por quantos minutos, depois do último sinal do motorista, ele
continua recebendo corridas com o app fechado. Se achar pouco, suba para 30. Quanto
maior, mais alcance por push — e maior a chance de oferecer corrida a quem já foi
embora.

### Opcional, mas recomendado no mesmo passo

| Chave | Valor | Por quê |
|---|---|---|
| `ASAAS_WEBHOOK_TOKEN` | *(pegue no painel do Asaas)* | **Não é do meu trabalho, é uma lacuna que encontrei.** Sem isso, `POST /webhooks/asaas` rejeita **tudo** com 401 — recarga via Pix não credita a carteira e o novo alerta de pagamento nunca dispara. |

O valor está no painel do Asaas, na configuração do webhook (é o token que o Asaas
devolve no header `asaas-access-token`).

Salvar dispara um redeploy. Espere terminar antes do PASSO 3.

---

## PASSO 2 — Variáveis na Vercel (painel admin) — opcional

Só é preciso se você quiser que o **painel administrativo receba** notificações (novo
motorista para aprovar, denúncia, problema de pagamento). Sem isso nada quebra — o
painel só não recebe push.

Vercel → projeto do **admin** (`movecity-admin`) → Settings → Environment Variables:

| Chave | Valor |
|---|---|
| `VITE_FIREBASE_API_KEY` | `<configurar-no-ambiente — Firebase Console > Configurações do projeto > Geral>` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_PROJECT_ID` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_APP_ID` | `<configurar-no-ambiente>` |
| `VITE_FIREBASE_VAPID_KEY` | `<configurar-no-ambiente — Firebase Console > Cloud Messaging > Web Push certificates>` |

São os mesmos valores do app do passageiro (mesmo projeto Firebase). A API key de
cliente Firebase não é um segredo clássico (vai no bundle do navegador), mas os
valores **não ficam mais versionados** neste repositório — Fase 1 da auditoria de
production readiness (C4, 2026-08-05): pegue-os no Firebase Console e cadastre só no
painel de deploy. Garanta também que a API key tenha **restrições de domínio/API** no
Google Cloud Console (isso não é configurável por código).

Confira também se `VITE_API_URL` já existe nesse projeto (deve ser
`https://movecity.onrender.com/api`). Se o painel já funciona hoje, então já está lá.

Depois de salvar, **faça um redeploy** na Vercel — variáveis de build do Vite só entram
em um build novo.

> O app do **passageiro/motorista** já está completo, inclusive a VAPID key. Nada a
> fazer nele.

---

## PASSO 3 — Scripts de migração — BLOQUEANTE

Faça **depois** que o redeploy do Render terminar.

### 3.1 — Tokens de notificação

```bash
node Backend/scripts/fix-notification-tokens.js
```

Corrige tokens gravados com `null` no campo que não se aplica — era isso que fazia
notificação de motorista chegar a passageiro e vice-versa, e o envio "para todos"
chegar duas vezes no mesmo aparelho.

**Saída esperada:**
```
Documentos com userId:null (deveriam ser só de motorista) -> N
Documentos com captainId:null (deveriam ser só de passageiro) -> M
userId:null corrigidos -> modifiedCount: N
captainId:null corrigidos -> modifiedCount: M
```

### 3.2 — Categorias de veículo (ícone da moto + TukTuk)

```bash
node Backend/scripts/fix-vehicle-categories.js
```

**Saída esperada:**
```
Categoria 'moto' corrigida: { iconKey: 'moto' }
Categoria 'auto' corrigida: { iconKey: 'auto', isActive: false }
Migração concluída com sucesso! Categorias atualizadas: 2
```

Se disser "já estava correta", é porque já rodou antes — tudo bem.

---

## PASSO 4 — Rodar o backfill de novo

```bash
node Backend/scripts/backfill-captain-last-seen.js
```

Sim, de novo. O do PASSO 0 pegou o estado de antes; este fecha a janela de qualquer
motorista que tenha ficado online entre lá e agora. Idempotente — se não houver nada a
fazer, mostra `modifiedCount: 0`.

---

## PASSO 5 — Conferir se funcionou

### 5.1 — TukTuk sumiu e a moto está certa
Abra o app do passageiro → peça uma corrida → tela "Escolha um veículo".
Esperado: **duas** opções (Carro Econômico e Moto Rápida), e a moto com **ícone de moto**.

### 5.2 — Push chega com o app fechado (o teste principal)

Precisa de **dois aparelhos** (ou um aparelho + um navegador anônimo).

1. Aparelho A: entre como **motorista**, aceite a permissão de notificações quando o
   cartão "Ativar notificações?" aparecer, e toque em **"Ficar Online"**.
2. **Feche o app** no aparelho A (fechar mesmo, não só minimizar).
3. Aparelho B: entre como **passageiro** e peça uma corrida do mesmo tipo de veículo do
   motorista, num endereço próximo dele.
4. **Esperado:** a notificação "Nova Corrida Disponível!" aparece no aparelho A com o
   app fechado, com os botões ✅ Aceitar / ❌ Recusar / 📱 Abrir App.
5. Toque em **✅ Aceitar** → deve mostrar "⏳ Aceitando..." e depois "✅ Corrida Aceita!".

**Se a notificação não chegar:**
- Passaram-se mais de 15 min (o TTL) desde que o motorista fechou o app? Ele saiu do
  despacho — reabra o app e tente de novo.
- O motorista concedeu a permissão de notificação? Sem isso não existe token.
- iPhone: Web Push no iOS **só funciona com o app instalado na tela de início** (PWA).
  No Safari comum não funciona — é limitação da Apple, não do código.

**Se a notificação chegar mas o "Aceitar" falhar:** é o `BASE_URL`. Confira o PASSO 1.
Se ele estiver ausente, o botão nem aparece (isso é proposital).

### 5.3 — Segmentação (opcional)
Painel admin → Notificações → dispare para **Motoristas**. Nenhum passageiro deve
receber, e ninguém deve receber duas vezes.

---

## Resumo do que é bloqueante

| Passo | Bloqueante? |
|---|---|
| 0 — backfill agora | **Sim** — motoristas sem receber corrida |
| 1 — `BASE_URL` + TTL no Render | **Sim** para o "Aceitar"; TTL tem padrão |
| 1 — `ASAAS_WEBHOOK_TOKEN` | Sim para pagamentos, mas é problema pré-existente |
| 2 — Firebase na Vercel (admin) | Não — só o painel deixa de receber |
| 3 — os dois scripts | **Sim** — segmentação errada e TukTuk visível |
| 4 — backfill de novo | Recomendado |
| 5 — conferência | — |
