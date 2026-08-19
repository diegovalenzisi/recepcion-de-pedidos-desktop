// IDENTIDAD CANÓNICA DE VENTA — mostrador y delivery no pueden compartir clave.
//
// El 19/08/2026 se detectó que Il Capo estaba PERDIENDO comisión: sus dos
// contadores (CONTADORES/mostrador y CONTADORES/pedidos) se cruzaron en el
// número 744 y, desde entonces, cada pedido de delivery encontraba la clave
// COMISIONES/REGISTRO/{id} ocupada por una venta de mostrador. La dedup lo leía
// como duplicado y descartaba la comisión: 182 pedidos afectados. Burano estaba
// a ~39 pedidos de empezar a hacer exactamente lo mismo.
//
// Correr con: node src/lib/api/__tests__/comisionVentaKey.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  PREFIJO_CANAL, canalDeModoVenta, claveDeVenta, claveLegada,
  esClaveCanonica, registroEsDelCanal, identidadDeVenta,
} from '../comisionVentaKey.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
console.log('\n1. La clave separa los canales:');

check('mostrador y delivery con el MISMO numero dan claves distintas', () => {
  assert.strictEqual(claveDeVenta('mostrador', 744), 'M744');
  assert.strictEqual(claveDeVenta('delivery', 744), 'D744');
  assert.notStrictEqual(claveDeVenta('mostrador', 744), claveDeVenta('delivery', 744));
});

check('el caso real de Il Capo: 744..925 ya no colisiona', () => {
  for (let id = 744; id <= 925; id++) {
    assert.notStrictEqual(claveDeVenta('mostrador', id), claveDeVenta('delivery', id));
  }
});

check('acepta id numerico o string, con el mismo resultado', () => {
  assert.strictEqual(claveDeVenta('delivery', 744), claveDeVenta('delivery', '744'));
});

check('los prefijos son los esperados', () => {
  assert.deepStrictEqual(PREFIJO_CANAL, { mostrador: 'M', delivery: 'D' });
});

// ---------------------------------------------------------------------------
console.log('\n2. Clasificacion del canal (se conserva el criterio de siempre):');

check('mostrador es mostrador; TODO lo demas es delivery', () => {
  assert.strictEqual(canalDeModoVenta('mostrador'), 'mostrador');
  assert.strictEqual(canalDeModoVenta('Mostrador'), 'mostrador');
  assert.strictEqual(canalDeModoVenta('  MOSTRADOR  '), 'mostrador');
  for (const v of ['delivery', 'Delivery', 'PEDIDOS', 'retiro', '', null, undefined]) {
    assert.strictEqual(canalDeModoVenta(v), 'delivery');
  }
});

check('es el MISMO criterio que ya usaba saveSaleToAccountSummary', () => {
  const criterioViejo = (tipo) => (String(tipo).toLowerCase() === 'mostrador' ? 'mostrador' : 'delivery');
  for (const t of ['Mostrador', 'Delivery', 'mostrador', 'delivery', 'otro']) {
    assert.strictEqual(canalDeModoVenta(t), criterioViejo(t));
  }
});

// ---------------------------------------------------------------------------
console.log('\n3. Convivencia con los registros viejos:');

check('la clave legada sigue siendo el numero pelado', () => {
  assert.strictEqual(claveLegada(123), '123');
  assert.strictEqual(claveLegada('123'), '123');
});

check('se distingue una clave nueva de una vieja', () => {
  assert.strictEqual(esClaveCanonica('M123'), true);
  assert.strictEqual(esClaveCanonica('D123'), true);
  assert.strictEqual(esClaveCanonica('123'), false);
  assert.strictEqual(esClaveCanonica(''), false);
  assert.strictEqual(esClaveCanonica('X123'), false);
});

check('un registro NUEVO se reconoce por su campo canal, no por la letra', () => {
  const nuevo = { canal: 'delivery', ventaKey: 'D744', idVenta: '744' };
  assert.strictEqual(registroEsDelCanal(nuevo, 'delivery'), true);
  assert.strictEqual(registroEsDelCanal(nuevo, 'mostrador'), false);
});

check('un registro VIEJO se reconoce por modoVenta', () => {
  const viejo = { idVenta: '744', modoVenta: 'mostrador', comisionGenerada: 80 };
  assert.strictEqual(registroEsDelCanal(viejo, 'mostrador'), true);
  assert.strictEqual(registroEsDelCanal(viejo, 'delivery'), false);
});

