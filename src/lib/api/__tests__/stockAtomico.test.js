// Fase 2 — atomicidad e idempotencia del impacto de stock.
//
// Se prueba contra un backend RTDB EN MEMORIA que reproduce las dos garantías
// reales que usa el diseño:
//   · `increment(delta)` suma sobre el valor actual del servidor;
//   · `update()` multi-ruta se aplica ENTERO o NADA.
// El backend permite inyectar una caída en cualquier etapa, para comprobar que
// nunca queda un pedido a medio descontar.
//
// No toca Firebase ni datos reales.
//
// Correr con: node src/lib/api/__tests__/stockAtomico.test.js
import assert from 'node:assert';
import {
  decidirAplicacion,
  construirPayloadAtomico,
  construirPayloadReversion,
  RESERVA_VENCIDA_MS,
  refMostrador,
  refReversionMostrador,
} from '../stockAtomico.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// --- Backend RTDB en memoria ------------------------------------------------
const INCR = Symbol('increment');
const increment = (delta) => ({ [INCR]: delta });

class DbMemoria {
  constructor(datos = {}) { this.datos = JSON.parse(JSON.stringify(datos)); this.caida = null; }
  /** Programa una caída: 'antes-de-escribir' | 'durante-la-escritura'. */
  romperEn(momento) { this.caida = momento; }
  leer(ruta) {
    return ruta.split('/').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), this.datos);
  }
  escribir(ruta, valor) {
    const partes = ruta.split('/');
    const ultima = partes.pop();
    let nodo = this.datos;
    for (const p of partes) { if (typeof nodo[p] !== 'object' || nodo[p] === null) nodo[p] = {}; nodo = nodo[p]; }
    nodo[ultima] = valor;
  }
  /** update() multi-ruta: atómico. O se aplica todo, o no se aplica nada. */
  update(payload) {
    if (this.caida === 'antes-de-escribir') throw new Error('CAIDA antes de escribir');
    // Se calcula el resultado completo sobre una COPIA; recién si todo salió
    // bien se publica. Así se reproduce el "todo o nada" del servidor.
    const copia = new DbMemoria(this.datos);
    for (const [ruta, valor] of Object.entries(payload)) {
      if (this.caida === 'durante-la-escritura') throw new Error('CAIDA durante la escritura');
      if (valor && typeof valor === 'object' && INCR in valor) {
        const actual = Number(copia.leer(ruta)) || 0;
        copia.escribir(ruta, actual + valor[INCR]);
      } else {
        copia.escribir(ruta, valor);
      }
    }
    this.datos = copia.datos;
  }
  /** runTransaction sobre la marca: reserva el referenceId (guarda de concurrencia). */
  reservar(ruta, ahora = Date.now()) {
    const actual = this.leer(ruta) || null;
    const { aplicar } = decidirAplicacion(actual, ahora);
    if (!aplicar) return false;
    this.escribir(ruta, { status: 'processing', timestamp: ahora });
    return true;
  }
}

const LOCAL = 'LOCAL_A';
const datosIniciales = () => ({
  [LOCAL]: {
    ARTICULOS: {
      'A-0007': { nombre: '1 KILO DE HELADO', stock: { stockType: 'propio', propio: 10 } },
      'A-ROCKLETS': { nombre: 'Rocklets', stock: { stockType: 'propio', propio: 20 } },
    },
    MATERIA_PRIMA: { 'M-3': { nombre: 'Azúcar', stock: 100 } },
  },
});

const IMPACTO = {
  'A-0007': { quantity: 1, type: 'ARTICULO' },
  'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' },
  'M-3': { quantity: 0.5, type: 'MATERIA_PRIMA' },
};

const stock = (db, id) => db.leer(`${LOCAL}/ARTICULOS/${id}/stock/propio`);
const marca = (db, ref) => db.leer(`${LOCAL}/PROCESSED_STOCK_IDS/${ref}`);

