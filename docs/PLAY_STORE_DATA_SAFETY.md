# Declaração de segurança de dados — Google Play

Base de preenchimento da seção **Data safety** para os dois aplicativos. Deve ser
revisada novamente na Play Console sempre que um SDK, permissão ou fluxo de dados
for alterado.

## Respostas gerais

| Pergunta da Play Console | Resposta sugerida |
|---|---|
| O app coleta ou compartilha dados? | Sim |
| Os dados são criptografados em trânsito? | Sim |
| O usuário pode solicitar exclusão? | Sim — dentro do app e em `https://www.moovecity.com.br/account-deletion` |
| Há mecanismo público de exclusão? | Sim — a URL acima, com verificação pelo suporte |
| O app contém anúncios? | Não |
| Público-alvo principal | Adultos; não direcionado a crianças |
| Revisão independente de segurança | Não declarar, salvo se uma certificação válida for contratada |

## MoveCity Passageiro

Marcar como **coletados** quando o dado trafega para o backend, mesmo que seja
opcional ou apagado posteriormente.

| Categoria da Play | Dados no MoveCity | Finalidades | Observação de compartilhamento |
|---|---|---|---|
| Informações pessoais | nome, e-mail, telefone, CPF, data de nascimento, gênero | conta, autenticação, segurança, suporte | nome e dados necessários ao serviço chegam ao motorista parceiro |
| Localização | aproximada e precisa; embarque e destino | rota, estimativa, despacho, acompanhamento e segurança | embarque/destino e posição necessária ao serviço são compartilhados com o motorista |
| Informações financeiras | saldo da carteira, forma e situação do pagamento | cobrança, conciliação, suporte e prevenção a fraude | processadores recebem o necessário quando uma integração de pagamento é usada |
| Fotos e vídeos | foto de perfil e fotos operacionais de encomenda, quando enviadas | perfil, comprovação e suporte | conforme necessário à execução do serviço |
| Mensagens | chat de corrida/encomenda e chamados de suporte | comunicação, segurança e suporte | chat é compartilhado com o motorista participante |
| Atividade no app | corridas, encomendas, avaliações, uso de promoções e interações operacionais | prestação do serviço, personalização operacional, métricas e prevenção a fraude | não marcar como compartilhado para publicidade |
| Informações e desempenho do app | falhas e diagnósticos quando Sentry está configurado | estabilidade, segurança e correção de erros | fornecedor atua como processador do serviço |
| Identificadores do dispositivo | token de notificação e dados técnicos de sessão | push, segurança e funcionamento | fornecedores de push/infraestrutura processam o dado |

Não declarar coleta de contatos da agenda, SMS, arquivos arbitrários ou áudio: o
aplicativo não pede essas permissões. Nome e telefone de remetente/destinatário
informados manualmente em uma encomenda devem ser cobertos pela política de
privacidade e usados somente para a entrega.

## MoveCity Motorista

| Categoria da Play | Dados no MoveCity | Finalidades | Observação de compartilhamento |
|---|---|---|---|
| Informações pessoais | nome, e-mail, telefone, CPF e data de nascimento | conta, verificação, segurança, suporte e conformidade | dados operacionais necessários podem chegar ao passageiro |
| Localização | aproximada e precisa, inclusive em segundo plano quando online/em serviço | despacho, acompanhamento, rota, cálculo da corrida e segurança | posição operacional é exibida ao passageiro do serviço |
| Informações financeiras | chave PIX, dados bancários, carteira, ganhos, repasses e transações | pagamentos, repasses, conciliação e prevenção a fraude | processadores financeiros recebem o necessário |
| Fotos e vídeos | perfil, CNH, CRLV, veículo e selfie de verificação | identidade, aprovação e segurança | documentos ficam restritos à operação/administração e fornecedores de armazenamento |
| Mensagens | chat de corrida/encomenda | comunicação, segurança e suporte | compartilhado com o passageiro participante |
| Atividade no app | corridas, encomendas, aceite/cancelamento, avaliações, tempo online | prestação, métricas operacionais, segurança e prevenção a fraude | não usado para publicidade |
| Informações e desempenho do app | falhas e diagnósticos quando Sentry está configurado | estabilidade, segurança e correção de erros | fornecedor atua como processador do serviço |
| Identificadores do dispositivo | token de notificação e dados técnicos de sessão | ofertas de serviço, push, segurança e funcionamento | fornecedores de push/infraestrutura processam o dado |

## Exclusão e retenção implementadas

- solicitação autenticada bloqueia a conta e revoga as sessões imediatamente;
- solicitações públicas ficam pendentes até verificação manual do suporte;
- corrida ou encomenda ativa impede o início da exclusão;
- dados pessoais, endereços, documentos, chats, notificações e tokens são apagados
  ou anonimizados em até 30 dias;
- registros financeiros/operacionais estritamente necessários podem ser preservados
  de forma desvinculada dos identificadores pessoais quando houver justificativa de
  segurança, disputa, fraude ou obrigação legal;
- pedidos públicos não verificados expiram e têm o e-mail anonimizado após 30 dias.

## Conferência antes de enviar

1. Comparar cada resposta com o formulário atual da Play Console.
2. Confirmar quais integrações estão habilitadas no build de produção (Firebase,
   Sentry, mapas, ImageKit e eventual gateway de pagamento).
3. Publicar o frontend e abrir, sem login, `/privacy`, `/support` e
   `/account-deletion` em janela anônima.
4. Não marcar “dados não coletados” apenas porque um campo é opcional.
