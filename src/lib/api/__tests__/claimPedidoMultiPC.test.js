// Reparto de un pedido entre DOS PCs y reconciliación contra ARCA.
//
// Simula dos motores (PC_A y PC_B) compitiendo por el MISMO pedido sobre un
// Firebase falso que respeta la semántica real de `transaction()`: el reductor
// puede devolver `undefined` para abortar, y el nodo que queda es el que decide
// quién ganó.
//
// La regla que se fija: para una misma venta puede existir UN solo comprobante
// fiscal, pase lo que pase — incluso si una PC obtiene el CAE y se cierra antes
// de registrarlo.
//
// Correr con: node src/lib/api/__tests__/claimPedidoMultiPC.test.js
import assert from 'node:assert';
import {
  CLAIM_TTL_MS,
  reductorDeClaim,
  gano,
  marcaDeIntento,
  decidirEmision,
  sinDatosOperativos,
} from '../../../../resources/facturacion/lib/claimPedido.mjs';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
// Firebase falso: un nodo con transacción atómica de verdad.
// ---------------------------------------------------------------------------
function nodoFirebase(valorInicial) {
  let valor = valorInicial;
  return {
    val: () => (valor === null ? null : JSON.parse(JSON.stringify(valor))),
    remove() { valor = null; },
    transaction(reductor) {
      const propuesto = reductor(valor === null ? null : JSON.parse(JSON.stringify(valor)));
      if (propuesto === undefined) return { committed: false, snapshot: { val: () => valor } };
      valor = propuesto;
      return { committed: true, snapshot: { val: () => (valor === null ? null : JSON.parse(JSON.stringify(valor))) } };
    },
  };
}

/** ARCA falso: sabe qué números autorizó, y cuál es el último. */
function arcaFalso() {
  const autorizados = new Map();   // nroCbte → { CodAutorizacion, FchVto }
  let ultimo = 124;
  return {
    ultimoAutorizado: () => ultimo,
    autorizar(nroCbte) {
      const cae = { CodAutorizacion: `CAE-${nroCbte}`, FchVto: '20260930' };
      autorizados.set(nroCbte, cae);
      ultimo = Math.max(ultimo, nroCbte);
      return { CAE: cae.CodAutorizacion, CAEFchVto: cae.FchVto };
    },
    consultar: (nroCbte) => autorizados.get(nroCbte) || null,
    cantidadAutorizados: () => autorizados.size,
  };
}

const PC_A = 'PC_A';
const PC_B = 'PC_B';
const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
console.log('\nCaso A — las dos PCs reciben el pedido al mismo tiempo:');

check('gana una sola: la otra no procesa', () => {
  const nodo = nodoFirebase({ TOTAL: 14400 });

  const rA = nodo.transaction(reductorDeClaim(PC_A, T0));
  const rB = nodo.transaction(reductorDeClaim(PC_B, T0 + 10));   // 10 ms después

  assert.strictEqual(gano(rA, PC_A), true, 'PC_A tenía que ganar');
  assert.strictEqual(gano(rB, PC_B), false, 'PC_B no puede ganar un claim vigente');
  assert.strictEqual(nodo.val().claim.machineId, PC_A);
});

check('el orden no importa: siempre gana exactamente una', () => {
  const nodo = nodoFirebase({ TOTAL: 14400 });
  const rB = nodo.transaction(reductorDeClaim(PC_B, T0));
  const rA = nodo.transaction(reductorDeClaim(PC_A, T0 + 10));
  assert.strictEqual(gano(rB, PC_B), true);
  assert.strictEqual(gano(rA, PC_A), false);
  assert.strictEqual([gano(rA, PC_A), gano(rB, PC_B)].filter(Boolean).length, 1);
});

check('la PC que ganó puede re-entrar a su propio claim (reintento)', () => {
  const nodo = nodoFirebase({ TOTAL: 14400 });
  nodo.transaction(reductorDeClaim(PC_A, T0));
  const otra = nodo.transaction(reductorDeClaim(PC_A, T0 + 1000));
  assert.strictEqual(gano(otra, PC_A), true, 'su propio claim no puede bloquearla');
});

check('emisiones totales del caso A: 1', () => {
  const arca = arcaFalso();
  const nodo = nodoFirebase({ TOTAL: 14400 });
  for (const pc of [PC_A, PC_B]) {
    const r = nodo.transaction(reductorDeClaim(pc, T0));
    if (!gano(r, pc)) continue;
    const d = decidirEmision({ claveEnHistorial: null, intentoPrevio: null, comprobanteEnArca: null });
    if (d.accion === 'emitir') arca.autorizar(arca.ultimoAutorizado() + 1);
  }
  assert.strictEqual(arca.cantidadAutorizados(), 1);
});

// ---------------------------------------------------------------------------
console.log('\nCaso B — PC_A gana pero muere ANTES de llegar a ARCA:');

check('vencido el TTL, PC_B retoma y emite; total de comprobantes: 1', () => {
  const arca = arcaFalso();
  const nodo = nodoFirebase({ TOTAL: 14400 });

  // PC_A gana y se cae sin anotar intento ni llamar a ARCA.
  assert.strictEqual(gano(nodo.transaction(reductorDeClaim(PC_A, T0)), PC_A), true);

  // Antes del TTL, PC_B no puede tocarlo.
  assert.strictEqual(gano(nodo.transaction(reductorDeClaim(PC_B, T0 + CLAIM_TTL_MS - 1)), PC_B), false);

  // Vencido el TTL, sí.
  const rB = nodo.transaction(reductorDeClaim(PC_B, T0 + CLAIM_TTL_MS + 1));
  assert.strictEqual(gano(rB, PC_B), true);

  const d = decidirEmision({
    claveEnHistorial: null,
    intentoPrevio: rB.snapshot.val().claim.intento || null,
    comprobanteEnArca: null,
  });
  assert.strictEqual(d.accion, 'emitir');
  arca.autorizar(arca.ultimoAutorizado() + 1);
  assert.strictEqual(arca.cantidadAutorizados(), 1);
});

