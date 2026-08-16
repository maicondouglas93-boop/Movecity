# Baseline de correções — MoveCity

**Data:** 2026-08-15  
**Tarefa:** COR-0001  
**Responsável:** Codex  
**Branch:** `fix/cor-0001-baseline`  
**Commit de origem:** `2e1a08d399ad1d3cf98d6ce3c065419ac144be18`

## Escopo congelado

Este ciclo trata primeiro os bloqueadores identificados na auditoria técnica de 15 de agosto de 2026. Não devem entrar funcionalidades novas nem refatorações sem relação direta com os riscos listados abaixo.

Ordem inicial:

1. criar regressões para pagamento prematuro, CSRF e exposição de dados;
2. corrigir o contrato de pagamento sem comunicar liquidação inexistente;
3. proteger mutações autenticadas por cookie;
4. substituir documentos Mongoose serializados por DTOs explícitos;
5. prosseguir para integridade financeira, autenticação e banco.

## Estado do repositório

| Item | Estado registrado |
| --- | --- |
| Branch de origem | `main` |
| Relação com remoto | `main...origin/main`, sem divergência no início |
| Árvore de trabalho inicial | limpa |
| Commit auditado | `2e1a08d399ad1d3cf98d6ce3c065419ac144be18` |
| Branch de estabilização | `fix/cor-0001-baseline` |
| Instruções locais adicionais | nenhum `AGENTS.md` dentro do repositório |

## Runtime e gerenciador de pacotes

| Contexto | Node.js | npm |
| --- | ---: | ---: |
| CI e Android | 20.x | fornecido pela imagem do CI |
| Ambiente local da auditoria | 24.19.0 | 11.9.0 |

O repositório ainda não contém `.nvmrc`, `.node-version` ou `engines` nos pacotes principais. Portanto, existe divergência reproduzível entre o runtime documentado pelos workflows e o ambiente local. A padronização pertence à tarefa COR-5007 e não será misturada neste baseline.

## Gates configurados no CI

| Componente | Gate atual |
| --- | --- |
| Backend | `npm ci` e `npm run test:coverage` (Vitest) |
| Frontend | `npm ci`, lint não bloqueante, Vitest, build web e build motorista |
| Admin | `npm ci`, oxlint, Vitest e build |
| E2E frontend/admin | Playwright Chromium após os respectivos builds |
| Android | workflows separados para APK por tag e AAB por execução manual |

Resultado da reprodução local deste baseline:

| Gate | Resultado em 2026-08-15 |
| --- | --- |
| Backend Vitest + coverage | não concluiu: o ambiente não possui o binário MongoDB efêmero e o download externo é indisponível; além disso, 7 arquivos com API `jest.*` não estão excluídos do gate Vitest e falham com `jest is not defined` |
| Frontend Vitest | 35 arquivos e 149 testes aprovados |
| Frontend build web | aprovado |
| Frontend build motorista | aprovado |
| Frontend lint | 897 apontamentos; permanece não bloqueante conforme o workflow atual |
| Admin Vitest | 6 arquivos e 17 testes aprovados |
| Admin build | aprovado |
| Admin oxlint | aprovado, com avisos |

As dependências foram instaladas com `npm ci` e caches isolados por componente. A reprodução usou Node 24.19.0, portanto não substitui a confirmação posterior em Node 20.x no CI. Nenhum teste foi conectado a banco ou serviço de produção.

## Configuração obrigatória conhecida

Somente os nomes são registrados; valores e credenciais não fazem parte deste documento.

### Backend

`NODE_ENV`, `PORT`, `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, `DB_CONNECT`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `ADMIN_COOKIE_PASSWORD`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `BASE_URL`, `SUPPORT_WHATSAPP`, `SUPPORT_EMAIL`, `CAPTAIN_AVAILABILITY_TTL_MINUTES`, `GOOGLE_MAPS_API`, `MAPS_PROVIDER`, `MAPS_COUNTRY_CODE`, `MAPS_LANGUAGE_CODE`, `ASAAS_WEBHOOK_TOKEN`.

### Frontend passageiro/motorista

`VITE_BASE_URL`, `VITE_APP_ROLE`, `VITE_NATIVE_PUSH_ENABLED`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`, `VITE_FIREBASE_VAPID_KEY`, `VITE_MAPS_PROVIDER`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID`, `VITE_SENTRY_DSN`, `VITE_SENTRY_TRACES_SAMPLE_RATE`, `VITE_SUPPORT_WHATSAPP`, `VITE_SUPPORT_EMAIL`, `VITE_DISTRIBUTION_CHANNEL`.

### Painel administrativo

`VITE_API_URL`, `VITE_ENV`, `VITE_SENTRY_DSN`, `VITE_SENTRY_TRACES_SAMPLE_RATE`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY`.

## Incidentes bloqueadores conhecidos

| ID | Problema | Estado inicial |
| --- | --- | --- |
| FIN-001 | `/rides/pay` pode comunicar pagamento antes da liquidação real | aberto |
| SEC-001 | mutações autenticadas por cookie não têm defesa CSRF completa | aberto |
| PRIV-001 | respostas e eventos podem serializar dados pessoais/financeiros excessivos | aberto |

## Regras para as próximas alterações

- uma correção financeira ou de segurança por branch/PR;
- teste de reprodução deve falhar antes da alteração e passar depois;
- nenhum teste, migration ou script pode apontar para produção;
- nenhuma credencial ou valor de secret deve aparecer em logs, documentos ou commits;
- o plano de correção deve ser atualizado somente depois da validação objetiva;
- qualquer regra de dinheiro, Pix, estorno ou taxa que não esteja explícita exige decisão do produto.

## Evidências de encerramento da COR-0001

- [x] commit de origem e estado limpo registrados;
- [x] branch separada criada;
- [x] versões de runtime registradas;
- [x] variáveis obrigatórias inventariadas sem valores;
- [x] gates do CI documentados;
- [x] bloqueadores e ordem inicial definidos;
- [x] resultado local das suítes registrado, inclusive limitações e falhas preexistentes.
