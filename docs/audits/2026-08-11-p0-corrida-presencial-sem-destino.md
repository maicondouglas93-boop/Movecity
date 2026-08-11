# Auditoria P0 — corrida presencial sem destino e percurso real

Data da leitura: 2026-08-11. Esta é uma auditoria estática do código e dos testes; nenhuma regra de produção foi alterada. Os valores configurados no banco implantado não estão versionados, portanto os exemplos financeiros abaixo são expressos pela fórmula e pelo `pricingSnapshot` efetivamente congelado em cada corrida, sem inventar uma tarifa de produção.

## Veredito executivo após correção

O achado original era **🔴 P0**: o endereço informado ao finalizar fazia o backend substituir `actualDistance` pela rota direta origem→fim. A correção implementada mantém o endereço exclusivamente como descrição do local de término. O preço agora usa a soma GPS validada desde `started` até o clique em finalizar e o tempo de relógio desde `startedAt`.

Lajinha → Manhuaçu → Lajinha, finalizada em “Lajinha”, conserva aproximadamente 2X em `actualDistance`; nenhuma consulta origem→Lajinha substitui o acumulador. O fix capturado no clique também é consolidado com os mesmos filtros do Socket.IO, evitando perder os metros posteriores ao último tick periódico.

Status: **P0 corrigido e coberto por teste simulado de 80 km e 150 minutos**.

## Fluxo encontrado

1. `POST /rides/presential` cria a corrida com `source=driver_initiated`, `status=accepted`, `destinationPending=true`, `destination` ausente, tarifa/preço/distâncias estimadas zero, origem e primeiro `lastLocation` iguais ao GPS validado do motorista e um snapshot imutável da configuração de preço.
2. O PIN leva a corrida a `started`; `startedAt` é a referência financeira de tempo.
3. A bridge única do motorista lê o `watchPosition` de alta precisão e emite a posição a cada 5 segundos durante um serviço ativo (10 segundos apenas quando online e sem serviço).
4. O Socket.IO autenticado atualiza a posição do motorista. Durante `started`, calcula Haversine entre `lastLocation` e o novo ponto e incrementa atomicamente `actualDistance` quando o segmento passa pelos filtros.
5. A UI exibe somente “Finalizar corrida” e envia o fix GPS disponível no instante do clique; não pede endereço nem oferece “Usar minha localização atual”.
6. `endRide` valida e consolida o último segmento por compare-and-swap. O backend faz reverse geocode do GPS apenas para registrar `destination`; não existe cálculo de rota origem→endereço.
7. O `PricingEngine` recalcula o preço com `actualDistance` acumulada, o tempo de relógio desde `startedAt` e o snapshot criado no início. A corrida, pagamento pendente, comissão e breakdown recebem o mesmo preço persistido.
8. Após o motorista confirmar o dinheiro, uma transação registra o valor bruto e outra debita a comissão na carteira. O fluxo presencial atual só aceita dinheiro.

## Qual distância é usada

Há duas respostas condicionais:

| Entrada em `endRide` | Distância financeira | Classificação |
|---|---|---|
| UI atual finaliza sem `destination` | soma Haversine dos segmentos GPS aceitos, incluindo o fix do clique final | **C** |
| cliente legado envia `destination` | o texto registra somente o término; a distância continua sendo a soma GPS | **C** |
| qualquer cliente sem tracking útil | finalização recusada; não inventa rota origem→fim | sem cobrança inventada |

Portanto a regra efetivamente acionada pelo aplicativo atual é **C: soma do percurso GPS validado**. O destino é apenas metadado do término.

### Soma GPS e filtros

Para pontos aceitos `p0..pn`, o socket mantém apenas o acumulador:

`actualDistance += haversine(lastLocation, currentLocation) * 1000`.

