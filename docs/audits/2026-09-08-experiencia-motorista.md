# MoveCity — auditoria da experiência do motorista

Data: 08/09/2026. Base: `0b1e41566e3fd646a32a8331cf66a3fc299f7057`, motorista 1.1.45 (47).

## 1. Conclusão executiva e limites

O MoveCity tem uma base técnica aproveitável, mas a experiência operacional ainda não funciona como um fluxo único. Telas, contextos, chamadas HTTP e pendências locais podem apresentar verdades diferentes ao motorista. O maior retorno está em corrigir essa coordenação e tornar cada próximo passo evidente; trocar cores e desenhar novos cards não resolve isso.

A recomendação é evolução incremental, não reescrita. Preservar a stack, a operação presencial, as encomendas, os agendamentos, as tarifas, as comissões e os dados já registrados.

Esta é uma auditoria de código, arquitetura e heurísticas de UX, contextualizada pelos relatos e imagens anteriores. Os achados diferenciam comportamento demonstrável no código de risco que precisa de reprodução visual. Não foi feita uma corrida real, acesso à conta do motorista afetado, inspeção da fila daquele celular, medição de GPS em campo ou certificação integral de acessibilidade. As imagens antigas não comprovam que todos os problemas continuam na versão atual.

Verificação executada nesta auditoria: `npx vitest run` — 50 arquivos e 315 testes aprovados. O E2E disponível em `frontend/e2e/rideFlow.spec.js` verifica apenas a abertura dos logins; não valida a jornada completa com backend, socket e Android. Portanto, testes verdes não equivalem a operação homologada.

Não foram alterados arquivos da aplicação nem regras de negócio nesta etapa. Este documento é a entrega de diagnóstico e plano anterior à implementação.

### Referências de produto, sem copiar concorrentes

