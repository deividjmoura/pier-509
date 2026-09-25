/**
 * Corrige fotos do cardápio de uma vez só.
 *
 * Onde ficam as fotos erradas?
 *   → Postgres: tabela produtos, coluna foto_url
 *   → Pode ser data:image/... (base64 enorme), /uploads/... ou URL antiga
 *   → O front prioriza foto_url; só usa demo se estiver vazio
 *
 * Este script grava caminhos leves /assets/demo/*.webp coerentes com o nome.
 *
 * Uso:
 *   node scripts/fix-fotos-cardapio.js --dry-run   # só lista
 *   node scripts/fix-fotos-cardapio.js             # aplica
 *   node scripts/fix-fotos-cardapio.js --only-data # só troca data-URL / vazios
 *
 * Requer DATABASE_URL no .env (Neon / local).
 */
require('dotenv').config();
const pool = require('../db/pool');

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Mesma lógica do demoPhoto do front (src/lib/foto.ts) */
function fotoPara(nomeRaw, catRaw) {
  const nome = norm(nomeRaw);
  const cat = norm(catRaw);

  if (/\bcombo\b/.test(nome)) return '/assets/demo/combo.webp';

  if (/dog/.test(nome) && /bacon/.test(nome)) return '/assets/demo/dog-bacon.webp';
  if (/dog/.test(nome) && /especial/.test(nome)) return '/assets/demo/dog-especial.webp';
  if (/dog/.test(nome) && /(vegetariano|vegano)/.test(nome)) return '/assets/demo/dog-veg.webp';
  if (/dog/.test(nome) && /duplo/.test(nome)) return '/assets/demo/dog-duplo.webp';
  if (/dog/.test(nome) || /hot\s*dogs?/.test(cat)) return '/assets/demo/dog-classic.webp';

  if (/x-?\s*bacon|xbacon/.test(nome)) return '/assets/demo/xbacon.webp';
  if (/x-?\s*salada/.test(nome)) return '/assets/demo/salad.webp';
  if (/x-?\s*tudo/.test(nome)) return '/assets/demo/burger.webp';
  if (/frango grelhado|x-?\s*frango/.test(nome)) return '/assets/demo/chicken.webp';
  if (/misto/.test(nome)) return '/assets/demo/misto.webp';
  if (/natural de frango|sanduiche natural|sanduíche natural/.test(nome))
    return '/assets/demo/natural.webp';
  if (/sandu|x-|burger|hamb/.test(nome) || /sandu/.test(cat)) return '/assets/demo/burger.webp';

  if (/onion|anel/.test(nome)) return '/assets/demo/onion.webp';
  if (/batata/.test(nome)) return '/assets/demo/fries.webp';
  if (/passarinho/.test(nome)) return '/assets/demo/chicken.webp';
  if (/polenta/.test(nome)) return '/assets/demo/polenta.webp';
  if (/mandioca|aipim/.test(nome)) return '/assets/demo/mandioca.webp';

  if (/suco/.test(nome)) return '/assets/demo/juice.webp';
  if (/milk\s*shake|milkshake|shake/.test(nome)) return '/assets/demo/milkshake.webp';
  if (/agua de coco|\bcoco\b/.test(nome)) return '/assets/demo/water.webp';
  if (/\bagua\b/.test(nome)) return '/assets/demo/water.webp';
  if (/refrigerante|refri|coca|cola/.test(nome)) return '/assets/demo/soda-cola.webp';
  if (/caipi/.test(nome)) return '/assets/demo/caipi.webp';
  if (/red\s*bull|monster|tnt|baly|energ/.test(nome)) return '/assets/demo/energy.webp';
  if (/long\s*neck|cerveja|chopp|pilsen|malte|\bipa\b|balde/.test(nome))
    return '/assets/demo/beer.webp';
  if (/gin|moscow|mule|vodka|drink/.test(nome)) return '/assets/demo/cocktail.webp';

  if (/churros/.test(nome)) return '/assets/demo/churros.webp';
  if (/brownie/.test(nome)) return '/assets/demo/brownie.webp';
  if (/petit|gateau/.test(nome)) return '/assets/demo/petit.webp';
  if (/sobremesa|sorvete|doce/.test(nome) || /sobremesa/.test(cat))
    return '/assets/demo/dessert.webp';

  if (/hot\s*dog|dog/.test(cat)) return '/assets/demo/dog-classic.webp';
  if (/sandu/.test(cat)) return '/assets/demo/burger.webp';
  if (/porc/.test(cat)) return '/assets/demo/fries.webp';
  if (/cerveja|chopp|bar/.test(cat)) return '/assets/demo/beer.webp';
  if (/drink/.test(cat)) return '/assets/demo/cocktail.webp';
  if (/bebida/.test(cat)) return '/assets/demo/drink.webp';
  if (/combo/.test(cat)) return '/assets/demo/combo.webp';
  return '/assets/demo/burger.webp';
}

function resumoUrl(url) {
  if (!url) return '(vazio)';
  if (String(url).startsWith('data:')) return `data-URL ~${Math.round(String(url).length / 1024)}KB`;
  if (String(url).length > 60) return String(url).slice(0, 57) + '…';
  return String(url);
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const onlyData = process.argv.includes('--only-data');

  const { rows } = await pool.query(
    `SELECT p.id, p.nome, p.foto_url, c.nome AS categoria
     FROM produtos p
     JOIN categorias c ON c.id = p.categoria_id
     ORDER BY c.ordem, p.nome`
  );

  console.log(`\n📦 ${rows.length} produtos no banco\n`);
  let mudancas = 0;

  for (const r of rows) {
    const alvo = fotoPara(r.nome, r.categoria);
    const atual = r.foto_url || '';
    const isData = String(atual).startsWith('data:');
    const isDemo = String(atual).startsWith('/assets/demo/');
    const precisa =
      !atual ||
      isData ||
      (!onlyData && atual !== alvo) ||
      (onlyData && (isData || !atual));

    if (!precisa) {
      console.log(`  · #${r.id} ${r.nome} → ok (${resumoUrl(atual)})`);
      continue;
    }

    mudancas += 1;
    console.log(
      `  ${dry ? '🔎' : '✓'} #${r.id} ${r.nome}\n     ${resumoUrl(atual)}  →  ${alvo}`
    );

    if (!dry) {
      await pool.query('UPDATE produtos SET foto_url = $1 WHERE id = $2', [alvo, r.id]);
    }
  }

  console.log(
    dry
      ? `\n--dry-run: ${mudancas} produto(s) seriam atualizados. Rode sem --dry-run para gravar.\n`
      : `\n✅ ${mudancas} produto(s) atualizados.\n`
  );
}

main()
  .catch((e) => {
    console.error('❌', e.message || e);
    process.exit(1);
  })
  .finally(() => pool.end());
