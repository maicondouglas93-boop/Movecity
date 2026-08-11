# MoveCity Passageiro no Android

O APK do Passageiro usa o mesmo frontend React/Vite da versão Web, com uma entrada
isolada que contém somente as rotas do passageiro.

## Estrutura

- `passenger.html` e `src/main.passenger.jsx`: entrada do bundle nativo.
- `dist-passenger/`: build gerado pelo Vite (não versionado).
- `capacitor-passenger/`: configuração Capacitor do Passageiro.
- `android-passenger/`: projeto Android com o pacote `br.com.movecity.passenger`.
- `android/`: continua sendo exclusivamente o projeto do Motorista.

## Configuração local

Defina as variáveis públicas do frontend em `.env.local` ou
`.env.passenger.local`. O arquivo deve conter pelo menos uma `VITE_BASE_URL` HTTPS
válida. Use `.env.example` como referência para mapas, Firebase e Sentry.

Não coloque segredos privados em variáveis `VITE_*`: elas são incorporadas ao APK.

## Comandos

```bash
npm ci
npm run build:passenger
npm run cap:sync:passenger
npm run apk:passenger:debug
```

## Firebase e notificações

Cadastre um segundo aplicativo Android no mesmo projeto Firebase com o pacote:

```text
br.com.movecity.passenger
```

Baixe o arquivo gerado e coloque-o somente em:

```text
android-passenger/app/google-services.json
```

Não copie `android/app/google-services.json`: ele pertence a
`br.com.movecity.driver`. O script `build:passenger` detecta o arquivo correto e
habilita o push nativo automaticamente. Enquanto ele estiver ausente, o bundle é
gerado com push Android desabilitado para impedir falha fatal do Firebase ao abrir o
APK.

O Passageiro reutiliza a arquitetura comprovada do Motorista para:

- token FCM via Capacitor e `POST /notifications/token`;
- canal Android com som e vibração;
- alertas em foreground, background e processo encerrado pelo sistema;
- armazenamento one-shot e ponte Native → React para deep links.

Não foram incorporados tela de oferta, full-screen intent, aceite/recusa nativos,
GPS em background, foreground service ou permissões especiais do Motorista.

O APK debug é gerado em:

```text
android-passenger/app/build/outputs/apk/debug/app-debug.apk
```

Para abrir o projeto no Android Studio:

```bash
npm run cap:open:passenger
```

## Escopo atual

Plugins ativos: App, Geolocation, Push Notifications e Splash Screen. O manifesto
solicita internet, localização somente em primeiro plano, notificações e vibração.

Login Google nativo, tratamento central de Status Bar e Keyboard, assinatura de
release e validação física da matriz de push continuam pendentes. Até essas etapas
terminarem, este projeto deve ser tratado como build técnico/debug, não como versão
pronta para publicação na Play Store.
