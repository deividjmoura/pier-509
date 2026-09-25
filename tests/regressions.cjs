require('dotenv').config();
/* Nenhum teste conecta ao banco de verdade; o valor só evita o exit(1)
   do pool.js na importação dos módulos db/*. */
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://regress:regress@127.0.0.1:5432/regress';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const { eventAccess } = require('../db/event-access');
const { subscribe, broadcast, clientCount } = require('../db/events');
const { validarDestinoRemoto } = require('../db/foto');
const { verificarOrigemRequisicao } = require('../db/auth');
const { ErroValidacao, numeroFinito, numeroInteiroPositivo } = require('../db/validacao');
const { getOuAbrirSessao, getProdutoComRegras } = require('../db/queries');
const { ErroGarcom, removerGarcom, setGarcomAtivo, entregarComoGarcom } = require('../db/garcons');
const { ErroPedido, setStatusPedido, setStatusItem } = require('../db/pedidos');

/* Marcas da versão anterior montadas em pedaços de propósito: o literal não
   pode existir em nenhum arquivo do repositório, nem no próprio teste. */
const MARCA_ANTIGA = new RegExp(
  ['qr' + 'admin', 'major' + ' ?pub', 'lanchonete' + '-qr'].join('|'),
  'i'
);

/* Mock mínimo de <html> que espelha o DOM real:
   dataset ↔ data-theme ficam sincronizados com getAttribute/setAttribute. */
function criarRoot() {
  const classes = new Set();
  return {
    _attrs: {},
    style: { values: {}, setProperty(k, v) { this.values[k] = v; } },
    get dataset() { return { theme: this._attrs['data-theme'] }; },
    set dataset(v) { this._attrs['data-theme'] = v.theme; },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
    },
  };
}

/* O boot do tema mora em public/tema-inicial.js (arquivo externo — a CSP de
   produção não permite <script> inline). Este helper roda esse arquivo. */
function boot({ blocked = false, dark = false, saved = null } = {}) {
  const root = criarRoot();
  const meta = {};
  const context = {
    document: {
      documentElement: root,
      querySelector: () => ({ setAttribute: (k, v) => { meta[k] = v; } }),
    },
    window: { matchMedia: () => ({ matches: dark }) },
    localStorage: {
      getItem: () => { if (blocked) throw Error('Blocked'); return saved; },
      setItem: () => { if (blocked) throw Error('Blocked'); },
      removeItem: () => { if (blocked) throw Error('Blocked'); },
    },
  };
  vm.runInNewContext(fs.readFileSync('public/tema-inicial.js', 'utf8'), context);
  return { root, meta };
}