/** Ejecuta el flujo real: reservar → construir payload → aplicar. */
function procesar(db, referenceId, impacto = IMPACTO, { ahora = Date.now(), intento = 1 } = {}) {
  const rutaMarca = `${LOCAL}/PROCESSED_STOCK_IDS/${referenceId}`;
  if (!db.reservar(rutaMarca, ahora)) return { aplicado: false, motivo: 'rechazado' };
  const { payload } = construirPayloadAtomico({
    localId: LOCAL, referenceId, impactMap: impacto,
    movimientoId: `mov-${referenceId}-${intento}`, increment, source: 'Venta Mostrador',
    timestamp: ahora, intento,
  });
  db.update(payload);
  return { aplicado: true };
}

console.log('Decisión de aplicar:');
check('sin marca → se aplica', () => assert.strictEqual(decidirAplicacion(null).aplicar, true));
check('completed → NUNCA se reaplica', () => {
  const d = decidirAplicacion({ status: 'completed' });
  assert.strictEqual(d.aplicar, false);
  assert.strictEqual(d.motivo, 'ya-procesado');
});
check('processing reciente → no se toca (otro proceso está en eso)', () => {
  const d = decidirAplicacion({ status: 'processing', timestamp: Date.now() });
  assert.strictEqual(d.aplicar, false);
  assert.strictEqual(d.motivo, 'en-curso');
});
check('processing vencido → se reintenta (es seguro: nada se aplicó)', () => {
  const ahora = Date.now();
  const d = decidirAplicacion({ status: 'processing', timestamp: ahora - RESERVA_VENCIDA_MS - 1 }, ahora);
  assert.strictEqual(d.aplicar, true);
  assert.strictEqual(d.motivo, 'reserva-huerfana');
});

console.log('\nAplicación normal:');
check('descuenta base, opcional y materia prima en una sola escritura', () => {
  const db = new DbMemoria(datosIniciales());
  procesar(db, refMostrador(1));
  assert.strictEqual(stock(db, 'A-0007'), 9);
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
  assert.strictEqual(db.leer(`${LOCAL}/MATERIA_PRIMA/M-3/stock`), 99.5);
});
check('la marca queda completed CON el ledger del impacto', () => {
  const db = new DbMemoria(datosIniciales());
  procesar(db, refMostrador(1));
  const m = marca(db, refMostrador(1));
  assert.strictEqual(m.status, 'completed');
  assert.strictEqual(m.impacto.length, 3);
  assert.ok(m.appliedAt > 0);
});
check('el movimiento se registra en la MISMA escritura', () => {
  const db = new DbMemoria(datosIniciales());
  procesar(db, refMostrador(1));
  const mov = db.leer(`${LOCAL}/TRANSACCIONES_STOCK/mov-MOSTRADOR_1-1`);
  assert.strictEqual(mov.referenceId, 'MOSTRADOR_1');
  assert.strictEqual(mov.detalles.length, 3);
});
check('segunda ejecución con el mismo referenceId NO descuenta', () => {
  const db = new DbMemoria(datosIniciales());
  procesar(db, refMostrador(1));
  const r = procesar(db, refMostrador(1));
  assert.strictEqual(r.aplicado, false);
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18, 'no puede bajar a 16');
});
check('Desktop y Tablet a la vez → un solo descuento', () => {
  const db = new DbMemoria(datosIniciales());
  const ahora = Date.now();
  const a = procesar(db, refMostrador(7), IMPACTO, { ahora });
  const b = procesar(db, refMostrador(7), IMPACTO, { ahora });
  assert.strictEqual(a.aplicado, true);
  assert.strictEqual(b.aplicado, false);
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
});
check('el mismo artículo en dos unidades produce UNA ruta con el total agregado', () => {
  // El impacto llega ya agregado por articleId (así lo arma resolveStockImpact).
  // Dos unidades con Rocklets no deben generar dos escrituras: una sola de -2.
  const { payload, rutas, totalItems } = construirPayloadAtomico({
    localId: LOCAL, referenceId: 'MOSTRADOR_X', increment, movimientoId: 'm',
    impactMap: { 'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' } },
  });
  const rutasStock = rutas.filter((r) => r.includes('/stock'));
  assert.strictEqual(rutasStock.length, 1, `esperaba una sola ruta de stock: ${rutasStock}`);
  assert.strictEqual(totalItems, 1);
  const db = new DbMemoria(datosIniciales());
  db.update(payload);
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18, 'nunca 19 ni dos movimientos');
});
check('un impacto de cantidad 0 no genera ruta de stock', () => {
  const { rutas, totalItems } = construirPayloadAtomico({
    localId: LOCAL, referenceId: 'MOSTRADOR_Y', increment, movimientoId: 'm',
    impactMap: { 'A-ROCKLETS': { quantity: 0, type: 'ARTICULO' } },
  });
  assert.strictEqual(totalItems, 0);
  assert.strictEqual(rutas.filter((r) => r.includes('/stock')).length, 0);
});
check('sin referenceId no se construye nada (no habría idempotencia)', () => {
  assert.throws(() => construirPayloadAtomico({ localId: LOCAL, impactMap: IMPACTO, increment }), /referenceId/);
});

