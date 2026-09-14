'use strict';

// Host fiscal único por local — decisión pura, sin Firebase real.
//
// Nodo Firebase FALSO que respeta `transaction()` de verdad (mismo patrón que
// src/lib/api/__tests__/claimPedidoMultiPC.test.js): el reductor puede
// devolver `undefined` para abortar, y el nodo resultante decide quién ganó.
//
// Correr con: node electron/lib/__tests__/facturacionHost.test.js

const assert = require('node:assert');
const {
  HEARTBEAT_INTERVALO_MS,
  LEASE_MS,
  reductorDeHost,
  reductorDeLiberacion,
  heartbeatVigente,
  esGanador,
} = require('../facturacionHost');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
// Nodo Firebase falso: transaction() atómica de verdad, sincrónica.
// ---------------------------------------------------------------------------
function nodoFirebase(valorInicial = null) {
  let valor = valorInicial;
  return {
    val: () => (valor === null ? null : JSON.parse(JSON.stringify(valor))),
    transaction(reductor) {
      const propuesto = reductor(valor === null ? null : JSON.parse(JSON.stringify(valor)));
      if (propuesto === undefined) return { committed: false, snapshot: { val: () => valor } };
      valor = propuesto;
      return { committed: true, snapshot: { val: () => valor } };
    },
  };
}

const T0 = 1_800_000_000_000; // instante base arbitrario, sólo para legibilidad

// ---------------------------------------------------------------------------
console.log('\nAdquisición — una sola PC:');

check('nodo ausente → una PC elegible gana y arranca', () => {
  const nodo = nodoFirebase(null);
  const r = nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'JOAO-PC', ahora: T0 }));
  assert.strictEqual(r.committed, true);
  assert.strictEqual(r.snapshot.val().machineId, 'pcA');
  assert.strictEqual(r.snapshot.val().leaseUntil, T0 + LEASE_MS);
  assert.strictEqual(r.snapshot.val().claimedAt, T0);
});

check('renovación: la misma PC conserva claimedAt y extiende leaseUntil', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'JOAO-PC', ahora: T0 }));
  const r = nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'JOAO-PC', ahora: T0 + HEARTBEAT_INTERVALO_MS }));
  assert.strictEqual(r.committed, true);
  assert.strictEqual(r.snapshot.val().claimedAt, T0, 'la racha de posesión no se reinicia al renovar');
  assert.strictEqual(r.snapshot.val().leaseUntil, T0 + HEARTBEAT_INTERVALO_MS + LEASE_MS);
});

// ---------------------------------------------------------------------------
console.log('\nAdquisición — varias PCs compitiendo:');

check('dos PCs simultáneas sobre nodo libre → exactamente una gana', () => {
  const nodo = nodoFirebase(null);
  const rA = nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  const rB = nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 }));
  const ganadores = [rA, rB].filter((r) => r.committed);
  assert.strictEqual(ganadores.length, 1);
  assert.strictEqual(nodo.val().machineId, ganadores[0].snapshot.val().machineId);
});

check('10 PCs simultáneas sobre nodo libre → exactamente UN ganador', () => {
  const nodo = nodoFirebase(null);
  const resultados = [];
  for (let i = 0; i < 10; i += 1) {
    resultados.push(nodo.transaction(reductorDeHost({ machineId: `pc${i}`, hostname: `PC${i}`, ahora: T0 })));
  }
  const ganadores = resultados.filter((r) => r.committed);
  assert.strictEqual(ganadores.length, 1, `ganaron ${ganadores.length} de 10`);
  // Y el nodo final coincide exactamente con la única que ganó.
  assert.strictEqual(nodo.val().machineId, ganadores[0].snapshot.val().machineId);
});

check('segunda PC del mismo local, host ya vigente → aborta, 0 arranques', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  const r = nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + 1000 }));
  assert.strictEqual(r.committed, false);
  assert.strictEqual(nodo.val().machineId, 'pcA', 'el dueño vigente no cambia');
});

// ---------------------------------------------------------------------------
console.log('\nHeartbeat, lease vencido y failover:');