function theme({ blocked = false, dark = false, saved = null } = {}) {
  const root = criarRoot();
  const meta = {};
  const context = {
    exports: {},
    document: { documentElement: root, querySelector: () => ({ setAttribute: (k, v) => meta[k] = v }) },
    window: { matchMedia: () => ({ matches: dark }), dispatchEvent: () => {} },
    localStorage: {
      getItem: () => { if (blocked) throw Error('Blocked'); return saved; },
      setItem: (_, v) => { if (blocked) throw Error('Blocked'); saved = v; },
    },
    CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data.detail; } },
  };
  const code = ts.transpileModule(fs.readFileSync('src/lib/tema.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, context);
  return { ...context.exports, root, meta, saved: () => saved };
}

test('tema alterna repetidamente mesmo com armazenamento bloqueado', () => {
  const t = theme({ blocked: true });
  t.aplicarTema(t.temaAtual());
  for (const expected of ['escuro', 'claro', 'escuro', 'claro']) {
    t.alternarTema();
    assert.equal(t.root.dataset.theme, expected);
    assert.equal(t.temaAtual(), expected);
  }
});
test('tema respeita sistema sem armazenamento e preferência salva', () => {
  assert.equal(theme({ blocked: true, dark: true }).temaAtual(), 'escuro');
  assert.equal(theme({ saved: 'claro', dark: true }).temaAtual(), 'claro');
  const t = theme();
  t.aplicarTema('escuro');
  assert.equal(t.saved(), 'escuro');
  assert.equal(t.meta.content, '#060f1d');
  assert.equal(theme({ saved: t.saved() }).temaAtual(), 'escuro');
});
test('tema claro usa superfície suave e não branco agressivo', () => {
  const t = theme();
  t.aplicarTema('claro');
  assert.equal(t.root.style.values['--p509-page'], '#e9dcc0');
  assert.equal(t.root.style.values['--p509-white'], '#f8f1de');
  assert.equal(t.meta.content, '#e9dcc0');
});
test('inicialização antes do React respeita sistema com armazenamento bloqueado', () => {
  const { root } = boot({ blocked: true, dark: true });
  assert.equal(root.dataset.theme, 'escuro');
  assert.equal(root.classList.contains('dark'), true);
  assert.equal(root.style.values['--p509-page'], '#060f1d');
});
test('inicialização antes do React aplica o tema claro sem flash branco agressivo', () => {
  const { root, meta } = boot({ saved: 'claro', dark: true });
  assert.equal(root.dataset.theme, 'claro');
  assert.equal(root.style.values['--p509-page'], '#e9dcc0');
  assert.equal(root.style.values['--p509-white'], '#f8f1de');
  assert.equal(meta.content, '#e9dcc0');
});

test('boot do tema é script externo — a CSP não permite inline', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<script src="\/tema-inicial\.js"[^>]*><\/script>/, 'index.html precisa carregar /tema-inicial.js');
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(html), false, 'nenhum <script> inline em index.html');
});

test('QR do PIX tem papel branco (leitor precisa de contraste e zona de silêncio)', () => {
  const css = fs.readFileSync('src/index.css', 'utf8');
  const papel = css.match(/\.papel-qr\s*\{([^}]*)\}/);
  assert.ok(papel, '.papel-qr precisa existir em src/index.css');
  assert.match(papel[1], /background:\s*#fff/i, 'fundo do papel do QR tem que ser branco');
  for (const tela of ['src/screens/Caixa.tsx', 'src/screens/Admin.tsx']) {
    const texto = fs.readFileSync(tela, 'utf8');
    assert.match(texto, /QRCodeSVG/, `${tela} deveria renderizar QR`);
    assert.match(texto, /papel-qr/, `${tela} precisa envolver o QR em .papel-qr`);
    assert.equal(/qr-paper/.test(texto), false, `${tela} ainda usa a classe antiga qr-paper`);
  }
});