Um segmento só entra se for maior que 5 m, menor que 2.000 m, tiver precisão ausente ou ≤100 m, timestamp no máximo 2 minutos antigo (e no máximo 30 segundos no futuro), e for fisicamente plausível: distância ≤ `max(150 m, tempo_no_servidor × 60 m/s)`. Escritas concorrentes usam compare-and-swap sobre o último ponto. Pontos rejeitados ainda substituem `lastLocation`, evitando que o salto rejeitado seja reaproveitado no segmento seguinte.

Isso filtra duplicatas/parado, coordenadas inválidas, baixa precisão declarada, saltos individuais ≥2 km e velocidade superior a 216 km/h (com tolerância mínima de 150 m). Limitações remanescentes:

- precisão ausente é considerada aceitável;
- não existe validação contra a velocidade reportada pelo aparelho;
- ruído de 6–100 m pode somar cobrança com o carro parado;
- um erro abaixo dos limiares pode entrar;
- segmentos reais de mais de 2 km entre amostras são descartados;
- a plausibilidade usa horário de recebimento no servidor, não o timestamp da amostra;
- não há `routePoints`/`locationHistory`: o banco guarda somente `actualDistance`, `lastLocation` e `lastLocationAt`, impossibilitando reconstruir ou auditar o traçado.

## GPS, queda de sinal e armazenamento

O navegador/Capacitor mantém o fix mais recente no contexto e em `localStorage`; a bridge envia esse fix em intervalos de 5 segundos. Sem socket, até 20 fixes ficam no IndexedDB, porém a reconexão envia **somente o último** e apaga a fila. Como o backend rejeita timestamps com mais de 2 minutos e segmentos ≥2 km, uma queda de sinal pode perder todo o trecho intermediário. Não existe interpolação nem consulta posterior ao provedor para preencher o caminho percorrido.

Uma falha de GPS não é preenchida com uma rota inventada: os segmentos comprovados permanecem acumulados, e o sistema exige distância útil para finalizar. O cliente offline ainda envia somente o último ponto ao reconectar, portanto gaps continuam sendo uma limitação conhecida e devem futuramente entrar em um fluxo explícito de conciliação/manual review.

## Destino no banco

Na criação sem destino:

- `destinationPending=true`;
- `destination` fica **ausente/undefined** (não igual à origem);
- `origin`, `pickupCoordinates`, `pickup`, `lastLocation` e `actualDistance=0` são persistidos;
- nenhum processo atualiza `destination` durante o trajeto.

Na finalização atual, o texto fornecido vira `destination`, `destinationPending=false`, e o último GPS válido identifica suas coordenadas/metadados. O histórico pode legitimamente exibir “Lajinha → Lajinha”, mas conserva em `actualDistance` os ~2X realmente rodados. A trilha ponto a ponto ainda não é persistida.

O metadado usa `destinationMeta.source='user_provided'`, valor já admitido pelo schema.

## Tempo e fórmula da tarifa

`actualTime = round((agora_do_backend - (startedAt || createdAt))/1000)`. Não usa timer do frontend nem duração entre pontos GPS. Para corridas com menos de 60 segundos, se houver `estimatedTime`, ela substitui o tempo real curto. Isso é tempo após o início, separado do deslocamento até o passageiro; espera pré-início é tratada por `waitTimeSeconds`/taxa de espera.

Com os valores do `pricingSnapshot.category.pricing` da corrida:

1. `D_cobrável = max(0, distância_m - minDistanceIncluded×1000)`;
2. `T_cobrável = max(0, tempo_s - minTimeIncluded×60)`;
3. `subtotal = baseFare + (D_cobrável/1000)×perKm + (T_cobrável/60)×perMinute`;
4. aplica `minimumFare`;
5. soma espera, opcionais, paradas, noturno, chuva e tarifas globais aplicáveis;
6. aplica taxa de cartão e cupom quando cabíveis (presencial é forçada a dinheiro, portanto sem cartão);
7. aplica a regra de arredondamento;
8. `comissão = (finalFare - cardFee) × platformCommission/100` e `líquido = finalFare - comissão`.

