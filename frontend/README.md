# MoveCity — App do Passageiro e do Motorista

PWA em React + Vite com duas entradas no mesmo código-fonte:

- **Web/passageiro** (`index.html` → `src/main.jsx`): app completo (passageiro + motorista) com PWA, push e update prompt.
- **Driver** (`driver.html` → `src/main.driver.jsx`, modo `--mode driver`): build só do motorista, preparado para empacotar com Capacitor (ver `docs/CAPACITOR.md`); sai em `dist-driver/` sem o service worker do PWA.

## Stack

React 18 · Vite 5 · Tailwind · React Router 6 · TanStack Query · Socket.IO client · Leaflet/Google Maps (selecionável) · Firebase (push + login Google) · Sentry (opcional) · Dexie (fila offline) · vite-plugin-pwa.

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha ao menos VITE_BASE_URL
npm run dev            # app web (passageiro + motorista)
npm run dev:driver     # entrada do motorista (driver.html)
```

O backend precisa estar de pé na URL de `VITE_BASE_URL` (padrão `http://localhost:3000`).

## Variáveis de ambiente

Todas documentadas em [`.env.example`](./.env.example) (versionado). Resumo:

| Grupo | Variáveis | Efeito se faltar |
|---|---|---|
| Backend | `VITE_BASE_URL` | nada funciona (API + socket) |
| Firebase | `VITE_FIREBASE_*`, `VITE_FIREBASE_VAPID_KEY` | sem push e sem login Google |
| Mapas | `VITE_MAPS_PROVIDER`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID` | cai no Leaflet (sem chave) |
| Observabilidade | `VITE_SENTRY_DSN`, `VITE_SENTRY_TRACES_SAMPLE_RATE` | monitoramento desligado |
| Suporte | `VITE_SUPPORT_WHATSAPP`, `VITE_SUPPORT_EMAIL` | fallback da tela Ajuda vazio |

A config do Firebase chega ao service worker de push pela **query string da URL de registro** (`src/shared/services/fcm.js` → `public/firebase-messaging-sw.js`) — não há valor hardcoded versionado.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` / `dev:driver` | dev server (web / driver) |
| `npm run build` | build web → `dist/` (com PWA) |
| `npm run build:driver` | build motorista → `dist-driver/` (sem PWA, com `index.html` para Capacitor) |
| `npm test` / `test:coverage` | Vitest (unit/integração; specs Playwright são excluídos) |
| `npm run test:e2e` | Playwright (precisa de backend + app de pé) |
| `npm run lint` | ESLint |

## Deploy (Vercel)

- Projeto aponta para `frontend/`; `vercel.json` já tem o rewrite de SPA.
- Cadastre as variáveis do `.env.example` em Settings → Environment Variables e **faça redeploy** (env de build do Vite só entra em build novo).
- O CI (`.github/workflows/ci.yml`) roda lint, testes e os dois builds como gate.

## Arquitetura em uma olhada

- `src/passenger/` e `src/driver/` — telas de cada papel; `src/shared/` — serviços, contexts e UI comuns.
- HTTP: via `@/shared/services/axios` (timeout 10s, withCredentials, refresh em 401). O logout do passageiro usa axios sem interceptor para não renovar a sessão durante a saída; ambos os logouts usam `POST` e enviam o refresh token no corpo.
- Tempo real: singleton em `src/shared/contexts/SocketContext.jsx` com `joinWithRetry` autenticado.
- Offline: fila de ações críticas em `src/shared/services/offlineQueue.js` (Dexie), reexecutada via HTTP na reconexão.
- Erros de render: `AppErrorBoundary` no topo das duas entradas, integrado ao Sentry.
