# Finalização presencial offline: teste parado e pendência no histórico

## Relato confirmado

As imagens de 07/09 mostram um teste feito parado: distância 0,0 km, cobrança local
por base + tempo, confirmação offline prematura, reabertura pelo histórico e rejeição
do servidor por distância insuficiente. Não são evidência de falha de login ou GPS.

## Correções locais

- Pré-validação offline de presencial sem destino: GPS válido/recente, distância
  registrada e deslocamento em relação à origem. Mantidas as travas do servidor
  (distância acumulada até 50 m perto da origem, ou distância zero).
- Usa checkpoint confirmado, fila GPS e fix do toque com os filtros existentes de
  precisão/tempo/salto. Não depende de tarifa nem de conexão para validar.
- Checa antes da prévia e novamente antes de enfileirar, inclusive no fallback de
  timeout online. Um teste parado não gera confirmação de cobrança ou fim pendente.
- Corrida realmente percorrida continua podendo ser salva offline. O texto distingue
  cálculo local, pedido persistido e confirmação posterior pelo servidor; não promete
  confirmação garantida ou diferença limitada a centavos.
- Histórico observa a fila local, exibe “Finalização pendente” / “A confirmar”,
  preserva um resumo mínimo por conta/servidor e não oferece reabertura da pendência.
- Navegação antiga para a corrida verifica a fila antes de iniciar contador/avisos.
  Falha nessa consulta não autoriza reabrir o snapshot. Sem pendência, uma corrida
  local válida continua contando sem esperar o servidor.
- Rejeições HTTP 400 da sincronização ficam visíveis no histórico. A ação é mantida,
  sem apagar silenciosamente o trabalho do motorista. Filas antigas são preservadas.

## Verificação

- Suíte frontend completa: 50 arquivos, 296 testes aprovados.
- Build `npm run build:driver` aprovado (avisos existentes de tamanho/imports).
- ESLint dos serviços de cálculo/validação e testes da validação aprovado.
- Regressões cobrem teste parado, GPS pendente, retorno à origem após percurso real,
  GPS inválido/antigo, prévia antiga, timeout, histórico após ACK e navegação antiga.

## Limites e publicação

Sem alteração de regra no backend. A verificação inicial acima antecede a publicação.
Ainda é necessário testar fisicamente uma viagem controlada com perda de internet
(sem desativar o GPS) e atualização do aplicativo. Pendências já criadas em versões
anteriores não são canceladas nem liquidadas automaticamente por esta correção.

## Pacote Android gerado em 07/09

- Motorista: `br.com.movecity.driver`, versão 1.1.44, código 46.
- AAB Play assinado com o mesmo certificado da versão 1.1.43.
- API de produção validada: `https://movecity.onrender.com`.
- Arquivo entregue na Área de Trabalho: `MoveCity-Motorista-1.1.44-v46.aab`.
- SHA-256: `49B44C9B9CE89AD1DF5C61F7A437901E3F78C6879AB2BCCA47DAE74C34F1999D`.
- Nenhum novo pacote do passageiro: a correção afeta o fluxo do motorista.

## Complemento: imagens das 17:44–17:48 (correção local, não publicada)

O último print exibe a viagem das 14:54 finalizada por R$ 7,59, mas também uma
pendência sem dados. Não há acesso à fila daquele aparelho para confirmar o ID.
Foi reproduzido no código o caminho: sem state/contexto, uma resposta UNKNOWN de
syncCaptainRide liberava a tela; FinishRide recebia um objeto sem _id e podia
enfileirar um end-ride sem identificação, rejeitado pela validação HTTP 400.

- Tela operacional, contador e aviso de início exigem identificação e status started.
- Recuperação indisponível mostra nova tentativa e acesso a Corridas, sem inventar
  ausência de viagem. Timeout limitado; snapshot válido segue funcionando offline.
- Dados que chegam posteriormente pelo contexto também verificam a fila antes de abrir.
- Painel de finalização e enqueue rejeitam identificações ausentes ou divergentes.
- Replay preserva registros antigos inválidos sem enviá-los, drenar GPS ou impedir
  ações legítimas posteriores. Histórico os mostra como aviso de diagnóstico separado.
- Erros da lista errors da API são interpretados; o histórico não duplica a mensagem.
- Nenhuma pendência foi apagada e nenhuma viagem foi cobrada/cancelada no servidor.

Verificação: 50 arquivos / 315 testes aprovados, incluindo 19 novas regressões;
build driver aprovado. Falta publicação (deploy e novo AAB) e teste físico.

### Pacote de correção 1.1.45 (47)

- AAB Play gerado e assinatura verificada em 07/09, mantendo o certificado anterior.
- Pacote `br.com.movecity.driver`, API de produção validada, minSDK 23 / targetSDK 36.
- Área de Trabalho: `MoveCity-Motorista-1.1.45-v47.aab` (10.301.308 bytes).
- SHA-256: `77380F01028224876923958AD42AAF4DAF5E02D37902A1597D2D1C113D333568`.
- Publicação web e envio ao teste fechado Alpha em andamento; teste físico pendente.
