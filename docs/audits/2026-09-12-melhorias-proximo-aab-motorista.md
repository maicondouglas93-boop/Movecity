# Melhorias do app motorista — 12/09/2026

Versão de origem: 1.1.48 (50). Versão deste lote: **1.1.49 (51)**. As propostas da revisão inicial foram implementadas após a solicitação do usuário, junto com a troca do telefone pelo nome na corrida presencial.

| Problema encontrado | Comportamento implementado |
| --- | --- |
| Login nativo recusado por falta de origem quando há cookies antigos | O cliente HTTP nativo envia a origem real do WebView. A proteção CSRF do servidor continua ativa. |
| Corrida presencial pedia telefone do passageiro | Campo de nome opcional, com até 100 caracteres; nome salvo e exibido na corrida, finalização e histórico do motorista. |
| Cache de carteira e extrato compartilhado entre contas | Consultas separadas pelo identificador do motorista, executadas apenas com sessão e identidade. A troca de conta mostra carregamento e não reutiliza dados da anterior. |
| Logout podia esperar indefinidamente pela rede ou ponte nativa | Limpeza local imediata e espera máxima de 5 segundos para concluir a saída. Respostas antigas de logout/push não renovam a sessão nem encerram um login posterior. |
| Cadastro ou foto sem resposta mantinham a tela aguardando | Cadastro limitado a 30 segundos e foto a 15 segundos. Conta confirmada permanece criada mesmo se a foto falhar; o perfil permite conferir ou reenviar. |
| Falha nas categorias deixava o formulário sem explicação | Estados de carregamento, falha e catálogo vazio, com nova tentativa preservando os dados preenchidos. |
| Recarga não reutilizava o contato disponível na central | Mesmo contato configurado ou padrão da central e link para outras opções de suporte. Janela com rolagem para telas pequenas e fontes ampliadas. |
| Rodapé mencionava reCAPTCHA sem integração correspondente | Links reais para privacidade e ajuda com o cadastro. |

O cadastro não repete automaticamente a criação quando o resultado é desconhecido: informa que a conta pode existir e oferece conferir o acesso. A saída local não implica confirmação de revogação remota quando a rede falha.

O nome informado na corrida presencial não procura nem vincula uma conta de passageiro. A API mantém suporte ao campo legado de telefone para versões antigas. O nome é incluído nos DTOs de corrida e histórico do motorista, sem ampliar os dados dos DTOs públicos ou de ofertas.

## Validação

- Frontend completo: `node node_modules/vitest/vitest.mjs run --maxWorkers=2` — **74 arquivos, 708 testes aprovados**.
- Carteira, após o ajuste visual final e reforço da regressão de troca de conta: **5 testes aprovados**, incluindo saldo e extrato pendentes da segunda conta.
- Backend: **21 testes Node** de contratos de DTO e CSRF/logout e **16 testes Jest** de corrida presencial aprovados.
- Navegação e layout: `node node_modules/@playwright/test/cli.js test --config playwright.driver-shell.config.js driverAccount.spec.js` — **18 testes aprovados**, em 320×568, 360×640 com fonte de 24 px e 844×390. Dados fictícios e requisições externas bloqueadas na fixture.
- ESLint das páginas de cadastro, carteira, logout e corrida presencial, dos serviços alterados e dos novos testes de regressão: aprovado. Isso não representa aprovação do lint global: existem pendências anteriores de validação de props nos componentes de corrida e histórico.
- `git diff --check`: aprovado.
- Configuração de push nativo: aprovada. Bundle web do motorista: 31 arquivos JavaScript verificados, apontando para `https://movecity.onrender.com`.

## Entrega e limites

A geração foi concluída com `node scripts/build-play-bundle.mjs driver`, Java 21, assinatura de release existente e variante `playRelease`. O resultado e a verificação do arquivo final estão nas [notas desta versão](2026-09-12-aab-motorista-1.1.49.md).

**O servidor precisa receber as alterações de `passengerName` antes da distribuição do aplicativo para persistir o nome da corrida presencial.** Não houve implantação do backend nem publicação na Play Store nesta tarefa.

Testes automatizados e capturas no Chromium não substituem instalação em aparelho. Não foram realizados corrida real, GPS em movimento ou homologação de notificações e permissões em diferentes fabricantes. As etapas de aparelho permanecem em `docs/qa-central-permissoes-2026-09-11.md` e `docs/qa-oferta-nativa-2026-09-11.md`.
