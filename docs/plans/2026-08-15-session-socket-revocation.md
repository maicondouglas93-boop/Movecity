# COR-2005 — Revogação distribuída de sessões e sockets

Data: 2026-08-15  
Status: implementação concluída; aceite em duas instâncias reais pendente.

## Problema e solução

O backend guardava somente um `socketId` em cada usuário ou motorista. A conexão mais
recente sobrescrevia a anterior, então bloqueio, exclusão ou logout alcançavam no máximo
uma aba. Além disso, o cache local do passageiro podia conservar `isBlocked=false` por
dez minutos e uma identidade Socket.IO já aceita continuava nas salas mesmo depois da
expiração do access token.

A correção registra cada conexão por ator, JTI, hash de dispositivo e instância, mantém
uma sala interna por ator e publica eventos persistentes de revogação no MongoDB. Cada
processo consome os eventos por change stream e também por polling com deduplicação, de
modo que a revogação não depende de qual instância recebeu a ação administrativa. A
identidade do socket expira no instante do JWT, flags críticas são revalidadas durante a
conexão e os clientes renovam o token e refazem o `join`. O ID de dispositivo é aleatório
e não secreto; somente seu SHA-256 é armazenado.

## Componentes e contrato

| Componente | Responsabilidade |
|---|---|
| `SocketSession` | Registro por conexão com ator, JTI, hash do dispositivo, instância, validade e motivo de encerramento. |
| `SessionRevocationEvent` | Evento de conta inteira ou de uma sessão/JTI, com TTL de 24 horas. |
| `sessionRevocation.service.js` | Publicação, invalidação de cache local, change stream, polling e deduplicação. |
| `socket.js` | Sala por ator, revalidação da conta, expiração exata, remoção das salas e encerramento de todos os sockets atingidos. |
| Clientes web/admin | ID local de dispositivo, renovação do access token e novo `join`; chat refaz a autorização após restauração da identidade. |

Eventos enviados ao cliente:

- `session-revoked`: a conta ou o JTI foi revogado; o servidor encerra o transporte.
- `reauth-required`: o access token expirou; o transporte permanece conectado, mas
  perde identidade e salas até novo `join` autenticado.
- `identity-restored`: o novo `join` foi aceito; componentes com autorização própria,
  como o chat, devem ingressar novamente.

## Configuração

- `INSTANCE_ID`: identificador estável e único da réplica. Se ausente, hostname, PID e
  sufixo aleatório são usados.
- `SESSION_REVOCATION_POLL_MS`: intervalo do fallback de polling; padrão 5000 ms e
  mínimo 1000 ms.
- `SOCKET_IDENTITY_REVALIDATE_MS`: intervalo de consulta das flags críticas; padrão
  30000 ms e mínimo 5000 ms.

MongoDB precisa operar como replica set para o change stream. Se o change stream ficar
indisponível, o polling continua sendo a malha de segurança; a latência máxima esperada
de propagação entre instâncias passa a ser o intervalo configurado.

## Ordem de implantação

- [ ] Confirmar MongoDB replica set e permissão de `watch` para o usuário da aplicação.
- [ ] Criar/sincronizar os índices de `SocketSession` e `SessionRevocationEvent`, incluindo
  os índices TTL de `purgeAt`.
- [ ] Definir `INSTANCE_ID` diferente em cada réplica e manter o polling em até 5 s.
- [ ] Publicar primeiro o backend, ainda compatível com clientes sem `deviceId`.
- [ ] Publicar passageiro, motorista e painel com renovação/reentrada automática.
- [ ] Bloquear uma conta de teste com duas abas em cada uma de duas instâncias e confirmar
  quatro eventos `session-revoked` e quatro desconexões.
- [ ] Fazer logout em apenas um dispositivo e confirmar que somente o JTI apresentado cai.
- [ ] Usar access token curto em staging e confirmar `reauth-required`, perda das salas e
  posterior `identity-restored` sem duplicar presença de chat.
- [ ] Interromper temporariamente o change stream e confirmar propagação pelo polling.
- [ ] Observar erros `SessionRevocation`, quantidade de sessões ativas e latência entre
  criação do evento e desconexão durante pelo menos um ciclo de access token.

## Validação automatizada

- Contrato crítico sem banco: 10 cenários.
- Teste comportamental isolado: 4 cenários, incluindo duas abas, JTI seletivo,
  deduplicação/invalidação de cache e flag `isBlocked` fresca.
- Integração Socket.IO + Mongo replica set: 3 cenários versionados em
  `Backend/tests/sockets/session.revocation.test.js` e adicionados ao CI.
- Frontend: teste do fluxo central de autenticação/reautenticação do socket.

No sandbox local, a integração não inicia porque o `mongod` do
`mongodb-memory-server` encerra com código 100. Isso ocorre antes dos casos de teste e
é o mesmo bloqueio de infraestrutura registrado em COR-5001; o gate foi mantido no CI,
onde o replica set deve estar disponível.

## Rollback controlado

Se houver falha na reentrada dos clientes, mantenha a publicação e o consumo das
revogações e force novo login após `reauth-required`; não restaure a permanência de uma
identidade expirada nas salas. Se change streams causarem instabilidade, preserve o
polling e desative apenas a abertura do stream em uma correção versionada. Se a
propagação distribuída falhar, reduza temporariamente para uma única instância e
desconecte todos os sockets antes do deploy. Não volte a depender do único `socketId`
do cadastro como fonte de verdade.
