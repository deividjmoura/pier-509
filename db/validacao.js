class ErroValidacao extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErroValidacao';
    this.status = 400;
  }
}

/**
 * Converte uma entrada numérica em número finito e aplica limites explícitos.
 * Strings vazias/nulas podem ser aceites apenas quando allowNull=true.
 */
function numeroFinito(raw, nome, { inteiro = false, minimo = 0, maximo = null, allowNull = false } = {}) {
  if (raw === undefined) {
    if (allowNull) return null;
    throw new ErroValidacao(`${nome} é obrigatório`);
  }

  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (allowNull) return null;
    throw new ErroValidacao(`${nome} é obrigatório`);
  }

  if (typeof raw === 'boolean' || (typeof raw !== 'string' && typeof raw !== 'number')) {
    throw new ErroValidacao(`${nome} inválido`);
  }

  const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (!Number.isFinite(value)) throw new ErroValidacao(`${nome} inválido`);
  if (inteiro && !Number.isInteger(value)) throw new ErroValidacao(`${nome} deve ser inteiro`);
  if (value < minimo) throw new ErroValidacao(`${nome} inválido`);
  if (maximo !== null && value > maximo) throw new ErroValidacao(`${nome} excede o limite permitido`);

  return value;
}

function numeroInteiroPositivo(raw, nome) {
  return numeroFinito(raw, nome, { inteiro: true, minimo: 1 });
}

module.exports = { ErroValidacao, numeroFinito, numeroInteiroPositivo };
