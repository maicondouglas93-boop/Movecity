# Controle administrativo do bloqueio por crédito negativo

O Centro Financeiro passa a mostrar a regra de crédito dos motoristas. `super_admin` e `OWNER` podem ativar ou desativar o bloqueio; `financeiro` pode consultar. Alterações são registradas no histórico administrativo.

Com a regra ativa, crédito abaixo de zero impede ficar online, aceitar novas corridas e encomendas, criar uma presencial e iniciar uma presencial ainda não iniciada. Zero é permitido. Com a regra desativada, crédito negativo não impede esses serviços. Aprovação, bloqueio administrativo, autorização de veículo e exclusividade de serviço continuam independentes. Uma corrida de passageiro já aceita pode prosseguir; a finalização de serviços em andamento permanece disponível.

O servidor consulta carteira e regra atuais, sem depender de um indicador financeiro antigo ou do cache da configuração. Comissões e recargas usam a mesma política. A antiga tolerância `maximumNegativeBalance` deixa de definir um segundo limite; o limite da regra ativa é zero. A configuração existente de ativação é preservada no deploy; quando ausente, o padrão é ativado.

Salvar a regra atualiza a configuração e o indicador `canReceiveRides` dos motoristas aprovados e sem bloqueio administrativo na mesma transação MongoDB. Depois, invalida os caches de configuração, perfil, resumo e candidatos ao despacho. A versão da configuração impede sobrescrever uma edição concorrente.

Validação local: 68 testes de servidor nos arquivos de política financeira, presencial, encomendas e carteira; 5 testes do novo controle no painel; 21 testes críticos de CSRF/logout e privacidade por ator. Lint e build do painel passaram. Conferência no navegador usou o componente real com respostas locais de teste, incluindo desligamento e salvamento confirmado. Nenhum dado de produção foi alterado nessa conferência.

Não há mudança no cliente Android: a atualização do painel e do servidor funciona com o AAB 1.1.49 (51) já gerado.

As suítes completas do Vitest mantêm falhas anteriores: servidor 13 arquivos/48 testes, painel 2 arquivos/2 testes (PIN do lançamento manual e recuperação do PIN). A comparação dos nomes únicos de falhas com o CI 34727009724 do commit anterior resultou nos mesmos 55 nomes, sem diferença. Não é uma afirmação de aprovação integral do CI.
