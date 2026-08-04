# Capacitor (motorista) — próximos passos

Este frontend já tem um build separado do motorista. **Não instale Capacitor até o `build:driver` estar estável no navegador.**

## Builds

| Comando | Saída | Conteúdo |
|---------|--------|----------|
| `npm run build` | `dist/` | App web completo (Start + passageiro + motorista + PWA) |
| `npm run build:driver` | `dist-driver/` | Só motorista (`driver.html` → `main.driver.jsx`) |
| `npm run dev:driver` | — | Dev server abrindo `/driver.html` |

## Quando for empacotar

1. `npm run build:driver`
2. Instalar Capacitor (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, …)
3. `npx cap init` com `webDir` apontando para `dist-driver`  
   (`build:driver` gera `driver.html` e também `index.html` para o Capacitor)
4. `npx cap add android` / sync

Fluxo: `dist-driver/` → Capacitor → Android.

O app web em `dist/` continua independente (PWA inclusa).

## Fora do escopo atual

- Pacotes Capacitor / pastas `android/` / `ios/`
- Push nativo (`@capacitor/push-notifications`)
- Mudanças em GPS, Socket.IO, auth ou backend
