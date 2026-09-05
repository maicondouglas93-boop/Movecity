# MoveCity — recuperação de finalização e sessão

Escopo: relatos de finalização sem sinal, logout durante o uso e logout após atualização. Nenhum deploy, commit, push ou AAB nesta etapa.

## Alterações

- `FinishRide.jsx`: reconhece timeouts Axios; reutiliza o mesmo horário/GPS no POST e na fila; guarda a finalização antes de calcular a prévia offline.
- `offlineRideFare.js`: aceita o horário do toque para não somar o tempo de espera da rede à prévia de recuperação.
- Controllers de refresh de motorista/passageiro: token explícito do corpo tem prioridade sobre cookie antigo ou do outro papel; cookie continua como fallback.
- `axios.js`: preserva o papel em rotas compartilhadas e não permite que um refresh atrasado apague um login novo ou desfaça logout.
- Sessão Android: leitura da cópia nativa antes de montar o app e antes do refresh; seleção pela data de atualização; backend da cópia deve coincidir; logout explícito impede restauração. Falha da ponte não apaga a sessão.
- Escritas nativas serializadas e com espera limitada no JS; removido espelhamento redundante da Home.
- Esclarecimento do motorista: o valor deve continuar contando durante a queda, não só permitir finalizar. `useRideMeter` integra o cálculo local à `CaptainRiding`, atualizando a cada segundo sem resposta do servidor, inclusive com distância zero; mantém o modo local até uma confirmação nova. Usa as tarifas já recebidas e a fila GPS existente; sem tarifas, informa a limitação e não inventa preço. O valor definitivo continua sendo confirmado pelo servidor.

## Segunda etapa — retomada offline e conciliação GPS

- `driverRecoveryStore`: guarda corrida iniciada e perfil mínimo, vinculados ao ID da conta e ao servidor. Logout, bloqueio definitivo e encerramento removem a recuperação; callbacks antigos não gravam dados em outra conta. Tokens são apenas usados para particionar a cópia local, não para autorizar ações no backend.
- `SessionGuard` / `CaptainProtectWrapper`: sem internet ou com falha transitória, permitem retomar somente a corrida salva. Também tentam a recuperação após 1,5 s de espera pelo servidor. Não liberam carteira ou novas operações com base no perfil antigo. Revalidam ao reconectar e respeitam 401/403 definitivos.
- `RideContext`: hidratação persistente protegida contra resposta tardia e finalização pendente; distingue ausência confirmada (404) de falha de rede. `CaptainRiding` sai de uma corrida inexistente após confirmação do servidor. Encerrar e voltar não causa redirecionamento para uma corrida já fechada.
- GPS: backend devolve distância e última posição válida do mesmo snapshot. DTO fornece essa âncora somente ao motorista na corrida iniciada; não a ofertas, passageiro ou históricos.
- IndexedDB v4 adiciona `rideTracking`, sem limpar filas anteriores. Um ACK grava o checkpoint e remove o ponto na mesma transação. Se a gravação falhar, ambos são revertidos e o ponto permanece para reenvio. Rejeições GPS não tornam o ponto inválido uma nova âncora.
- Prévia local inclui o trecho entre a última posição confirmada e o primeiro ponto offline, ignora pontos já cobertos pelo checkpoint, pontos futuros, imprecisos e deslocamentos impossíveis. Durante replay parcial, o contador inclui o restante da fila em vez de voltar ao valor parcial do servidor.
- `fake-indexeddb` adicionado apenas como dependência de desenvolvimento para testar persistência, migração e rollback transacional.

## Validação

- Primeira etapa: 45 arquivos, 246 testes frontend aprovados. Segunda etapa: 47 arquivos, 270 testes aprovados; build motorista aprovado (`driver-DIa9qmsV.js`).
- Backend: Jest crítico de recuperação de sessão e middleware: 45 testes aprovados.
- Contratos/comportamento de rotação: 8 testes aprovados; revogação por reuso e isolamento de família mantidos.
- ESLint dos arquivos de sessão e testes alterados: aprovado.
- `npm run build:driver`: aprovado, com avisos de tamanho de bundle/importações já existentes.
- Android: `:app:compileDebugJavaWithJavac --offline --no-daemon --console=plain`, JDK 21: aprovado. Primeiras tentativas foram bloqueadas pelo sandbox e pelo JDK 25 incompatível; nenhuma alteração de Gradle foi necessária.
- Segunda etapa: 5 testes GPS backend e 17 testes de DTOs/rotação aprovados; os 45 testes de sessão/middleware foram reexecutados e passaram. Serviços JS novos/alterados e novos testes passam no ESLint; lint completo dos componentes ainda aponta convenções legadas de `prop-types`/Fast Refresh, não foi declarado limpo.

## Antes de distribuir

Validar em aparelho: instalar atualização por cima da versão anterior (sem desinstalar), reabrir sem perder sessão, renovar após aceite nativo, encerrar em modo avião e reconectar sem duplicar cobrança; confirmar logout/bloqueio reais. Testes automatizados não substituem estes cenários físicos nem confirmam a causa de cada relato de campo.

Para o contador: percorrer trecho com e sem dados móveis, comparar a medição GPS local com a confirmação do servidor e testar perda também do GPS. Não prometer navegação offline completa, novas ofertas sem rede ou igualdade irrestrita da prévia com a cobrança final: promoções, horário do aparelho e regras de tarifa inicial ainda podem causar ajustes. Os filtros GPS principais foram alinhados nesta segunda etapa.

O rastreamento nativo em segundo plano não foi reescrito nesta etapa. É obrigatório testar tela bloqueada, suspensão pelo Android, processo morto e atualização instalada por cima da versão anterior. A retomada recupera o que foi salvo; não recria posições que o sistema operacional deixou de coletar. A migração foi testada em IndexedDB simulado, não em aparelho físico.

Publicação: disponibilizar primeiro o backend que retorna checkpoints e depois o novo app. Um backend antigo continua aceitando o protocolo GPS, mas não fornece a nova garantia de conciliação local. Nenhum serviço de produção foi alterado nesta etapa.

Para chegar aos usuários, ainda são necessários deploy do backend/web e novo AAB do motorista com a ponte Android atualizada. Não foi feita limpeza de dados nem reinstalação.
