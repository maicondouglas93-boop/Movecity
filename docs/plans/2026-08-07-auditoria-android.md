# Auditoria Técnica Completa — MoveCity Android (App do Motorista)

**Data:** 2026-08-07
**Escopo:** `frontend/android/` (Capacitor nativo) + `frontend/src/` (código consumido pelo build `driver`) + integração com `Backend/`
**Regra seguida:** nenhum arquivo do projeto foi alterado. Todos os comandos executados (leitura de código, `adb`, `grep`) são somente-diagnóstico.
**Dispositivo real usado para evidência:** Xiaomi 24095PCADG (codinome `malachite`), Android 16 (API 36), HyperOS/MIUI V816, app instalado versão 1.1.13 (versionCode 15), com sessão de motorista ativa e processo rodando (PID real no momento da auditoria).

---

## A. RESUMO EXECUTIVO

O app Android do motorista **não é** um wrapper PWA genérico — é uma implementação nativa Capacitor com uma camada Java própria (15 arquivos) construída especificamente para contornar as limitações do Android em segundo plano: FCM como transporte puro, uma Activity nativa em tela cheia ("tela verde") para ofertas de corrida/encomenda, criptografia real da sessão (`EncryptedSharedPreferences`), GPS real via Foreground Service dedicado, e uma tela de onboarding específica para permissões de fabricante (Xiaomi/MIUI). A engenharia é, em termos gerais, **de qualidade alta e acima da média** para esse tipo de app — a maior parte do que se espera de um app de motorista (FCM real, GPS real, sessão criptografada, atualização de APK com verificação de hash, `network_security_config` restritivo) está implementada corretamente.

O problema relatado por você — **a notificação nativa/verde só aparece depois que o usuário toca na notificação do sistema** — tem causa raiz identificada com alta confiança, **e confirmada empiricamente no aparelho real**: a permissão que permitiria a tela verde abrir sozinha sobre a tela bloqueada (`USE_FULL_SCREEN_INTENT`) está **concedida no aparelho** (`Uid mode: USE_FULL_SCREEN_INTENT: allow`), mas o código que constrói a notificação de oferta **nunca chama o método que ativaria esse comportamento** (`NotificationCompat.Builder.setFullScreenIntent(...)`). A infraestrutura para o comportamento correto existe quase inteira — permissão no manifest, tela de onboarding pedindo a permissão ao motorista, `Activity` corretamente configurada com `showWhenLocked`/`turnScreenOn`, e até um mecanismo alternativo via `AlarmManager` já implementado — mas o "fio" que liga tudo isso não está conectado no caminho que roda quando o app está em segundo plano.

Não é um caso de "duas implementações brigando". É uma implementação só, bem pensada, com uma chamada de API ausente no lugar certo — mais um achado secundário real (dois canais de entrega paralelos sem deduplicação) que pode produzir a sensação de duplicidade em cenários de borda.

---

## B. ARQUITETURA ENCONTRADA

```
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (Node/Express)                                              │
│  dispatchRideToCaptains() / dispatchParcelToCaptains()               │
│  → SEMPRE dispara os dois canais, sem checar se o socket está vivo:  │
│                                                                        │
│    1) sendMessageToSocketId(captain.socketId, {event:'new-ride'})    │
│    2) notificationService.sendNewRide(captain._id, {...}) → FCM      │
│         data-only, type=NEW_RIDE, Urgency:high                       │
└───────────────┬───────────────────────────────┬──────────────────────┘
                 │ (1) Socket.IO                 │ (2) FCM (push real)
                 ▼                               ▼
┌─────────────────────────────┐   ┌──────────────────────────────────────┐
│ App em FOREGROUND            │   │ MoveCityMessagingService (FCM)       │
│ CaptainHome.jsx recebe       │   │ (substitui o serviço padrão do       │
│ 'new-ride' via socket        │   │  Capacitor — manifest tools:node=    │
│  → presentNativeRideOffer()  │   │  "remove" no push-notifications)     │
│  → plugin NativeRideOffer    │   │                                       │
│  → RideOfferNotifier         │   │  onMessageReceived():                │
│    .showFullScreenOffer()    │   │   type=NEW_RIDE/NEW_PARCEL            │
└──────────────┬────────────────┘   │   → RideOfferNotifier                │
               │                    │     .showFullScreenOffer()            │
               │                    └──────────────┬─────────────────────┘
               │                                     │
               ▼                                     ▼
        ┌─────────────────────────────────────────────────────┐
        │  RideOfferNotifier.showFullScreenOffer()             │
        │  if (isAppInForeground()) {                          │
        │      launchOfferActivityNow() → RideOfferActivity     │  ← tela verde abre na hora
        │  } else {                                             │
        │      postRichOfferNotification()                      │  ← só a notificação, SEM
        │  }                                            ▲       │     setFullScreenIntent()
        └────────────────────────────────────────────────┼──────┘
                                                            │
                                    AQUI ESTÁ O GAP: nada chama
                                    launchOfferActivityNow() nem
                                    scheduleLaunchAlarm() neste ramo.
                                    A tela verde só abre se o
                                    motorista tocar a notificação.
```

**Componentes nativos (15 arquivos Java, todos em `frontend/android/app/src/main/java/br/com/movecity/driver/`):**

