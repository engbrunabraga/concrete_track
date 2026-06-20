# 🏗️ ConcreteTrack v2 — Rastreabilidade de Concreto

Sistema completo de rastreabilidade de concreto usinado e feito na obra.

## 📁 Arquivos

| Arquivo | Descrição |
|---|---|
| `server.js` | API REST — Node.js + Express + SQLite |
| `concrete-web.html` | Web App — Dashboard, Traços, Relatório PDF |
| `concrete-mobile.html` | Mobile App — Formulários de campo (PWA) |
| `concrete-shared.css` | Design system compartilhado |
| `package.json` | Dependências |
| `setup.sh` | Script de instalação |

## 🚀 Instalação Rápida

```bash
# 1. Instalar dependências
npm install

# Se houver erro no better-sqlite3 (Linux sem headers):
node-gyp rebuild --nodedir=/usr --directory node_modules/better-sqlite3

# 2. Iniciar API
npm start          # porta 3001

# 3. Popular banco com dados de exemplo
npm run seed

# 4. Abrir no browser
# Web:    concrete-web.html
# Mobile: concrete-mobile.html
```

## ✨ Novidades v2

### 📐 Traços
- CRUD completo de traços de concreto
- Composição detalhada: cimento, água, areia, brita, aditivo
- Relação A/C, resistência 28 dias, norma
- Ativar/desativar (protegido contra exclusão se em uso)
- Vinculação automática ao registro de concreto

### 🏗️ Concreto na Obra
- Flag `concreto_obra` em cada registro
- Campos extras: Responsável Técnico, CREA, Temperatura
- Filtro de origem no relatório e dashboard

### 📄 Relatório PDF
- Filtros: obra, período, status, traço, origem
- Pré-visualização antes de imprimir
- Print nativo do browser → salvar PDF

### 🎨 Design System
- CSS separado em `concrete-shared.css`
- Tokens reutilizáveis (cores, tipografia, componentes)
- Fonte: IBM Plex Sans + IBM Plex Mono

## 📡 API — Novos Endpoints

### Traços
```
GET    /api/tracos              lista (filtros: ativo, fck)
GET    /api/tracos/:id          detalhes + total_usos
POST   /api/tracos              criar
PUT    /api/tracos/:id          atualizar
DELETE /api/tracos/:id          excluir (bloqueado se em uso)
PATCH  /api/tracos/:id/toggle   ativar/desativar
```

### Relatório
```
GET /api/relatorio?obra_id=&data_inicio=&data_fim=&status=&traco_id=&concreto_obra=
```

## 🗄️ Schema — Novidades

```sql
-- Tabela tracos (nova)
tracos: id, codigo, descricao, fck, slump_minimo, slump_maximo, brita,
        cimento_kg_m3, agua_litros_m3, areia_kg_m3, brita_kg_m3,
        aditivo, aditivo_kg_m3, relacao_agua_cimento, resistencia_28d,
        norma, observacoes, ativo

-- caminhoes — novos campos
caminhoes: + traco_id, concreto_obra, responsavel_tecnico, crea, temperatura_c
```

---
*ConcreteTrack v2.0 — NBR 12655*