test('nenhum resquício da marca antiga no que o cliente vê', () => {
  const alvos = ['index.html', 'public/tema-inicial.js', 'public/site.webmanifest', 'package.json'];
  for (const f of alvos) {
    const texto = fs.readFileSync(f, 'utf8');
    assert.equal(MARCA_ANTIGA.test(texto), false, `resquício de marca em ${f}`);
  }
});
test('tema normaliza valores legados light/dark de builds anteriores', () => {
  assert.equal(theme({ saved: 'dark', dark: false }).temaAtual(), 'escuro');
  assert.equal(theme({ saved: 'light', dark: true }).temaAtual(), 'claro');
  const t = theme();
  t.aplicarTema('escuro');
  assert.equal(t.root.dataset.theme, 'escuro');
  assert.equal(t.root.classList.contains('dark'), true);
  t.aplicarTema('claro');
  assert.equal(t.root.dataset.theme, 'claro');
  assert.equal(t.root.classList.contains('dark'), false);
});
test('SSE exige token existente ou staff e rejeita garçom inativo', async () => {
  const token = '12345678-1234-4234-8234-123456789abc';
  const deps = { staff: null, findMesa: async () => null, findGarcom: async () => null };
  assert.equal(await eventAccess(new URLSearchParams(), deps), null);
  assert.equal(await eventAccess(new URLSearchParams({ mesa: token }), deps), null);
  assert.equal(await eventAccess(new URLSearchParams({ mesa: token }), { ...deps, findMesa: async () => ({ id: 1 }) }), 'public');
  assert.equal(await eventAccess(new URLSearchParams({ garcom: token }), { ...deps, findGarcom: async () => ({ ativo: false }) }), null);
  assert.equal(await eventAccess(new URLSearchParams({ garcom: token }), { ...deps, findGarcom: async () => ({ ativo: true }) }), 'public');
  assert.equal(await eventAccess(new URLSearchParams(), { ...deps, staff: { id: 1 } }), 'staff');
});
test('SSE público não divulga nome, token ou pagamento de outra mesa', () => {
  const staff = new EventEmitter(); const publicRes = new EventEmitter();
  let staffData = ''; let publicData = '';
  staff.write = s => staffData += s; publicRes.write = s => publicData += s;
  subscribe(staff); subscribe(publicRes, { publicClient: true });
  broadcast('update', { clienteNome: 'Privado', mesaToken: 'segredo', valor: 20 });
  assert.match(staffData, /Privado/);
  assert.equal(publicData, 'event: update\ndata: {}\n\n');
  staff.emit('close'); publicRes.emit('close');
  assert.equal(clientCount(), 0);
});
test('cliente SSE envia token e encerra conexão no cleanup', () => {
  let url; let closed = false;
  const context = { exports: {}, URLSearchParams, setTimeout, clearTimeout, EventSource: class {
    constructor(value) { url = value; } addEventListener() {} close() { closed = true; }
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/api.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  const stop = context.exports.connectEvents(() => {}, { mesa: 'a&b' });
  assert.equal(url, '/api/events?mesa=a%26b'); stop(); assert.equal(closed, true);
  context.exports.connectEvents(() => {}, { garcom: 'abc' })();
  assert.equal(url, '/api/events?garcom=abc');
  context.exports.connectEvents(() => {})(); assert.equal(url, '/api/events');
});

test('upload de foto rejeita destinos SSRF locais', async () => {
  await assert.rejects(() => validarDestinoRemoto('http://127.0.0.1/segredo'), /Destino de rede não permitido/);
  await assert.rejects(() => validarDestinoRemoto('http://10.0.0.1/segredo'), /Destino de rede não permitido/);
  await assert.rejects(() => validarDestinoRemoto('file:///etc/passwd'), /http:\/\/ ou https:\/\//);
});

/* A reescrita de db/foto.js (sharp lazy) quase levou embora estas defesas. Elas
   voltaram e ficam travadas aqui, porque o padrão de "aparece corrigido, some no
   próximo refactor" já aconteceu três vezes neste repo. */
test('SSRF: IPv6 reservado e IPv4 mapeado não passam', async () => {
  for (const alvo of [
    'http://[::1]/x', 'http://[fc00::1]/x', 'http://[fd12:3456::1]/x',
    'http://[fe80::1]/x', 'http://[ff02::1]/x', 'http://[::ffff:127.0.0.1]/x',
    'http://[::]/x',
  ]) {
    await assert.rejects(() => validarDestinoRemoto(alvo), /rede não permitido|URL de imagem inválida/, alvo);
  }
});

test('SSRF: alcance IPv4 reservados além do básico', async () => {
  for (const alvo of [
    'http://169.254.169.254/latest/meta-data/', 'http://192.0.2.1/x', 'http://198.18.0.1/x',
    'http://100.64.0.1/x', 'http://0.0.0.0/x', 'http://224.0.0.1/x',
  ]) {
    await assert.rejects(() => validarDestinoRemoto(alvo), /rede não permitido/, alvo);
  }
});

test('SSRF: credencial embutida na URL é rejeitada', async () => {
  await assert.rejects(() => validarDestinoRemoto('http://admin:segredo@10.0.0.9/foto.png'), /URL de imagem inválida/);
  await assert.rejects(() => validarDestinoRemoto('http://user@127.0.0.1/foto.png'), /URL de imagem inválida|rede não permitido/);
});

test('upload aceita o corpo { data } / { url } que o server.js envia', async () => {
  // Regressão da reescrita: processarUploadFoto passou a aceitar só string/Buffer
  // e o endpoint manda o objeto do body → todo upload do admin daria 400.
  const { processarUploadFoto } = require('../db/foto');
  await assert.rejects(() => processarUploadFoto({ url: 'http://127.0.0.1/interno.png' }), /Destino de rede não permitido/);
  await assert.rejects(() => processarUploadFoto({}), /Envie data-URL base64, Buffer ou URL https/);
  await assert.rejects(() => processarUploadFoto({ data: 'data:image/png;base64,@@@' }), /base64 inválido|[Ii]magem vazia|corrompido/);
});

test('requisições autenticadas rejeitam Origin externo', () => {
  assert.doesNotThrow(() => verificarOrigemRequisicao({
    method: 'POST',
    headers: { host: 'app.local', origin: 'http://app.local' },
    socket: { encrypted: false },
  }));
  assert.throws(() => verificarOrigemRequisicao({
    method: 'POST',
    headers: { host: 'app.local', origin: 'https://evil.example' },
    socket: { encrypted: false },
  }), /Origem da requisição não permitida/);
});

/* ---------- Regressões vindas de hardening/pre-sale-audit (PR #7) ----------
   Esses casos existiam lá e se perderam na resolução de conflito do PR #8. */

test('validação numérica do admin rejeita NaN, Infinity, vazios e tipos inválidos', () => {
  for (const value of [NaN, Infinity, -Infinity, '', '   ', true, false, {}, [], 'abc']) {
    assert.throws(
      () => numeroFinito(value, 'Preço', { minimo: 0 }),
      (error) => error instanceof ErroValidacao && error.status === 400
    );
  }
  assert.equal(numeroFinito('12.50', 'Preço', { minimo: 0 }), 12.5);
  assert.equal(numeroFinito(0, 'Estoque', { inteiro: true, minimo: 0 }), 0);
  assert.equal(numeroFinito(null, 'Estoque', { allowNull: true }), null);
  assert.equal(numeroInteiroPositivo('7', 'categoriaId'), 7);
  assert.throws(() => numeroFinito(1.5, 'Estoque', { inteiro: true, minimo: 0 }), /deve ser inteiro/);
  assert.throws(() => numeroFinito(-1, 'Estoque', { minimo: 0 }), /inválido/);
  assert.throws(() => numeroInteiroPositivo('0', 'categoriaId'), /inválido/);
});

test('abertura de sessão trava a mesa antes de criar sessão (ADR-005)', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT id FROM mesas')) return { rows: [{ id: 7 }] };
      if (sql.includes("SELECT id FROM mesa_sessoes")) return { rows: [] };
      if (sql.includes('INSERT INTO mesa_sessoes')) return { rows: [{ id: 42 }] };
      return { rows: [] };
    },
  };
  assert.equal(await getOuAbrirSessao(client, 7), 42);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.match(calls[1].sql, /status = 'aberta'/);
  assert.match(calls[2].sql, /INSERT INTO mesa_sessoes/);
});