check('host pierde heartbeat: pasado el lease, otra PC candidata reclama', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  // A deja de renovar. Justo antes de vencer, sigue vigente:
  const antes = nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + LEASE_MS - 1 }));
  assert.strictEqual(antes.committed, false, 'todavía no venció');
  // El instante exacto del vencimiento todavía cuenta como vigente (límite
  // inclusive, mismo criterio que heartbeatVigente); recién un instante
  // después, B puede tomarlo:
  const despues = nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + LEASE_MS + 1 }));
  assert.strictEqual(despues.committed, true);
  assert.strictEqual(nodo.val().machineId, 'pcB');
});

check('host viejo reaparece después del failover → NO reclama mientras el nuevo lease sea válido', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + LEASE_MS + 5000 })); // B toma tras vencer
  // A "vuelve" e intenta renovar como si nada, con el reloj más adelantado:
  const rAviejo = nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 + LEASE_MS + 6000 }));
  assert.strictEqual(rAviejo.committed, false, 'A no puede reclamar mientras el lease de B siga vigente');
  assert.strictEqual(nodo.val().machineId, 'pcB');
});

check('reinicio del host (mismo machineId, lease propio todavía vigente) → renueva y sigue', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  // "Reinicio" simulado: mismo machineId, un rato después, dentro del lease.
  const r = nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 + 30000 }));
  assert.strictEqual(r.committed, true);
  assert.strictEqual(r.snapshot.val().machineId, 'pcA', 'no se trata como "otra PC"');
});

// ---------------------------------------------------------------------------
console.log('\nheartbeatVigente / esGanador:');

check('heartbeatVigente: dentro y fuera del lease', () => {
  const host = { machineId: 'pcA', leaseUntil: T0 + LEASE_MS };
  assert.strictEqual(heartbeatVigente(host, T0), true);
  assert.strictEqual(heartbeatVigente(host, T0 + LEASE_MS), true, 'justo al vencer todavía cuenta como vigente');
  assert.strictEqual(heartbeatVigente(host, T0 + LEASE_MS + 1), false);
  assert.strictEqual(heartbeatVigente(null, T0), false);
});

check('esGanador: identifica al dueño actual sin mirar el lease', () => {
  assert.strictEqual(esGanador({ machineId: 'pcA' }, 'pcA'), true);
  assert.strictEqual(esGanador({ machineId: 'pcA' }, 'pcB'), false);
  assert.strictEqual(esGanador(null, 'pcA'), false);
});

// ---------------------------------------------------------------------------
console.log('\nLiberación (cierre normal y handoff):');

check('cierre normal: libera sólo si machineId coincide', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  const r = nodo.transaction(reductorDeLiberacion({ machineId: 'pcA' }));
  assert.strictEqual(r.committed, true);
  assert.strictEqual(nodo.val(), null, 'el nodo queda libre de verdad');
});

check('liberación: si ya no soy el dueño, aborta sin tocar nada ajeno', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + LEASE_MS + 1 })); // B ya lo tomó
  const r = nodo.transaction(reductorDeLiberacion({ machineId: 'pcA' })); // A, tarde, intenta soltar
  assert.strictEqual(r.committed, false);
  assert.strictEqual(nodo.val().machineId, 'pcB', 'no se toca el host de B');
});

check('liberar un nodo ya ausente no rompe nada', () => {
  const nodo = nodoFirebase(null);
  const r = nodo.transaction(reductorDeLiberacion({ machineId: 'pcA' }));
  assert.strictEqual(r.committed, false);
  assert.strictEqual(nodo.val(), null);
});

check('cierre abrupto: sin liberación, el lease vence solo y otra PC reclama igual', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  // Sin ninguna liberación explícita (simula un corte de luz):
  const r = nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + LEASE_MS + 1 }));
  assert.strictEqual(r.committed, true);
  assert.strictEqual(nodo.val().machineId, 'pcB');
});

// ---------------------------------------------------------------------------
console.log('\nSeguridad: ningún reductor puede pisar un lease vigente ajeno:');

check('reductorDeHost NUNCA reclama un lease vigente ajeno, sin excepción', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  for (let dt = 0; dt < LEASE_MS; dt += 5000) {
    const r = nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + dt }));
    assert.strictEqual(r.committed, false, `no debería poder reclamar en ahora=T0+${dt}`);
  }
  assert.strictEqual(nodo.val().machineId, 'pcA');
});

