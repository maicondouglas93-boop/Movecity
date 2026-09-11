# Central de permissões — MoveCity Motorista

## Escopo

- Rota protegida `/captain/permissions`, acessível pelo menu e por atalho na Home.
- Não depende do token FCM, da conexão com o backend ou da dispensa dos avisos temporários.
- Abertura de configurações somente após toque. Nenhuma concessão automática, alteração de disponibilidade ou criação de corrida.
- Sobreposição em primeiro lugar; notificações, canal de ofertas, localização, bateria e opções do fabricante no mesmo lugar.
- Full-screen intent somente quando declarado pela distribuição. A versão Play continua sem essa permissão.
- Não Perturbe e otimização de bateria explicados como opcionais.
- Erros e estados desconhecidos não são apresentados como permissões concedidas. As opções OEM exigem conferência manual.

## Verificação automatizada

- Testes da página cobrem entrada permanente, consentimento, retorno do Android, negação, erros, atalhos, localização em duas etapas, dados desatualizados e navegação web.
- Testes do serviço verificam propagação de erros e lista restrita de atalhos.
- Regressão do menu, avisos existentes, disponibilidade e shell da Home.
- Compilação Java da variante Play e build do frontend motorista.

## Verificação necessária em aparelho físico

Não executada nesta alteração. Os testes automatizados não comprovam abertura da tela verde em cada fabricante.

1. Instalar o novo pacote mantendo os dados. Confirmar versão instalada; o AAB 1.1.47 anterior não contém esta central.
2. Abrir Menu → Permissões do aplicativo e também o atalho da Home, inclusive após dispensar os avisos e sem internet.
3. Sem sobreposição, tocar Autorizar aparecer sobre outros apps. Se o Android abrir uma lista, selecionar MoveCity Motorista. Negar/voltar deve continuar Não ativado; autorizar/voltar deve mostrar Ativado.
4. Revogar a autorização no Android e voltar: a central deve atualizar para Não ativado, sem logout nem mudar ONLINE.
5. Bloquear notificações globalmente e no canal Ofertas urgentes. Conferir os dois atalhos e estados separadamente, incluindo um Android anterior ao 13.
6. Confirmar que o volume e Não Perturbe podem silenciar alertas mesmo com o canal habilitado.
7. Localização: explicar uso antes do toque, solicitar foreground primeiro e background em etapa separada. No Android 11+, escolher Permissões → Localização → Permitir o tempo todo. Negar não pode marcar autorização concedida.
8. Xiaomi/Redmi/POCO: conferir os atalhos para Outras permissões e inicialização automática. Fallback deve explicar a necessidade de procurar manualmente. Não mostrar confirmação automática para permissões OEM.
9. Testar uma oferta autorizada com app aberto, minimizado e tela bloqueada; conferir tela verde, prazo, Aceitar/Recusar e fallback. Não usar corridas reais cobradas para validar a interface.
10. Verificar leitura e rolagem em tela pequena, fonte ampliada e retorno pelo botão Android. Conferir que a corrida em andamento não é encerrada nem duplicada.

## Publicação

### Ajuste visual adicional — oferta nativa

- Tela verde agora usa janela flutuante centralizada, fundo escurecido e cantos arredondados.
- Margens laterais de 16 dp e largura máxima de 440 dp. Altura cresce somente até o conteúdo, limitada a 84% da área da tela e 640 dp.
- Valor reduzido de 44 sp para 36 sp. Removido o espaço vazio esticado dos endereços.
- Cabeçalho e detalhes rolam quando necessário; Aceitar/Recusar ficam fora da rolagem, com altura mínima de 56 dp e possibilidade de crescer para fontes grandes.
- Toque fora não fecha nem atravessa para o aplicativo abaixo. Sem mudanças em aceite, recusa, som, prazo ou permissões.
- Cinco testes novos validam dimensões em celular, tablet, tela baixa, densidades diferentes e medidas vazias. Também executados os oito testes existentes de apresentação da oferta.
- Validação visual em aparelho ainda pendente: testar orientação, fonte ampliada, endereços longos, tela bloqueada e conteúdo curto sem grande espaço vazio.

Versão preparada: **1.1.48 (código 50)**, com novo pacote Android para os atalhos nativos, leitura de notificações e modal centralizado. O código 49 pertence à versão anterior. A disponibilidade aos motoristas depende do envio, análise e liberação na faixa Alpha da Play; geração do AAB não significa publicação aprovada.

Referências: [configurações Android](https://developer.android.com/reference/android/provider/Settings), [localização em segundo plano](https://developer.android.com/develop/sensors-and-location/location/permissions/background).