test('produto com id inválido não dispara consulta ao PostgreSQL', async () => {
  let called = false;
  const client = { query: async () => { called = true; return { rows: [] }; } };
  assert.equal(await getProdutoComRegras(client, NaN), null);
  assert.equal(await getProdutoComRegras(client, Infinity), null);
  assert.equal(await getProdutoComRegras(client, 0), null);
  assert.equal(called, false);
});

test('admin de garçom rejeita IDs não inteiros antes do banco', async () => {
  // Funções são async: o erro vira rejeição, não exception síncrona.
  await assert.rejects(() => removerGarcom(Infinity), (e) => e instanceof ErroValidacao && e.status === 400);
  await assert.rejects(() => setGarcomAtivo(NaN, true), (e) => e instanceof ErroValidacao && e.status === 400);
  await assert.rejects(
    () => entregarComoGarcom(-1, '00000000-0000-4000-8000-000000000000'),
    (e) => e instanceof ErroValidacao && e.status === 400
  );
  assert.equal(ErroGarcom.prototype instanceof Error, true);
});

test('cozinha/bar não podem concluir entrega pelo endpoint genérico (ADR-007)', async () => {
  // O guard roda antes de qualquer conexão com o banco, então o teste é herético.
  await assert.rejects(() => setStatusPedido(1, 'entregue', 'cozinha'), (e) => e instanceof ErroPedido && e.status === 403);
  await assert.rejects(() => setStatusPedido(1, 'entregue', 'bar'), (e) => e instanceof ErroPedido && e.status === 403);
  await assert.rejects(() => setStatusItem(1, 'entregue'), (e) => e instanceof ErroPedido && e.status === 400);
});

