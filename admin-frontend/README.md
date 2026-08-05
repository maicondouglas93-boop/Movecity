# MoveCity — Painel Administrativo

SPA em React 19 + Vite para operação da plataforma: dashboard, despacho de corridas com mapa em tempo real, gestão de motoristas/usuários, finanças, tarifas, notificações e monitoramento de serviços externos.

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha VITE_API_URL
npm run dev
```

O backend precisa estar de pé na URL de `VITE_API_URL` (padrão `http://localhost:3000/api`).

## Variáveis de ambiente

Documentadas em [`.env.example`](./.env.example). Resumo:

| Variável | Efeito |
|---|---|
| `VITE_API_URL` | base da API REST (**com** `/api`) |
| `VITE_SOCKET_URL` | opcional — origin do Socket.IO; por padrão é derivada de `VITE_API_URL` sem o `/api` |
| `VITE_FIREBASE_*` + `VITE_FIREBASE_VAPID_KEY` | push do painel (opcional; sem elas o painel funciona, só não recebe alertas) |
| `VITE_SENTRY_DSN`, `VITE_SENTRY_TRACES_SAMPLE_RATE` | observabilidade (opcional) |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | build de produção → `dist/` |
| `npm test` | Vitest + MSW (specs Playwright são excluídos) |
| `npm run test:e2e` | Playwright |
| `npm run lint` | oxlint |

## Deploy (Vercel)

`vercel.json` já tem o rewrite de SPA. Cadastre as variáveis e faça redeploy após alterá-las. O CI (`.github/workflows/ci.yml`) roda lint, testes e build como gate.

## Notas de segurança conhecidas

- **Sessão em localStorage** (`adminToken`/`adminRefreshToken`/`adminUser`): padrão SPA — um XSS teria acesso aos tokens. Mitigações ativas: nenhuma renderização de HTML cru no painel, restauração de sessão sempre confirmada contra `GET /admin/me`, refresh único em 401 com logout em falha, e cookie httpOnly complementar no backend. Migrar a sessão inteira para cookies httpOnly exige mudanças no backend (refresh em cookie + proteção CSRF) e está registrado como dívida.
- Push do painel usa service worker próprio (`public/firebase-messaging-sw.js`) que recebe a config Firebase pela query string do registro — nada hardcoded versionado.