check('sin registro no hay coincidencia posible', () => {
  assert.strictEqual(registroEsDelCanal(null, 'mostrador'), false);
  assert.strictEqual(registroEsDelCanal(undefined, 'delivery'), false);
});

// ---------------------------------------------------------------------------
console.log('\n4. Identidad explicita guardada en el registro:');

check('guarda idVenta, canal y ventaKey', () => {
  assert.deepStrictEqual(identidadDeVenta('mostrador', 1808), { idVenta: '1808', canal: 'mostrador', ventaKey: 'M1808' });
  assert.deepStrictEqual(identidadDeVenta('delivery', 5220), { idVenta: '5220', canal: 'delivery', ventaKey: 'D5220' });
});

check('la identidad es coherente con la clave', () => {
  const i = identidadDeVenta('delivery', 744);
  assert.strictEqual(i.ventaKey, claveDeVenta(i.canal, i.idVenta));
});

// ---------------------------------------------------------------------------
// EL ESCENARIO COMPLETO, con la forma real del nodo REGISTRO de Il Capo.
// ---------------------------------------------------------------------------
console.log('\n5. Simulacion del caso Il Capo, extremo a extremo:');

/** Reproduce la resolucion de clave de registrarComision (dedup en 2 pasos). */
const yaRegistrada = (REG, modoVenta, idVenta) => {
  if (REG[claveDeVenta(modoVenta, idVenta)]) return true;
  const legado = REG[claveLegada(idVenta)];
  return !!(legado && registroEsDelCanal(legado, modoVenta));
};
/** Reproduce la resolucion de clave de cancelarComision. */
const claveParaCancelar = (REG, modoVenta, idVenta) => {
  const c = claveDeVenta(modoVenta, idVenta);
  if (REG[c]) return c;
  const legado = REG[claveLegada(idVenta)];
  if (legado && registroEsDelCanal(legado, modoVenta)) return claveLegada(idVenta);
  return null;
};

check('ANTES el delivery 744 se descartaba; AHORA se registra', () => {
  const REG = { '744': { idVenta: '744', modoVenta: 'mostrador', comisionGenerada: 80 } };
  assert.ok(REG[claveLegada(744)], 'precondicion: existe el registro de mostrador');
  assert.strictEqual(yaRegistrada(REG, 'delivery', 744), false, 'el delivery 744 sigue perdiendose');
  assert.strictEqual(yaRegistrada(REG, 'mostrador', 744), true, 'el mostrador 744 no se puede duplicar');
});

check('las dos comisiones conviven en el mismo nodo', () => {
  const REG = {
    '744':  { idVenta: '744', modoVenta: 'mostrador', comisionGenerada: 80 },
    'D744': { idVenta: '744', canal: 'delivery', ventaKey: 'D744', comisionGenerada: 142 },
  };
  const total = Object.values(REG).reduce((s, r) => s + r.comisionGenerada, 0);
  assert.strictEqual(total, 222);
});

check('anular el delivery 744 NO toca la comision del mostrador 744', () => {
  const REG = {
    '744':  { idVenta: '744', modoVenta: 'mostrador', comisionGenerada: 80 },
    'D744': { idVenta: '744', canal: 'delivery', ventaKey: 'D744', comisionGenerada: 142 },
  };
  assert.strictEqual(claveParaCancelar(REG, 'delivery', 744), 'D744');
  assert.strictEqual(claveParaCancelar(REG, 'mostrador', 744), '744');
});

check('un delivery SIN registro propio no adopta el registro de mostrador', () => {
  const REG = { '744': { idVenta: '744', modoVenta: 'mostrador', comisionGenerada: 80 } };
  assert.strictEqual(claveParaCancelar(REG, 'delivery', 744), null, 'no debe cancelar la comision ajena');
});

check('ventas ANTERIORES al arreglo se siguen anulando bien', () => {
  const REG = { '1038': { idVenta: '1038', modoVenta: 'mostrador', comisionGenerada: 50 } };
  assert.strictEqual(claveParaCancelar(REG, 'mostrador', 1038), '1038');
});

check('ventas POSTERIORES al arreglo se anulan por clave canonica', () => {
  const REG = { 'M1808': { idVenta: '1808', canal: 'mostrador', ventaKey: 'M1808', comisionGenerada: 60 } };
  assert.strictEqual(claveParaCancelar(REG, 'mostrador', 1808), 'M1808');
});

// ---------------------------------------------------------------------------
// MATRIZ EXPLICITA DE CONVIVENCIA M744 / D744.
// ---------------------------------------------------------------------------
console.log('\n6. Matriz M744 / D744:');