/* ---------- Schema: DDL não pode morar no caminho da requisição ---------- */

test('migrations incluem a tabela pix_avisos com índice', () => {
  const sql = fs.readFileSync('db/migrations/0016_pix_avisos.sql', 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pix_avisos/);
  assert.match(sql, /idx_pix_avisos_sessao_status/);
});

test('handlers de pedido e caixa não disparam DDL em tempo de requisição', () => {
  for (const file of ['db/caixa.js', 'db/pedidos.js', 'server.js']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /CREATE TABLE/, `${file} não deveria criar tabela`);
    assert.doesNotMatch(source, /ensurePixAvisosTable\(/, `${file} não deveria chamar o DDL legado`);
  }
});

test('relação ausente vira 503 acionável em vez de erro cru do PostgreSQL', () => {
  const { erroDeSchema, ErroPixCliente } = require('../db/pix-cliente');
  const marcado = erroDeSchema(Object.assign(new Error('relation "pix_avisos" does not exist'), { code: '42P01' }));
  assert.ok(marcado instanceof ErroPixCliente);
  assert.equal(marcado.status, 503);
  const outro = new Error('outra coisa');
  assert.equal(erroDeSchema(outro), outro);
});

/* ---------- PIX do cliente (hardening do colega, porta do ab9fa34) ----------
   Os testes dele eram regex no fonte; aqui viram comportamentais — mesma proteção,
   sem quebrar na próxima formatação. */

const { informarPixPago, ErroPixCliente, validarUuid } = require('../db/pix-cliente');

test('PIX rejeita token fora do formato UUID antes de tocar no PostgreSQL', async () => {
  for (const token of ['', '  ', 'nao-existe', '../etc/passwd', '00000000-0000-0000-0000-000000000000', null, 42]) {
    await assert.rejects(() => informarPixPago(token, {}), (e) => e instanceof ErroPixCliente && e.status === 400, String(token));
  }
  assert.equal(validarUuid('00000000-0000-4000-8000-000000000000'), '00000000-0000-4000-8000-000000000000');
});

test('PIX rejeita payload não-objeto e campos explícitos inválidos', async () => {
  const uuid = '00000000-0000-4000-8000-000000000000';
  // undefined é omissão legítima (vira {}); null/string/número/array são payload quebrado.
  for (const corpo of [null, 'x', 42, []]) {
    await assert.rejects(() => informarPixPago(uuid, corpo), /Dados do PIX inválidos/, String(corpo));
  }
  for (const pedidoId of ['abc', 1.5, 0, -3, true, {}]) {
    await assert.rejects(() => informarPixPago(uuid, { pedidoId }), /Pedido (inválido|deve ser inteiro)/);
  }
  for (const valor of ['abc', 0, -1, true, NaN, Infinity, {}]) {
    await assert.rejects(() => informarPixPago(uuid, { valor }), /Valor inválido/);
  }
});

