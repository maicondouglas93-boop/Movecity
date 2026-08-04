# Migração de upload de imagem: Cloudinary → ImageKit

Data: 2026-08-04

## O que mudou
- SDK: `cloudinary` removido; `@imagekit/nodejs` adicionado.
- Config: `Backend/config/imagekit.js` (env `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`).
- Serviço: `Backend/services/upload.service.js` — mesmas funções exportadas; upload WebP via Sharp; documentos com `isPrivateFile`; delete por `fileId`; URL assinada via `helper.buildSrc({ signed: true, expiresIn: 300 })`.
- URL salva no banco inclui `ik-fileId` (e `ik-private=1` para docs) para delete sem lookup.
- Testes: mock em `tests/mocks/imagekit.mock.js`; suite `upload.service.test.js` atualizada.

## Produção (Render)
Trocar as variáveis Cloudinary pelas ImageKit no painel. Sem isso, upload falha com aviso no boot.
