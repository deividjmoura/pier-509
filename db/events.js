// Barramento SSE: clientes em GET /api/events recebem eventos operacionais.
const clients = new Map();

function subscribe(res, { publicClient = false } = {}) {
  clients.set(res, { publicClient });
  res.on('close', () => {
    clients.delete(res);
  });
}

function broadcast(event, payload = {}) {
  if (!clients.size) return;
  const data = JSON.stringify({ ...payload, at: Date.now() });
  const chunk = `event: ${event}\ndata: ${data}\n\n`;
  for (const [res, { publicClient }] of clients) {
    try {
      // Clientes de mesa/garçom precisam apenas invalidar a tela.
      // Não envie nomes, tokens ou pagamentos de outras mesas.
      res.write(publicClient ? `event: ${event}\ndata: {}\n\n` : chunk);
    } catch (_) {
      clients.delete(res);
    }
  }
}

function clientCount() {
  return clients.size;
}

module.exports = { subscribe, broadcast, clientCount };