test('rotas de PIX e entrega não mascaram JSON inválido em payload vazio', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  // body() já resolve {} para corpo ausente; engolir erro de parse virava
  // "PIX com payload inventado" e "entregar todos os itens".
  assert.doesNotMatch(source, /await body\(req\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(source, /const payload = await body\(req\);\s*const out = await informarPixPago/);
  assert.equal((source.match(/await body\(req\);/g) || []).length >= 2, true);
});

/* ------------------------------------------------------------------ *
 * PIX: normalização de chave (fonte única) e payload EMV/BR Code
 * ------------------------------------------------------------------ */
const { normalizarChavePix, inspecionarChavePix, cpfValido, cnpjValido } = require('../db/pix-normaliza');

test('chave aleatória (EVP) sobrevive à normalização — bug que destruía 1,18% das chaves', () => {
  // O server.js antigo não checava letras: um UUID com 11/14 dígitos virava
  // "CPF"/"telefone" e o QR passava a apontar para uma chave inexistente,
  // mesmo com PIX_CHAVE correta no provedor.
  const destruidasAntes = [
    '7a064d54-edbe-49fd-b675-eaff2b5ce6bb', // 14 dígitos
    'df0c7f27-c606-40cd-9dba-ffeadda63f01', // 14 dígitos
    'a4984f0b-15f0-4efb-bcba-413bfe3fdbb4', // 14 dígitos
    'b139cfb3-cae4-4e9d-9ade-7b1eb021b3de', // 14 dígitos
  ];
  for (const k of destruidasAntes) {
    assert.equal(normalizarChavePix(k), k.toLowerCase(), k);
  }
  // varredura: nenhum UUID v4 aleatório pode ser reescrito
  for (let i = 0; i < 3000; i++) {
    const b = require('node:crypto').randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    assert.equal(normalizarChavePix(uuid), uuid, `UUID reescrito: ${uuid} → ${normalizarChavePix(uuid)}`);
  }
});

test('normalização resolve CPF x celular pelos dígitos verificadores', () => {
  // 11 dígitos são ambíguos (CPF ou DDD+número). Só o dígito verificador decide.
  assert.equal(cpfValido('52998224725'), true);
  assert.equal(cpfValido('11111111111'), false, 'sequência repetida não é CPF');
  assert.equal(cpfValido('52998224726'), false, 'dígito verificador errado');
  assert.equal(normalizarChavePix('529.982.247-25'), '52998224725', 'CPF válido vira só dígitos');
  assert.equal(normalizarChavePix('21987654321'), '+5521987654321', '11 dígitos que não são CPF viram celular E.164');
  assert.equal(normalizarChavePix('(21) 98765-4321'), '+5521987654321');
  assert.equal(cnpjValido('11222333000181'), true);
  assert.equal(cnpjValido('00000000000000'), false, 'CNPJ de zeros não é válido');
  assert.equal(normalizarChavePix('11.222.333/0001-81'), '11222333000181');
});

test('normalização preserva e-mail, E.164 e remove aspas de .env', () => {
  assert.equal(normalizarChavePix('Pagamentos@Pier509.com.br'), 'pagamentos@pier509.com.br');
  assert.equal(normalizarChavePix('+55 21 98765-4321'), '+5521987654321');
  assert.equal(normalizarChavePix('"21987654321"'), '+5521987654321', 'aspas de .env/painel não podem virar parte da chave');
  assert.equal(normalizarChavePix('"Pag@Pier509.com.br"'), 'pag@pier509.com.br');
  assert.equal(normalizarChavePix('   '), '');
  assert.equal(normalizarChavePix(undefined), '');
});

test('inspeção de chave sinaliza chave ausente/placeholder em vez de QR inválido', () => {
  assert.deepEqual(inspecionarChavePix(''), { ok: false, tipo: 'vazia', motivo: 'PIX_CHAVE não está definida no servidor' });
  assert.equal(inspecionarChavePix('00000000000').tipo, 'placeholder');
  assert.equal(inspecionarChavePix('00000000000000').ok, false);
  assert.equal(inspecionarChavePix('21987654321').tipo, 'telefone');
  assert.equal(inspecionarChavePix('pag@x.com').tipo, 'email');
  assert.equal(inspecionarChavePix('f47ac10b-58cc-4372-a567-0e02b2c3d479').tipo, 'aleatoria');
});

test('server.js usa a fonte única de normalização (sem segunda cópia)', () => {
  const source = fs.readFileSync('server.js', 'utf8');
  assert.match(source, /require\('\.\/db\/pix-normaliza'\)/);
  // a lógica duplicada que causava o bug não pode voltar
  assert.doesNotMatch(source, /digits\.length === 11 \|\| digits\.length === 14/);
  const front = fs.readFileSync('src/lib/utils.ts', 'utf8');
  assert.match(front, /from "\.\.\/\.\.\/db\/pix-normaliza\.js"/, 'front deve importar a mesma implementação');
});

test('payload PIX (BR Code) é TLV válido com CRC16 correto', () => {
  const code = ts.transpileModule(fs.readFileSync('src/lib/utils.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  // utils.ts importa ../../db/pix-normaliza.js — o require do contexto precisa
  // resolver a partir de src/lib/, não a partir de tests/.
  const requireDeSrc = require('node:module').createRequire(
    require('node:path').join(process.cwd(), 'src', 'lib', 'utils.ts')
  );
  const ctx = { exports: {}, console: { warn() {} }, require: requireDeSrc };
  vm.runInNewContext(code, ctx);
  const { montarPixEMV } = ctx.exports;

  const crc16 = (s) => {
    let crc = 0xffff;
    for (const ch of s) {
      crc ^= ch.charCodeAt(0) << 8;
      for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  };
  const parseTLV = (s) => {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const id = s.substr(i, 2);
      const len = Number(s.substr(i + 2, 2));
      assert.match(id, /^\d{2}$/, `id de campo inválido em ${i}`);
      out.push({ id, len, val: s.substr(i + 4, len) });
      i += 4 + len;
    }
    assert.equal(i, s.length, 'payload tem bytes fora de TLV');
    return out;
  };

  const casos = [
    { chave: '21987654321', nome: 'PIER 509', cidade: 'ITAJAI', valor: 147.9, txid: 'SESSAO12' },
    { chave: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', nome: 'PIER 509', cidade: 'ITAJAI', valor: 50, txid: 'SESSAO1' },
    { chave: 'pag@pier509.com.br', nome: 'PIER 509', cidade: 'ITAJAI', valor: 0.01, txid: 'SESSAO1' },
    { chave: '21987654321', nome: 'AÇAITERIA SÃO JOSÉ', cidade: 'RIO DE JANEIRO', txid: 'SESSAO-9/26!' },
  ];
  for (const opts of casos) {
    const payload = montarPixEMV(opts);
    assert.match(payload, /^[\x20-\x7E]+$/, 'payload com caractere não-ASCII');
    assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)), `CRC inválido para ${opts.chave}`);
    const tlvs = parseTLV(payload);
    const ids = tlvs.map((t) => t.id);
    for (const obrigatorio of ['00', '26', '52', '53', '58', '59', '60', '63']) {
      assert.ok(ids.includes(obrigatorio), `campo obrigatório ${obrigatorio} ausente`);
    }
    const nums = tlvs.map((t) => Number(t.id));
    for (let i = 1; i < nums.length; i++) assert.ok(nums[i] > nums[i - 1], 'campos fora de ordem crescente');
    assert.ok(tlvs.find((t) => t.id === '59').val.length <= 25, 'nome acima de 25 chars');
    assert.ok(tlvs.find((t) => t.id === '60').val.length <= 15, 'cidade acima de 15 chars');
    const mai = parseTLV(tlvs.find((t) => t.id === '26').val);
    assert.equal(mai[0].val, 'BR.GOV.BCB.PIX');
    assert.ok(mai[1].val.length > 0, 'campo 26 sem chave');
  }
});

/* ------------------------------------------------------------------ */
/* Bugs corrigidos na auditoria de produção (apontados por testes aqui) */
/* ------------------------------------------------------------------ */

test('login limita SENHA ERRADA, não tentativa (equipe inteira sai pelo mesmo IP)', () => {
  const { golpeExcedido, registrarGolpe, limparGolpes } = require('../db/rateLimit');
  const chave = 'teste-login-falha:' + Math.random();
  const limite = { janelaMs: 60_000, max: 3 };
  // consultas não consomem a cota: 30 logins corretos seguidos continuam liberados
  for (let i = 0; i < 30; i++) assert.equal(golpeExcedido(chave, limite), false, 'consulta não pode consumir a cota');
  // senha errada registra e estoura
  for (let i = 1; i <= 3; i++) {
    assert.equal(golpeExcedido(chave, limite), false, `falha ${i} deveria passar`);
    registrarGolpe(chave);
  }
  assert.equal(golpeExcedido(chave, limite), true, 'depois do limite tem que bloquear');
  // login correto zera a chave do usuário
  limparGolpes(chave);
  assert.equal(golpeExcedido(chave, limite), false, 'sucesso limpa as falhas registradas');

  // e o server.js tem que usar esse caminho (não golpePermitido no login)
  const fonte = fs.readFileSync('server.js', 'utf8');
  const blocoLogin = fonte.slice(fonte.indexOf("p === '/api/login'"), fonte.indexOf("p === '/api/logout'"));
  assert.match(blocoLogin, /golpeExcedido\(chaveIp/, 'login deve consultar a cota antes de autenticar');
  assert.match(blocoLogin, /registrarGolpe\(chaveIp\)/, 'somente falha deve registrar tentativa');
  assert.doesNotMatch(blocoLogin, /golpePermitido\(`login:/, 'golpePermitido no login volta a contar acerto e trava o turno');
});

test('criar/editar produto valida a categoria antes de gravar (sem 500 de FK)', () => {
  const fonte = fs.readFileSync('db/admin.js', 'utf8');
  assert.match(fonte, /erroDeIntegridade|function exigirCategoria/, 'admin.js precisa checar a categoria antes do INSERT/UPDATE');
  const chamaNoCriar = fonte.slice(fonte.indexOf('async function criarProduto'), fonte.indexOf('async function atualizarProduto'));
  assert.match(chamaNoCriar, /await exigirCategoria\(categoriaId\)/, 'criarProduto deve validar a categoria');
  const chamaNoEditar = fonte.slice(fonte.indexOf('async function atualizarProduto'), fonte.indexOf('async function criarAdicional'));
  assert.match(chamaNoEditar, /await exigirCategoria\(categoriaId\)/, 'atualizarProduto deve validar a categoria');
});

test('violação de integridade do PostgreSQL vira 409 amigável, nunca 500 com nome de constraint', () => {
  const fonte = fs.readFileSync('server.js', 'utf8');
  assert.match(fonte, /e\.code\.startsWith\('23'\)/, 'erros de integridade (classe 23xxx) devem ter tratamento próprio');
  assert.match(fonte, /e\.code === '23505'/, 'duplicidade (23505) tem mensagem própria');
  assert.doesNotMatch(fonte, /json\(res, 500, \{ error: e\.message \}\)/, 'mensagem crua do banco não pode ir para o cliente');
});

test('limite de pedidos por mesa não atrapalha mesa grande (20/5min) e mantém teto por IP', () => {
  const fonte = fs.readFileSync('server.js', 'utf8');
  assert.match(fonte, /pedido:\$\{ip\}:\$\{m\[1\]\}`, \{ janelaMs: 5 \* 60 \* 1000, max: 20 \}/, 'teto por mesa deve ser 20/5min');
  assert.match(fonte, /pedido-ip:\$\{ip\}`/, 'teto por IP precisa continuar existindo');
});

test('nenhum arquivo do projeto usa alert()/confirm() nativo (quebra em navegador embutido)', () => {
  const arquivos = [];
  const varrer = (dir) => {
    for (const nome of fs.readdirSync(dir, { withFileTypes: true })) {
      const caminho = `${dir}/${nome.name}`;
      if (nome.isDirectory()) varrer(caminho);
      else if (/\.(ts|tsx)$/.test(nome.name)) arquivos.push(caminho);
    }
  };
  varrer('src');
  // Dialogos.tsx é quem OFERECE avisar()/confirmar(); o comentário dele cita alert()/confirm().
  const culpados = arquivos
    .filter((f) => !f.endsWith('components/Dialogos.tsx'))
    .filter((f) => {
      // ignora comentários: procura só o que aparece depois de remover // e /* */
      const codigo = fs.readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      return /(?<![.\w])(alert|confirm)\(/.test(codigo);
    });
  assert.deepEqual(culpados, [], 'use avisar()/confirmar() de components/Dialogos');
});
