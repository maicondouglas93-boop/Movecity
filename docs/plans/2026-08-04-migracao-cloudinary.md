# Migração de upload de imagem: Firebase Storage → Cloudinary

**Data:** 2026-08-04

## Diagnóstico (confirmado empiricamente, não por suposição)

Rodei um teste real contra o projeto Firebase de produção, usando as credenciais reais já configuradas em `Backend/.env`, chamando exatamente o mesmo caminho de código que `upload.service.js` usava (`bucket.exists()` e depois um upload de verdade via `uploadProfileImage`).

Resultado:
```
bucket.exists() = false
Erro no upload: 404 - "The specified bucket does not exist."
```

**Causa raiz:** o bucket padrão do Firebase Storage (`movecity-12a8d.firebasestorage.app`) nunca existiu de verdade. Em projetos Firebase no plano **Spark** (gratuito), o Storage não provisiona bucket padrão sozinho — isso só acontece automaticamente no plano **Blaze** (pago, mesmo com uso dentro da cota gratuita). Não é uma regressão de código: `upload.service.js` sempre esteve correto, só apontava pra um bucket que nunca foi criado. Na prática, **100% dos uploads de foto de perfil, foto de veículo e documento de motorista (CNH/CRLV/selfie) falhavam** com erro 500 devolvido ao frontend.

## Migração aplicada

Substituído Firebase Storage por Cloudinary (plano gratuito, bucket pronto na hora, sem essa barreira de plano):

- **`Backend/config/cloudinary.js`** (novo) — inicializa o SDK a partir de `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`.
- **`Backend/services/upload.service.js`** — reescrito por dentro, **mantendo exatamente as mesmas 5 funções exportadas** (`uploadProfileImage`, `uploadVehicleImage`, `uploadDocument`, `deleteImage`, `getSignedDocumentUrl`) com a mesma assinatura — nenhum outro arquivo do projeto precisou mudar (`upload.controller.js`, `admin.service.js` continuam iguais).
  - Fotos de perfil/veículo: sobem como `type: 'upload'` (público), igual ao comportamento anterior.
  - Documentos (CNH/CRLV/selfie): sobem como `type: 'authenticated'` (privado) — mesma garantia de segurança de antes (S9 da auditoria de segurança: documento de identidade nunca fica com URL pública direta). `getSignedDocumentUrl` gera uma URL assinada válida por 5 minutos sob demanda, mesmo prazo de antes.
  - A "URL" salva no banco pra documentos privados não é diretamente acessível (como já era no Firebase) — é só um identificador estável de onde o arquivo está; o acesso real sempre passa por `getSignedDocumentUrl`.
- **`Backend/jest.config.js` + `Backend/tests/mocks/cloudinary.mock.js`** (novo) — mock do SDK do Cloudinary pros testes, mesmo padrão já usado pro firebase-admin (mocka só a chamada de rede externa, a lógica de `upload.service.js` roda de verdade).
- **`Backend/tests/mocks/firebase-admin.mock.js`** — removido o stub de `getStorage` (código morto agora, nada mais usa).
- **`Backend/tests/unit/upload.service.test.js`** (novo) — 8 testes cobrindo upload público, upload privado, geração de URL assinada, delete (público e privado), e os casos sem URL.
- **`Backend/.gitignore`** — tinha `.env*` sem exceção, então `.env.example` nunca foi versionado (ninguém que clonasse o repo veria as variáveis necessárias documentadas). Adicionada a exceção `!.env.example`. Arquivo também estava salvo em UTF-16 (por algum editor/terminal Windows) — reescrito em UTF-8 padrão.
- **`Backend/.env.example`** — `FIREBASE_STORAGE_BUCKET` marcado como não usado (comentário explicando o porquê); adicionadas `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

## O que NÃO mudou

- `firebase-admin` continua em uso normalmente para Auth (login Google) e Cloud Messaging (push) — só o Storage saiu de cena.
- Nenhuma mudança de schema no banco — os campos que já guardavam URL de imagem (`captain.documents.<tipo>.url` etc.) continuam do mesmo jeito, só o conteúdo da URL muda de domínio.
- Frontend não precisou de nenhuma alteração — ele só chama `POST /upload/profile|vehicle|document`, nunca soube (nem precisa saber) qual provedor de storage está por trás.

## Pendências (fora do meu alcance nesta sessão)

- **Criar a conta Cloudinary** e configurar `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` no Render (produção) — sem isso, o comportamento é o mesmo de antes: upload falha, só que agora com uma mensagem de aviso mais clara nos logs (`AVISO: Credenciais do Cloudinary não encontradas`) em vez de um 404 de bucket inexistente.
- Não migrei nenhum dado antigo (não havia nada pra migrar — nenhum upload nunca funcionou de verdade nesse bucket).
- Testado com o SDK do Cloudinary mockado (mesmo padrão de todo o resto da suíte para serviços externos) — recomendo um teste manual de upload real assim que a conta estiver configurada, antes de considerar isso 100% fechado em produção.

## Verificação

Build/suíte do backend: 24 suites, 181 testes, todos passando (subiu de 20/154 porque a suíte já tinha crescido com trabalho paralelo em andamento no repositório — os 8 testes novos de `upload.service.test.js` estão entre eles). Nenhuma regressão introduzida pela migração.