| Arquivo | Papel |
|---|---|
| `MainActivity.java` | Entry point Capacitor. Registra 4 plugins nativos, inicializa canais de notificação e o `CurrentActivityHolder`. |
| `MoveCityMessagingService.java` | Substitui o `FirebaseMessagingService` padrão do Capacitor. Roteia por `type` do payload: oferta → `RideOfferNotifier`; alerta com título/corpo → `DriverAlertNotifier`; resto → Capacitor JS. |
| `RideOfferNotifier.java` | Núcleo do sistema de ofertas. Decide entre abrir a Activity direto (foreground) ou postar a notificação rica (background). **Aqui está a causa raiz.** |
| `RideOfferActivity.java` | A "tela verde" — full-screen, `showWhenLocked`+`turnScreenOn`+`requestDismissKeyguard`, toca ringtone e vibra, Aceitar/Recusar chamam a API diretamente. |
| `RideOfferAcceptActivity.java` | Trampolim para o botão "Aceitar" da notificação (Android 12+ não permite mais `BroadcastReceiver → startActivity`). |
| `RideOfferActionReceiver.java` | Ação "Recusar" da notificação (via `goAsync()`, correto para trabalho assíncrono em `BroadcastReceiver`). |
| `RideOfferLaunchReceiver.java` | Disparado por `AlarmManager` — teoricamente o mecanismo de abrir a Activity com isenção de restrição de "background activity start". **Nunca é acionado no caminho de background.** |
| `RideOfferAcceptHelper.java` | HTTP nativo (sem depender do WebView) para aceitar/recusar, com retry de token via `/captains/refresh`. |
| `RideOfferLaunchHelper.java` | Abre a `MainActivity` com deep link após aceite nativo. |
| `RideOfferFlowLog.java` | Logging padronizado (tag `RideOfferFlow`), sem PII. |
| `DriverAlertNotifier.java` | Notificações secundárias (chat, cancelamento, pagamento) — canal separado (`driver_alerts_v1`). |
| `NativeSessionPlugin.java` / `NativeSessionStore.java` | Sessão do motorista espelhada em `EncryptedSharedPreferences` (AES-256), lida pelo aceite nativo mesmo com o app morto. |
| `NativeDriverPermissionsPlugin.java` | Status + atalhos de Settings para FSI, bateria, autostart por fabricante (Xiaomi/Huawei/Oppo/Vivo). |
| `NativeDeepLinkStore.java` | Deep link pendente entre clique nativo e consumo pelo JS. |
| `CurrentActivityHolder.java` | Rastreia a Activity em resume via `WeakReference` — usado para decidir foreground/background. |
| `AppUpdatePlugin.java` | Download + instalação de APK fora da Play Store, com HTTPS obrigatório e verificação SHA-256. |

**Frontend (`frontend/src/`) relevante ao Android:**
- `driver.html` → `dist-driver` (build **separado** do PWA, `vite build --mode driver`, **sem** o plugin PWA — ou seja, **não existe Service Worker dentro do APK**).
- `shared/platform/nativeRideOffer.service.js`, `nativeSession.service.js`, `driverPermissions.service.js`, `location.service.js` — pontes para os 4 plugins nativos.
- `driver/pages/CaptainHome.jsx` — chama `presentNativeRideOffer()` no handler do socket `'new-ride'`.
- `driver/components/DriverOemPermissionsCard.jsx` — onboarding de permissões (dispensável).

---

## E. NOTIFICAÇÕES — ANÁLISE ESPECÍFICA E DETALHADA

### E.1 Mapeamento das implementações concorrentes

Respondendo item a item ao que foi pedido na seção 2:

1. **Por que isso acontece:** `RideOfferNotifier.showFullScreenOffer()` ([RideOfferNotifier.java:96-122](../../frontend/android/app/src/main/java/br/com/movecity/driver/RideOfferNotifier.java#L96-L122)) só chama `launchOfferActivityNow()` (que abre a tela verde) quando `isAppInForeground()` é verdadeiro. No ramo `else` (app em segundo plano ou tela bloqueada — o cenário relevante aqui), a função termina em `postRichOfferNotification()`, que **cria e posta a notificação e não faz mais nada**. Não há chamada a `launchOfferActivityNow()`, a `scheduleLaunchAlarm()`, nem a `setFullScreenIntent()` no `NotificationCompat.Builder` ([linhas 159-175](../../frontend/android/app/src/main/java/br/com/movecity/driver/RideOfferNotifier.java#L159-L175)). A tela verde só abre quando o motorista toca no corpo da notificação (`contentPi`, linha 138) ou no botão Aceitar (`RideOfferAcceptActivity`).

2. **Qual componente cria cada notificação:**
   - "Notificação exibida pelo sistema" (a que aparece sozinha) = `RideOfferNotifier.postRichOfferNotification()`, canal `ride_offers_v4`.
   - "Notificação nativa/verde" (que deveria abrir sozinha) = `RideOfferActivity`, uma `Activity` em tela cheia — **não é uma segunda notificação**, é a tela que deveria abrir automaticamente via Full-Screen Intent e hoje só abre por toque.

3. **Duas implementações concorrentes?** Não, no sentido de "brigando". É uma implementação única e coerente, mas com um comportamento condicional (foreground vs. background) em que o ramo de background está incompleto.

4. **Existe listener JS criando notificação manual?** Sim, mas não conflita: `showBrowserNotification()` ([`Home.jsx`](../../frontend/src/passenger/pages/Home.jsx), reaproveitado no motorista) só roda quando `!isNativePlatform()` — ou seja, **no PWA/navegador, nunca no APK**. Confirmado em [`CaptainHome.jsx` linha ~359](../../frontend/src/driver/pages/CaptainHome.jsx): `if (!isNativePlatform() && 'Notification' in window ...)`. Corretamente blindado.

5. **Existe código Android nativo criando outra?** Sim — `DriverAlertNotifier`, mas é para um propósito diferente (chat/pagamento/cancelamento), canal diferente (`driver_alerts_v1`), e só dispara quando o payload tem `title`/`message`/`body` e **não** é uma oferta (`MoveCityMessagingService.onMessageReceived`, linha 50). Sem sobreposição com ofertas de corrida.

6. **O Firebase cria automaticamente uma notificação?** Não. O manifest remove explicitamente o serviço padrão do Capacitor (`tools:node="remove"` sobre `com.capacitorjs.plugins.pushnotifications.MessagingService`, [AndroidManifest.xml:55-57](../../frontend/android/app/src/main/AndroidManifest.xml#L55-L57)) e o backend envia `NEW_RIDE`/`NEW_PARCEL` como **data-only** (confirmado em `Backend/notification/notificationDispatcher.service.js`, `sendNewRide`: `dataOnly: true`). Mensagem data-only nunca gera notificação automática do sistema — sempre passa pelo código do app. Não há duplicação vinda do FCM em si.

7. **O Capacitor cria outra?** Não, pelo mesmo motivo do item 6 — o serviço nativo do plugin foi removido do manifest.

8. **Qual implementação deve permanecer?** A atual (`RideOfferNotifier` + `RideOfferActivity` nativos). É a arquitetura correta para esse tipo de app — o que falta é completar, não substituir.

9. **Qual deve ser removida?** Nenhuma. Não há redundância a remover — há uma chamada a acrescentar.

10. **Como fazer a notificação principal aparecer sem depender de clique:** ver Causa Raiz e Plano de Correção abaixo. Resumo: adicionar `.setFullScreenIntent(pendingIntent, true)` ao `NotificationCompat.Builder` de `postRichOfferNotification()`, usando o `PendingIntent` que já existe (`contentPi`) — a permissão já está concedida no aparelho de teste, então o efeito deve ser imediato.

### E.2 Achado secundário — dois canais sem deduplicação (🟠 ALTO)

O backend dispara **sempre os dois canais** para cada motorista despachado, sem verificar se o socket está conectado ([`ride.controller.js` linhas 64-89](../../Backend/controllers/ride.controller.js#L64-L89) — `sendMessageToSocketId` e `notificationService.sendNewRide` chamados incondicionalmente, mesmo padrão em `parcel.controller.js`):

```js
sendMessageToSocketId(captain.socketId, { event: 'new-ride', data: ... })
notificationService.sendNewRide(captain._id, { ... }).catch(console.error)
```

Se o motorista está com o app tecnicamente em foreground (socket conectado) no exato instante em que o FCM também chega — cenário plausível, já que os dois saem quase simultaneamente do backend — **dois gatilhos independentes** tentam abrir a mesma `RideOfferActivity`: o socket via `presentNativeRideOffer()` (bridge JS) e o FCM via `MoveCityMessagingService`. `RideOfferActivity` está declarada com `launchMode="singleTop"` ([AndroidManifest.xml:41](../../frontend/android/app/src/main/AndroidManifest.xml#L41)), então uma segunda `startActivity` não cria uma segunda tela — mas como a Activity **não sobrescreve `onNewIntent()`**, o segundo disparo é descartado silenciosamente, o que é inofensivo nesse caso específico. O risco real é a janela de corrida entre "socket ainda não marcou `isAppInForeground()`" e "FCM chega e usa o valor antigo de foreground" — nessa janela estreita pode-se ver a notificação rica **e** a tela verde abrindo por dois caminhos diferentes quase ao mesmo tempo, reforçando a percepção de "duas notificações" mesmo depois de corrigido o item principal.

**Causa raiz:** ausência de idempotência entre os dois canais de entrega (nenhum dos dois checa se o outro já processou a mesma oferta).

### E.3 Achado — `setBypassDnd(true)` não tem efeito real (🟠 ALTO, confirmado no aparelho)

O código declara o canal `ride_offers_v4` com `channel.setBypassDnd(true)` ([RideOfferNotifier.java:62](../../frontend/android/app/src/main/java/br/com/movecity/driver/RideOfferNotifier.java#L62)), com a intenção clara de a oferta tocar mesmo com o celular em Não Perturbe. **Evidência real do aparelho** (`adb shell dumpsys notification`):

```
NotificationChannel{mId='ride_offers_v4', ... mImportance=4, mBypassDnd=false, ...}
```

`mBypassDnd=false` no canal real. Isso acontece porque `setBypassDnd()` sozinho não é suficiente — o Android exige que o usuário conceda manualmente acesso a "Não Perturbe" para o app (`Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS`), um fluxo que **não existe em nenhum lugar do código** (nem no manifest — `ACCESS_NOTIFICATION_POLICY` não está declarada, nem na tela de onboarding `DriverOemPermissionsCard.jsx`, que pede FSI/bateria/local./autostart mas não pede acesso a Não Perturbe). Resultado prático: um motorista com o celular em modo Não Perturbe (comum durante o sono entre turnos, ou com "Foco" ativado) **não vai ouvir nem ver** a oferta em destaque, apesar do código pretender exatamente o contrário.

### E.4 Comentário desatualizado (⚪ INFORMATIVO)

`NativeRideOfferPlugin.java` linha 17 diz "A Push heads-up da bandeja está desativada" — mas `postRichOfferNotification` claramente cria notificações heads-up (`IMPORTANCE_HIGH` + `PRIORITY_MAX`). O comentário provavelmente se refere à remoção do handler padrão do Capacitor (item 6/7 acima), não à notificação rica atual. Não é bug, mas confunde quem for mexer no código depois.

---

## F. PERMISSÕES

### F.1 Inventário (declaradas no `AndroidManifest.xml`, confirmado no dispositivo real)

| Permissão | Declarada | Runtime/Especial | Estado real no aparelho | Necessária? |
|---|---|---|---|---|
| `INTERNET` | ✅ | Normal | — | Sim, óbvio |
| `ACCESS_COARSE_LOCATION` | ✅ | Runtime | **granted=true** | Sim |
| `ACCESS_FINE_LOCATION` | ✅ | Runtime | **granted=true** | Sim (GPS de motorista precisa de precisão) |
| `ACCESS_BACKGROUND_LOCATION` | ✅ | Runtime (pedida em 2 passos, Android 10+) | **granted=true** | Sim — motorista precisa ser localizável de app minimizado |
| `FOREGROUND_SERVICE` | ✅ | Normal | — | Sim, para o FGS de localização |
| `FOREGROUND_SERVICE_LOCATION` | ✅ | Normal (Android 14+) | — | Sim, tipo obrigatório desde a API 34 |
| `WAKE_LOCK` | ✅ | Normal | — | Sim, usado para acordar a tela na oferta |
| `POST_NOTIFICATIONS` | ✅ | Runtime (Android 13+) | **granted=true** | Sim, essencial |
| `VIBRATE` | ✅ | Normal | — | Sim |
| `USE_FULL_SCREEN_INTENT` | ✅ | Especial (revisável pelo usuário no Android 14+) | **allow** (`appops get`) | Sim — e é a que não está sendo usada (ver seção E) |
| `DISABLE_KEYGUARD` | ✅ | Normal (deprecated, mas ainda funcional) | — | Usada por `RideOfferActivity` para dispensar o keyguard em versões pré-O_MR1 |
| `SCHEDULE_EXACT_ALARM` | ✅ | Especial | — | Ver ressalva F.2 |
| `USE_EXACT_ALARM` | ✅ | Especial ("core alarm/clock app") | — | Ver ressalva F.2 |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | ✅ | Normal + Settings | app **está** na whitelist do Doze no aparelho testado | Sim, essencial para GPS/push confiáveis |
| `REQUEST_INSTALL_PACKAGES` | ✅ | Especial | — | Sim, para o `AppUpdatePlugin` (update fora da Play Store) |

Nenhuma permissão de câmera, microfone, armazenamento ou telefone é usada — condizente com o escopo do app (não há upload de foto de documento nesta build nativa, por exemplo).

### F.2 Ressalva sobre `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM` (🟡 MÉDIO)

`USE_EXACT_ALARM` é uma permissão "especial" da Play Store reservada a apps cuja **função principal** é alarme/timer/relógio (política declarada do Google Play, não apenas documentação técnica). Um app de corridas normalmente não se enquadra nessa categoria. Isso é usado por `scheduleLaunchAlarm()` em `RideOfferNotifier.java` — que, como já registrado, **não está sendo chamado no caminho relevante hoje**. Se a intenção for reativar esse caminho como parte da correção, vale revisar se a Play Store aceitaria a declaração dessa permissão para este app antes de depender dela em produção — o app já é distribuído fora da Play Store (`AppUpdatePlugin`), o que reduz o risco imediato, mas não elimina a necessidade de checar caso um dia haja publicação na Play Store.

### F.3 Timing das solicitações (🟢 correto)

- Localização em foreground é pedida por `location.service.js` só quando `watchPosition()` é chamado (ligado à sessão ativa, não no boot do app).
- Localização em background só é pedida **depois** de a de foreground já estar concedida (`requestBackgroundLocationPermission`, [location.service.js:150-167](../../frontend/src/shared/platform/location.service.js#L150-L167)) — exatamente a sequência que o Android exige desde a API 29; pedir os dois juntos faz o sistema negar automaticamente.
- `POST_NOTIFICATIONS` (Android 13+) é gerenciada pelo próprio `@capacitor/push-notifications` no registro do listener — não inspecionei o ponto exato de chamada, mas o estado real confirma que está concedida.

### F.4 Negação e fallback

`DriverOemPermissionsCard.jsx` trata negação com um atalho para "Abrir informações do app" em todos os casos, e para background location especificamente há fallback explícito (`if (!r.granted) await openDriverAppSettings()`). O ponto fraco (🟡 MÉDIO): o card usa uma única flag de `localStorage` (`driverOemPermsSeen_v1`) que, marcada por **qualquer** dos botões ("Já configurei" ou "Agora não"), esconde o card **permanentemente** ([`driverPermissions.service.js:108-117`](../../frontend/src/shared/platform/driverPermissions.service.js#L108-L117) — `hasSeenOemPermissionsOnboarding()` é checada primeiro e nunca mais reavaliada). Um motorista que dispense o card sem configurar nada não recebe um segundo aviso, mesmo que `canUseFullScreenIntent` continue falso semanas depois.

---

## G. BACKGROUND / GPS

### G.1 GPS é real

Confirmado por leitura de código: `location.service.js` usa `@capacitor/geolocation`, que por sua vez chama a API nativa Android de localização (`FusedLocationProviderClient` por baixo do plugin) — **não há nenhuma simulação, mock ou interpolação de posição**. O único "suavizamento" existente é de **rumo** (heading), calculado a partir de dois pontos reais quando o sensor não informa heading diretamente (`computeBearing`, mesma lógica já usada no PWA) — isso é tratamento de dado real, não substituição por dado falso.

### G.2 Confiabilidade em background — Foreground Service correto

O app usa `@capawesome-team/capacitor-android-foreground-service` com `serviceType: "location"` ([manifest linha 87-90](../../frontend/android/app/src/main/AndroidManifest.xml#L87-L90), payload em [`location.service.js:193-204`](../../frontend/src/shared/platform/location.service.js#L193-L204)) — este é o mecanismo correto e suportado pelo Android para tracking contínuo com o app minimizado ou a tela bloqueada. O ciclo de vida é amarrado corretamente a `isOnline || hasActiveTrip` (`syncTrackingLifecycle`), então o FGS não fica ligado à toa quando o motorista está offline.

Pontos que checagem de código não resolve sozinha, precisam de teste prolongado real (não foi possível validar em tempo de auditoria sem gerar corridas reais no backend de produção):
- Se o `setInterval` de envio de posição ao backend (usado nas telas de corrida, já auditado nesta sessão anteriormente) continua disparando na frequência esperada com a `Activity` parada — Foreground Service garante que o **processo** não morre, mas não é garantia formal de que timers de JS numa WebView em `onStop()` continuem no ritmo normal (Chromium pode aplicar *throttling* de timers em segundo plano independentemente do FGS). **Recomendo teste de campo**: online por 30+ minutos com tela bloqueada, comparando timestamps de `update-location-captain` no backend.

### G.3 Doze / App Standby

App confirmado na whitelist do Doze no aparelho de teste (`dumpsys deviceidle whitelist` lista `br.com.movecity.driver`). Isso normalmente exige ação do usuário (a tela de onboarding já cobre isso) — não é algo que o app consiga forçar sozinho, mas o app **pede** corretamente via `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.

---

## Classificação consolidada dos problemas encontrados

### 🔴 CRÍTICO
Nenhum problema desta severidade foi encontrado. O sistema funciona; o comportamento relatado é uma degradação de confiabilidade, não uma quebra total.

### 🟠 ALTO

**H1 — Full-Screen Intent nunca acionado no caminho de background (a causa raiz do problema relatado)**
- **Arquivo:** `frontend/android/app/src/main/java/br/com/movecity/driver/RideOfferNotifier.java`, método `postRichOfferNotification`, linhas 130-185.
- **Causa provável:** implementação interrompida — a permissão, o manifest, a `Activity` e até um mecanismo alternativo (`AlarmManager`) foram construídos, mas a chamada final (`setFullScreenIntent` ou acionamento de `launchOfferActivityNow`/`scheduleLaunchAlarm` no ramo de background) nunca foi conectada.
- **Impacto:** motorista com o app minimizado ou tela bloqueada não vê a tela cheia de oferta automaticamente — precisa notar e tocar a notificação primeiro. Em corridas com prazo curto de aceite, isso custa tempo real.
- **Evidência:** leitura de código (ausência da chamada) + `adb shell cmd appops get br.com.movecity.driver USE_FULL_SCREEN_INTENT` → `allow` no aparelho real, provando que a permissão concedida não está sendo usada.
- **Correção recomendada:** dentro de `postRichOfferNotification`, adicionar ao `NotificationCompat.Builder` (antes do `.build()`):
  ```java
  .setFullScreenIntent(contentPi, true)
  ```
  reaproveitando o `contentPi` que já existe na função. Isso é aditivo — não remove nada do que já funciona (toque continua abrindo a tela, botões continuam funcionando). Testar em seguida com tela bloqueada de verdade (Full-Screen Intent só se comporta como tela cheia com a tela desligada/bloqueada — com a tela ligada e desbloqueada ele degrada para heads-up, que já é o comportamento atual).

**H2 — Dois canais de entrega (Socket.IO + FCM) sem deduplicação**
- **Arquivos:** `Backend/controllers/ride.controller.js` (`dispatchRideToCaptains`), `Backend/controllers/parcel.controller.js` (`dispatchParcelToCaptains`).
- **Causa provável:** os dois canais foram implementados em momentos/motivações diferentes (tempo real vs. confiabilidade com app fechado) sem um mecanismo de "quem chegou primeiro vence".
- **Impacto:** em janelas de corrida estreitas, pode gerar dois gatilhos de abertura da mesma tela quase simultâneos — inofensivo pela config `singleTop`, mas contribui para a sensação de duplicidade.
- **Correção recomendada:** no lado nativo, `RideOfferNotifier` já tem os IDs de notificação/alarme por `offerId` (`notificationIdFor`) — o mesmo `offerId` poderia ser usado para um lock leve em memória (ex.: `Set<String>` estático com TTL curto) que ignora uma segunda chamada de `showFullScreenOffer` para o mesmo `offerId` dentro de poucos segundos.

**H3 — `setBypassDnd(true)` sem efeito real (confirmado no aparelho)**
- **Arquivo:** `RideOfferNotifier.java`, método `ensureChannel`, linha 62.
- **Causa provável:** o código assume que declarar `setBypassDnd(true)` é suficiente; falta o fluxo de solicitar ao usuário o acesso a Não Perturbe (`ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS`), que é obrigatório e não pode ser automatizado.
- **Impacto:** ofertas não tocam nem vibram com o aparelho em Não Perturbe/Foco, apesar do código pretender o contrário.
- **Evidência:** `dumpsys notification` no aparelho real → `mBypassDnd=false` no canal `ride_offers_v4`.
- **Correção recomendada:** adicionar um item na tela de onboarding (`DriverOemPermissionsCard.jsx`) pedindo acesso a Não Perturbe via `NotificationManager.isNotificationPolicyAccessGranted()` + `Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS`, no mesmo padrão dos outros itens do card.

### 🟡 MÉDIO

**M1 — Onboarding de permissões é dispensável sem retorno**
- **Arquivo:** `frontend/src/shared/platform/driverPermissions.service.js`, `shouldShowOemPermissionsCard`.
- **Causa:** flag única em `localStorage`, sem reavaliação periódica.
- **Correção:** trocar a lógica para reexibir o card se, ao reabrir o app, `canUseFullScreenIntent` ou `ignoringBatteryOptimizations` ainda estiverem falsos — mesmo já tendo sido "dispensado" — no máximo uma vez a cada N dias, para não incomodar demais.

**M2 — Colisão de nome de `SharedPreferences` entre deep link e sessão legada**
- **Arquivos:** `NativeDeepLinkStore.java` (`PREFS = "MoveCityNative"`) e `NativeSessionStore.java` (`LEGACY_PREFS = "MoveCityNative"`, mesmo nome).
- **Causa:** a migração de sessão de `NativeSessionStore` (linha 71: `legacy.edit().clear().apply()`) limpa o arquivo inteiro de preferências, sem saber que `NativeDeepLinkStore` também guarda dados nesse mesmo arquivo.
- **Impacto:** se um deep link for gravado exatamente na janela entre o app subir e a primeira leitura de `NativeSessionStore` (o que aciona a migração one-shot), o deep link pode ser apagado antes do JS conseguir consumi-lo. Janela estreita, mas real — mais provável logo após uma atualização do app (quando a migração roda pela primeira vez) combinada com um clique em notificação nesse mesmo instante.
- **Correção recomendada:** usar nomes de arquivo de preferências diferentes para os dois (`MoveCityNativeDeepLink` vs. `MoveCityNativeLegacySession`), ou fazer a limpeza da migração remover só as chaves de sessão, não o arquivo inteiro.

**M3 — `USE_EXACT_ALARM` declarada mas dependente de política da Play Store**
- Ver seção F.2.

**M4 — Comportamento de fila divergente entre corrida e encomenda (herdado da auditoria anterior desta sessão)**
- Já registrado no plano de correção do módulo de encomendas ([docs/plans/2026-08-04-correcao-modulo-encomendas.md](2026-08-04-correcao-modulo-encomendas.md)) — reafirmado aqui porque também se manifesta no Android: a notificação de "sem motorista disponível" para encomenda é imediata, mas para corrida o app aguarda em `requested`. Não é um bug Android per se, mas afeta a experiência do motorista via push.

### 🔵 BAIXO

**B1 — Comentário desatualizado em `NativeRideOfferPlugin.java`** (ver E.4).

**B2 — `postAcceptDeepLink` para corrida não inclui o `rideId` na query** ([RideOfferLaunchHelper.java:15-17](../../frontend/android/app/src/main/java/br/com/movecity/driver/RideOfferLaunchHelper.java#L15-L17) retorna só `/captain-home`, sem `?rideOffer=`). Funciona porque `RideContext` sincroniza a corrida ativa via `/rides/captain-current` ao montar a tela — mas não pude confirmar em teste real ponta-a-ponta que isso resulta na tela de confirmação/OTP abrindo automaticamente pós-aceite nativo. Recomendo um teste manual dedicado.

### ⚪ INFORMATIVO

**I1 — App já target Android 14 (API 34) rodando em Android 16 (API 36) real** — sem incompatibilidade encontrada, mas todo novo lançamento do Android tende a apertar ainda mais regras de segundo plano/FSI; vale revisitar esta auditoria a cada bump de `targetSdkVersion`.

**I2 — Dois canais de notificação de ofertas já existem no aparelho (`ride_offers_v3` e `ride_offers_v4`)**, confirmando que o time já precisou "pular" de versão de canal antes (prática correta — canais existentes são imutáveis por app, e o Android ignora silenciosamente novas configurações de importância/som em um canal já criado). Se a correção do H1/H3 exigir novos atributos de canal, será necessário criar `ride_offers_v5` — mudar atributos de um canal existente via `createNotificationChannel()` **não tem efeito** em quem já tem o app instalado.

---

## Segurança (resumo, sem expor segredos)

- **Keystore de release** (`android/movecity-driver-release.jks`) e `keystore.properties` **não estão versionados** — confirmado via `git ls-files`. Corretamente listados no `.gitignore` (`*.jks`, `*.keystore`, `keystore.properties`).
- `build.gradle` não tem senha/alias hardcoded — lê de `keystore.properties` em runtime, com guarda de CI (`CI_REQUIRE_RELEASE_SIGNING`) que **falha o build** se o keystore de produção não estiver presente, evitando publicar um APK assinado com a chave de debug por engano.
- `google-services.json` **está** versionado — isso é esperado e aceito pela própria Google para apps móveis (não é um segredo de servidor; a proteção real está em restrições de API no Google Cloud Console / Firebase App Check, que não pude auditar de dentro do repositório).
- `network_security_config.xml`: cleartext desligado por padrão, com exceção só para endereços de loopback/emulador. Nenhuma exceção ampla.
- Sessão do motorista (token + refresh) em `EncryptedSharedPreferences` (AES-256-GCM/SIV), com migração automática e limpeza do armazenamento legado em texto puro.
- Nenhum `debuggable=true` fixo encontrado em `build.gradle`; nenhuma chamada a `WebView.setWebContentsDebuggingEnabled` encontrada no código nativo.
- `AppUpdatePlugin` (instalação de APK fora da Play Store) exige HTTPS (com exceção só para IPs de rede local) **e** SHA-256 obrigatório do arquivo baixado antes de abrir o instalador — boa prática, mitiga adulteração do binário em trânsito.
- Não foram encontradas chaves de API, segredos de backend ou tokens hardcoded nos arquivos Java/Kotlin lidos nesta auditoria.

---

## H. Matriz de testes

Legenda de evidência: 🧪 = testado empiricamente no aparelho real durante esta auditoria · 📖 = inferido por leitura de código (não testado ao vivo) · ⏳ = requer teste de campo prolongado, fora do escopo desta sessão.

| Cenário | Esperado | Atual (avaliação) | Status | Evidência |
|---|---|---|---|---|
| App aberto, oferta chega | Tela verde abre na hora | Abre na hora via `presentNativeRideOffer` | ✅ | 📖 código consistente, sem gap |
| App minimizado, tela **desbloqueada** | Notificação heads-up; tela verde opcional (FSI degrada para heads-up com tela ligada) | Só a notificação aparece — comportamento correto por limitação de plataforma | ✅ | 📖 |
| **Tela bloqueada**, oferta chega | Tela verde deveria abrir sobre o bloqueio (Full-Screen Intent) | Só a notificação aparece; tela verde exige toque | ❌ | 🧪 FSI `allow` no aparelho + código sem `setFullScreenIntent` |
| App removido dos recentes | App morto; push ainda deve acordar o processo (FCM) e mostrar oferta | Deveria funcionar — `MoveCityMessagingService` roda independente de Activity viva | ⏳ | 📖, não testado ao vivo (exigiria gerar corrida real) |
| Celular reiniciado, app não reaberto | FCM continua entregando após boot (token permanece válido) | Esperado funcionar (comportamento padrão do FCM/Android) | ⏳ | 📖 |
| Internet cai durante corrida ativa | Fila offline / reconexão de socket | Existe fila offline (`db.driverLocations`), auditada em sessão anterior deste projeto | ✅ | 📖 (herdado de auditoria PWA anterior) |
| GPS desligado no aparelho | Erro tratado, motorista avisado | `handleError` cobre `POSITION_UNAVAILABLE` | ✅ | 📖 |
| Permissão de localização negada | App não trava; pede de novo ou orienta Settings | Tratado com fallback para Settings | ✅ | 📖 |
| Notificação negada (`POST_NOTIFICATIONS`) | App continua funcional sem push; sem crash | Não há guarda explícita contra esse estado em `RideOfferNotifier`, mas `NotificationManager.notify()` simplesmente não exibe nada sem crashar | 🟡 | 📖 — recomendo teste real revogando a permissão |
| Bateria em modo restrito (usuário reverteu a whitelist) | App avisa que push/GPS podem falhar | Onboarding pede a exceção, mas não há novo aviso se o usuário revogar depois | 🟡 | 📖 |
| Bateria irrestrita | GPS e push confiáveis | Confirmado — app na whitelist do Doze no aparelho real | ✅ | 🧪 `dumpsys deviceidle whitelist` |
| Corrida — oferta em segundo plano | Tela verde automática | **Falha** (ver H1) | ❌ | 🧪 |
| Agendamento — vira disponível | Push chega ao motorista via o mesmo caminho de `NEW_RIDE` | Confirmado — cron de ativação reusa `dispatchRideToCaptains` | ✅ | 📖 `schedule.service.js` |
| Encomenda — oferta em segundo plano | Mesmo comportamento de corrida | Mesma falha (H1), mesmo código (`type=NEW_PARCEL`) | ❌ | 🧪/📖 |
| Chat — mensagem em background | Notificação nativa (`driver_alerts_v1`), abre o chat ao tocar | Implementado via `DriverAlertNotifier`, canal confirmado no aparelho (id=23142, importance=4) | ✅ | 🧪 |
| PIN de entrega/OTP via chat | Motorista recebe mesmo com app fechado | Seria roteado como alerta padrão (mesmo canal de chat) — **não encontrei tratamento especial de PIN separado do texto da mensagem** | 🟡 | 📖 — vale confirmar se o PIN chega legível no corpo da notificação |
| Localização — dispositivo em Doze | GPS continua atualizando | FGS ativo deveria evitar suspensão | ⏳ | 📖, recomendo teste de campo de 30+ min |
| Notificação nativa — Full Screen Intent | Abre sozinha com tela bloqueada | **Não abre** | ❌ | 🧪 causa raiz confirmada |

---

## I. Causa raiz — síntese

Para os três achados 🟠 ALTO (H1, H2, H3), a causa raiz comum não é falta de conhecimento técnico da equipe — pelo contrário, o código demonstra conhecimento correto e específico do Android (comentários explicando exatamente por que Full-Screen Intent degrada para heads-up com a tela ligada, por que `BroadcastReceiver → startActivity` não funciona mais no Android 12+, por que motoristas Xiaomi precisam de telas de permissão extras). O padrão em comum é **infraestrutura construída e permissão/plumbing prontos, mas o último passo de ativação não foi conectado ou foi desativado em algum momento** (possivelmente por uma tentativa anterior de auto-abertura ter causado instabilidade — o comentário "não tentar abrir Activity por background start" em `showFullScreenOffer` sugere isso foi uma decisão deliberada, não um esquecimento simples). Isso é reforçado pela existência de `RideOfferLaunchReceiver`/`scheduleLaunchAlarm`, um mecanismo de abertura alternativo **completo e não utilizado** — código que só faz sentido existir se alguém já tentou e recuou dessa abordagem antes.

---

## J. Plano de correção

### FASE 1 — Crítico
Nenhum item crítico identificado.

### FASE 2 — Alto
1. **H1**: adicionar `.setFullScreenIntent(contentPi, true)` em `postRichOfferNotification` (`RideOfferNotifier.java`). Testar com tela bloqueada de verdade no aparelho Xiaomi já disponível para esta auditoria.
2. **H3**: adicionar solicitação de acesso a Não Perturbe no onboarding (`DriverOemPermissionsCard.jsx` + novo método no `NativeDriverPermissionsPlugin`).
3. **H2**: lock leve por `offerId` em `RideOfferNotifier` para ignorar chamada duplicada de `showFullScreenOffer` dentro de uma janela curta (poucos segundos).

### FASE 3 — Médio
4. **M2**: separar os nomes dos arquivos de `SharedPreferences` de `NativeDeepLinkStore` e `NativeSessionStore`.
5. **M1**: reavaliação periódica (não permanente) do card de onboarding de permissões.
6. Confirmar em teste real se o PIN/OTP entregue via chat em background chega legível na notificação (`DriverAlertNotifier`).

### FASE 4 — Melhorias
7. Testes de campo prolongados (Doze, tela bloqueada por 30+ min, app removido dos recentes) com corrida real de ponta a ponta, correlacionando logcat (`RideOfferFlow`, `MoveCityFCM`) com os eventos do backend.
8. Revisitar `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM` se o app algum dia for publicado na Play Store.
9. Corrigir o comentário desatualizado em `NativeRideOfferPlugin.java`.

---

## K. Riscos de produção

- **O mais direto:** motoristas com o celular bloqueado (a maioria do tempo, realisticamente) dependem de notar e tocar a notificação a tempo — em mercados competitivos de corrida, atraso de segundos custa a oferta para outro motorista. Este é o mesmo comportamento reportado por você.
- Motoristas com Não Perturbe/Foco ativado (comum durante o sono, entre turnos) podem não perceber a oferta de forma alguma — nem som, nem vibração — mesmo com o código pretendendo o contrário.
- A colisão de `SharedPreferences` (M2) é rara mas pode causar um deep link "sumido" logo após uma atualização do app — sintoma seria "toquei em aceitar mas o app abriu na Home, não na corrida", difícil de reproduzir sob demanda.
- Nenhum dos achados representa risco de segurança de dados, de pagamento, ou de corrupção de estado de corrida — o núcleo transacional (aceite, HTTP nativo, autenticação) está bem protegido.

---

## L. Checklist final — pronto para produção?

- [x] GPS real, sem simulação
- [x] Sessão criptografada em repouso
- [x] `network_security_config` restritivo
- [x] Keystore fora do controle de versão
- [x] Atualização de APK com verificação de integridade
- [x] Permissões corretas declaradas e com timing correto de solicitação
- [x] Foreground Service correto para localização contínua
- [x] Onboarding de permissões por fabricante (Xiaomi e outros)
- [ ] **Full-Screen Intent realmente ativado no caminho de background (H1)** — bloqueador da experiência reportada
- [ ] Deduplicação entre socket e FCM para a mesma oferta (H2)
- [ ] Acesso a Não Perturbe solicitado e efetivo (H3)
- [ ] Teste de campo prolongado validando GPS/push com tela bloqueada por período extenso
- [ ] Confirmação de que PIN/OTP via chat chega legível em notificação de background

Nenhum destes pendentes é crítico o bastante para impedir o uso atual do app — mas H1 é, na prática, exatamente o problema que motivou esta auditoria, e deveria ser o primeiro a ser corrigido.
