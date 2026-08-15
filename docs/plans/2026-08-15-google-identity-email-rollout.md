# COR-2004 — Identidade Google e normalização de e-mail

Data: 2026-08-15

Status: implementação concluída; auditoria/migração da base real e aceite em staging pendentes.

## Problema e solução

O endpoint Google confiava apenas no e-mail contido no token Firebase. Ele não exigia
`email_verified`, não confirmava que o provedor daquela autenticação era `google.com` e
não persistia o UID imutável do Firebase. Uma conta local com o mesmo e-mail podia ser
vinculada silenciosamente. Cadastro e login por senha também consultavam o e-mail sem
uma normalização única, permitindo identidades distintas apenas por espaços ou caixa.

A correção valida token revogado, UID, provedor e e-mail verificado; procura primeiro
por `firebaseUid`; e exige a senha atual antes de ligar uma conta local existente. Todo
e-mail novo passa por `trim` e minúsculas no validator, serviço e schema. Senha e UID
foram marcados como campos não selecionáveis e também são removidos no `toJSON`, mesmo
quando o controller precisa selecioná-los para autenticar. Contas Google novas recebem
senha interna aleatória criptograficamente forte, nunca exposta ao cliente.

## Matriz de decisão do login Google

| Estado encontrado | Resultado |
|---|---|
| Token sem UID, não verificado ou de outro provedor | `401`, sem consulta/vínculo |
| UID já vinculado e mesmo e-mail normalizado | login permitido |
| UID já vinculado e e-mail divergente | `409 GOOGLE_IDENTITY_CONFLICT`; suporte manual |
| E-mail local existe, sem UID e sem senha confirmada | `409 GOOGLE_LINK_PASSWORD_REQUIRED` |
| E-mail local existe, senha informada mas inválida | `401 GOOGLE_LINK_PASSWORD_INVALID` |
| E-mail local existe e senha atual é válida | UID persistido; login permitido |
| E-mail não existe | nova conta normalizada e vinculada ao UID |
| Conta bloqueada | sessões revogadas e `403` |

O frontend não envia a senha junto ao primeiro token Google. Após receber
`GOOGLE_LINK_PASSWORD_REQUIRED`, orienta o usuário e somente a segunda tentativa inclui
a senha preenchida. Isso evita transformar o login Google comum em transporte
desnecessário de credencial local.

## Auditoria e migração segura

Os scripts abaixo leem `DB_CONNECT`. O relatório não imprime e-mails ou UIDs em claro:
usa fingerprints e IDs internos para encaminhar a análise controlada.

1. Criar snapshot/backup recuperável do banco e registrar o responsável pela mudança.
2. Executar o auditor somente leitura:

   ```bash
   npm run audit:user-email-identities
   ```

3. Se houver `normalizedEmailCollisions`, `firebaseUidCollisions` ou `invalidEmails`,
   interromper. Investigar cada ID, confirmar o titular e preservar corridas, pagamentos,
   carteira e auditoria. Nunca escolher automaticamente uma conta para apagar ou mesclar.
4. Depois de zerar conflitos, executar o dry-run transacional:

   ```bash
   npm run migrate:user-email-normalization
   ```

5. Revisar o resumo e, somente com backup e aprovação operacional, aplicar:

   ```bash
   npm run migrate:user-email-normalization -- --apply
   ```

6. Repetir o auditor. O resultado esperado é zero colisões, zero inválidos e zero
   candidatos à normalização.

O modo `--apply` repete a auditoria dentro de transação Mongo com leitura snapshot e
write concern majority. Qualquer conflito, dado inválido, alteração concorrente ou erro
de índice aborta a transação inteira; não existe migração parcial silenciosa.

## Ordem de implantação

- [ ] Executar auditor somente leitura na base real e anexar o resumo sem PII ao ticket.
- [ ] Resolver manualmente colisões/invalidos, se existirem, sem exclusão automática.
- [ ] Criar snapshot e aplicar a normalização transacional; repetir o auditor.
- [ ] Publicar backend com `GOOGLE_LOGIN_ENABLED=true` e
  `GOOGLE_ALLOW_LEGACY_EMAIL_LINK=false`.
- [ ] Publicar frontend e validar a confirmação de vínculo nas telas Login e Cadastro.
- [ ] Confirmar em staging: token não Google, e-mail não verificado, conta nova, conta
  existente com senha errada/correta, caixa/espaços e conta bloqueada.
- [ ] Verificar que respostas e logs não contêm hash de senha, UID, token ou e-mail.

Para contas históricas criadas pelo fluxo Google antigo, a senha aleatória nunca foi
conhecida pelo usuário. Se o suporte confirmar que elas precisam de transição, pode-se
abrir excepcionalmente uma janela curta com as duas condições abaixo:

```env
GOOGLE_ALLOW_LEGACY_EMAIL_LINK=true
GOOGLE_LEGACY_LINK_UNTIL=2026-08-16T18:00:00.000Z
```

Cada uso emite `AUTH_GOOGLE_LEGACY_EMAIL_LINK` sem PII. Encerrar a janela assim que a
contagem esperada for atingida; flag `true` sem data futura continua falhando fechado.

## Validação automatizada executada

- Contrato crítico COR-2004: 7/7.
- Testes comportamentais de identidade/controller/migração: 7/7.
- Telas de Login e Cadastro: 10/10.
- ESLint dos arquivos alterados do frontend, sintaxe Node e `git diff --check`: aprovados.

A suíte ampla não fornece um sinal válido neste ambiente: Jest é interrompido antes dos
cenários pelo MongoMemoryReplSet, e Vitest também coleta arquivos escritos para Jest
(`jest is not defined`) além de tentar criar `/root/.cache/mongodb-binaries`. Essa dívida
de runner está registrada na COR-5001. O aceite real do relatório e da transação deve
ser feito contra um replica set de staging.

## Rollback controlado

Definir `GOOGLE_LOGIN_ENABLED=false` interrompe apenas o login Google; login por senha
continua disponível. Não remover `firebaseUid`, reverter e-mails para caixa antiga nem
restaurar associação automática por e-mail. Se houver incidente, revogar as sessões das
contas afetadas, manter os dados normalizados e investigar usando o snapshot e os IDs do
relatório. A janela legada deve permanecer desligada durante o incidente.
