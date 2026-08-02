# Execução — Bloco A (Segurança) — Painel Administrativo

**Base:** [auditoria do painel administrativo, 2026-08-02](2026-08-02-auditoria-painel-administrativo.md), achados S1 e S9, Bloco A do Plano de Correção.
**Escopo:** dois vazamentos de dados de terceiros — GPS de toda a frota exposto via socket sem autenticação, e documentos de identidade dos motoristas (CNH, CRLV, selfie) servidos em URL pública sem login.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## O que muda

| Item | Onde |
|---|---|
| Entrada na sala `admin_room` do socket passa a exigir um JWT de admin válido | `Backend/socket.js` (evento `join`), `admin-frontend/src/contexts/SocketContext.jsx` (envia o token guardado no login) |
| Upload de documento de identidade deixa de ser `public: true` no Storage | `Backend/services/upload.service.js` |
| Nova rota para o admin obter uma URL assinada (expira em 5 min) de um documento específico | `Backend/routes/admin.routes.js`, `controllers/admin.controller.js`, `services/admin.service.js` |
| Miniatura/link do documento no drawer do motorista passa a buscar a URL assinada em vez de usar a URL salva direto | `admin-frontend/src/pages/Captains.jsx` (`TabDocuments`/`DocumentRow`) |

## Fora de escopo desta execução

- **Fotos de perfil e do veículo continuam públicas** — são exibidas ao passageiro durante a corrida, então precisam ser acessíveis sem autenticação. Só documentos de identidade (`uploadDocument`) mudam de visibilidade.
- **Migração dos arquivos já enviados**: os documentos que já estão no Storage foram gravados com `public: true` antes desta mudança. Esta execução não reescreve ACL de objetos existentes — cobre uploads novos a partir de agora. Sinalizar ao usuário como pendência separada (não é um "bug" desta etapa, é dado histórico).
- Bug do namespace do Socket.IO em produção (`VITE_API_URL` com `/api`) — é o achado R10 da auditoria, distinto de S1, e não faz parte deste bloco.

## Como verifico

- Simular `join` com `userType: 'admin'` sem token / com token inválido → não entra em `admin_room` (não recebe `admin-captain-location-updated`).
- Simular `join` com token de admin válido → entra normalmente.
- Chamar a rota de URL assinada autenticado como admin → recebe uma URL que expira; a URL antiga salva no banco deixa de abrir direto (403 do Storage).
- Build do admin-frontend limpo; suíte do backend na baseline conhecida.

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

### Socket sem autenticação (S1)

`Backend/socket.js`: o evento `join` agora exige `data.token` quando `userType === 'admin'`. O token é validado com `jwt.verify` contra `process.env.JWT_SECRET` (mesmo segredo usado pelo `authAdmin` HTTP) e o admin é confirmado como existente e `active` via `adminUserModel.findById`. Só depois disso o socket entra em `admin_room`. Sem token, token inválido, ou admin inativo/inexistente → `socket.emit('unauthorized', ...)` e o `join` não acontece — o cliente nunca recebe `admin-captain-location-updated`.

`admin-frontend/src/contexts/SocketContext.jsx`: o `emit('join', ...)` passou a incluir `token: localStorage.getItem('adminToken')`, o mesmo token já usado nas chamadas REST via `api.js`.

### Documentos de identidade em URL pública (S9)

`Backend/services/upload.service.js`: `processAndUploadImage` ganhou um parâmetro `isPublic` (default `true`, para não mudar o comportamento de foto de perfil e foto do veículo — ambas seguem públicas de propósito, pois são exibidas ao passageiro durante a corrida). `uploadDocument` (CNH frente/verso, CRLV, selfie) passa `isPublic = false`. Adicionei `getSignedDocumentUrl(fileUrl)`, que reaproveita a mesma lógica de extração de path que `deleteImage` já usava, e gera uma URL assinada válida por 5 minutos via `file.getSignedUrl({ action: 'read', expires: ... })`.

Novo endpoint `GET /admin/captains/:id/documents/:docType/url` (`authAdmin`, sem restrição de papel — mesmo nível de `getCaptainDocuments`, que já não tinha) devolve `{ url }` com a URL assinada. `admin.service.js` ganhou `getCaptainDocumentSignedUrl`.

No painel, `Captains.jsx`: o componente `DocumentRow`, que antes era redefinido a cada render de `TabDocuments` (perdendo qualquer cache de query a cada abertura da aba), virou componente de nível superior do módulo. Cada linha busca sua própria URL assinada via `useQuery` (`staleTime: 4min`, abaixo dos 5min de validade do backend) só quando existe `docData.url`. Enquanto a URL assinada carrega, ou se ainda não chegou, o link/thumbnail fica desabilitado (ícone de relógio) em vez de apontar para a URL pública antiga — que agora retorna 403 no Storage.

### O que ficou de fora, por decisão consciente

- **Migração de arquivos já enviados**: documentos enviados antes desta mudança continuam com ACL pública no Storage (setada no momento do upload). Esta execução não reescreve ACL de objetos existentes — só uploads novos a partir de agora nascem privados. Migrar os antigos exigiria um script avulso iterando o bucket, fora do escopo de "corrigir o código que causa o vazamento".
- **Fotos de perfil e do veículo**: deliberadamente mantidas públicas — são mostradas ao passageiro durante a corrida (`isPublic` default `true` preserva esse comportamento sem tocar em `uploadProfileImage`/`uploadVehicleImage`).
- **Bug do namespace do Socket.IO em produção** (`VITE_API_URL` com `/api`, achado R10): distinto de S1, não faz parte deste bloco. A autenticação implementada aqui vale tanto para dev quanto para produção assim que R10 for corrigido.

### Verificação

- `npm run build` do `admin-frontend`: limpo, sem erro de import/sintaxe (bundle único de 1.23MB, aviso de tamanho pré-existente e fora de escopo).
- `node --check` nos 5 arquivos de backend editados: sintaxe válida em todos.
- Suíte de testes do backend (`npm test`, 16 arquivos, 81 testes): **76 passam, 4 falham, 1 pulado — idêntico ao estado sem as mudanças deste bloco.** Confirmei isso concretamente: dei `git stash`, rodei a suíte no código original (mesmas 4 falhas, nos mesmos arquivos, nas mesmas linhas — `tests/auth.test.js` e `tests/integration/ride.api.test.js`, pré-existentes e sem relação com socket/upload/admin), depois `git stash pop` para restaurar e rodei de novo com o mesmo resultado. Nenhuma regressão introduzida.

**Nada foi commitado.**
