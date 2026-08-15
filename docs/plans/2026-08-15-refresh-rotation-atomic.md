# Rotação atômica de refresh tokens

## Problema

A implementação anterior criava o documento sucessor e, em outra operação, alterava o
token apresentado para `revokedAt/replacedBy`. Duas instâncias podiam observar o mesmo
token ainda ativo e confirmar sucessores diferentes; uma falha entre as operações também
deixava sucessor órfão ou sessão inconsistente. A janela de graça agravava o caso ao
percorrer a cadeia e executar outra rotação.

## Solução

Cada login recebe um `familyId`. A rotação abre uma transação Mongo com leitura snapshot e
write concern majority, faz um claim por `findOneAndUpdate` condicionado a token vivo,
não revogado, não substituído e não expirado, e cria o sucessor usando a mesma sessão. O
commit confirma as duas mudanças ou nenhuma.

Se outra requisição reapresentar o token nos 30 segundos de graça, ela recebe somente um
access token de 15 minutos e não cria refresh adicional. O navegador preserva o único
refresh retornado pela requisição vencedora; por isso os controllers não sobrescrevem o
cookie e o painel ADM não grava valor nulo. Fora da graça, a família identificada é
revogada. Para documentos antigos ainda sem `familyId`, o primeiro giro preenche o campo;
um reuse anterior a essa migração usa o fallback conservador de revogar as sessões do
mesmo ator.

## Requisito operacional

O MongoDB precisa oferecer transações (replica set ou cluster compatível). O deploy deve
confirmar essa capacidade antes de publicar o código. Não usar fallback não transacional:
falhar a renovação é mais seguro que voltar a permitir dois sucessores.

## Validação e observabilidade

- Executar os contratos e testes em memória com 20 chamadas concorrentes.
- Executar `test:integration:refresh-rotation` em replica set real/efêmero; deve haver um
  único sucessor persistido, enquanto as demais respostas são access-only.
- Injetar falha na criação do sucessor e confirmar que o token original continua vivo.
- Reapresentar token fora da graça e confirmar revogação somente da mesma família.
- Monitorar contadores da política e logs estruturados `AUTH_REFRESH_ROTATION_CONFLICT` /
  `AUTH_REFRESH_TOKEN_REUSE`, além de falhas de transação; nenhum deles inclui token ou ID.

## Rollback

Preferir roll-forward. O campo `familyId` é aditivo e pode permanecer no banco. Se houver
incidente operacional, restaurar a versão anterior somente depois de interromper novas
rotações e avaliar as famílias emitidas; nunca remover o índice ou apagar a trilha de
`replacedBy/revokedAt`. Sessões afetadas podem ser revogadas e exigir novo login.