/** Nodo REGISTRO simulado + alta que respeta la dedup real. */
const nuevoRegistro = () => ({});
const altaComision = (REG, modoVenta, idVenta, comision) => {
  if (yaRegistrada(REG, modoVenta, idVenta)) return false;   // dedup
  const ident = identidadDeVenta(modoVenta, idVenta);
  REG[ident.ventaKey] = { ...ident, comisionGenerada: comision, estado: 'pendiente' };
  return true;
};

check('M744 puede existir', () => {
  const REG = nuevoRegistro();
  assert.strictEqual(altaComision(REG, 'mostrador', 744, 80), true);
  assert.ok(REG.M744, 'no se creo M744');
});

check('D744 puede existir', () => {
  const REG = nuevoRegistro();
  assert.strictEqual(altaComision(REG, 'delivery', 744, 142), true);
  assert.ok(REG.D744, 'no se creo D744');
});

check('M744 y D744 existen SIMULTANEAMENTE', () => {
  const REG = nuevoRegistro();
  assert.strictEqual(altaComision(REG, 'mostrador', 744, 80), true);
  assert.strictEqual(altaComision(REG, 'delivery', 744, 142), true);
  assert.deepStrictEqual(Object.keys(REG).sort(), ['D744', 'M744']);
  assert.strictEqual(REG.M744.comisionGenerada + REG.D744.comisionGenerada, 222);
});

check('M744 repetido -> NO duplica', () => {
  const REG = nuevoRegistro();
  assert.strictEqual(altaComision(REG, 'mostrador', 744, 80), true);
  assert.strictEqual(altaComision(REG, 'mostrador', 744, 80), false, 'se duplico M744');
  assert.strictEqual(Object.keys(REG).length, 1);
});

check('D744 repetido -> NO duplica', () => {
  const REG = nuevoRegistro();
  assert.strictEqual(altaComision(REG, 'delivery', 744, 142), true);
  assert.strictEqual(altaComision(REG, 'delivery', 744, 142), false, 'se duplico D744');
  assert.strictEqual(Object.keys(REG).length, 1);
});

check('M744 NO bloquea D744', () => {
  const REG = nuevoRegistro();
  altaComision(REG, 'mostrador', 744, 80);
  assert.strictEqual(altaComision(REG, 'delivery', 744, 142), true, 'el mostrador bloqueo al delivery');
});

check('D744 NO bloquea M744', () => {
  const REG = nuevoRegistro();
  altaComision(REG, 'delivery', 744, 142);
  assert.strictEqual(altaComision(REG, 'mostrador', 744, 80), true, 'el delivery bloqueo al mostrador');
});

check('la venta nueva almacena idVenta, canal y ventaKey', () => {
  const REG = nuevoRegistro();
  altaComision(REG, 'delivery', 744, 142);
  assert.strictEqual(REG.D744.idVenta, '744');
  assert.strictEqual(REG.D744.canal, 'delivery');
  assert.strictEqual(REG.D744.ventaKey, 'D744');
  altaComision(REG, 'mostrador', 744, 80);
  assert.strictEqual(REG.M744.idVenta, '744');
  assert.strictEqual(REG.M744.canal, 'mostrador');
  assert.strictEqual(REG.M744.ventaKey, 'M744');
});

check('Achaval con porcentaje 0: identidad correcta y comision 0', () => {
  const REG = nuevoRegistro();
  assert.strictEqual(altaComision(REG, 'delivery', 5220, 0), true);
  assert.strictEqual(REG.D5220.comisionGenerada, 0, 'no debe generar comision');
  assert.strictEqual(REG.D5220.ventaKey, 'D5220', 'la identidad igual tiene que quedar bien');
});

// ---------------------------------------------------------------------------
console.log('\n7. El codigo real usa la clave canonica:');

const fuenteApi = leer('../comisionesApi.js');

check('registrarComision escribe con ventaKey, no con idVenta pelado', () => {
  assert.match(fuenteApi, /REGISTRO\/\$\{ventaKey\}/);
});

check('registrarComision guarda la identidad explicita', () => {
  assert.match(fuenteApi, /\.\.\.identidad/);
});

check('cancelarComision resuelve la clave y escribe SOBRE ESA clave', () => {
  assert.match(fuenteApi, /claveResuelta/);
  assert.match(fuenteApi, /\$\{base\}\/\$\{claveResuelta\}/);
});

check('la anulacion de mostrador informa su canal', () => {
  const counter = leer('../counterApi.js');
  assert.match(counter, /cancelarComision\(String\(sale\.id\), 'mostrador'\)/);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
