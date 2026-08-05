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
EOF
fi

if [ ! -f admin-frontend/.env ]; then
  echo "==> Criando admin-frontend/.env (dev)"
  cat > admin-frontend/.env <<'EOF'
VITE_API_URL=http://localhost:3000/api
EOF
fi

echo "==> Bootstrap concluído."
