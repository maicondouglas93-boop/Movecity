# Motorista — lote 7: conta, documentos e suporte

Implementado localmente em 08/09/2026. Referência principal: I12 da auditoria `docs/audits/2026-09-08-experiencia-motorista.md`. Preservados os lotes 5 e 6 ainda sem commit.

## Acesso e recuperação assistida

- Login permite mostrar/ocultar senha, mantendo o conteúdo e a leitura de autofill do WebView. Normaliza apenas e-mail; não remove espaços da senha.
- Erros ficam junto ao formulário, sem o toast duplicado que cobria o conteúdo com fonte ampliada. O botão de entrada usa verde mais escuro e a página permite rolagem em telas pequenas.
- Clique duplo não duplica a tentativa de login. Resposta incompleta não cria sessão, e resposta tardia depois de sair da tela não autentica silenciosamente.
- Login confirmado não anuncia que o motorista está online: autenticação e disponibilidade continuam separadas.
- Login e tela de falha do SessionGuard oferecem ajuda pública em `/captain-help?category=access`. O acesso à ajuda não exige que a consulta de perfil tenha sucesso.
- Não há endpoint público de recuperação automática de senha para captain no backend atual. A implementação orienta solicitar ajuda nos canais existentes e não oferece um formulário fictício de redefinição. Não alterou senhas, permissões administrativas, tokens ou políticas de autenticação.
- A orientação não recomenda desinstalar/limpar dados: isso poderia descartar pendências locais de corrida.

## Suporte único do motorista

- `/captain/support` mantém o shell de conta e a oferta global; `/captain-help` é o caminho público de recuperação. Perfil e ApprovalGate encaminham ao suporte por assunto. `/support` no build driver encaminha à ajuda pública; a página pública do passageiro mantém o comportamento anterior.
- Categorias: Acesso e senha, Documentos e cadastro, Corrida, Pagamento, Veículo, Conta, Segurança, Aplicativo e Outros.
- Mensagem revisável inclui categoria, versão/canal e descrição digitada. ID de conta só entra após seleção explícita; troca de conta limpa consentimento e rascunho.
- Não anexa automaticamente senha, token, e-mail da conta, Pix, documentos, localização ou histórico. Orienta não incluir segredos no texto. Os canais abrem somente por ação do usuário.
- Mantém WhatsApp/e-mail já publicados e permite usar o endereço de e-mail em outro aplicativo. Abrir o canal não equivale a envio, protocolo ou atendimento confirmado; não há promessa de SLA ou serviço de emergência.
- O helper de e-mail aceita assunto opcional, preservando o assunto de finalização pendente para os chamadores antigos.
- Não conecta `/support/tickets`, que continua exclusivo do passageiro; não amplia autorização no backend.

## Documentação e aprovação

- Fotos, CNH e Pix compartilham uma trava de operação. Não inicia outro envio enquanto aguarda confirmação do atual.
- Mantém `postDocumentImageUpload`: multipart web e bytes nativos no Android. Valida imagem não vazia e limite de 5 MB antes do envio.
- Foto só é apresentada como enviada depois do PATCH confirmar o mesmo motorista, documento/URL e estado não verificado. Falha de upload não faz vínculo vazio; falha de vínculo permite repetir usando a URL já recebida, sem baixar/enviar a mesma imagem novamente enquanto a tela permanece aberta.
- Troca de sessão durante upload impede a etapa de vinculação; resposta tardia não atualiza outra conta. Cada seção aplica somente seus campos confirmados, evitando substituir Pix/CNH/documentos vizinhos por um perfil antigo.
- Erros e confirmação ficam junto ao item. Dados digitados são mantidos na tentativa novamente; trocar de conta recria o formulário e descarta o rascunho anterior.
- Motivo de rejeição fica visível. Substituição de foto aprovada exige uma ação explícita com aviso de nova análise. Inputs têm rótulos persistentes e layout adequado à fonte ampliada.
- Prazo de envio vem apenas de `documentDeadline` válido e não é tratado como prazo de aprovação.
- ApprovalGate oferece documentos e suporte, distingue status desconhecido e prazo expirado, e não promete “48 horas úteis”. Perfil não promete reativação automática nem confunde aprovação do cadastro com aprovação de toda foto reenviada.
- Consulta de aprovação na Home tem trava, valida o proprietário e não substitui o contexto se houve atualização do cadastro durante a leitura. Também ignora resultado após desmontagem.

## Verificação

- Frontend: **64 arquivos / 596 testes aprovados**, 38 testes líquidos adicionais em relação ao lote 6.
- Navegador: **44 testes aprovados**, incluindo 12 novos de login, documentos, ajuda e aprovação em 320×568, 360×640 com fonte 24 e 844×390.
- Capturas inspecionadas: campos e ações continuam acessíveis por rolagem; erro de login sem sobreposição; suporte, motivo de rejeição e próximos passos legíveis. Um seletor inicial do teste de assunto foi ajustado para usar o papel/nome acessível do combobox; os testes completos passaram depois.
- Fixtures interceptam o transporte e bloqueiam requisições externas. E-mails, senha, token e imagem usados são sintéticos; não houve atendimento, credencial ou documento real enviado.
- Builds aprovados: motorista `driver-D1d_MHtJ.js`, passageiro `passenger-CpHinRL6.js`.
- ESLint selecionado de login, aprovação e novos componentes/hook sem erros. `git diff --check` aprovado. Permanecem avisos legados de imports/tamanho de bundle; não é declaração de lint global limpo.
- Sem novas dependências e sem mudanças no backend.

## Limites e publicação

Sem commit, push, deploy, AAB, incremento de versão ou submissão à Play Store. Publicação do conjunto acumulado continua exigindo backend antes do frontend/AAB por causa do contrato do lote 2.

Falta homologação no Android real: autofill, teclado, mostrar senha, seletor de arquivos/câmera, upload nativo com rede instável, retorno de WhatsApp/e-mail, TalkBack e botões Voltar. Testes web não comprovam esses comportamentos nativos.

Rascunho e URL de upload pendente ficam em memória, não constituem uma fila durável de documentos após fechar o aplicativo. O servidor continua responsável por autorização, armazenamento, validação e aprovação; este lote não muda essas políticas. Recuperação automática de senha exige um fluxo de backend e um canal de identidade verificado, não implementados aqui.

Próximo lote sugerido: resiliência de encomendas e agendados, preservando validação de PIN/entrega no servidor e sem inventar confirmação offline.
