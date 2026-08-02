# Execução — Etapa 8 (Ganhos) — App do Motorista

**Base:** [auditoria de UX/UI de 2026-08-02](2026-08-02-auditoria-ux-motorista.md), item 9 do plano ("Médio — pode exigir endpoint novo").
**Escopo:** recorte diário/semanal/mensal de ganhos + detalhe por corrida com comissão e líquido. Hoje `CaptainEarnings.jsx` só mostra `captain.earnings` (total acumulado vitalício, sem nenhum recorte) e não lista nenhuma corrida.

## O que muda

| Arquivo | Mudança |
|---|---|
| `Backend/services/captain.service.js` | Nova `getEarningsBreakdown(captainId, range)` — `range ∈ {day, week, month}`. `day` = desde meia-noite de hoje (mesmo critério já usado em `getSummary`); `week`/`month` = janela rolante de 7/30 dias. Retorna total de ganhos líquidos, total de corridas, total de comissão, e a lista das corridas no período (`finalPrice`, `commissionAmount`, líquido, endereços, data). |
| `Backend/controllers/captain.controller.js` + `routes/captain.routes.js` | Novo `GET /captains/earnings?range=day\|week\|month` (`authCaptain`). |
| `frontend/src/modules/driver/pages/CaptainEarnings.jsx` | Seletor Hoje/Semana/Mês (segmented control); card de total do período; lista de corridas do período com valor, comissão e líquido por corrida (reaproveitando `Card`, `EmptyState`, `Skeleton` do UI kit). O cartão "Ganhos Totais" (vitalício) permanece — é uma informação diferente (total histórico vs. recorte). |

**Como verifico:** build limpo, testes de integração novos pro endpoint, suíte do frontend, verificação ao vivo criando corridas finalizadas em datas diferentes e conferindo que cada recorte soma certo.

**Nada será commitado sem pedido explícito.**

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

Implementado exatamente como mapeado, sem desvios. O card "Ganhos Totais" (vitalício) foi mantido ao lado do novo recorte — são informações complementares, não redundantes (histórico completo vs. "quanto ganhei recentemente").

**Backend:** `getEarningsBreakdown` reaproveita a mesma lógica de cálculo líquido (`finalPrice - commissionAmount`) já usada em `getSummary`, só generalizada pra um intervalo de datas parametrizável em vez de fixa em "hoje". 3 testes de integração novos: recorte "day" isola só a corrida de hoje; recorte "week" inclui até 7 dias mas exclui 8; parâmetro inválido cai no padrão "day" em vez de quebrar.

**Frontend:** segmented control Hoje/Semana/Mês; card de total do período; lista de corridas com bruto/comissão/líquido por corrida, usando `RideCardSkeleton` (carregando), `EmptyState` (sem corridas no período, e separadamente erro de rede com retry — mesmo padrão já estabelecido na Etapa 4 para o histórico).

**Build:** `vite build` limpo. **Testes:** backend `92 passes` (89 + 3 novos), frontend na baseline de sempre.

**Verificação ao vivo (servidor de dev real, Atlas real, navegador real):** motorista com 2 corridas finalizadas reais — uma de hoje (R$60 bruto, R$12 comissão, R$48 líquido) e uma de 3 dias atrás (R$35 bruto, R$7 comissão, R$28 líquido, `updatedAt` sobrescrito diretamente no banco pra simular a data). No recorte "Hoje": mostra só a corrida de hoje, R$48 líquido, a de 3 dias atrás não aparece. Ao trocar pra "Semana": as duas aparecem, total R$76 líquido — a soma exata das duas. Confirma que o filtro de data e a soma batem exatamente com o que está no Atlas.

**Nota sobre a limpeza dos dados de teste desta etapa:** depois do incidente da Etapa 7 (delete sem escopo), usei filtros explícitos por `pickup`+`otp` das corridas de teste — confirmado que só os 2 documentos criados por este script foram removidos.

**Nada foi commitado.**