console.log('\nFallos simulados en cada etapa:');
check('caída ANTES de escribir → ningún artículo descontado', () => {
  const db = new DbMemoria(datosIniciales());
  db.romperEn('antes-de-escribir');
  assert.throws(() => procesar(db, refMostrador(2)), /CAIDA/);
  assert.strictEqual(stock(db, 'A-0007'), 10);
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 20);
  assert.strictEqual(marca(db, refMostrador(2)).status, 'processing', 'queda la reserva huérfana');
});
check('caída DURANTE la escritura → tampoco se aplica nada (todo o nada)', () => {
  const db = new DbMemoria(datosIniciales());
  db.romperEn('durante-la-escritura');
  assert.throws(() => procesar(db, refMostrador(3)), /CAIDA/);
  assert.strictEqual(stock(db, 'A-0007'), 10, 'el base NO puede quedar descontado');
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 20, 'el opcional NO puede quedar descontado');
});
check('reintento tras la caída descuenta UNA sola vez', () => {
  const db = new DbMemoria(datosIniciales());
  db.romperEn('durante-la-escritura');
  const ahora = Date.now();
  assert.throws(() => procesar(db, refMostrador(4), IMPACTO, { ahora }), /CAIDA/);
  db.romperEn(null);
  const r = procesar(db, refMostrador(4), IMPACTO, { ahora: ahora + RESERVA_VENCIDA_MS + 1, intento: 2 });
  assert.strictEqual(r.aplicado, true);
  assert.strictEqual(stock(db, 'A-0007'), 9, 'exactamente un descuento');
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
});
check('reintentos repetidos tras completar no vuelven a descontar', () => {
  const db = new DbMemoria(datosIniciales());
  const ahora = Date.now();
  procesar(db, refMostrador(5), IMPACTO, { ahora });
  for (let i = 0; i < 5; i += 1) procesar(db, refMostrador(5), IMPACTO, { ahora: ahora + RESERVA_VENCIDA_MS * (i + 2) });
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
});
check('nunca existe un estado "parcialmente aplicado"', () => {
  for (const momento of ['antes-de-escribir', 'durante-la-escritura']) {
    const db = new DbMemoria(datosIniciales());
    db.romperEn(momento);
    try { procesar(db, refMostrador(9)); } catch { /* esperado */ }
    const m = marca(db, refMostrador(9));
    const algoAplicado = stock(db, 'A-0007') !== 10 || stock(db, 'A-ROCKLETS') !== 20;
    const completada = m && m.status === 'completed';
    assert.strictEqual(algoAplicado, !!completada, `invariante roto en ${momento}`);
  }
});