check('el módulo no exporta ningún reductor "siempre reclama" (auditoría de superficie)', () => {
  const facturacionHost = require('../facturacionHost');
  const exportados = Object.keys(facturacionHost);
  assert.deepStrictEqual(
    exportados.sort(),
    [
      'HEARTBEAT_INTERVALO_MS', 'LEASE_MS', 'TOMA_CONTROL_REINTENTO_MS', 'TOMA_CONTROL_TIMEOUT_MS',
      'esGanador', 'heartbeatVigente', 'reductorDeHost', 'reductorDeLiberacion',
    ].sort(),
    'si aparece un export nuevo acá, hay que auditar explícitamente que no pueda pisar un lease vigente'
  );
});

// ---------------------------------------------------------------------------
console.log('\nHandoff seguro ("Tomar control fiscal") — simulación de la secuencia completa:');

/**
 * Simula la secuencia completa de electron/main.js para un traslado A→B:
 * B solicita → A detiene sus motores → A libera (transaction) → B adquiere
 * (transaction) → B arranca. Devuelve un LOG de eventos, en orden, para poder
 * afirmar sobre la secuencia exacta.
 */
function simularHandoff({ aResponde }) {
  const nodo = nodoFirebase(null);
  const eventos = [];
  const motoresB = { corriendo: false };

  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  eventos.push({ paso: 'A-gana-inicial', hostNodo: nodo.val()?.machineId, motoresBCorriendo: motoresB.corriendo });

  eventos.push({ paso: 'B-solicita-transferencia', hostNodo: nodo.val()?.machineId, motoresBCorriendo: motoresB.corriendo });

  if (aResponde) {
    // A detiene sus motores ANTES de soltar (orden que exige el plan).
    eventos.push({ paso: 'A-detiene-motores', hostNodo: nodo.val()?.machineId, motoresBCorriendo: motoresB.corriendo });
    const rLiberar = nodo.transaction(reductorDeLiberacion({ machineId: 'pcA' }));
    eventos.push({ paso: 'A-libera', ok: rLiberar.committed, hostNodo: nodo.val(), motoresBCorriendo: motoresB.corriendo });
  }

  const rAdquirir = nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + 3000 }));
  eventos.push({ paso: 'B-intenta-adquirir', ok: rAdquirir.committed, hostNodo: nodo.val()?.machineId, motoresBCorriendo: motoresB.corriendo });

  if (rAdquirir.committed) {
    motoresB.corriendo = true; // B SÓLO arranca después de ganar, nunca antes.
    eventos.push({ paso: 'B-arranca-motores', hostNodo: nodo.val()?.machineId, motoresBCorriendo: motoresB.corriendo });
  }

  return { nodo, eventos, motoresB, gano: rAdquirir.committed };
}

check('transferencia A→B: B no arranca hasta que A detuvo motores y liberó el host', () => {
  const { eventos, motoresB, gano, nodo } = simularHandoff({ aResponde: true });
  assert.strictEqual(gano, true);
  assert.strictEqual(motoresB.corriendo, true);
  assert.strictEqual(nodo.val().machineId, 'pcB');

  const idxLibera = eventos.findIndex((e) => e.paso === 'A-libera');
  const idxArranca = eventos.findIndex((e) => e.paso === 'B-arranca-motores');
  assert.ok(idxLibera >= 0 && idxArranca >= 0 && idxLibera < idxArranca, 'A tiene que soltar ANTES de que B arranque');

  // El evento de arranque de B es el ÚNICO con motoresBCorriendo:true.
  const conMotoresCorriendo = eventos.filter((e) => e.motoresBCorriendo === true);
  assert.strictEqual(conMotoresCorriendo.length, 1);
  assert.strictEqual(conMotoresCorriendo[0].paso, 'B-arranca-motores');
});

check('invariante del handoff: en NINGÚN evento el nodo dice "pcA" con los motores de B ya corriendo', () => {
  const { eventos } = simularHandoff({ aResponde: true });
  const violacion = eventos.find((e) => e.hostNodo === 'pcA' && e.motoresBCorriendo === true);
  assert.strictEqual(violacion, undefined, `se encontró un estado inseguro: ${JSON.stringify(violacion)}`);
});