A documentação da Uber organiza a experiência por preparação, realização de viagens, ganhos e suporte. Isso serve como referência de organização da jornada, não como comprovação de um layout atual ou de tecnologia offline específica. [Uber — noções básicas](https://www.uber.com/br/pt-br/drive/basics/).

A 99 destaca a clareza do ganho antes do aceite e o detalhamento posterior. O princípio aplicável é identificar claramente o que cada valor representa; não transportar para o MoveCity a promessa de preço fixo ou a política comercial da concorrente. [99 — clareza nos ganhos](https://motoristas.99app.com/clareza-nos-ganhos/).

A separação entre ajuda durante a viagem, pagamentos, conta e segurança também aparece na organização pública de suporte da 99. Não significa copiar seus textos, canais ou garantias de atendimento. [99 — ajuda ao motorista](https://99app.com/ajuda/motorista/).

## 2. Arquitetura atual

| Camada | Implementação | Avaliação |
|---|---|---|
| Aplicativo | React 18, Vite, Tailwind, React Router, TanStack Query, Capacitor/Android | Manter; não há justificativa para migrar de framework |
| Sessão e conta | CaptainContext, SessionGuard, sessão web/nativa, restauração antes dos guards | Há proteções úteis; não atribuir os relatos de logout a uma única causa sem logs |
| Operação | CaptainHome, RidePopUp, ConfirmRidePopUp, CaptainRiding, FinishRide | Responsabilidade dividida entre páginas e vários booleanos locais |
| Fonte de corrida | RideContext + snapshots de navegação + recuperação local + HTTP/socket | Boa intenção de centralização, mas componentes continuam decidindo transições por conta própria |
| Offline | Dexie, offlineQueue, driverRecoveryStore, checkpoints e fila GPS | Base valiosa; contratos de persistência/feedback ainda diferem entre ações |
| Medição | CaptainLocationBridge, LocationContext, useRideMeter, cálculo local e backend | Preservar GPS e preço local; distinguir medição disponível de confirmação financeira |
| Mapa | LiveTracking, providers Google/Leaflet, câmera de navegação e cálculo de rota | Reaproveitar; separar câmera/rota da decisão de estado e do layout do painel |
| Áreas secundárias | Ganhos, carteira, histórico, perfil, documentos e agendados sobre a Home persistente | Evita remontar mapa, mas cria sobreposição de cabeçalhos e ofertas |
| Backend | Estados e regras reais em ride.model/ride.service; aceite atômico e finalização idempotente | Continuar como autoridade de atribuição, transição e liquidação |

Fontes: [rotas](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/routes.jsx:25>), [providers](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/bootstrap/DriverAppProviders.jsx:15>), [RideContext](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/contexts/RideContext.jsx:38>), [modelo de corrida](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/Backend/models/ride.model.js:88>).

### O que já funciona e deve ser preservado

- Oferta tem origem, destino, preço, dados de percurso e contador ancorado no prazo do servidor.
- O aceite do backend é atômico; a UI deve respeitar essa confirmação.
- Há recuperação de viagem iniciada e distinção entre resposta desconhecida e ausência confirmada de corrida.
- Taxímetro local e checkpoints permitem continuidade sem internet quando os dados necessários existem.
- A finalização mantém o instante do toque e aguarda confirmação real antes de retirar a ação da fila.
- A versão 1.1.45 já bloqueia a finalização de tela sem identificação e preserva registros locais inválidos.
- Existem estados de aprovação, documentos, loading, skeletons, erro e tentativa novamente.
- Ganhos já possuem recortes Hoje/Semana/Mês; não é necessário reconstruir isso do zero.
- Button, Card, StatusBadge, PageHeader, EmptyState e PassengerIdentityCard já formam um núcleo reutilizável.

## 3. Achados classificados

**CRÍTICO:** pode induzir uma ação operacional/financeira errada, esconder trabalho ou impedir recuperação. **IMPORTANTE:** compromete compreensão, eficiência, acesso ou consistência. **MELHORIA:** refinamento posterior aos riscos operacionais. “Confirmado” significa caminho explícito no código, não reprodução no celular do relato.

### Críticos

#### C01 — Aceite apresentado antes de ser confirmado

**Confirmado no código.** RidePopUp abre o painel seguinte antes de aguardar `confirmRide`. CaptainHome também cria um estado `accepted` otimista quando detecta falta de rede. Uma oferta pode já ter sido atribuída a outra pessoa; guardar uma intenção local não reserva a corrida.

**Efeito:** motorista pode interpretar que deve buscar o passageiro e encontrar controles do próximo passo antes da atribuição efetiva.

**Correção proposta:** estado explícito “Confirmando aceite”, uma única ação bloqueada durante a tentativa e nenhuma instrução de deslocamento até o ACK. Se a resposta se perder, consultar a atribuição pelo mesmo ID antes de declarar sucesso ou permitir novo aceite. Oferta expirada/recusada deixa de ser acionável conforme regra real.

Evidências: [abertura antecipada](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/RidePopUp.jsx:138>), [aceite e fallback](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainHome.jsx:621>).

#### C02 — Início/chegada offline avançam sem garantir gravação

**Confirmado no código; perda efetiva exige falha de armazenamento.** ConfirmRidePopUp chama `enqueueOfflineAction(...).catch(console.error)` e imediatamente avança o estado. Se a gravação falhar, a interface já anunciou uma ação que não está persistida. Além disso, seus catches não reconhecem `isConnectivityIssue`, usado pelo timeout rígido; rede aparentemente online pode produzir erro genérico em vez do fallback esperado.

**Correção proposta:** aguardar persistência durável antes de avançar, exibir “Salvando no aparelho” e diferenciar erro de armazenamento, rede, sessão e regra de negócio. Para início, exigir que a corrida já pertença ao motorista. Não transformar aceite competitivo em aceite offline garantido.

Evidências: [chegada e início](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/ConfirmRidePopUp.jsx:95>), [contrato de timeout](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/utils/hardTimeout.js:17>).

#### C03 — Forma de pagamento e confirmação financeira podem induzir cobrança errada

**Confirmado nos caminhos de apresentação.** RidePopUp trata `carteira` como “Dinheiro”. Em FinishRide, a tela de finalização offline descreve pagamento em dinheiro/Pix antes do ramo específico de carteira. Na conclusão online, “Pagamento confirmado” também é utilizado quando o backend liquidou contabilmente uma corrida paga em mãos; isso não comprova que o dinheiro ou Pix chegou ao motorista.

**Correção proposta:** um apresentador compartilhado de pagamento, separando valor do passageiro, ganho líquido, comissão e liquidação. Para carteira, não orientar cobrança externa. Para dinheiro/Pix, não confundir liquidação da plataforma com comprovação bancária ou entrega de numerário. Estados financeiros precisam refletir o contrato existente, sem mudar a regra de comissão.

Evidências: [rótulo da oferta](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/RidePopUp.jsx:59>), [finalização e recibo](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/FinishRide.jsx:574>), [liquidação atual](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/Backend/services/ride.service.js:2030>).

#### C04 — Pendência preservada, mas sem caminho operacional de resolução

**Confirmado como lacuna de UX.** O histórico explica que a finalização não foi aceita e pede suporte, porém não oferece detalhe acionável com identificação, tentativas e contato contextual. Registros inválidos são preservados corretamente, mas o motorista não consegue encaminhar o contexto pelo próprio aviso.

**Correção proposta:** detalhe da pendência com estado, horário do toque, código seguro de referência, última resposta e ação de suporte. “Tentar sincronizar” apenas quando seguro e com o pedido original. Encerramento já confirmado deve reconciliar somente o mesmo ID/conta. Sem ID, não associar por horário, preço ou endereço e não apagar silenciosamente.

Evidência: [pendências do histórico](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainRidesHistory.jsx:200>).

#### C05 — Oferta pode ficar atrás de uma tela secundária

**Risco de sobreposição diretamente identificado no JSX/CSS; requer validação visual integrada.** A Home permanece montada em Ganhos/Perfil/Histórico. Seus BottomSheets usam `z-modal`, e o Outlet é renderizado depois, também em `z-modal`, dentro de uma cobertura de tela inteira. Nesse arranjo a oferta pode existir na Home, mas ficar encoberta pela página filha. O aviso nativo não torna o painel web visível.

**Correção proposta:** camada operacional de ofertas única acima das páginas secundárias, coordenada com o estado ocupado e com o prazo. Não duplicar popups nem ativar uma oferta expirada ao voltar à Home.

Evidências: [painéis da Home](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainHome.jsx:871>), [Outlet sobreposto](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainHome.jsx:918>), [camadas do BottomSheet](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/components/ui/BottomSheet.jsx:9>).

#### C06 — Sem ação clara de segurança/viagem interrompida durante a corrida

**Lacuna de produto confirmada nas telas inspecionadas.** Há chat e há cancelamento presencial inicial, mas não um acesso contextual de segurança/ajuda na viagem iniciada. O motivo “Situação de segurança” existe no cancelamento pré-embarque; não resolve uma viagem interrompida depois.

**Correção proposta:** acesso persistente e discreto a ajuda/segurança, com distinção entre emergência e suporte comercial. Não prometer atendimento 24 horas, não reutilizar telefones de concorrentes e não tornar cancelamento após início livre: destino, responsabilidade de atendimento e tratamento financeiro exigem definição operacional.

Evidências: [ações em viagem](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainRiding.jsx:442>), [limite atual de cancelamento](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/Backend/services/ride.service.js:2465>).

### Importantes

#### I01 — “Atualizar app” tem contrato errado no build motorista

**Confirmado.** CaptainHeader espera booleano de `checkForUpdate`. Sem PwaUpdateProvider, o fallback retorna um objeto `{ updated: false, reason: 'disabled' }`, que é verdadeiro no `if`. Assim, pode anunciar atualização e recarregar a página sem atualizar o AAB. O perfil possui outro fluxo de atualização.

**Proposta:** centralizar no serviço de atualização existente, respeitar Play/PWA/distribuição externa e não interromper trabalho ativo para uma atualização opcional. [Menu](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/CaptainHeader.jsx:30>), [fallback](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/contexts/PwaUpdateContext.jsx:122>).

#### I02 — Home ainda é um painel administrativo

**Confirmado na composição.** Divisão fixa de mapa em 40vh e conteúdo em 60vh, status, permissões, GO pulsante, escolha de modos, agendados, ganhos e quatro atalhos. “Ficar online” disputa atenção com “GO / Iniciar uma corrida”, que faz outra coisa.

**Proposta:** mapa como base, estado operacional compacto e uma ação principal. Corrida presencial continua disponível com esse nome explícito, sem parecer o botão para ficar online. Ganhos do dia em resumo recolhível; restantes fora da primeira dobra. [Home](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainHome.jsx:715>), [painel](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/CaptainDetails.jsx:197>).

#### I03 — Disponibilidade, conexão e GPS comunicam verdades diferentes

**Confirmado na lógica.** CaptainDetails deriva “Disponível” de `isOnline`, créditos e locationError; ConnectionBanner observa internet/socket separadamente. O taxímetro também usa modo local quando a confirmação está atrasada, não apenas sem internet. “Bem-vindo online” no login não significa que o motorista ficou disponível para despacho.

**Proposta:** um estado derivado: desconectado voluntariamente, conectando, disponível, ocupado, indisponível por conta/créditos/GPS e reconectando. Rede, GPS e sessão são eixos independentes, não sinônimos de logout. [Disponibilidade](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/CaptainDetails.jsx:163>), [banner](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/components/ui/ConnectionBanner.jsx:10>), [taxímetro](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/hooks/useRideMeter.js:30>).

#### I04 — Oferta não distingue bem percurso, deslocamento e ganho

**Confirmado.** A distância até o embarque usa linha reta, enquanto o tempo apresentado é da viagem. Endereços são cortados na primeira vírgula e truncados; o preço aparece duas vezes sem identificação de ganho líquido.

**Proposta:** blocos separados “Até o embarque” e “Viagem”, rótulo de aproximação quando não houver rota, bairro/referência suficiente e valor identificado como estimativa. Não chamar fare bruto de ganho líquido sem dado do servidor. [Oferta](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/RidePopUp.jsx:22>).

#### I05 — Embarque muda o botão, mas quase não muda a explicação

**Confirmado.** O título permanece “Iniciar corrida” em accepted/going_to_pickup/arrived. O painel destaca distância estimada da viagem, não o deslocamento até o passageiro. Não oferece chat/contato contextual nessa etapa; o chat operacional aparece depois de iniciar. Não há orientação clara de espera/no-show no painel.

**Proposta:** títulos específicos “Corrida aceita”, “Indo buscar passageiro”, “Você chegou”; navegação e ETA do embarque; contato antes da viagem; espera com informação que o backend realmente suportar; ajuda e cancelamento com consequência explícita. Não criar taxa de espera ou timeout de no-show por conta própria. [Painel de embarque](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/ConfirmRidePopUp.jsx:175>).

#### I06 — Viagem iniciada ainda exige atenção demais

**Confirmado na hierarquia; validar dimensões em dispositivo.** O valor em `text-4xl`, identidade, endereço e informações adicionais concorrem com navegação. A região `aria-live` envolve valor atualizado frequentemente. O limite de altura do painel recolhido não vem acompanhado de rolagem como o expandido. Não há mensagem de qualidade/idade do GPS tão clara quanto a informação de conexão.

**Proposta:** navegação como prioridade durante deslocamento, valor compacto mas sempre acessível — especialmente na presencial, em que o taxímetro é essencial. Qualidade de GPS com ação quando necessário; leitor de tela anuncia mudança de estado, não cada centavo. [Painel ativo](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainRiding.jsx:512>).

#### I07 — Pós-corrida curto demais e centrado no valor do passageiro

**Confirmado.** O resultado pode trocar para avaliação após 1,2 s ou voltar à Home após 1,5 s. O valor principal é `passengerAmount`, não o ganho líquido. Não há resumo estável de ganho da corrida e dia antes de seguir.

**Proposta:** recibo persistente com “Cliente paga” e “Seu ganho” separados; detalhes de comissão acessíveis; botão claro para continuar disponível. Avaliação opcional e sem tirar o recibo automaticamente. [Transição automática](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/FinishRide.jsx:102>), [resultado](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/FinishRide.jsx:635>).

#### I08 — Ganhos prioriza acumulado e pode mostrar zero quando houve erro

**Confirmado.** O acumulado e avaliação ficam antes do ganho do período. Sem dados, cartões usam formatação que resulta em R$ 0,00; o erro aparece abaixo, e a consulta de acumulado não tem tratamento visual próprio de erro.

**Proposta:** Hoje/Semana no topo; indisponível não é zero. Manter último dado válido com horário, erro local e tentativa novamente. Retirar avaliação/desempenho da prioridade financeira. Detalhe por corrida deve explicar bruto, comissão e líquido com dados reais. [Ganhos](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainEarnings.jsx:42>).

#### I09 — Navegação e cabeçalhos duplicados

**Confirmado na estrutura.** Menu contém sete destinos, atualização e saída; Home repete atalhos. Há dois caminhos para Carteira. A Home persistente e páginas filhas montam CaptainHeader, e os cabeçalhos variam entre preto, branco e diferentes espaçamentos. Agendados não segue o mesmo offset das páginas com `pt-24`.

**Proposta:** um shell de conta e uma navegação principal única fora da corrida, preservando links antigos como aliases. Créditos dentro de Ganhos; agendados e encomendas dentro de Viagens. Oferta global acima do shell. [Menu](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/CaptainHeader.jsx:13>), [rotas](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/routes.jsx:64>).

#### I10 — Contraste insuficiente em componentes centrais

**Medido a partir das cores do código.** Branco sobre brand-500 (#22c55e): **2,28:1**; branco sobre brand-600 (#16a34a): **3,30:1**; ink-400 (#9ca3af) sobre branco: **2,54:1**. Botões e textos auxiliares usam essas combinações. Comentário no Tailwind que considera o verde claro adequado a botão branco não substitui medição.

**Proposta:** verde de ação mais escuro ou texto escuro sobre verde claro; tokens separados para marca, ação e texto. Para texto normal, referência AA de 4,5:1; texto grande, 3:1. #15803d com branco chega a 5,02:1, sendo uma opção técnica, não uma imposição de identidade. [Tokens](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/tailwind.config.js:13>), [Button](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/components/ui/Button.jsx:3>), [W3C — contraste](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

#### I11 — Painéis, alertas e Voltar não têm um contrato único

**Confirmado no código; efeitos visuais dependem do viewport.** BottomSheet não limita a altura nem implementa foco de diálogo/retorno de foco. Recebe `expandable` na Home, mas não utiliza essa propriedade. Toasts não têm região de anúncio e ficam em top-4; ConnectionBanner fica em top-0/z40, abaixo do cabeçalho z60. Voltar do Android navega para a Home em vez de priorizar o fechamento do painel operacional.

**Proposta:** uma camada modal por vez, altura disponível com rolagem interna e ação fixa; foco e fechamento coerentes; safe areas superiores/inferiores; avisos persistentes acionáveis para problemas críticos. Voltar fecha painel antes de abandonar o contexto. Não transformar todo painel persistente em diálogo modal. [BottomSheet](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/components/ui/BottomSheet.jsx:9>), [toasts](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/contexts/ToastContext.jsx:76>), [Voltar](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/components/DriverBackButton.jsx:15>).

#### I12 — Suporte, recuperação de acesso e documentos precisam de próximos passos

**Confirmado como lacuna.** Login não oferece recuperar senha nem mostrar/ocultar senha. ApprovalGate recomenda suporte, mas oferece apenas atualização e perfil. Ajuda da Home depende de variável de WhatsApp e pode apenas abrir perfil; a página pública tem canais fixos. `/support/tickets` usa autenticação de passageiro, não deve ser ligado ao motorista sem adaptar a autorização. O prazo “48 horas úteis” da análise é texto fixo, não um SLA demonstrado pela implementação.

**Proposta:** suporte único por categoria e contexto, acesso sem login, recuperação segura de conta e documentos com motivo de rejeição/ação. Reutilizar infraestrutura de tickets somente após autorizar captain e isolar dados por conta. Validar prazos com a operação. [Login](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainLogin.jsx:84>), [aprovação](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/components/ApprovalGate.jsx:20>), [tickets](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/Backend/routes/support.routes.js:10>).

#### I13 — Encomendas não têm a mesma resiliência das corridas

**Confirmado nos handlers.** Avanço de status, confirmação de PIN e pagamento usam parcelApi, sem a fila durável de finalização de corridas. Seus erros são apresentados por toast. Isso não comprova que todo pedido trava, mas impede prometer o mesmo comportamento offline.

**Proposta:** preservar etapas de coleta/entrega e PIN, adotar erros e tempos limite consistentes. Definir quais ações podem ser persistidas offline; PIN/entrega não devem ser declarados validados pelo servidor sem confirmação. [Operação de encomenda](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/driver/pages/CaptainParcelRiding.jsx:155>), [API](<C:/Users/Pichau/Desktop/projetos/UberDemo-master/frontend/src/shared/services/parcelApi.js:53>).

### Melhorias

- **M01 — Linguagem:** padronizar “Corridas/Viagens/Histórico”, “Concluir/Finalizar”, “Carteira/Créditos”. Substituir “Iniciar sem despacho” por linguagem de motorista. Não chamar indisponibilidade de rede de “offline” sem distinguir a disponibilidade voluntária.
- **M02 — Densidade:** reduzir sombras, cards aninhados e tipos de raio; conservar contraste e espaçamento. Texto operacional de 10–12 px deve subir de importância ou desaparecer quando secundário.
- **M03 — Descoberta:** orientação curta e dispensável para primeiro uso, explicando ficar online, presencial e créditos. Não exibir tutorial no meio de uma viagem.
- **M04 — Movimento e desempenho:** respeitar redução de movimento; retirar pulsação permanente do GO. Medir bateria, uso do mapa persistente e rede em aparelho, sem afirmar melhoria de desempenho antes de medir.

## 4. Arquitetura de experiência proposta

### Navegação fora da viagem

**Início · Ganhos · Viagens · Perfil** é adequado aqui, desde que seja um shell único e fique fora do modo de condução.

- **Início:** disponibilidade, mapa, pedido recebido e atalho explicitamente chamado “Corrida presencial”.
- **Ganhos:** Hoje/Semana/Mês e detalhe por viagem; seção separada “Créditos MoveCity” para a carteira operacional atual.
- **Viagens:** corrida atual, pendências e histórico; alternância Corridas/Encomendas e acesso aos Agendados. A lista de agendados atual é informativa de próximas 24 horas, não uma reserva aceita: preservar essa regra.
- **Perfil:** identificação, avaliação, veículo, documentos, status da conta, configurações, atualização e suporte. Saída/exclusão ficam aqui, longe das ações de condução.

Durante viagem: mapa + painel de etapa + ação principal + ajuda/segurança. Sem barra financeira ou menu completo sobre a navegação. O retorno à Home não cancela nem encerra o trabalho.

### Organização técnica

Manter RideContext como integração e acrescentar seletores puros de estado operacional, sem biblioteca nova obrigatória. Separar: disponibilidade; etapa de serviço; comando em processamento; confirmação/sincronização; sessão; qualidade da rede/GPS; pagamento.

As telas passam a apresentar esse estado, não a inventar transições por meio de booleanos independentes. Um controlador operacional coordena a oferta, a etapa atual, a modal e o destino de recuperação. O backend continua decidindo atribuição e transições de negócio.

Invariantes a testar:

1. Nenhuma ação operacional sem ID, proprietário e etapa compatíveis.
2. Nunca mostrar aceite competitivo como confirmado sem atribuição do servidor.
3. Nunca avançar uma ação offline executada antes de confirmar sua gravação local.
4. Um evento duplicado não duplica efeito, cobrança, painel ou viagem.
5. Finalização pendente não reabre como viagem iniciada e não é sucesso financeiro.
6. Pedido salvo conserva o instante original; reconexão não acrescenta tempo ao término.
7. Falha de rede não confirma ausência de viagem nem invalida sessão por si só.
8. Uma única ação principal operacional e uma única modal crítica por vez.

## 5. Matriz explícita de estados e recuperação

Estados abaixo são de **apresentação**. Não adicionar todos ao enum persistido do backend.

| Estado | UI específica | Ação principal | Secundárias e recuperação |
|---|---|---|---|
| INICIALIZANDO/RECUPERANDO | Etapa de recuperação, sem dados inventados | Aguardar por prazo limitado | Tentar novamente; suporte se indisponível |
| CADASTRO_PENDENTE/BLOQUEADO | Motivo real e o que falta | Resolver documento/crédito conforme causa | Perfil, suporte; não oferecer ficar disponível |
| OFFLINE voluntário | “Você está offline”, mapa discreto | Ficar online | Ganhos, Viagens, Perfil; presencial identificado |
| CONECTANDO | “Verificando disponibilidade” | Aguardar ACK | Repetir após falha, sem ativação falsa |
| ONLINE/BUSCANDO_CORRIDA | “Disponível — aguardando solicitações” | Ficar offline | Presencial e resumo de hoje recolhido |
| SOLICITAÇÃO_RECEBIDA | Embarque, destino permitido, percurso, estimativa, pagamento, prazo | Aceitar | Recusar; expiração observada do servidor |
| CONFIRMANDO_ACEITE | Mesma oferta com processamento, sem controles de embarque | Aguardar atribuição | Reconciliar mesmo ID após timeout |
| CORRIDA_ACEITA | Confirmação, passageiro e embarque | Ir buscar passageiro | Navegar, contato, ajuda/cancelamento permitido |
| A_CAMINHO_DO_PASSAGEIRO | Rota/ETA do embarque | Cheguei ao local | Contato, ajuda; restaurar ao reabrir |
| CHEGUEI/ESPERANDO | “Você chegou”, passageiro e orientação de embarque | Iniciar viagem | Contato; passageiro ausente com consequência real |
| INICIO_SALVO_LOCALMENTE | “Início salvo; aguardando sincronização” | Continuar operação validada localmente | Persistir antes de navegar; bloquear se armazenamento falhar |
| VIAGEM_INICIADA | Navegação, destino, tempo/medição necessária | Finalizar no destino | Ajuda/segurança, detalhes, recenter; sem menu administrativo |
| PRESENCIAL_SEM_DESTINO | Tempo, distância, valor calculado e identificação presencial | Finalizar no destino real | Qualidade GPS e ajuda; não inventar destino nem deslocamento |
| PREVIA_DE_FINALIZACAO | Valor, método, origem do cálculo e consequência | Confirmar finalização | Voltar; validar antes de anunciar término |
| FINALIZANDO | “Enviando finalização”, botão protegido | Aguardar por prazo limitado | Persistir com segurança se conexão falhar |
| FINALIZACAO_PENDENTE | Toque salvo, dados e valor não confirmados | Ver acompanhamento | Sincronizar com pedido original; não cobrar em método diferente |
| FINALIZACAO_RECUSADA | Motivo compreensível e referência | Resolver pendência | Retry quando cabível; suporte contextual; preservar evidências |
| REGISTRO_LOCAL_INVALIDO | Diagnóstico separado de uma corrida real | Abrir suporte | Não enviar sem ID nem associar por aproximação |
| VIAGEM_FINALIZADA | Recibo, valor do passageiro, ganho e taxas | Continuar disponível conforme status real | Avaliar, detalhe, ajuda; sem sumiço automático do recibo |
| PAGAMENTO_PENDENTE | Método e instrução específica | Ação realmente disponível para esse método | Suporte; não converter carteira em cobrança em mãos |
| CANCELADA/OFERTA_ENCERRADA | Quem encerrou, motivo e consequência | Voltar à disponibilidade confirmada | Histórico/ajuda; não mostrar próxima etapa da viagem |
| SEM_CONEXAO | Faixa persistente com impacto específico | Continuar corrida já recuperada quando seguro | Sincronização automática; não ofertar atribuição não confirmada |
| GPS_IMPRECISO/INDISPONIVEL | Qualidade, idade do último ponto e limitação | Recuperar localização quando parado | Manter dados; não fabricar distância nem garantir preço final |
| SERVIDOR_INDISPONIVEL | “Não foi possível confirmar com o servidor” | Nova tentativa controlada | Preservar sessão/viagem; diferenciar de senha inválida |
| ERRO_DE_ESTADO | Recuperação sem controles vazios | Recuperar viagem | Pendências e suporte; nunca finalizar objeto vazio |

ONLINE/BUSCANDO compartilham a mesma vista enquanto não há oferta; não precisam de duas páginas. Os estados de rede/GPS se sobrepõem à etapa da corrida, sem substituí-la.

Encomendas preservam seus estados próprios: `provider_accepted`, `going_to_pickup`, `arrived_pickup`, `collected`, `in_transit`, `arrived_destination`, entrega com PIN e conclusão/pagamento. Usam o mesmo shell, não a mesma transição de negócio da corrida.

## 6. Cancelamento, interrupção e erro: contratos de UX

| Situação | O motorista deve entender | Próxima ação |
|---|---|---|
| Motorista desiste antes do embarque | Motivo exigido quando aplicável; viagem pode voltar ao despacho | Confirmar somente após explicação; voltar disponível após ACK |
| Passageiro cancela | Corrida encerrada por ele, sem culpa presumida do motorista | Fechar controles antigos; mostrar evento e retorno |
| Oferta expira/outro motorista aceita | Esta oferta não pertence ao motorista | Remover ações; procurar novas ofertas |
| Passageiro não localizado | Contato, tempo de espera disponível e regra de cancelamento | Contatar ou cancelar conforme regra; não inventar penalidade |
| Presencial iniciada por engano | Janela atual de cancelamento é limitada | Cancelar apenas se permitido; fora dela, suporte/interrupção apropriada |
| Problema de pagamento | Qual método, quem ainda deve agir e qual valor está confirmado | Cobrança correta ou suporte; sem dupla cobrança |
| Perda de internet | Serviço ativo não desapareceu; confirmação está pendente | Continuar coleta local se válida; sincronizar depois |
| Corrida interrompida/segurança | O que é emergência e o que é suporte operacional | Acesso rápido ao canal validado; resolução auditável do serviço |

Preservar a trava atual de distância insuficiente e a janela de 60 segundos da presencial até uma decisão explícita de produto. Não liberar finalização parada apenas para eliminar um erro visual. Teste parado deve ter orientação clara de teste/engano, sem virar cobrança de corrida legítima.

## 7. Especificação das áreas secundárias

**Ganhos:** Hoje em destaque; Semana/Mês em controle segmentado; quantidade de viagens do mesmo período; lista enxuta; toque abre recibo. Separar bruto, comissão, líquido e créditos. Sem dados, mostrar indisponibilidade ou último valor com horário, não zero. Encomendas entram somente se o endpoint e o recorte financeiro forem compatíveis.

**Viagens:** primeiro trabalho ativo e pendências, depois histórico. Linha compacta: data/hora, tipo, origem/destino, valor identificado e status. Detalhe com ID, pagamento, taxas, motivo de cancelamento e ajuda. Filtros iniciais mínimos: período/tipo/status quando houver volume. Manter paginação; não transformar toda informação em um card grande.

**Perfil/documentos:** identidade e veículo; situação da conta com causa; documentação com prazo real, rejeição por documento e ação de reenviar; configurações separadas. Mostrar versão/canal do aplicativo para diagnóstico. Não tratar bloqueio de crédito como documento reprovado.

**Suporte:** categorias Corrida, Pagamento, Veículo, Conta, Segurança, Aplicativo e Outros. Oferecer contexto da viagem e referência técnica sem senha/token ou trilha GPS inteira. Registros sensíveis só devem ser compartilhados com transparência e necessidade. Até existir suporte interno autenticado para captain, usar canais oficiais validados sem prometer ticket/atendimento que não existe.

## 8. Design system e mapa

### Reutilização e evolução

| Existente | Destino proposto |
|---|---|
| Button | Base única com contraste, foco visível, loading/aria-busy e tamanhos operacionais |
| BottomSheet | Separar painel persistente de modal; altura/rolagem, foco, Voltar e camadas coerentes |
| PassengerIdentityCard | Identidade compacta, dados adequados ao pré/pós-aceite |
| StatusBadge + ConnectionBanner | Estado de operação e aviso de integridade com semântica consistente |
| PageHeader + CaptainHeader | Shell único; não remontar cabeçalho por cima de outro |
| Card/DetailRow/RouteCard | Linhas de informação reutilizáveis; reduzir contêineres decorativos |
| EmptyState/SessionSplash/Skeleton | Loading, vazio, recuperação e erro realmente diferentes |
| LiveTracking + providers | Preservar mapa e navegação; centralizar áreas ocupadas pelos painéis |
| useRideMeter/checkpoints/offlineQueue | Manter cálculo/persistência e acrescentar contratos e testes, não reescrever |

Novos componentes justificados: `DriverOperationalShell`, `RideStagePanel`, `PaymentSummary`, `PendingFinalizationDetails` e `ContextualHelp`. Nomes são propostas, não arquivos já criados. Um componente por responsabilidade, não por cor ou variação mínima de texto.

Padrões recomendados:

- Cor de marca preservada; tokens distintos para ação, texto, sucesso, alerta e bloqueio.
- Corpo operacional 16 px como base de projeto; auxiliar normalmente 14 px; valores/ETA 24–32 px conforme contexto. Não usar texto minúsculo para informação decisiva.
- Escala de espaço 4/8/12/16/24/32; raios restritos, por exemplo 12/16 e topo de painel 24.
- Sombra reservada a elevação real; listas com separadores simples.
- Ações operacionais com alvo de aproximadamente 48–56 px como meta de usabilidade mobile, sem afirmar que isso é o mínimo WCAG. A WCAG 2.2 AA estabelece 24×24 CSS px com exceções; tamanho e espaçamento devem ser testados. [W3C — alvo de toque](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Label persistente em input; erro junto ao campo; foco identificável; leitor de tela para estado/loading/erro; seleção indicada além de cor.
- Fonte ampliada até 200%, teclado, TalkBack, contraste e rotação sem perder ação principal. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- Redução de movimento e ausência de pulsação contínua sem finalidade operacional.

Mapa: usar altura disponível do aparelho, não divisão fixa 40/60. Painel muda pela etapa e reporta sua altura real à câmera. O ResizeObserver existente deve ser reavaliado: hoje seu efeito roda na montagem, quando a página ainda pode mostrar somente reidratação, sem o painel no DOM. Risco: altura ficar em zero e a câmera não compensar o painel; confirmar em integração.

Manobra no topo respeitando área segura; localização e controles não escondidos atrás do painel; recenter acessível. Diferenciar posição sem precisão, mapa/rota indisponível e internet perdida. GPS local não garante mapas completos, rota nova ou despacho offline. Não prometer navegação offline integral sem suporte/cache apropriado.

## 9. Plano de implementação, dependências e aceite

| Ordem | Entrega | Dependência | Critério de conclusão |
|---|---|---|---|
| 1 | Regressões de C01/C02/C03/C05 e seletor de estado | Diagnóstico atual | Cenários falham antes da correção e passam depois; zero atribuição falsa |
| 2 | Aceite/início durável e classificação de falhas | Etapa 1 | Timeout, armazenamento cheio, clique duplo e ACK perdido não avançam indevidamente |
| 3 | Pagamento, recibo e detalhe de pendência | Etapa 2 + contrato financeiro real | Carteira nunca vira dinheiro; erro não vira sucesso; pedido preservado e rastreável |
| 4 | Shell único e oferta global | Etapas 1–3 | Oferta visível em Ganhos/Perfil; só uma modal; navegação não perde serviço |
| 5 | Home offline/disponível e pré-embarque | Etapa 4 | Iniciante distingue ficar online de presencial; sabe o próximo passo sem abrir menu |
| 6 | Viagem, mapa, GPS, ajuda e finalização | Etapas 3–5 + definição de segurança | Ação principal acessível em tela pequena; GPS/rede não apagam serviço; recibo persistente |
| 7 | Ganhos, Viagens, Perfil, documentos e suporte | Shell e componentes consolidados | Dados reconciliáveis, erro distinto de zero, ajuda contextual e sem cabeçalhos duplicados |
| 8 | Encomendas/agendados, a11y e publicação piloto | Etapas anteriores | Jornadas preservadas; testes físicos aprovados; distribuição gradual com reversão segura |

Não adicionar dependência de gerenciamento de estado ou biblioteca de UI sem provar necessidade. Extrair primeiro funções puras e adaptar componentes existentes. Alterações em componentes compartilhados exigem regressões do passageiro, mesmo sem gerar um novo AAB dele automaticamente.

### Gate obrigatório por fluxo

1. Cenário feliz e os erros aplicáveis ao fluxo passam em teste automatizado.
2. Revisão de primeira utilização: onde estou, o que aconteceu e qual é o próximo passo estão explícitos.
3. Revisão em 360×640 e 390×844, fonte ampliada, teclado e TalkBack; 320 px como teste de estresse.
4. Simular rede lenta, timeout com navigator ainda online, GPS impreciso, app em segundo plano e reabertura.
5. Validar backend + app com dados de teste, sem usar passageiros reais como teste involuntário.
6. Só então publicar esse lote; não acumular um redesenho enorme sem validação intermediária.

### Roteiro mínimo de homologação física

- Aceite concorrente em dois dispositivos; uma atribuição vencedora e feedback correto no outro.
- Oferta em Home, Ganhos, Perfil e tela bloqueada; expiração consistente.
- Chegada e início com internet; depois início já atribuído com perda de sinal e falha de gravação simulada.
- Viagem presencial real com percurso conhecido; perda de dados móveis mantendo GPS ligado; reabertura do app; reconexão.
- Teste parado identificado como tal: zero distância não vira viagem cobrável por simples passagem de tempo.
- Finalização online, ACK perdido, tentativa repetida e app fechado após persistência: nenhuma duplicidade e mesmo instante de término.
- Métodos dinheiro, Pix, carteira suficiente/insuficiente e demais métodos realmente habilitados.
- Cancelamento antes do embarque, passageiro ausente, cancelamento recebido e interrupção após início.
- Atualização 1.1.45 → próxima versão sem desinstalar: sessão, ID da corrida e pendências sobrevivem.
- Encomenda com cada etapa, PIN válido/inválido e erro de conexão.

## 10. Decisões de produto antes de ampliar regras

Não impedem correções de bugs, mas precisam de validação antes de prometer novas capacidades:

- Qual é a regra oficial para interrupção após início, no-show, espera e eventual ajuste financeiro?
- Qual canal atende segurança e em qual horário? Existe equipe para isso?
- No MoveCity, qual estimativa pode ser apresentada como ganho líquido antes do aceite?
- Carteira/cartão continuam habilitados em todas as modalidades ou só em parte delas?
- Qual política trata divergência entre cálculo local e fechamento do servidor?
- O motorista permanece disponível após finalizar ou pode escolher parar após a viagem?

Nenhuma dessas respostas deve ser inventada pelo frontend. Não importar taxas, políticas ou mecanismos comerciais de Uber/99.

## 11. Medição e conclusão

Instrumentar, com minimização de dados: tentativa/ACK de aceite; início persistido; finalização solicitada, salva, confirmada ou recusada; duração de pendência; perda/recuperação de dados; rejeição por GPS e motivo de falha. Sem senhas, tokens ou localização completa nos logs de UX.

Metas iniciais de aceite, não resultados já alcançados: zero finalizações sem ID; zero duplicidade no cenário de retry; nenhuma oferta coberta em telas secundárias; nenhuma pendência descartada por erro transitório; nenhuma carteira apresentada como dinheiro; nenhuma falsa confirmação de atualização; motoristas de primeiro uso encontram a ação principal sem orientação verbal.

Recomendação final: começar pelo contrato operacional e financeiro, simplificar a jornada sobre essa base e só depois polir apresentação. O produto deve parecer confiável porque conserva o trabalho, explica o que confirmou e oferece recuperação — não porque usa mais cards ou animações.
