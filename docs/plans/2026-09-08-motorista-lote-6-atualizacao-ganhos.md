# Motorista — lote 6: atualização e ganhos

Implementado localmente em 08/09/2026, após o lote 5. Referência: I01 e I08 da auditoria `docs/audits/2026-09-08-experiencia-motorista.md`. Alterações locais dos lotes anteriores preservadas.

## Atualização do aplicativo

- Menu e Perfil usam a mesma entrada `requestAppUpdateCheck` / `AppUpdateGate`. O menu não consulta mais um Service Worker inexistente nem agenda `window.location.reload()`.
- O fallback de `usePwaUpdate` retorna `false` booleano, compatível com o contrato do provider. O objeto truthy anterior era interpretado como atualização encontrada.
- Android do canal Play: informa que a verificação é feita na loja e oferece um link explícito para `br.com.movecity.driver`. Não consulta o catálogo de APK externo, não baixa APK nem afirma que a versão mais recente está instalada.
- Android de distribuição externa: mantém serviço de versão, verificação de integridade, permissões e instalador existentes. Diferencia erro de consulta, versão atual, nova versão e ausência de publicação no canal. Uma exceção inesperada também produz retorno visível.
- Navegador do build motorista (sem PWA): explica que não há verificação automática e orienta reabrir o site depois do atendimento, sem recarregamento automático.
- Atendimento ativo/restaurado, encomenda, disponibilidade online ou recuperação inicial ainda não reconciliada adiam a atualização. Resposta que chega durante um atendimento não abre o diálogo sobre a viagem. Não altera o estado online do motorista.
- Travas de consulta e de instalação impedem operações concorrentes por cliques repetidos. Ao voltar da permissão de instalação, preserva o APK já baixado se a versão consultada continua igual.
- Diálogo usa o componente operacional com foco contido, Voltar/Escape, rolagem e fechamento bloqueado durante download. O menu devolve o foco para seu botão ao fechar a atualização.

## Ganhos

- Período selecionado vem primeiro: Hoje, 7 dias e 30 dias. Os dois últimos nomes correspondem às janelas móveis já calculadas pelo backend, não a semanas/meses de calendário.
- Acumulado fica recolhido e só é consultado quando expandido, com erro e botão de nova consulta independentes.
- Identificação da conta obrigatória antes de consultar; chave de cache inclui motorista e período. Usa AbortSignal para cancelar consultas anteriores. Não usa dados de outro período como placeholder.
- Erro, consulta pausada e valor ausente não são convertidos em zero. Zero só aparece quando informado como número válido pelo endpoint.
- Falha de atualização mantém o último valor válido, a lista e o horário da consulta, acompanhados de aviso. DTO incompleto ou linha malformada é rejeitado antes de substituir o cache. Nova consulta pode recuperar sem sair da tela.
- Mantém somente o líquido disponibilizado por `sanitizeEarningsBreakdown`. A política atual remove bruto/comissão do DTO; este lote não expande essa exposição, não inventa valores e não muda regras financeiras.
- Texto diferencia ganhos de saldo para saque, com atalho à carteira. Por corrida usa “Ganho líquido”, não “Você recebeu”, pois o DTO não confirma recebimento de dinheiro/Pix.
- Remove avaliação e desempenho da hierarquia de ganhos; preserva as informações de perfil nas respectivas telas. Endereços completos têm quebra de linha. Fonte ampliada usa tamanho legível também para “Indisponível”.

## Verificação

- Suite frontend: **62 arquivos / 558 testes aprovados** (40 testes líquidos a mais que o lote 5). Nova execução dos quatro arquivos diretamente afetados após ajustes finais: **66 testes aprovados**.
- Suite de navegador: **32 testes aprovados** — 26 anteriores e 6 novos de ganhos/atualização, em 320×568, 360×640 com fonte 24 e 844×390. Os 6 novos foram repetidos após ajustes visuais.
- Fixtures usam componentes reais com transporte isolado e dados sintéticos; requisições externas bloqueadas. Não houve consulta financeira, atualização ou atendimento em produção.
- Capturas inspecionadas; corrigida quebra ruim de “Indisponível” com fonte ampliada. Uma primeira execução encontrou recarregamento de desenvolvimento durante a inicialização da fixture; o teste agora aguarda a interface pronta antes de operar.
- Builds motorista e passageiro aprovados; motorista final `driver-B9nx7Wx3.js`, passageiro `passenger-_xQ_9yr3.js`.
- ESLint dos arquivos selecionados sem erros; permanece aviso de Fast Refresh pelo export de função no componente existente. Avisos legados de build/tamanho de bundle não foram tratados neste lote.
- Sem novas dependências. Nenhuma alteração no backend ou na versão Android.

## Limites e próximos passos

Sem commit, push, deploy, AAB ou envio à Play Store neste lote. Para publicar o conjunto acumulado, permanece a dependência do lote 2: backend antes de frontend/AAB.

Falta homologação no Android real: abrir a loja pelo AAB, atualização disponível por aparelho/faixa de lançamento, retorno da permissão/instalador de APK externo, manutenção de sessão após uma atualização efetiva e TalkBack. Testes de navegador não comprovam esses comportamentos nativos.

Cache de ganhos é o cache em memória do QueryClient, não um extrato persistido para uso após reiniciar o aplicativo. O recorte e a data das corridas continuam baseados no contrato atual do backend (`updatedAt`); uma mudança de regra contábil não foi inferida.

Próximo lote sugerido: recuperação de conta, documentos e suporte do motorista, sem conectar rotas de suporte exclusivas do passageiro nem inventar prazo de atendimento.