check('A no responde a la transferencia → B espera al vencimiento del lease, nunca se salta el lease vigente', () => {
  const { gano, motoresB } = simularHandoff({ aResponde: false });
  assert.strictEqual(gano, false, 'sin que A suelte, B no puede ganar todavía');
  assert.strictEqual(motoresB.corriendo, false);

  // B sigue el camino normal de failover: recién gana cuando el lease real vence.
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  // Reintentos "rápidos" de B mientras el lease sigue vigente: todos abortan.
  for (let dt = 2000; dt < LEASE_MS; dt += 2000) {
    const r = nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + dt }));
    assert.strictEqual(r.committed, false, `no debe ganar en ahora=T0+${dt} sin que A haya liberado`);
  }
  const rFinal = nodo.transaction(reductorDeHost({ machineId: 'pcB', hostname: 'B', ahora: T0 + LEASE_MS + 1 }));
  assert.strictEqual(rFinal.committed, true, 'recién al vencer el lease real, por la vía normal');
});

check('dos solicitudes de transferencia simultáneas → sólo una PC termina siendo host', () => {
  const nodo = nodoFirebase(null);
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 }));
  // A procesa la solicitud (no importa cuál de las dos disparó el handler primero:
  // A suelta UNA vez) y libera:
  nodo.transaction(reductorDeHost({ machineId: 'pcA', hostname: 'A', ahora: T0 })); // (no-op extra, sigue siendo A)
  const rLibera = nodo.transaction(reductorDeLiberacion({ machineId: 'pcA' }));
  assert.strictEqual(rLibera.committed, true);

  // B1 y B2 compiten por el nodo ya libre, "simultáneamente":
  const rB1 = nodo.transaction(reductorDeHost({ machineId: 'pcB1', hostname: 'B1', ahora: T0 + 100 }));
  const rB2 = nodo.transaction(reductorDeHost({ machineId: 'pcB2', hostname: 'B2', ahora: T0 + 100 }));
  const ganadores = [rB1, rB2].filter((r) => r.committed);
  assert.strictEqual(ganadores.length, 1, `ganaron ${ganadores.length} de 2 solicitantes`);
  assert.strictEqual(nodo.val().machineId, ganadores[0].snapshot.val().machineId);
});

// ---------------------------------------------------------------------------
console.log('\nOffset de reloj de servidor — comparaciones consistentes entre PCs desincronizadas:');

check('dos PCs con relojes locales distintos, corregidos por offset, coinciden en el veredicto', () => {
  // Reloj "real" del servidor: SIEMPRE T0-based. Cada PC simula su propio
  // desvío de reloj local con un offset distinto, y ambas calculan
  // `ahora = relojLocal + offset` — el resultado tiene que coincidir.
  const relojServidorReal = (t) => t; // referencia neutra para el test

  const pcConRelojAdelantado = { relojLocal: T0 + 5 * 60 * 1000, offset: -5 * 60 * 1000 }; // 5 min adelantada, offset lo corrige
  const pcConRelojAtrasado   = { relojLocal: T0 - 3 * 60 * 1000, offset: 3 * 60 * 1000 };   // 3 min atrasada, offset lo corrige

  const ahoraA = pcConRelojAdelantado.relojLocal + pcConRelojAdelantado.offset;
  const ahoraB = pcConRelojAtrasado.relojLocal + pcConRelojAtrasado.offset;
  assert.strictEqual(ahoraA, relojServidorReal(T0));
  assert.strictEqual(ahoraB, relojServidorReal(T0));

  // Con la referencia corregida, las dos PCs coinciden en si un lease venció o no.
  const host = { machineId: 'pcA', leaseUntil: T0 + LEASE_MS };
  assert.strictEqual(heartbeatVigente(host, ahoraA), heartbeatVigente(host, ahoraB));
});

check('sin corregir por offset, dos relojes desincronizados PUEDEN discrepar (motivo real de la corrección)', () => {
  const host = { machineId: 'pcA', leaseUntil: T0 + LEASE_MS };
  const relojLocalAdelantado = T0 + LEASE_MS + 1000; // "cree" que ya venció
  const relojLocalAtrasado = T0 + 1000; // "cree" que sigue vigente
  assert.notStrictEqual(
    heartbeatVigente(host, relojLocalAdelantado),
    heartbeatVigente(host, relojLocalAtrasado),
    'sin offset, dos PCs pueden discrepar sobre si el lease venció — por eso se corrige con serverTimeOffset'
  );
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
