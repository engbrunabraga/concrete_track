#!/bin/bash
set -e

echo "🏗️  ConcreteTrack v2 — Setup"
echo "============================="

# Check node
node_ver=$(node -v 2>/dev/null || echo "not found")
echo "Node: $node_ver"

# Install deps
echo ""
echo "📦 Instalando dependências..."
npm install --ignore-scripts

# Build native module (better-sqlite3)
echo ""
echo "🔧 Compilando better-sqlite3..."

# Try to find node headers
if [ -d "/usr/include/node" ]; then
  NODEDIR="/usr"
elif [ -d "/usr/local/include/node" ]; then
  NODEDIR="/usr/local"
else
  NODEDIR=""
fi

if [ -n "$NODEDIR" ]; then
  (cd node_modules/better-sqlite3 && npm_config_nodedir=$NODEDIR node-gyp rebuild 2>/dev/null) \
    && echo "✓ better-sqlite3 compilado" \
    || echo "⚠ Falha ao compilar - tente: npm install (sem --ignore-scripts)"
else
  npm install
fi

echo ""
echo "✅ Setup concluído!"
echo ""
echo "Para iniciar:"
echo "  npm start         # produção"
echo "  npm run dev       # desenvolvimento (hot-reload)"
echo ""
echo "Seed de dados:"
echo "  npm run seed"
echo ""
echo "Abra no browser:"
echo "  concrete-web.html   — Dashboard Web"
echo "  concrete-mobile.html — App Mobile"
