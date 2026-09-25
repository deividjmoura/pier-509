const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function eventAccess(params, { staff, findMesa, findGarcom }) {
  if (staff) return 'staff';
  const mesa = (params.get('mesa') || params.get('token') || '').trim();
  const garcom = (params.get('garcom') || '').trim();
  if (UUID.test(mesa) && await findMesa(mesa)) return 'public';
  if (UUID.test(garcom)) {
    const found = await findGarcom(garcom);
    if (found?.ativo) return 'public';
  }
  return null;
}

module.exports = { eventAccess };
