# Motorista — lote 3: navegação única e ofertas globais

Data: 08/09/2026. Implementação local sobre os lotes 1 e 2, sem publicação.

## Escopo entregue

Correção de C05 e da parte estrutural de I09/I11 da auditoria: uma camada de atendimento acima das páginas de conta. Não é a conclusão de toda a auditoria.

- `DriverAccountShell` mantém um único CaptainHeader, a conexão e o retorno ao serviço ativo. Ganhos, Carteira, Corridas, Perfil e Encomendas deixam de montar outro cabeçalho. Agendados, documentos, notificações e exclusão usam a mesma área útil, sem offsets fixos duplicados.
- Mapa da Home continua montado entre as páginas. Conteúdo coberto fica sem interação/foco. Carregamento de uma página sob demanda tem Suspense local, sem esconder o atendimento inteiro.
- `DriverOperationalDialog` é um portal fora do shell: um painel operacional por vez, acima das páginas e do menu. Cabeçalho, limite de altura, rolagem interna, safe areas, foco inicial, contenção de Tab e retorno de foco.
- Ofertas de corrida e encomenda usam a mesma fila. Menu fecha quando a oferta aparece. Motorista bloqueado, indisponível ou com serviço ativo não recebe destaque concorrente.
- Voltar Android e Escape primeiro recolhem o atendimento/menu. Recolher não envia recusa, cancelamento ou finalização. Oferta recolhida pode ser reaberta enquanto seu destaque estiver válido; embarque recolhido mantém “Retomar embarque”. Corrida iniciada e encomenda têm atalhos de retorno.
- Aceite e gravação de etapa bloqueiam o recolhimento durante a operação. Confirmação de cancelamento do embarque fica dentro do mesmo painel, sem outra cobertura de tela inteira.
- Os botões de aceite de Corridas e Encomendas passam pelo coordenador da Home via contexto do Outlet. Não mantêm um segundo caminho HTTP independente. Trava em memória impede aceitar por outro botão enquanto a primeira requisição está em andamento; aceite de corrida incerto continua bloqueando outros serviços conforme o lote 1.
- Encomenda só navega depois de resposta com o mesmo ID e estado atribuído. Clique duplo e evento tardio de perda de oferta não podem abrir a encomenda como aceita indevidamente.
- Consultas de ofertas validam conta, sequência e eventos ocorridos durante a espera. Resposta atrasada anterior a troca de conta, ocupação ou retirada da oferta não pode ressuscitar aquele destaque.

## Prazo de destaque não é cancelamento

O contrato existente em `Backend/config/offerPolicy.js` define **45 segundos de destaque**. A solicitação pode continuar disponível por mais tempo na lista autorizada de pendentes do backend.

A fila elimina destaques vencidos, inclusive atrás da oferta atual e no retorno de segundo plano, sem renovar relógio. O card retornado por `pending` continua disponível para aceite confirmado no servidor. O fim do destaque não cancela a solicitação e não altera regras de despacho. Dados legados sem prazo continuam compatíveis; prazo presente e inválido não abre popup.

## Verificação realizada

- Seis regressões reproduzidas antes da correção: duplicação de cabeçalho, ausência da camada acessível em Ganhos/Perfil, alerta vencido, concorrência com encomenda e falta de retorno ao embarque.
- Suíte frontend completa: **58 arquivos / 448 testes aprovados**, incluindo os 415 existentes após o lote 2 e **33 novos**.
- Testes novos cobrem ofertas mistas, recusa explícita, cancelamento/tomada por outro motorista, consulta atrasada, troca de conta, perda de destaque em segundo plano, foco, Voltar e aceite pelos caminhos alternativos.
- **4 testes de navegador aprovados**: 360×640, 390×844, 320×568 e 360×640 com fonte raiz de 24 px. Componentes reais do shell/diálogo/oferta em fixture isolada, sem APIs, mapas, analytics ou socket de produção. Botão de aceite alcançável, sem cobertura nem overflow horizontal; anotação preservada e foco retornado ao fechar. Capturas de 320 px e fonte ampliada também inspecionadas visualmente.
- `npm run build:driver` e `npm run build:passenger`: aprovados. Build do passageiro é regressão dos componentes compartilhados; não foi gerado AAB dele.
- ESLint dos serviços, testes e configuração novos selecionados: aprovado. Lint completo dos componentes legados ainda tem dívida de prop-types/hooks; não é declarado limpo.
- `git diff --check`: aprovado. Nenhuma dependência nova.

Reprodução em `frontend`:

```text
npx vitest run
npm run test:e2e:driver-shell
npm run build:driver
npm run build:passenger
```

Testes de navegador usam configuração própria em `playwright.driver-shell.config.js` e servidor local isolado na porta 5181, inclusive em CI. Fixtures não entram nos bundles publicados; capturas ficam em `frontend/test-results/`.

## Limites e publicação

Não houve deploy, commit/push, AAB, submissão à Play Store, alteração de dados de produção ou mudança de tarifas/comissões neste lote. Modificações locais dos lotes anteriores foram preservadas.

Falta homologar no Android real: botão Voltar do aparelho, TalkBack, teclado, retorno de background, conexão instável e recebimento de oferta com páginas reais abertas. Os testes visuais são de componentes em navegador, não uma viagem em campo ou o fluxo de notificações nativas.

As rotas antigas e aliases da Carteira continuam funcionando. Reorganização completa do menu, simplificação da Home, contraste global, segurança durante a viagem e recuperação ampliada de encomendas ficam para as etapas seguintes.

Na publicação acumulada, permanece a exigência do lote 2: **backend antes do novo frontend/AAB**, para disponibilizar o resumo correto do valor a receber diretamente.

Próximo lote: Home offline/disponível e pré-embarque, com foco no próximo passo do motorista e na distinção entre ficar online e iniciar corrida presencial.