// ---------------------------------------------------------------------------
console.log('\nCaso C (CRÍTICO) — ARCA autorizó pero PC_A murió antes del historial:');

/** Corre el caso C completo para un motor. Devuelve cuántos CAE se pidieron. */
function correrCasoC({ cbteTipo }) {
  const arca = arcaFalso();
  const nodo = nodoFirebase({ TOTAL: 14400 });

  // ── PC_A ──────────────────────────────────────────────────────────────
  const rA = nodo.transaction(reductorDeClaim(PC_A, T0));
  assert.strictEqual(gano(rA, PC_A), true);

  const nroA = arca.ultimoAutorizado() + 1;                    // 125
  // Anota la INTENCIÓN antes de pedir el CAE. Esto es lo que salva el caso.
  nodo.transaction((p) => ({
    ...p,
    claim: { ...p.claim, intento: marcaDeIntento({ nroCbte: nroA, ptoVta: 8, cbteTipo, machineId: PC_A, ahora: T0 }) },
  }));
  arca.autorizar(nroA);                                        // ARCA AUTORIZA el 125
  // …y acá PC_A se cierra. No escribió historial ni borró el pedido.

  // ── PC_B, pasado el TTL ───────────────────────────────────────────────
  const rB = nodo.transaction(reductorDeClaim(PC_B, T0 + CLAIM_TTL_MS + 1));
  assert.strictEqual(gano(rB, PC_B), true);

  const intentoPrevio = rB.snapshot.val().claim.intento;
  assert.strictEqual(intentoPrevio.nroCbte, 125, 'PC_B tiene que ver el intento de PC_A');

  const d = decidirEmision({
    claveEnHistorial: null,                                    // PC_A nunca lo escribió
    intentoPrevio,
    comprobanteEnArca: arca.consultar(intentoPrevio.nroCbte),  // FECompConsultar(125)
  });

  assert.strictEqual(d.accion, 'reconciliar', 'no puede emitir: ARCA ya autorizó el 125');
  assert.strictEqual(d.nroCbte, 125, 'usa el 125, no el 126');
  assert.strictEqual(d.cae.CAE, 'CAE-125');
  return { arca, decision: d };
}

check('Monotributo (Factura C, CbteTipo 11): reconcilia, no re-emite', () => {
  const { arca, decision } = correrCasoC({ cbteTipo: 11 });
  assert.strictEqual(arca.cantidadAutorizados(), 1, 'un solo comprobante fiscal');
  assert.strictEqual(decision.nroCbte, 125);
});

check('Responsable Inscripto (Factura B, CbteTipo 6): reconcilia, no re-emite', () => {
  const { arca, decision } = correrCasoC({ cbteTipo: 6 });
  assert.strictEqual(arca.cantidadAutorizados(), 1, 'un solo comprobante fiscal');
  assert.strictEqual(decision.nroCbte, 125);
});

check('NO se salta al 126 ni se pide de nuevo el 125', () => {
  const { arca } = correrCasoC({ cbteTipo: 11 });
  assert.strictEqual(arca.consultar(126), null, 'el 126 no puede existir');
  assert.strictEqual(arca.ultimoAutorizado(), 125);
});

// ---------------------------------------------------------------------------
console.log('\nOrden de las barreras:');

check('el historial gana sobre todo: si ya está, no se emite', () => {
  const d = decidirEmision({
    claveEnHistorial: 'FCC0008-00000125',
    intentoPrevio: { nroCbte: 125 },
    comprobanteEnArca: { CodAutorizacion: 'CAE-125' },
  });
  assert.strictEqual(d.accion, 'ya-facturado');
});

check('sin intento previo se emite normalmente', () => {
  assert.strictEqual(decidirEmision({}).accion, 'emitir');
});

check('intento previo que ARCA NO autorizó → se emite', () => {
  const d = decidirEmision({ intentoPrevio: { nroCbte: 125 }, comprobanteEnArca: null });
  assert.strictEqual(d.accion, 'emitir');
});

// ---------------------------------------------------------------------------
console.log('\nEl claim no contamina el comprobante:');

check('`claim` no llega al historial ni al PDF', () => {
  const pedido = {
    TOTAL: 14400,
    CLIENTE: 'Consumidor Final',
    claim: { machineId: PC_A, at: T0, intento: { nroCbte: 125 } },
  };
  const limpio = sinDatosOperativos(pedido);
  assert.strictEqual(limpio.claim, undefined, 'claim es dato operativo, no fiscal');
  assert.strictEqual(limpio.TOTAL, 14400, 'el resto del pedido queda intacto');
  assert.strictEqual(pedido.claim.machineId, PC_A, 'no muta el original');
});

check('un pedido borrado por la otra PC no se reclama', () => {
  const nodo = nodoFirebase(null);
  const r = nodo.transaction(reductorDeClaim(PC_A, T0));
  assert.strictEqual(gano(r, PC_A), false, 'no hay nada que facturar');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