console.log('\nAislamiento por local:');
check('dos locales con el mismo articleId no se mezclan', () => {
  const db = new DbMemoria({
    LOCAL_A: { ARTICULOS: { 'A-ROCKLETS': { stock: { propio: 20 } } } },
    LOCAL_B: { ARTICULOS: { 'A-ROCKLETS': { stock: { propio: 50 } } } },
  });
  const { payload } = construirPayloadAtomico({
    localId: 'LOCAL_A', referenceId: 'MOSTRADOR_1', increment, movimientoId: 'm1',
    impactMap: { 'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' } },
  });
  db.update(payload);
  assert.strictEqual(db.leer('LOCAL_A/ARTICULOS/A-ROCKLETS/stock/propio'), 18);
  assert.strictEqual(db.leer('LOCAL_B/ARTICULOS/A-ROCKLETS/stock/propio'), 50, 'el otro local no se toca');
});

console.log('\nReversión de mostrador:');
check('repone exactamente lo del ledger, con su propio referenceId', () => {
  const db = new DbMemoria(datosIniciales());
  procesar(db, refMostrador(11));
  const { payload, motivo } = construirPayloadReversion({
    localId: LOCAL, referenceIdOriginal: refMostrador(11),
    marcaOriginal: marca(db, refMostrador(11)),
    referenceIdReversion: refReversionMostrador(11),
    movimientoId: 'mov-rev-11', increment,
  });
  assert.strictEqual(motivo, 'ok');
  db.update(payload);
  assert.strictEqual(stock(db, 'A-0007'), 10);
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 20);
  assert.strictEqual(db.leer(`${LOCAL}/MATERIA_PRIMA/M-3/stock`), 100);
});
check('la marca original NO se borra ni se reutiliza', () => {
  const db = new DbMemoria(datosIniciales());
  procesar(db, refMostrador(12));
  const { payload } = construirPayloadReversion({
    localId: LOCAL, referenceIdOriginal: refMostrador(12),
    marcaOriginal: marca(db, refMostrador(12)),
    referenceIdReversion: refReversionMostrador(12), movimientoId: 'mv', increment,
  });
  db.update(payload);
  assert.strictEqual(marca(db, refMostrador(12)).status, 'completed');
  assert.strictEqual(marca(db, refReversionMostrador(12)).status, 'completed');
});
check('segunda cancelación NO repone dos veces', () => {
  const db = new DbMemoria(datosIniciales());
  const ahora = Date.now();
  procesar(db, refMostrador(13));
  const rutaRev = `${LOCAL}/PROCESSED_STOCK_IDS/${refReversionMostrador(13)}`;
  for (let i = 0; i < 2; i += 1) {
    if (!db.reservar(rutaRev, ahora + i)) continue;
    const { payload } = construirPayloadReversion({
      localId: LOCAL, referenceIdOriginal: refMostrador(13),
      marcaOriginal: marca(db, refMostrador(13)),
      referenceIdReversion: refReversionMostrador(13), movimientoId: `mv${i}`, increment,
    });
    db.update(payload);
  }
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 20, 'nunca 22');
  assert.strictEqual(stock(db, 'A-0007'), 10, 'nunca 11');
});
check('no se puede revertir una operación que nunca se completó', () => {
  const r = construirPayloadReversion({
    localId: LOCAL, referenceIdOriginal: 'X', marcaOriginal: { status: 'processing' },
    referenceIdReversion: 'REVERSAL_X', movimientoId: 'm', increment,
  });
  assert.strictEqual(r.payload, null);
  assert.strictEqual(r.motivo, 'original-no-completada');
});
check('no se puede revertir sin ledger de impacto', () => {
  const r = construirPayloadReversion({
    localId: LOCAL, referenceIdOriginal: 'X', marcaOriginal: { status: 'completed' },
    referenceIdReversion: 'REVERSAL_X', movimientoId: 'm', increment,
  });
  assert.strictEqual(r.payload, null);
  assert.strictEqual(r.motivo, 'sin-impacto-registrado');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
