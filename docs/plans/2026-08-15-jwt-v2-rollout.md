# Rollout JWT v2 — ator e finalidade

## Objetivo

Publicar access tokens com `sub`, `_id` temporário, `actorType`, `tokenType=access`,
`ver=2`, `iss`, `aud` e `jti`, usando audiences por ator. Tokens de ADM e de
compartilhamento usam segredos próprios. Refresh tokens continuam opacos e persistidos
somente por hash.

## Pré-deploy obrigatório

1. Gerar valores aleatórios independentes para `JWT_ACCESS_SECRET`,
   `JWT_ADMIN_SECRET` e `JWT_SHARE_SECRET` em cada ambiente. Todas as instâncias do
   mesmo ambiente devem receber exatamente os mesmos valores.
2. Manter `JWT_SECRET` temporariamente apenas para validar tokens v1 já emitidos.
3. Definir `JWT_ACCEPT_LEGACY_TOKENS=true` e `JWT_LEGACY_ACCEPT_UNTIL` como uma data ISO
   curta, no mínimo seis horas e preferencialmente 24 horas após o deploy. A janela
   cobre o maior token legado público existente sem virar compatibilidade permanente.
4. Confirmar que relógio e timezone de todas as instâncias estão sincronizados.

O backend deliberadamente recusa emitir ou validar tokens de ADM ou share em produção
sem seus segredos específicos. Não publicar o código antes de concluir os
passos acima.

## Ordem do rollout

1. Aplicar as variáveis em todas as instâncias antes de trocar o código.
2. Publicar o backend inteiro; não fazer canário com instâncias usando políticas ou
   segredos diferentes.
3. Confirmar login/refresh de passageiro, motorista e ADM e criar/abrir um link de
   compartilhamento novo.
4. Contar logs estruturados `AUTH_LEGACY_TOKEN_ACCEPTED`. Eles não contêm ID nem token;
   informam somente finalidade e ator esperado.
5. Após uma janela completa sem aceitações legadas, definir
   `JWT_ACCEPT_LEGACY_TOKENS=false`. Manter a data de corte passada como defesa extra.
6. Depois da estabilização, remover `JWT_SECRET` dos ambientes que não tenham outra
   dependência comprovada.

## Critérios de aceite

- Token de passageiro falha em rota/socket de motorista e ADM antes de qualquer lookup.
- Token de motorista falha em rota/socket de passageiro e ADM.
- Token de ADM só valida com `JWT_ADMIN_SECRET` e audience `movecity:admin`.
- Token share só valida com `JWT_SHARE_SECRET`, `tokenType=share` e audience
  `movecity:ride-share`; ele nunca autentica REST ou Socket.IO.
- Refresh apresentado no endpoint de outro ator falha sem rotacionar o token.
- A data de corte passada desativa a compatibilidade mesmo se a flag continuar `true`.

## Rollback seguro

Preferir roll-forward. Se for necessário suspender a política v2, manter o novo código e
reativar temporariamente a janela legada; não restaurar uma versão que desconheça os
novos segredos, pois access tokens v2 já emitidos deixariam de validar. Refresh tokens
opacos permanecem válidos e podem emitir novos access tokens depois da correção do
ambiente. Nunca copiar um segredo de ADM ou share para outro propósito como atalho.
