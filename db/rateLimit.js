// Rate limit em memória (janela deslizante).
// ATENÇÃO: não é compartilhado entre processos/instâncias.
// Em produção multi-instância use Redis (ou Cloudflare/Upstash).
const buckets = new Map();

function golpePermitido(chave, { janelaMs = 60_000, max = 30 } = {}) {
  const agora = Date.now();
  let lista = buckets.get(chave) || [];
  // remove timestamps fora da janela
  lista = lista.filter((t) => agora - t < janelaMs);
  if (lista.length >= max) {
    buckets.set(chave, lista);
    return false;
  }
  lista.push(agora);
  buckets.set(chave, lista);
  return true;
}

// Limpeza periódica (evita memory leak em chaves antigas)
setInterval(() => {
  const agora = Date.now();
  const maxAge = 60 * 60 * 1000; // 1h
  for (const [chave, lista] of buckets) {
    const viva = lista.filter((t) => agora - t < maxAge);
    if (viva.length) buckets.set(chave, viva);
    else buckets.delete(chave);
  }
}, 5 * 60 * 1000).unref();

module.exports = { golpePermitido };