O seed versionado não prova a configuração do banco atual: ele só cria categorias ausentes, e o motor prioriza `VehicleCategory.pricing` (cujos defaults podem divergir dos campos legados do seed). Por isso não é correto declarar um valor em reais para cidades sem consultar o snapshot de uma corrida real e a resposta real do provedor.

## Simulação matemática obrigatória

Se `X` é a distância rodoviária Lajinha→Manhuaçu e `T` é o tempo total real entre início e finalização:

| Cenário | Distância considerada | Tempo | Valor calculado |
|---|---:|---:|---:|
| Origem → destino final (Lajinha) | 0 ou pequena rota local `ε` | `T` | erro se 0; se `ε>0`, `Fare(ε,T,snapshot)` |
| Soma do percurso GPS | aproximadamente `X + X = 2X` (menos segmentos filtrados/perdidos) | `T` | `Fare(actualDistance,T,snapshot)` |
| Regra atualmente implementada pela UI | **aproximadamente `2X`, soma GPS validada** | `T` | **`Fare(actualDistance,T,snapshot)`** |

A correção elimina a perda aproximada de `(2X-ε) × preço_por_km` que existia quando a rota direta substituía o percurso. A diferença residual entre `ΣGPS` e o odômetro real depende somente da qualidade/amostragem e dos filtros de segurança do tracking.

## Matriz dos testes solicitados

`ΣGPS` significa soma dos segmentos aceitos; `R(O,F)` é a rota do provedor da origem ao endereço final; `Fare(D,T,S)` aplica distância `D`, duração de relógio `T` e snapshot `S`.

| Teste | Distância esperada | Distância atual (UI) | Valor esperado pela regra de percurso | Valor atual | Risco |
|---|---|---|---|---|---|
| A — Lajinha→Manhuaçu→Lajinha | `2X` | `ΣGPS≈2X` | `Fare(2X,T,S)` | `Fare(ΣGPS,T,S)` | baixo, sujeito à qualidade GPS |
| B — Lajinha→Ibatiba→Lajinha | `2Y` | `ΣGPS≈2Y` | `Fare(2Y,T,S)` | `Fare(ΣGPS,T,S)` | baixo, sujeito à qualidade GPS |
| C — Lajinha→Manhuaçu→outra cidade→Lajinha | soma dos três trechos | `ΣGPS` | `Fare(soma,T,S)` | `Fare(ΣGPS,T,S)` | baixo, sujeito à qualidade GPS |
| D — sem destino, deslocamento curto | percurso curto real | `ΣGPS` | `Fare(ΣGPS,T,S)` | `Fare(ΣGPS,T,S)` | baixo; ruído/filtros merecem monitoramento |
| E — sem destino, deslocamento longo | percurso longo real | `ΣGPS` | `Fare(ΣGPS,T,S)` | `Fare(ΣGPS,T,S)` | baixo com tracking contínuo; gaps podem subestimar |
| F — praticamente parado | aproximadamente 0 | rota 0 | política deve impedir cobrança inventada | finalização rejeitada se rota 0; pequena rota pode gerar mínimo/tempo | baixo a médio; ruído pode inflar `ΣGPS` |
| G — GPS cai temporariamente | percurso completo | `ΣGPS` pode ficar subestimada | cobrança baseada em evidência auditável/rota conciliada | cobra somente segmentos comprovados | alto; requer futura política de conciliação |
| H — baixa precisão | percurso real | segmentos com accuracy >100 m não contam | distância validada | `Fare(ΣGPS válido,T,S)` | médio; pode subestimar |
| I — termina longe da origem | percurso real | `ΣGPS` | percurso real | `Fare(ΣGPS,T,S)` | baixo com tracking contínuo |
| J — volta exatamente à origem | `ΣGPS≈2X` | `ΣGPS≈2X` | `Fare(2X,T,S)` | `Fare(ΣGPS,T,S)` | baixo, sujeito à qualidade GPS |

