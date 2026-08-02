# Execução — Etapa 5 (Aprovação e Perfil) — App do Motorista

**Base:** [auditoria de UX/UI de 2026-08-02](2026-08-02-auditoria-ux-motorista.md), §2.7 e item 9 do plano (risco "Médio").
**Escopo:** corrigir o bug de comparação de `approvalStatus` (§2.7), criar o gate de acesso pros 7 estados de aprovação, mostrar status por documento no perfil.
**Fora de escopo, deliberadamente reduzido:** edição de perfil/foto (motorista não tem campo de foto no model hoje — adicionar isso é upload + endpoint novo + UI de edição de nome/telefone/veículo, um recorte grande o suficiente pra ser uma etapa própria si fosse pedida separadamente). Sinalizado aqui, não implementado.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## O que muda

| Arquivo | Mudança |
|---|---|
| `modules/driver/components/ApprovalGate.jsx` (novo) | Tela dedicada pros 7 estados do enum (`iniciado`, `documentos_enviados`, `em_analise`, `aprovado`, `reprovado`, `suspenso`, `bloqueado`) + o eixo separado `isBlocked`. Ícone/título/descrição por estado, botão "Verificar novamente" (refetch do perfil) e link pro Perfil. |
| `modules/driver/pages/CaptainHome.jsx` | Troca o mapa+`CaptainDetails` pelo `ApprovalGate` quando `captain.approvalStatus !== 'aprovado' \|\| captain.isBlocked` — mantém `CaptainHeader` (nav) sempre visível, pra não prender o motorista numa tela sem saída. |
| `modules/driver/pages/CaptainProfile.jsx` | `captain?.approvalStatus === 'approved'` (nunca batia) → mapa completo dos 7 estados reais, com `StatusBadge` de tom correto por estado. Novo cartão "Documentos" listando os 5 documentos (`cnhFront/cnhBack/crlv/vehicleFront/selfie`) com 3 estados por documento: Verificado / Em análise / Não enviado. |

**Como verifico:** build limpo, suíte na baseline, e verificação ao vivo criando motoristas descartáveis em cada um dos 7 estados (+ bloqueado) e conferindo por screenshot.

**Nada será commitado sem pedido explícito.**

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

O gate fica em `CaptainHome.jsx` (não em `CaptainProtectWrapper.jsx`) de propósito — um motorista pendente/reprovado ainda precisa conseguir abrir o Perfil pra ver seus documentos e o motivo, então bloquear a nível de rota inteira o deixaria sem conseguir nem isso. Só a experiência *operacional* (mapa, toggle online, aceitar corrida) fica atrás do gate.

**`refreshApprovalStatus` em `CaptainHome.jsx`:** o contexto do motorista (`CaptainDataContext`) só é populado no login ou no mount do `CaptainProtectWrapper` — sem esse botão, um motorista aprovado enquanto o app já estava aberto continuaria vendo a tela de bloqueio até fechar e reabrir o app. Chama `GET /captains/profile` de novo e atualiza o contexto via `setCaptain`.

**Achado durante a verificação, documentado por transparência (não é um bug, é uma boa surpresa):** testei o cenário "motorista aprovado mas com `isBlocked:true`" esperando ver a tela `ApprovalGate` com a mensagem de bloqueio — em vez disso, o app derrubou a sessão e voltou direto pro login. Investigando: isso é o comportamento **correto e mais forte**, resultado do P3.2 da auditoria de concorrência anterior (2026-08-02, fase 1 desta sessão) — `authCaptain` já rejeita com 403 qualquer requisição de um motorista bloqueado, com cache invalidado imediatamente, e `CaptainProtectWrapper` reage ao 403 limpando o token e mandando pro login. Ou seja, o branch `isBlocked` do `ApprovalGate` fica sem uso na prática **porque a auditoria anterior já resolveu esse caso de um jeito mais direto** (bloqueio = sessão encerrada na hora, não uma tela de aviso). Mantive o branch mesmo assim — é defesa em profundidade barata, e passaria a ativar se o contrato do endpoint de perfil mudasse no futuro (200 com `isBlocked:true` em vez de 403).

**Build:** `vite build` limpo. **Testes:** suíte do frontend na mesma baseline (`3 falhas | 4 passes`).

**Verificação ao vivo (Playwright, servidor de dev real, Atlas real):** motoristas descartáveis criados em 4 estados (`em_analise`, `reprovado`, `aprovado + isBlocked`, `aprovado` normal), login real em cada um, screenshots de Home e Perfil:
- `em_analise`: Home mostra o gate certo ("Cadastro em análise", ícone de relógio, âmbar); Perfil mostra o badge "Em análise" no tom correto.
- `reprovado`: Home mostra "Cadastro reprovado" (vermelho), orientando a falar com o suporte.
- `aprovado + isBlocked`: sessão encerrada e redirecionada pro login (achado acima).
- `aprovado` normal: Home operacional completa, sem gate; Perfil mostra "Aprovado" (verde) e o cartão de Documentos com os 3 estados reais (`cnhFront` verificado, `cnhBack` em análise, os 3 restantes não enviados) — confirmando que o cartão novo lê `captain.documents` corretamente.

Todos os motoristas descartáveis removidos ao final.

**Nada foi commitado.**
