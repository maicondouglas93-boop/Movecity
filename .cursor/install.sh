#!/usr/bin/env bash
# Bootstrap idempotente do ambiente de desenvolvimento do MoveCity (Cloud Agent).
# Roda depois do checkout do repositório. Deve terminar (sem servidores em foreground).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Instalando dependências do Backend"
( cd Backend && npm ci )

echo "==> Instalando dependências do frontend (passageiro/motorista)"
( cd frontend && npm ci )

echo "==> Instalando dependências do admin-frontend (painel)"
( cd admin-frontend && npm ci )

# --- Arquivos .env de desenvolvimento ---------------------------------------
# São gitignored, então não existem no checkout. Criados aqui só se ausentes,
# para não sobrescrever ajustes locais. Todos com valores de DEV apenas.

if [ ! -f Backend/.env ]; then
  echo "==> Criando Backend/.env (dev)"
  cat > Backend/.env <<'EOF'
# Ambiente de desenvolvimento local (Cloud Agent).
# DB_CONNECT deixado em branco de propósito: o backend cai no fallback
# mongodb-memory-server (ver Backend/db/db.js) — nenhum MongoDB externo é necessário.
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173
ADMIN_FRONTEND_URL=http://localhost:5174
JWT_SECRET=dev-secret-movecity-local-only
ADMIN_EMAIL=admin@movecity.com
ADMIN_PASSWORD=admin123456
MAPS_PROVIDER=osm
EOF
fi

if [ ! -f frontend/.env ]; then
  echo "==> Criando frontend/.env (dev)"
  cat > frontend/.env <<'EOF'
VITE_BASE_URL=http://localhost:3000
VITE_MAPS_PROVIDER=leaflet

# Firebase: valores PLACEHOLDER só de dev. firebase.js chama initializeApp()/getAuth()
# no carregamento do módulo, então telas que importam Firebase (login/cadastro) ficam
# em branco se estas variáveis estiverem ausentes. O login com Google de verdade exige
# um projeto Firebase real; com estes valores fictícios só esse recurso opcional fica
# indisponível — o resto do app (incl. login/cadastro por e-mail) funciona normalmente.
VITE_FIREBASE_API_KEY=AIzaSyDummyKeyForLocalDevelopment12345
VITE_FIREBASE_AUTH_DOMAIN=movecity-dev.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=movecity-dev
VITE_FIREBASE_STORAGE_BUCKET=movecity-dev.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abc123def456
VITE_FIREBASE_MEASUREMENT_ID=G-MEASUREMENT123
EOF
fi

if [ ! -f admin-frontend/.env ]; then
  echo "==> Criando admin-frontend/.env (dev)"
  cat > admin-frontend/.env <<'EOF'
VITE_API_URL=http://localhost:3000/api

# Firebase: valores PLACEHOLDER só de dev (mesmo motivo do frontend). Usados apenas
# pelo canal de push do painel; recursos de push exigem um projeto Firebase real.
VITE_FIREBASE_API_KEY=AIzaSyDummyKeyForLocalDevelopment12345
VITE_FIREBASE_AUTH_DOMAIN=movecity-dev.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=movecity-dev
VITE_FIREBASE_STORAGE_BUCKET=movecity-dev.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abc123def456
EOF
fi

echo "==> Bootstrap concluído."