Esses são testes determinísticos da seleção de ramo, não afirmações sobre quilometragens urbanas específicas. A quilometragem e os reais exatos exigem fixtures de rota/snapshot ou integração com o provedor e banco do ambiente alvo.

## Histórico, telas e consistência financeira

O documento da corrida é a fonte comum de `finalPrice`, `actualDistance`, `actualTime`, `commissionAmount`, pagamento e status. O backend devolve o documento final ao motorista, notifica passageiro vinculado e as telas de passageiro/motorista/admin preferem `finalPrice`; o histórico do motorista mostra `pickup`, `destination` e `finalPrice`. Depois da correção, as superfícies recebem os mesmos valores consolidados inclusive quando origem e término são iguais. Passageiro presencial sem conta vinculada não possui tela/histórico de passageiro para comparar.

O pagamento também copia `finalPrice`. Depois da confirmação em dinheiro, a carteira recebe um lançamento bruto de `finalPrice` e um débito de `commissionAmount`; assim, pagamento, comissão, histórico financeiro e métricas compartilham o resultado recalculado com a distância total. Há ainda uma semântica questionável em `captain.earnings`, incrementado pelo bruto, enquanto o ledger separa bruto e comissão, mas isso não cria um preço diferente para a corrida.

## Respostas SIM/NÃO

| Pergunta | Resposta | Qualificação |
|---|---|---|
| No cenário Lajinha→Manhuaçu→Lajinha, soma o percurso real? | **SIM** | soma os segmentos GPS que passam pelos filtros financeiros |
| Poderia calcular quase 0 km apenas por voltar à origem? | **NÃO** | o endereço final não substitui mais o acumulado |
| Existe risco de cobrar muito menos por usar origem→fim? | **NÃO** | essa substituição foi removida; gaps de GPS continuam um risco separado |
| GPS atualmente é suficiente para calcular o percurso? | **SIM, com ressalvas** | o acumulador calcula e tarifa o trajeto; falta trilha auditável e gaps ainda podem descartar trechos |
| A distância fica registrada no backend? | **SIM** | somente escalar `actualDistance`, mais último ponto; não o percurso completo |
| O valor final usa a distância correta? | **SIM** | usa o acumulador consolidado no cenário corrigido |
| O histórico registra o valor correto? | **SIM** | recebe o mesmo `actualDistance`, `actualTime` e `finalPrice` persistidos |
| Passageiro e motorista recebem o mesmo valor? | **SIM, quando há passageiro vinculado** | mesmo `finalPrice`; consistência não implica correção. Sem vínculo, não existe visão do passageiro |

## Causa e implementação aplicada

**Causa original:** o ramo `typedDestination` atribuía a rota origem→fim a `finishExtras.actualDistance`, com precedência sobre o acumulador.

**Implementação:** o ramo não calcula mais essa rota; consolida o fix do clique final, conserva `ride.actualDistance`, calcula `actualTime` pelo relógio do backend e entrega os dois ao `PricingEngine`. O destino e o GPS final ficam como localização de término.

**Regra recomendada para correção futura:**

- corrida normal com destino: manter origem/destino contratados, mas conservar uma trilha GPS auditável e uma política explícita para diferença entre rota contratada e execução;
- presencial sem destino: usar distância percorrida validada por segmentos, nunca distância líquida origem→fim; persistir pontos/timestamps/accuracy ou segmentos agregados auditáveis; tratar GPS faltante com estado “distância não conciliada”, sem inventar cobrança nem impedir silenciosamente a operação;
- conciliar GPS com map matching/rota dos segmentos e regras de gaps/outliers, com limiares configuráveis e revisão manual quando a confiança for insuficiente;
- não permitir que o endereço final sobrescreva o acumulado; ele deve descrever o término, não medir todo o percurso;
- criar testes de ida e volta, queda de sinal, precisão, concorrência e consistência entre ride/payment/commission/wallet antes da mudança.
