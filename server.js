/**
 * ConcreteTrack — Backend API v2
 * Node.js + Express + SQLite
 */
const express    = require('express');
const Database   = require('better-sqlite3');
const multer     = require('multer');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const path       = require('path');
const fs         = require('fs');
const { v4: uuidv4 } = require('uuid');

const PORT       = process.env.PORT || 3001;
const DB_PATH    = path.join(__dirname, 'concrete.db');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(__dirname));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS obras (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL, responsavel TEXT, localidade TEXT,
    data_inicio TEXT, data_prev_fim TEXT, total_pecas INTEGER DEFAULT 0,
    status TEXT DEFAULT 'andamento', observacoes TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS fornecedores (
    id TEXT PRIMARY KEY, nome TEXT NOT NULL, cnpj TEXT, telefone TEXT, email TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tracos (
    id TEXT PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, descricao TEXT NOT NULL,
    fck INTEGER NOT NULL, slump_minimo REAL, slump_maximo REAL, brita TEXT,
    cimento_kg_m3 REAL, agua_litros_m3 REAL, areia_kg_m3 REAL, brita_kg_m3 REAL,
    aditivo TEXT, aditivo_kg_m3 REAL, relacao_agua_cimento REAL, resistencia_28d REAL,
    norma TEXT DEFAULT 'NBR 12655', observacoes TEXT, ativo INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS caminhoes (
    id TEXT PRIMARY KEY, obra_id TEXT NOT NULL REFERENCES obras(id),
    fornecedor_id TEXT REFERENCES fornecedores(id), traco_id TEXT REFERENCES tracos(id),
    codigo TEXT UNIQUE, data_registro TEXT NOT NULL, nota_fiscal TEXT, numero_lacre TEXT,
    fck INTEGER, slump_projeto REAL, slump_obtido REAL, tolerancia REAL, volume_m3 REAL,
    hr_saida_usina TEXT, hr_chegada_obra TEXT, hr_inicio_aplic TEXT, hr_fim_aplic TEXT,
    sobrou_concreto INTEGER DEFAULT 0, sobrou_qtd_m3 REAL, concreto_obra INTEGER DEFAULT 0,
    responsavel_tecnico TEXT, crea TEXT, temperatura_c REAL, observacoes TEXT,
    status TEXT DEFAULT 'pendente', aprovado_por TEXT, aprovado_em TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pecas (
    id TEXT PRIMARY KEY, obra_id TEXT NOT NULL REFERENCES obras(id),
    caminhao_id TEXT REFERENCES caminhoes(id), codigo TEXT NOT NULL, tipo TEXT,
    pavimento TEXT, bloco TEXT, nivel TEXT, descricao TEXT, area_m2 REAL,
    status TEXT DEFAULT 'pendente', concretada_em TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS evidencias (
    id TEXT PRIMARY KEY, caminhao_id TEXT NOT NULL REFERENCES caminhoes(id),
    tipo TEXT NOT NULL, filename TEXT NOT NULL, originalname TEXT, mimetype TEXT,
    size_bytes INTEGER, descricao TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS plantas (
    id TEXT PRIMARY KEY, obra_id TEXT NOT NULL REFERENCES obras(id), nome TEXT NOT NULL,
    pavimento TEXT, svg_data TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS marcacoes_planta (
    id TEXT PRIMARY KEY, planta_id TEXT NOT NULL REFERENCES plantas(id),
    peca_id TEXT REFERENCES pecas(id), elemento_id TEXT, cor TEXT DEFAULT '#f5a623',
    status TEXT DEFAULT 'selecionada', saved_at TEXT DEFAULT (datetime('now'))
  );
`);

// Safe column migrations
['traco_id TEXT REFERENCES tracos(id)','concreto_obra INTEGER DEFAULT 0',
 'responsavel_tecnico TEXT','crea TEXT','temperatura_c REAL'].forEach(col => {
  try { db.exec(`ALTER TABLE caminhoes ADD COLUMN ${col}`); } catch {}
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, req.params.caminhaoId || 'misc');
    fs.mkdirSync(dir, { recursive: true }); cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4().slice(0,8)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 10*1024*1024 } });

const ok   = (res, data, s=200) => res.status(s).json({ ok: true, data });
const fail = (res, msg, s=400) => res.status(s).json({ ok: false, error: msg });
const now  = () => new Date().toISOString();

// OBRAS
const obraR = express.Router();
obraR.get('/', (req, res) => {
  const { status, page=1, limit=20, search } = req.query;
  let sql = `SELECT o.*,
    (SELECT COUNT(*) FROM pecas p WHERE p.obra_id=o.id) AS total_pecas_real,
    (SELECT COUNT(*) FROM pecas p WHERE p.obra_id=o.id AND p.status='concretada') AS pecas_concretadas,
    (SELECT COUNT(*) FROM caminhoes c WHERE c.obra_id=o.id) AS total_caminhoes,
    (SELECT COALESCE(SUM(c.volume_m3),0) FROM caminhoes c WHERE c.obra_id=o.id) AS volume_total_m3
    FROM obras o WHERE 1=1`;
  const p = {};
  if (status) { sql += ' AND o.status=:status'; p.status=status; }
  if (search)  { sql += ' AND (o.nome LIKE :s OR o.localidade LIKE :s)'; p.s=`%${search}%`; }
  sql += ' ORDER BY o.created_at DESC LIMIT :limit OFFSET :offset';
  const rows = db.prepare(sql).all({ ...p, limit: +limit, offset: (+page-1)*(+limit) });
  ok(res, { rows, page: +page, limit: +limit });
});
obraR.get('/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM obras WHERE id=?').get(req.params.id);
  if (!o) return fail(res,'Obra não encontrada',404);
  const stats = db.prepare(`SELECT COUNT(c.id) as total_caminhoes, SUM(c.volume_m3) as volume_total_m3,
    SUM(CASE WHEN c.status='aprovado' THEN 1 ELSE 0 END) as aprovados,
    SUM(CASE WHEN c.status='pendente' THEN 1 ELSE 0 END) as pendentes,
    SUM(CASE WHEN c.status='reprovado' THEN 1 ELSE 0 END) as reprovados
    FROM caminhoes c WHERE c.obra_id=?`).get(req.params.id);
  ok(res, { ...o, stats });
});
obraR.post('/', (req, res) => {
  const { nome, responsavel, localidade, data_inicio, data_prev_fim, total_pecas, status, observacoes } = req.body;
  if (!nome) return fail(res,'"nome" obrigatório');
  const id = uuidv4();
  db.prepare(`INSERT INTO obras (id,nome,responsavel,localidade,data_inicio,data_prev_fim,total_pecas,status,observacoes)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id,nome,responsavel,localidade,data_inicio,data_prev_fim,total_pecas||0,status||'andamento',observacoes);
  ok(res, { id }, 201);
});
obraR.put('/:id', (req, res) => {
  const f=['nome','responsavel','localidade','data_inicio','data_prev_fim','total_pecas','status','observacoes'];
  db.prepare(`UPDATE obras SET ${f.map(x=>x+'=?').join(',')}, updated_at=? WHERE id=?`)
    .run(...f.map(x=>req.body[x]??null), now(), req.params.id);
  ok(res,{updated:true});
});
obraR.patch('/:id/status', (req, res) => {
  if (!['andamento','pausada','concluida'].includes(req.body.status)) return fail(res,'Status inválido');
  db.prepare('UPDATE obras SET status=?, updated_at=? WHERE id=?').run(req.body.status,now(),req.params.id);
  ok(res,{updated:true});
});
obraR.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM obras WHERE id=?').run(req.params.id); ok(res,{deleted:true});
});
app.use('/api/obras', obraR);

// TRAÇOS
const tracoR = express.Router();
tracoR.get('/', (req, res) => {
  let sql='SELECT * FROM tracos WHERE 1=1'; const p=[];
  if (req.query.ativo!==undefined) { sql+=' AND ativo=?'; p.push(+req.query.ativo); }
  if (req.query.fck) { sql+=' AND fck=?'; p.push(+req.query.fck); }
  ok(res, db.prepare(sql+' ORDER BY codigo').all(...p));
});
tracoR.get('/:id', (req, res) => {
  const t=db.prepare('SELECT * FROM tracos WHERE id=?').get(req.params.id);
  if (!t) return fail(res,'Traço não encontrado',404);
  ok(res, { ...t, total_usos: db.prepare('SELECT COUNT(*) as n FROM caminhoes WHERE traco_id=?').get(req.params.id).n });
});
tracoR.post('/', (req, res) => {
  const { codigo,descricao,fck,slump_minimo,slump_maximo,brita,cimento_kg_m3,agua_litros_m3,
    areia_kg_m3,brita_kg_m3,aditivo,aditivo_kg_m3,relacao_agua_cimento,resistencia_28d,norma,observacoes } = req.body;
  if (!codigo||!descricao||!fck) return fail(res,'"codigo", "descricao" e "fck" obrigatórios');
  const id=uuidv4();
  db.prepare(`INSERT INTO tracos (id,codigo,descricao,fck,slump_minimo,slump_maximo,brita,
    cimento_kg_m3,agua_litros_m3,areia_kg_m3,brita_kg_m3,aditivo,aditivo_kg_m3,
    relacao_agua_cimento,resistencia_28d,norma,observacoes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,codigo,descricao,fck,slump_minimo||null,slump_maximo||null,brita||null,
      cimento_kg_m3||null,agua_litros_m3||null,areia_kg_m3||null,brita_kg_m3||null,
      aditivo||null,aditivo_kg_m3||null,relacao_agua_cimento||null,resistencia_28d||null,
      norma||'NBR 12655',observacoes||null);
  ok(res,{id},201);
});
tracoR.put('/:id', (req, res) => {
  const f=['codigo','descricao','fck','slump_minimo','slump_maximo','brita','cimento_kg_m3',
    'agua_litros_m3','areia_kg_m3','brita_kg_m3','aditivo','aditivo_kg_m3',
    'relacao_agua_cimento','resistencia_28d','norma','observacoes','ativo'];
  db.prepare(`UPDATE tracos SET ${f.map(x=>x+'=?').join(',')}, updated_at=? WHERE id=?`)
    .run(...f.map(x=>req.body[x]??null), now(), req.params.id);
  ok(res,{updated:true});
});
tracoR.delete('/:id', (req, res) => {
  const uso=db.prepare('SELECT COUNT(*) as n FROM caminhoes WHERE traco_id=?').get(req.params.id);
  if (uso.n>0) return fail(res,`Traço em uso por ${uso.n} registro(s). Desative ao invés de excluir.`);
  db.prepare('DELETE FROM tracos WHERE id=?').run(req.params.id); ok(res,{deleted:true});
});
tracoR.patch('/:id/toggle', (req, res) => {
  const t=db.prepare('SELECT ativo FROM tracos WHERE id=?').get(req.params.id);
  if (!t) return fail(res,'Traço não encontrado',404);
  db.prepare('UPDATE tracos SET ativo=?, updated_at=? WHERE id=?').run(t.ativo?0:1, now(), req.params.id);
  ok(res,{ativo:!t.ativo});
});
app.use('/api/tracos', tracoR);

// CAMINHÕES
const camR = express.Router();
camR.get('/', (req, res) => {
  const { obra_id, status, page=1, limit=20 } = req.query;
  let sql=`SELECT c.*,o.nome as obra_nome,t.codigo as traco_codigo,t.descricao as traco_descricao,
    (SELECT COUNT(*) FROM evidencias e WHERE e.caminhao_id=c.id) as total_evidencias,
    (SELECT COUNT(*) FROM pecas p WHERE p.caminhao_id=c.id) as total_pecas
    FROM caminhoes c LEFT JOIN obras o ON o.id=c.obra_id LEFT JOIN tracos t ON t.id=c.traco_id WHERE 1=1`;
  const p={};
  if (obra_id){sql+=' AND c.obra_id=:obra_id';p.obra_id=obra_id;}
  if (status) {sql+=' AND c.status=:status';p.status=status;}
  sql+=' ORDER BY c.created_at DESC LIMIT :limit OFFSET :offset';
  const rows=db.prepare(sql).all({...p,limit:+limit,offset:(+page-1)*(+limit)});
  ok(res,{rows,page:+page,limit:+limit});
});
camR.get('/:id', (req, res) => {
  const c=db.prepare(`SELECT c.*,t.codigo as traco_codigo,t.descricao as traco_descricao,
    t.cimento_kg_m3,t.agua_litros_m3,t.areia_kg_m3,t.brita_kg_m3
    FROM caminhoes c LEFT JOIN tracos t ON t.id=c.traco_id WHERE c.id=?`).get(req.params.id);
  if (!c) return fail(res,'Não encontrado',404);
  ok(res,{...c,
    pecas:db.prepare('SELECT * FROM pecas WHERE caminhao_id=?').all(req.params.id),
    evidencias:db.prepare('SELECT * FROM evidencias WHERE caminhao_id=?').all(req.params.id)
  });
});
camR.post('/', (req, res) => {
  const { obra_id,fornecedor_id,traco_id,codigo,data_registro,nota_fiscal,numero_lacre,
    fck,slump_projeto,slump_obtido,tolerancia,volume_m3,hr_saida_usina,hr_chegada_obra,
    hr_inicio_aplic,hr_fim_aplic,sobrou_concreto,sobrou_qtd_m3,concreto_obra,
    responsavel_tecnico,crea,temperatura_c,observacoes } = req.body;
  if (!obra_id||!data_registro) return fail(res,'"obra_id" e "data_registro" obrigatórios');
  const id=uuidv4();
  const cd=codigo||`CAM-${new Date().getFullYear()}-${String(db.prepare('SELECT COUNT(*)+1 AS n FROM caminhoes').get().n).padStart(3,'0')}`;
  db.prepare(`INSERT INTO caminhoes (id,obra_id,fornecedor_id,traco_id,codigo,data_registro,nota_fiscal,numero_lacre,
    fck,slump_projeto,slump_obtido,tolerancia,volume_m3,hr_saida_usina,hr_chegada_obra,hr_inicio_aplic,hr_fim_aplic,
    sobrou_concreto,sobrou_qtd_m3,concreto_obra,responsavel_tecnico,crea,temperatura_c,observacoes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,obra_id,fornecedor_id||null,traco_id||null,cd,data_registro,nota_fiscal,numero_lacre,
      fck,slump_projeto,slump_obtido,tolerancia,volume_m3,hr_saida_usina,hr_chegada_obra,hr_inicio_aplic,hr_fim_aplic,
      sobrou_concreto?1:0,sobrou_qtd_m3||null,concreto_obra?1:0,
      responsavel_tecnico||null,crea||null,temperatura_c||null,observacoes||null);
  ok(res,{id,codigo:cd},201);
});
camR.put('/:id', (req, res) => {
  const f=['obra_id','fornecedor_id','traco_id','codigo','data_registro','nota_fiscal','numero_lacre',
    'fck','slump_projeto','slump_obtido','tolerancia','volume_m3','hr_saida_usina','hr_chegada_obra',
    'hr_inicio_aplic','hr_fim_aplic','sobrou_concreto','sobrou_qtd_m3','concreto_obra',
    'responsavel_tecnico','crea','temperatura_c','observacoes'];
  db.prepare(`UPDATE caminhoes SET ${f.map(x=>x+'=?').join(',')}, updated_at=? WHERE id=?`)
    .run(...f.map(x=>req.body[x]??null), now(), req.params.id);
  ok(res,{updated:true});
});
camR.patch('/:id/aprovacao', (req, res) => {
  const { status, aprovado_por } = req.body;
  if (!['aprovado','reprovado','pendente'].includes(status)) return fail(res,'Status inválido');
  db.prepare('UPDATE caminhoes SET status=?,aprovado_por=?,aprovado_em=?,updated_at=? WHERE id=?')
    .run(status,aprovado_por||null,now(),now(),req.params.id);
  ok(res,{updated:true});
});
app.use('/api/caminhoes', camR);

// PEÇAS
const pecaR = express.Router();
pecaR.get('/', (req, res) => {
  let sql='SELECT * FROM pecas WHERE 1=1'; const p=[];
  if(req.query.obra_id){sql+=' AND obra_id=?';p.push(req.query.obra_id);}
  if(req.query.caminhao_id){sql+=' AND caminhao_id=?';p.push(req.query.caminhao_id);}
  if(req.query.status){sql+=' AND status=?';p.push(req.query.status);}
  if(req.query.tipo){sql+=' AND tipo=?';p.push(req.query.tipo);}
  ok(res,db.prepare(sql+' ORDER BY created_at DESC').all(...p));
});
pecaR.post('/', (req, res) => {
  const { obra_id, caminhao_id, pecas } = req.body;
  if (!obra_id||!Array.isArray(pecas)) return fail(res,'Dados inválidos');
  const ins=db.prepare(`INSERT INTO pecas (id,obra_id,caminhao_id,codigo,tipo,pavimento,bloco,nivel,descricao,area_m2,status,concretada_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ids=db.transaction(list=>list.map(p=>{
    const id=uuidv4();
    ins.run(id,obra_id,caminhao_id||null,p.codigo,p.tipo||'outro',p.pavimento,p.bloco,p.nivel,p.descricao,p.area_m2||null,p.status||'concretada',p.concretada_em||now());
    return id;
  }))(pecas);
  ok(res,{ids,count:ids.length},201);
});
pecaR.patch('/:id/status', (req, res) => {
  db.prepare('UPDATE pecas SET status=? WHERE id=?').run(req.body.status,req.params.id);
  ok(res,{updated:true});
});
app.use('/api/pecas', pecaR);

// EVIDÊNCIAS
const evidR = express.Router({ mergeParams: true });
evidR.get('/', (req, res) => {
  ok(res, db.prepare('SELECT * FROM evidencias WHERE caminhao_id=? ORDER BY created_at DESC').all(req.params.caminhaoId)
    .map(r=>({...r,url:`/uploads/${req.params.caminhaoId}/${r.filename}`})));
});
evidR.post('/', upload.array('files',20), (req, res) => {
  const { caminhaoId } = req.params;
  if (!req.files?.length) return fail(res,'Nenhum arquivo recebido');
  const ins=db.prepare(`INSERT INTO evidencias (id,caminhao_id,tipo,filename,originalname,mimetype,size_bytes,descricao) VALUES (?,?,?,?,?,?,?,?)`);
  const ids=db.transaction(files=>files.map(f=>{
    const id=uuidv4();
    ins.run(id,caminhaoId,req.body.tipo||'foto_obra',f.filename,f.originalname,f.mimetype,f.size,req.body.descricao||null);
    return {id,url:`/uploads/${caminhaoId}/${f.filename}`,originalname:f.originalname};
  }))(req.files);
  ok(res,{uploaded:ids,count:ids.length},201);
});
evidR.delete('/:id', (req, res) => {
  const ev=db.prepare('SELECT * FROM evidencias WHERE id=? AND caminhao_id=?').get(req.params.id,req.params.caminhaoId);
  if (!ev) return fail(res,'Evidência não encontrada',404);
  const fp=path.join(UPLOAD_DIR,req.params.caminhaoId,ev.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('DELETE FROM evidencias WHERE id=?').run(req.params.id);
  ok(res,{deleted:true});
});
app.use('/api/caminhoes/:caminhaoId/evidencias', evidR);

// PLANTAS
const plantaR = express.Router();
plantaR.get('/', (req,res)=>ok(res,db.prepare('SELECT * FROM plantas WHERE obra_id=? ORDER BY created_at').all(req.query.obra_id||'')));
plantaR.post('/', (req,res)=>{
  const {obra_id,nome,pavimento,svg_data}=req.body;
  const id=uuidv4();
  db.prepare('INSERT INTO plantas (id,obra_id,nome,pavimento,svg_data) VALUES (?,?,?,?,?)').run(id,obra_id,nome,pavimento,svg_data||null);
  ok(res,{id},201);
});
plantaR.put('/:id/svg', (req,res)=>{
  db.prepare('UPDATE plantas SET svg_data=? WHERE id=?').run(req.body.svg_data,req.params.id);
  ok(res,{updated:true});
});
plantaR.get('/:id/marcacoes', (req,res)=>ok(res,db.prepare('SELECT * FROM marcacoes_planta WHERE planta_id=?').all(req.params.id)));
plantaR.post('/:id/marcacoes', (req,res)=>{
  const {peca_id,elemento_id,cor,status}=req.body;
  const id=uuidv4();
  db.prepare('INSERT INTO marcacoes_planta (id,planta_id,peca_id,elemento_id,cor,status) VALUES (?,?,?,?,?,?)')
    .run(id,req.params.id,peca_id||null,elemento_id,cor||'#f5a623',status||'selecionada');
  ok(res,{id},201);
});
app.use('/api/plantas', plantaR);

// FORNECEDORES
app.get('/api/fornecedores',(req,res)=>ok(res,db.prepare('SELECT * FROM fornecedores ORDER BY nome').all()));
app.post('/api/fornecedores',(req,res)=>{
  const {nome,cnpj,telefone,email}=req.body;
  const id=uuidv4();
  db.prepare('INSERT INTO fornecedores (id,nome,cnpj,telefone,email) VALUES (?,?,?,?,?)').run(id,nome,cnpj,telefone,email);
  ok(res,{id},201);
});

// RELATÓRIO
app.get('/api/relatorio', (req, res) => {
  const { obra_id, data_inicio, data_fim, status, traco_id, concreto_obra } = req.query;
  let where='WHERE 1=1'; const p=[];
  if (obra_id)     { where+=' AND c.obra_id=?';        p.push(obra_id); }
  if (data_inicio) { where+=' AND c.data_registro>=?'; p.push(data_inicio); }
  if (data_fim)    { where+=' AND c.data_registro<=?'; p.push(data_fim); }
  if (status)      { where+=' AND c.status=?';         p.push(status); }
  if (traco_id)    { where+=' AND c.traco_id=?';       p.push(traco_id); }
  if (concreto_obra!==undefined&&concreto_obra!=='') { where+=' AND c.concreto_obra=?'; p.push(+concreto_obra); }

  const caminhoes=db.prepare(`SELECT c.*,
    o.nome as obra_nome, o.responsavel as obra_responsavel, o.localidade,
    f.nome as fornecedor_nome, f.cnpj as fornecedor_cnpj,
    t.codigo as traco_codigo, t.descricao as traco_descricao,
    t.cimento_kg_m3, t.agua_litros_m3, t.areia_kg_m3, t.brita_kg_m3,
    (SELECT COUNT(*) FROM pecas pe WHERE pe.caminhao_id=c.id) as total_pecas
    FROM caminhoes c
    LEFT JOIN obras o ON o.id=c.obra_id
    LEFT JOIN fornecedores f ON f.id=c.fornecedor_id
    LEFT JOIN tracos t ON t.id=c.traco_id
    ${where} ORDER BY c.data_registro DESC`).all(...p);

  const totais={
    registros:caminhoes.length,
    volume_total:caminhoes.reduce((s,c)=>s+(c.volume_m3||0),0),
    aprovados:caminhoes.filter(c=>c.status==='aprovado').length,
    reprovados:caminhoes.filter(c=>c.status==='reprovado').length,
    pendentes:caminhoes.filter(c=>c.status==='pendente').length,
    concreto_obra_qtd:caminhoes.filter(c=>c.concreto_obra).length,
    concreto_usinado:caminhoes.filter(c=>!c.concreto_obra).length,
  };

  const obra_info=obra_id?db.prepare('SELECT nome,responsavel,localidade FROM obras WHERE id=?').get(obra_id):null;
  ok(res,{ caminhoes, totais, obra_info, filtros:req.query, gerado_em:now() });
});

// DASHBOARD
app.get('/api/dashboard', (req, res) => {
  const { obra_id } = req.query;
  const w=obra_id?`WHERE obra_id='${obra_id}'`:'';
  ok(res,{
    totalObras:    db.prepare('SELECT COUNT(*) as n FROM obras').get().n,
    obrasAndamento:db.prepare("SELECT COUNT(*) as n FROM obras WHERE status='andamento'").get().n,
    totalCaminhoes:db.prepare(`SELECT COUNT(*) as n FROM caminhoes ${w}`).get().n,
    totalVolume:   db.prepare(`SELECT COALESCE(SUM(volume_m3),0) as v FROM caminhoes ${w}`).get().v,
    totalTracos:   db.prepare('SELECT COUNT(*) as n FROM tracos WHERE ativo=1').get().n,
    camPoMes:db.prepare(`SELECT strftime('%Y-%m',data_registro) as mes,COUNT(*) as total,SUM(volume_m3) as volume FROM caminhoes ${w} GROUP BY mes ORDER BY mes DESC LIMIT 12`).all(),
    aprovacoes:db.prepare(`SELECT status,COUNT(*) as total FROM caminhoes ${w} GROUP BY status`).all(),
    pecasPorStatus:db.prepare(`SELECT status,COUNT(*) as total FROM pecas ${w.replace('obra_id','pecas.obra_id')} GROUP BY status`).all(),
    concreto_origem:db.prepare(`SELECT CASE WHEN concreto_obra=1 THEN 'Na Obra' ELSE 'Usinado' END as origem,COUNT(*) as total FROM caminhoes ${w} GROUP BY concreto_obra`).all(),
  });
});

app.get('/api/health', (req,res)=>ok(res,{status:'ok',ts:now(),version:'2.0'}));

app.post('/api/seed', (req, res) => {
  if (db.prepare('SELECT COUNT(*) as n FROM obras').get().n>0) return ok(res,{msg:'Banco já possui dados'});
  const obraId=uuidv4();
  db.prepare(`INSERT INTO obras (id,nome,responsavel,localidade,data_inicio,total_pecas,status) VALUES (?,?,?,?,?,?,?)`)
    .run(obraId,'Residencial Montserrat','João Silva','Belo Horizonte, MG','2024-03-01',563,'andamento');
  const fornId=uuidv4();
  db.prepare(`INSERT INTO fornecedores (id,nome,cnpj) VALUES (?,?,?)`)
    .run(fornId,'Concreto BH Ltda','12.345.678/0001-99');
  const t1=uuidv4(),t2=uuidv4(),t3=uuidv4();
  db.prepare(`INSERT INTO tracos (id,codigo,descricao,fck,slump_minimo,slump_maximo,brita,cimento_kg_m3,agua_litros_m3,areia_kg_m3,brita_kg_m3,relacao_agua_cimento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(t1,'T-001','Concreto Estrutural C25',25,8,12,'Brita 1',380,190,780,1000,0.50);
  db.prepare(`INSERT INTO tracos (id,codigo,descricao,fck,slump_minimo,slump_maximo,brita,cimento_kg_m3,agua_litros_m3,areia_kg_m3,brita_kg_m3,relacao_agua_cimento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(t2,'T-002','Concreto Estrutural C30',30,10,14,'Brita 1',420,180,750,990,0.43);
  db.prepare(`INSERT INTO tracos (id,codigo,descricao,fck,slump_minimo,slump_maximo,brita,cimento_kg_m3,agua_litros_m3,areia_kg_m3,brita_kg_m3,relacao_agua_cimento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(t3,'T-003','Concreto Magro C15',15,6,10,'Brita 1',280,200,820,1020,0.71);
  const camId=uuidv4();
  db.prepare(`INSERT INTO caminhoes (id,obra_id,fornecedor_id,traco_id,codigo,data_registro,nota_fiscal,numero_lacre,fck,slump_projeto,slump_obtido,tolerancia,volume_m3,hr_saida_usina,hr_chegada_obra,hr_inicio_aplic,hr_fim_aplic,status,concreto_obra)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(camId,obraId,fornId,t1,'CAM-2024-001','2024-11-26','NF-001234','LC-0001',25,10,10.5,2,4.5,'07:30','08:15','08:30','10:45','aprovado',0);
  db.prepare(`INSERT INTO pecas (id,obra_id,caminhao_id,codigo,tipo,pavimento,status,concretada_em) VALUES (?,?,?,?,?,?,?,?)`)
    .run(uuidv4(),obraId,camId,'P-A1','pilar','Térreo','concretada',now());
  ok(res,{msg:'Seed OK!',obraId,camId,tracos:[t1,t2,t3]});
});

app.use((err,req,res,next)=>{
  console.error(err);
  if (err.code==='LIMIT_FILE_SIZE') return fail(res,'Arquivo muito grande (máx 10MB)',413);
  fail(res,err.message||'Erro interno',500);
});
app.use((req,res)=>fail(res,'Rota não encontrada',404));

app.listen(PORT,()=>{
  console.log(`\n🏗️  ConcreteTrack API v2 → http://localhost:${PORT}`);
  console.log(`   /api/obras  /api/tracos  /api/caminhoes  /api/relatorio  /api/dashboard\n`);
});
module.exports = app;
