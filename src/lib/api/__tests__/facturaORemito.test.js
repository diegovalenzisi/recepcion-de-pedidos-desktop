// FACTURA o REMITO: la decisión sale del interruptor "Imprime Factura" de la
// cuenta, NUNCA del nombre del medio de pago; y el comprobante es SIEMPRE UNO
// SOLO por el TOTAL COMPLETO de la venta.
// Módulo puro → corre sin Firebase: node src/lib/api/__tests__/facturaORemito.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAMPO_IMPRIME_FACTURA,
  COLAS_POR_CUENTA,
  esColaFiscalValida,
  COMPROBANTE_FACTURA,
  COMPROBANTE_REMITO,
  IMPRIME_FACTURA_POR_DEFECTO,
  colaFiscalDeCuenta,
  cuentaFavorita,
  decidirComprobante,
  encoladoBloqueado,
  imprimeFacturaResuelto,
  indexarCuentas,
  leerImprimeFactura,
  mensajeDeBloqueo,
  normalizarNombreCuenta,
  resolverEncolado,
  resolverReglaMedioPago,
  resolverCuentaDeAliasFavorito,
  resolverCuentaAsociadaDePlataforma,
  cuentasAsociablesParaFacturacion,
  validarAsociacionPlataforma,
  plataformaDeCuenta,
  CAMPO_CUENTA_ASOCIADA,
  esVentaSoloEfectivo,
  puedeEntrarAFacturacion,
  REGLA,
  ventaSeFactura,
} from '../facturaORemito.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

/** Cuentas tal como las guarda /{localId}/CUENTAS. */
const cuenta = (nombre, imprimeFactura, extra = {}) => ({
  nombre,
  ...(imprimeFactura === undefined ? {} : { imprimeFactura }),
  ...extra,
});

const venta = (...metodos) => ({
  id: 27,
  total: metodos.reduce((s, [, importe]) => s + importe, 0),
  payments: metodos.map(([method, amount]) => ({ method, amount })),
});

const decidir = (v, cuentas, emiteFacturaManual = false) =>
  decidirComprobante({ venta: v, cuentas, emiteFacturaManual });

/** Decisión + cola, que es lo que consumen los flujos de venta. */
const resolver = (v, cuentas, emiteFacturaManual = false) => {
  const d = decidir(v, cuentas, emiteFacturaManual);
  return { ...d, encolado: resolverEncolado(d, cuentas) };
};

console.log('\nEl campo real:');
check('el interruptor se llama imprimeFactura', () => {
  assert.strictEqual(CAMPO_IMPRIME_FACTURA, 'imprimeFactura');
});
check('lee true / false y distingue el campo AUSENTE', () => {
  assert.strictEqual(leerImprimeFactura({ nombre: 'X', imprimeFactura: true }), true);
  assert.strictEqual(leerImprimeFactura({ nombre: 'X', imprimeFactura: false }), false);
  assert.strictEqual(leerImprimeFactura({ nombre: 'X' }), null, 'ausente no es false');
  assert.strictEqual(leerImprimeFactura(null), null);
});
check('tolera el booleano guardado como texto o número', () => {
  assert.strictEqual(leerImprimeFactura({ imprimeFactura: 'true' }), true);
  assert.strictEqual(leerImprimeFactura({ imprimeFactura: 'false' }), false);
  assert.strictEqual(leerImprimeFactura({ imprimeFactura: 1 }), true);
  assert.strictEqual(leerImprimeFactura({ imprimeFactura: 0 }), false);
});
check('campo ausente → comportamiento histórico documentado (false)', () => {
  assert.strictEqual(IMPRIME_FACTURA_POR_DEFECTO, false);
  assert.strictEqual(imprimeFacturaResuelto({ nombre: 'Cuenta nueva' }), false);
});
check('las cuentas se indexan por nombre normalizado', () => {
  const indice = indexarCuentas([cuenta('  Transferencia   2 ', true)]);
  assert.strictEqual(indice.get('TRANSFERENCIA 2').imprimeFactura, true);
});
check('acepta las cuentas como mapa de Firebase, no sólo como array', () => {
  assert.strictEqual(indexarCuentas({ 'cta-1': cuenta('Mercado Pago', true) }).size, 1);
});
check('la normalización sólo toca mayúsculas y espacios', () => {
  assert.strictEqual(normalizarNombreCuenta('  transferencia   2  '), 'TRANSFERENCIA 2');
  assert.strictEqual(normalizarNombreCuenta('Banco 1'), 'BANCO 1');
  assert.notStrictEqual(normalizarNombreCuenta('Transferencia 2'), normalizarNombreCuenta('Transferencia'));
});

console.log('\nTabla de colas fiscales (coincidencia EXACTA):');
// Esquema definitivo: transferencias 1–5, medios bancarios/digitales 6–9.
// PEDIDOSYA y RAPPI NO están: no tienen cola propia, facturan por la
// Transferencia que se les asocia.
const TABLA = [
  ['Transferencia', 'FACTURACION_1'],
  ['Transferencia 2', 'FACTURACION_2'],
  ['Transferencia 3', 'FACTURACION_3'],
  ['Transferencia 4', 'FACTURACION_4'],
  ['Transferencia 5', 'FACTURACION_5'],
  ['Mercado Pago', 'FACTURACION_6'],
  ['Cuenta DNI', 'FACTURACION_7'],
  ['Banco 1', 'FACTURACION_8'],
  ['Banco 2', 'FACTURACION_9'],
];
for (const [nombre, cola] of TABLA) {
  check(`${nombre} → ${cola}`, () => {
    assert.strictEqual(colaFiscalDeCuenta(nombre), cola);
    assert.strictEqual(colaFiscalDeCuenta(nombre.toLowerCase()), cola, 'no tolera minúsculas');
    assert.strictEqual(colaFiscalDeCuenta(`  ${nombre}  `), cola, 'no tolera espacios de más');
  });
}
check('nueve cuentas, nueve colas distintas, sin repetir ninguna', () => {
  const colas = Object.values(COLAS_POR_CUENTA);
  assert.strictEqual(Object.keys(COLAS_POR_CUENTA).length, 9);
  assert.strictEqual(new Set(colas).size, 9, 'dos cuentas no pueden compartir cola: cada una es un CUIT distinto');
});

check('las plataformas NO tienen cola propia en el mapa', () => {
  // Los mapeos viejos (PedidosYa a FACTURACION_1, Rappi a FACTURACION_9) se
  // eliminaron: mandaban a una cola fija sin mirar la cuenta asociada.
  assert.strictEqual(COLAS_POR_CUENTA['PREPAGO PEDIDOSYA'], undefined);
  assert.strictEqual(COLAS_POR_CUENTA['PREPAGO RAPPI'], undefined);
  assert.strictEqual(colaFiscalDeCuenta('PREPAGO PEDIDOSYA'), null);
  assert.strictEqual(colaFiscalDeCuenta('PREPAGO RAPPI'), null);
});

check('el tope es FACTURACION_9: no existe la 10 ni superior', () => {
  for (const c of ['FACTURACION_1', 'FACTURACION_5', 'FACTURACION_9']) {
    assert.strictEqual(esColaFiscalValida(c), true, c);
  }
  for (const c of ['FACTURACION_10', 'FACTURACION_11', 'FACTURACION_0', 'FACTURACION', '']) {
    assert.strictEqual(esColaFiscalValida(c), false, c);
  }
  for (const cola of Object.values(COLAS_POR_CUENTA)) {
    assert.strictEqual(esColaFiscalValida(cola), true, `${cola} tiene que entrar en el esquema 1..9`);
  }
});
check('"Transferencia 2" NUNCA cae en la cola de "Transferencia"', () => {
  assert.strictEqual(colaFiscalDeCuenta('Transferencia 2'), 'FACTURACION_2');
  assert.notStrictEqual(colaFiscalDeCuenta('Transferencia 2'), 'FACTURACION_1');
  assert.strictEqual(colaFiscalDeCuenta('Transferencia 3'), 'FACTURACION_3');
});
check('sin coincidencias parciales: un nombre parecido no hereda cola', () => {
  for (const parecido of ['Transferencia Bancaria', 'Mercado Pago 2', 'Banco', 'Transferencias', 'DNI']) {
    assert.strictEqual(colaFiscalDeCuenta(parecido), null, `"${parecido}" no debería tener cola`);
  }
});
check('una cuenta fuera de la tabla no tiene cola', () => {
  assert.strictEqual(colaFiscalDeCuenta('Efectivo'), null);
  assert.strictEqual(colaFiscalDeCuenta('Billetera Futura'), null);
  assert.strictEqual(colaFiscalDeCuenta(''), null);
  assert.strictEqual(colaFiscalDeCuenta(null), null);
});

// Cuentas SIN regla por medio de pago: para ellas manda el interruptor, igual
// que siempre. Transferencia 1/2/3, Efectivo y PedidosYa quedan fuera porque
// ahora los gobierna la regla (se prueban en su propio bloque, más abajo).
console.log('\nSin regla por nombre, el interruptor sigue decidiendo:');
const APAGADAS = [
  'Cuenta DNI', 'Mercado Pago',
  'Banco 1', 'Banco 2', 'Cuenta que todavía no existe',
];
for (const nombre of APAGADAS) {
  check(`"${nombre}" apagada, tilde OFF → FCX por el total`, () => {
    const d = resolver(venta([nombre, 8000]), [cuenta(nombre, false)]);
    assert.strictEqual(d.comprobante, COMPROBANTE_REMITO);
    assert.strictEqual(d.debeFacturarse, false);
    assert.strictEqual(d.total, 8000);
    assert.strictEqual(d.encolado.estado, 'sin-factura');
  });
}

console.log('\nCon regla por nombre, el interruptor apagado YA NO corta la facturación:');
for (const nombre of ['Transferencia', 'Transferencia 2', 'Transferencia 3', 'PREPAGO PEDIDOSYA']) {
  check(`"${nombre}" apagada → se factura IGUAL, por regla`, () => {
    const d = resolver(venta([nombre, 8000]), [cuenta(nombre, false)]);
    assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
    // Una plataforma sin cuenta asociada configurada NO encola: se detiene con
    // el error a la vista, nunca cae a FACTURACION_1 ni degrada a remito.
    const esperado = resolverReglaMedioPago(nombre).requiereCuentaAsociada ? 'sin-cola' : 'encolar';
    assert.strictEqual(d.encolado.estado, esperado);
    if (d.encolado.estado === 'encolar') assert.strictEqual(d.encolado.total, 8000);
    assert.strictEqual(d.contradicciones.length, 1, 'la contradicción tiene que quedar registrada');
  });
}
check('"Efectivo" apagado → FCX, como corresponde', () => {
  const d = resolver(venta(['Efectivo', 8000]), [cuenta('Efectivo', false)]);
  assert.strictEqual(d.comprobante, COMPROBANTE_REMITO);
  assert.strictEqual(d.encolado.estado, 'sin-factura');
});
check('"Efectivo" no está en CUENTAS: sin cuenta → FCX (histórico)', () => {
  const d = resolver(venta(['Efectivo', 5000]), [cuenta('Transferencia', true)]);
  assert.strictEqual(d.comprobante, COMPROBANTE_REMITO);
  assert.deepStrictEqual(d.metodosSinCampo, ['Efectivo']);
});
check('la cuenta existe pero nunca guardó el campo: sin regla → FCX y queda avisado', () => {
  const d = resolver(venta(['Mercado Pago', 5000]), [cuenta('Mercado Pago')]);
  assert.strictEqual(d.comprobante, COMPROBANTE_REMITO);
  assert.deepStrictEqual(d.metodosSinCampo, ['Mercado Pago']);
});
check('la cuenta nunca guardó el campo pero SÍ tiene regla → factura igual', () => {
  const d = resolver(venta(['Transferencia', 5000]), [cuenta('Transferencia')]);
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
  assert.strictEqual(d.encolado.cola, 'FACTURACION_1');
  assert.deepStrictEqual(d.metodosSinCampo, ['Transferencia'], 'igual queda avisado que falta el campo');
});

console.log('\nUna cuenta encendida → UNA factura por el TOTAL, en SU cola:');
// PedidosYa queda afuera: su cola NO es fija, la resuelve el alias favorito.
for (const [nombre, cola] of TABLA.filter(([n]) => !resolverReglaMedioPago(n).requiereCuentaAsociada)) {
  check(`"${nombre}" encendida → ${cola} por el total`, () => {
    const d = resolver(venta([nombre, 9500]), [cuenta(nombre, true)]);
    assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
    assert.strictEqual(d.encolado.estado, 'encolar');
    assert.strictEqual(d.encolado.cola, cola);
    assert.strictEqual(d.encolado.total, 9500);
    // El criterio depende de quién resolvió: la REGLA por medio de pago cuando
    // el nombre la tiene, y el interruptor de la cuenta en los demás casos.
    const esperado = resolverReglaMedioPago(nombre).cola
      ? `regla-medio-de-pago:${resolverReglaMedioPago(nombre).regla}`
      : 'unica-cuenta-que-factura';
    assert.strictEqual(d.encolado.criterio, esperado);
  });
}

console.log('\nPagos combinados (Opción A): una cuenta encendida basta:');
check('Efectivo false + Transferencia true → factura TOTAL por FACTURACION_1', () => {
  const d = resolver(
    venta(['Efectivo', 3000], ['Transferencia', 2000]),
    [cuenta('Transferencia', true)]
  );
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
  assert.strictEqual(d.encolado.cola, 'FACTURACION_1');
  assert.strictEqual(d.encolado.total, 5000, 'facturó un importe parcial');
});
check('Efectivo false + Mercado Pago true → factura TOTAL por FACTURACION_6', () => {
  const d = resolver(
    venta(['Efectivo', 3000], ['Mercado Pago', 1500]),
    [cuenta('Mercado Pago', true)]
  );
  assert.strictEqual(d.encolado.cola, 'FACTURACION_6');
  assert.strictEqual(d.encolado.total, 4500);
});
check('todas apagadas → UN FCX por el total, ninguna factura', () => {
  const d = resolver(
    venta(['Efectivo', 3000], ['Cuenta DNI', 2000], ['Mercado Pago', 1000]),
    [cuenta('Cuenta DNI', false), cuenta('Mercado Pago', false)]
  );
  assert.strictEqual(d.comprobante, COMPROBANTE_REMITO);
  assert.strictEqual(d.total, 6000);
  assert.strictEqual(d.encolado.estado, 'sin-factura');
});
check('Transferencia true + Mercado Pago true, favorita entre ellas → UNA factura total', () => {
  const d = resolver(
    venta(['Transferencia', 2000], ['Mercado Pago', 4000]),
    [cuenta('Transferencia', true, { isFavorite: true }), cuenta('Mercado Pago', true)]
  );
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
  assert.strictEqual(d.encolado.cola, 'FACTURACION_1');
  assert.strictEqual(d.encolado.total, 6000);
  assert.strictEqual(d.encolado.criterio, 'cuenta-favorita-entre-las-que-facturan');
});
check('todas las cuentas usadas en true → UNA sola factura total, nunca FCX', () => {
  const d = resolver(
    venta(['Transferencia 2', 1000], ['Banco 1', 2000], ['Cuenta DNI', 3000]),
    [
      cuenta('Transferencia 2', true),
      cuenta('Banco 1', true, { isFavorite: true }),
      cuenta('Cuenta DNI', true),
    ]
  );
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
  assert.strictEqual(d.encolado.cola, 'FACTURACION_8', 'Banco 1 pasó de la 6 a la 8');
  assert.strictEqual(d.encolado.total, 6000);
});
check('varias encendidas y la favorita NO es una de ellas → se DETIENE, no se elige a dedo', () => {
  const d = resolver(
    venta(['Transferencia', 2000], ['Mercado Pago', 4000]),
    [cuenta('Transferencia', true), cuenta('Mercado Pago', true), cuenta('Banco 2', false, { isFavorite: true })]
  );
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
  assert.strictEqual(d.encolado.estado, 'ambiguo');
  assert.ok(encoladoBloqueado(d.encolado));
  assert.ok(mensajeDeBloqueo(d.encolado).includes('Transferencia'));
});

console.log('\nTilde manual "Emite Factura" (override):');
check('todas apagadas + tilde ON → se DETIENE: la favorita de cobro no factura', () => {
  // "Banco 2" es la favorita pero tiene "Imprime Factura" apagado. Antes se la
  // usaba igual y la venta terminaba en FACTURACION_7, una cola que ese local
  // nunca configuró. Ahora se corta con un mensaje claro.
  const d = resolver(
    venta(['Efectivo', 3000], ['Cuenta DNI', 2000]),
    [cuenta('Cuenta DNI', false), cuenta('Banco 2', false, { isFavorite: true })],
    true
  );
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA, 'el usuario pidió factura: nunca sale un remito');
  assert.strictEqual(d.motivo, 'tilde-manual');
  assert.strictEqual(d.encolado.estado, 'sin-cola');
  assert.ok(mensajeDeBloqueo(d.encolado).includes('No hay una cuenta fiscal habilitada'));
  assert.ok(mensajeDeBloqueo(d.encolado).includes('Banco 2'), 'tiene que nombrar a la favorita');
});
check('todas apagadas + tilde ON, con OTRA cuenta fiscal → usa esa, no la favorita', () => {
  const d = resolver(
    venta(['Efectivo', 3000], ['Cuenta DNI', 2000]),
    [cuenta('Cuenta DNI', false), cuenta('Banco 2', false, { isFavorite: true }), cuenta('Mercado Pago', true)],
    true
  );
  assert.strictEqual(d.encolado.estado, 'encolar');
  assert.strictEqual(d.encolado.cuenta, 'Mercado Pago');
  assert.strictEqual(d.encolado.cola, 'FACTURACION_6');
  assert.strictEqual(d.encolado.total, 5000);
});
check('tilde ON + una cuenta encendida → manda la cuenta usada, no la favorita', () => {
  const d = resolver(
    venta(['Mercado Pago', 7000]),
    [cuenta('Mercado Pago', true), cuenta('Transferencia', false, { isFavorite: true })],
    true
  );
  assert.strictEqual(d.encolado.cola, 'FACTURACION_6');
});
check('el tilde también se lee de la venta guardada', () => {
  const d = decidirComprobante({
    venta: { ...venta(['Mercado Pago', 100]), emiteFactura: true },
    cuentas: [cuenta('Banco 1', true, { isFavorite: true })],
  });
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
});
check('tilde ON sin cuenta favorita → se DETIENE, no cae a FCX', () => {
  const d = resolver(venta(['Mercado Pago', 100]), [cuenta('Mercado Pago', false)], true);
  assert.strictEqual(d.encolado.estado, 'sin-cola');
  assert.ok(encoladoBloqueado(d.encolado));
});
check('cuenta encendida SIN cola en la tabla → se DETIENE, no cae a FCX', () => {
  const d = resolver(venta(['Billetera Futura', 100]), [cuenta('Billetera Futura', true)]);
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
  assert.strictEqual(d.encolado.estado, 'sin-cola');
  assert.ok(mensajeDeBloqueo(d.encolado).includes('Billetera Futura'));
  assert.ok(!mensajeDeBloqueo(d.encolado).toLowerCase().includes('remito emitido'));
});

console.log('\nLa tabla completa del pedido:');
// Esta matriz prueba el INTERRUPTOR, así que usa dos cuentas SIN regla por
// medio de pago. Con "Transferencia" ya no tendría sentido: su regla factura
// siempre, apagada o no (eso se prueba en el bloque de reglas definitivas).
const conFlags = (t1, t2) => [
  cuenta('Cuenta DNI', t1, { isFavorite: true }),
  cuenta('Mercado Pago', t2),
];
// `encolable` = además de decidir FACTURA, ¿hay una cuenta FISCAL HABILITADA
// con la que emitirla? Con el tilde manual y TODAS las cuentas apagadas la
// respuesta es no: el comprobante que corresponde sigue siendo una factura
// —nunca un remito— pero la operación se DETIENE hasta que haya una cuenta con
// "Imprime Factura" encendido. Ser la favorita no alcanza.
const FILAS = [
  ['OFF', 'todas false', false, [false, false], COMPROBANTE_REMITO, false],
  ['OFF', 'una true', false, [true, false], COMPROBANTE_FACTURA, true],
  ['OFF', 'varias true y otras false', false, [true, false], COMPROBANTE_FACTURA, true],
  ['OFF', 'todas true', false, [true, true], COMPROBANTE_FACTURA, true],
  ['ON', 'todas false', true, [false, false], COMPROBANTE_FACTURA, false],
  ['ON', 'combinadas', true, [true, false], COMPROBANTE_FACTURA, true],
  ['ON', 'todas true', true, [true, true], COMPROBANTE_FACTURA, true],
];
for (const [tilde, caso, manual, flags, esperado, encolable] of FILAS) {
  check(`tilde ${tilde} · ${caso} → ${esperado} por el total`, () => {
    const v = venta(['Cuenta DNI', 4000], ['Mercado Pago', 6000]);
    const d = resolver(v, conFlags(...flags), manual);
    assert.strictEqual(d.comprobante, esperado);
    assert.strictEqual(d.total, 10000);

    if (esperado === COMPROBANTE_REMITO) {
      assert.strictEqual(d.encolado.estado, 'sin-factura');
      return;
    }
    if (encolable) {
      assert.strictEqual(d.encolado.estado, 'encolar');
      assert.strictEqual(d.encolado.total, 10000, 'no facturó el total completo');
    } else {
      assert.strictEqual(d.encolado.estado, 'sin-cola');
      assert.ok(mensajeDeBloqueo(d.encolado).includes('No hay una cuenta fiscal habilitada'));
      assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA, 'bloquear NO es degradar a remito');
    }
  });
}

console.log('\nNunca factura Y remito por la misma venta:');
check('el comprobante y el encolado siempre coinciden', () => {
  const combinaciones = [[false, false], [true, false], [false, true], [true, true]];
  for (const manual of [false, true]) {
    for (const [t1, t2] of combinaciones) {
      const d = resolver(venta(['Transferencia', 1000], ['Mercado Pago', 2000]), conFlags(t1, t2), manual);
      const hayFactura = d.encolado.estado === 'encolar';
      const hayRemito = !ventaSeFactura({ comprobante: d.comprobante });
      assert.ok(!(hayFactura && hayRemito), `factura Y remito con manual=${manual} flags=${t1},${t2}`);
      if (d.comprobante === COMPROBANTE_REMITO) assert.strictEqual(hayFactura, false);
    }
  }
});
check('venta sin pagos (sorteo / regalo / mal armado) → FCX', () => {
  const d = resolver({ id: 5, total: 0, payments: [] }, [cuenta('Transferencia', true)]);
  assert.strictEqual(d.comprobante, COMPROBANTE_REMITO);
  assert.strictEqual(d.motivo, 'sin-pagos');
});
check('sin cuentas cargadas en el local → FCX, nunca factura por las dudas', () => {
  // Sin regla por nombre y sin cuentas: FCX. ("Transferencia" ya no aplica acá:
  // su regla factura aunque el local no tenga la cuenta cargada.)
  assert.strictEqual(resolver(venta(['Mercado Pago', 100]), []).comprobante, COMPROBANTE_REMITO);
  assert.strictEqual(resolver(venta(['Mercado Pago', 100]), null).comprobante, COMPROBANTE_REMITO);
});

console.log('\nEl total sale de la venta, no de la suma de pagos declarados:');
check('lee payment.payments, payment.details y payment.method', () => {
  const cuentas = [cuenta('Transferencia', true)];
  for (const payment of [
    { total: 1200, payments: [{ method: 'Transferencia', amount: 1200 }] },
    { total: 1200, details: [{ method: 'Transferencia', amount: 1200 }] },
    { method: 'Transferencia', total: 1200 },
  ]) {
    const d = resolver({ payment }, cuentas);
    assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
    assert.strictEqual(d.encolado.total, 1200);
  }
});
check('el total del comprobante es el de la venta aunque los pagos no cierren', () => {
  const d = resolver({ total: 10000, payments: [{ method: 'Transferencia', amount: 2000 }] },
    [cuenta('Transferencia', true)]);
  assert.strictEqual(d.encolado.total, 10000);
});

console.log('\nLa decisión guardada en la venta (la que lee el remito):');
check('comprobante FACTURA → la venta NO lleva FCX', () => {
  assert.strictEqual(ventaSeFactura({ comprobante: COMPROBANTE_FACTURA }), true);
});
check('comprobante REMITO → lleva FCX aunque emiteFactura haya quedado en true', () => {
  assert.strictEqual(ventaSeFactura({ comprobante: COMPROBANTE_REMITO, emiteFactura: true }), false);
});
check('ventas viejas sin comprobante: manda emiteFactura (compatibilidad)', () => {
  assert.strictEqual(ventaSeFactura({ emiteFactura: true }), true);
  assert.strictEqual(ventaSeFactura({ emiteFactura: false }), false);
  assert.strictEqual(ventaSeFactura({}), false);
  assert.strictEqual(ventaSeFactura(null), false);
});
check('la cuenta favorita se detecta por isFavorite', () => {
  assert.strictEqual(cuentaFavorita([cuenta('A', false), cuenta('B', true, { isFavorite: true })]).nombre, 'B');
  assert.strictEqual(cuentaFavorita([cuenta('A', false)]), null);
});

// NOTA DE DISEÑO — este bloque cambió a propósito.
//
// Antes se exigía lo contrario: que la decisión NO conociera ningún nombre de
// medio de pago y saliera sólo del interruptor `imprimeFactura`. Esa regla dejó
// de facturar en Achaval sin avisar, porque alcanzaba con que alguien apagara
// el interruptor de una cuenta. Ahora la cola sale del MEDIO DE PAGO, con una
// tabla de reglas cerrada y anclada, y el interruptor sólo decide donde no hay
// regla. Lo que se verifica es que esas reglas sean explícitas y acotadas.
console.log('\nLa DECISIÓN usa reglas por medio de pago, cerradas y explícitas:');
check('las reglas por nombre están ancladas: nada de coincidencias parciales', () => {
  // Nombres que CONTIENEN una palabra de la regla pero no son esa cuenta.
  for (const ajeno of ['Transferencia Mercado Pago', 'Efectivo en dólares', 'Mercado Pago', 'Transferencia 6', 'Transferencia bancaria']) {
    const r = resolverReglaMedioPago(ajeno);
    assert.strictEqual(r.cola, null, `"${ajeno}" no debe resolver ninguna cola (dio ${r.cola})`);
    assert.strictEqual(r.regla, REGLA.SIN_REGLA, `"${ajeno}" no debe matchear una regla`);
  }
});
check('la fórmula está escrita tal cual quedó acordada', () => {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const fuente = fs.readFileSync(path.join(aqui, '../facturaORemito.js'), 'utf8');
  // La fórmula lleva ahora el corte por EFECTIVO PURO adelante de todo: es la
  // regla fija que gana sobre el interruptor y sobre el tilde manual.
  assert.ok(/const debeFacturarse = !soloEfectivo && \(tildeManualActivo \|\| algunaCuentaFactura\);/.test(fuente),
    'cambió la fórmula debeFacturarse');
  assert.ok(/const soloEfectivo =/.test(fuente), 'falta la regla de efectivo puro');
});

// ---------------------------------------------------------------------------
// REGLAS DEFINITIVAS POR MEDIO DE PAGO — los 8 casos obligatorios
// ---------------------------------------------------------------------------
console.log('\nReglas definitivas por medio de pago (mostrador, delivery y combinadas):');

// Cuentas tal como quedan configuradas: las cuatro que facturan en true y el
// efectivo (que ni siquiera es una cuenta) en false.
const CUENTAS_REALES = [
  { nombre: 'Transferencia', imprimeFactura: true, isFavorite: true },
  { nombre: 'Transferencia 2', imprimeFactura: true },
  { nombre: 'Transferencia 3', imprimeFactura: true },
  { nombre: 'PREPAGO PEDIDOSYA', imprimeFactura: true },
];

const resolverCaso = (pagos, cuentas = CUENTAS_REALES) => {
  const total = pagos.reduce((s, p) => s + p.amount, 0);
  const venta = { payments: pagos, total };
  const decision = decidirComprobante({ venta, cuentas });
  return { decision, encolado: resolverEncolado(decision, cuentas), total };
};

const casoCola = (etiqueta, pagos, colaEsperada, totalEsperado) => {
  check(`${etiqueta} → ${colaEsperada}`, () => {
    const { decision, encolado, total } = resolverCaso(pagos);
    assert.strictEqual(decision.comprobante, COMPROBANTE_FACTURA, `debía ser FACTURA (fue ${decision.comprobante})`);
    assert.strictEqual(encolado.estado, 'encolar', `debía encolarse (fue ${encolado.estado}: ${encolado.motivo || ''})`);
    assert.strictEqual(encolado.cola, colaEsperada);
    // UNA sola entrada, por el TOTAL COMPLETO de la venta.
    assert.strictEqual(encolado.total, totalEsperado ?? total);
  });
};

casoCola('Transferencia', [{ method: 'Transferencia', amount: 10000 }], 'FACTURACION_1');
casoCola('Transferencia 2', [{ method: 'Transferencia 2', amount: 10000 }], 'FACTURACION_2');
casoCola('Transferencia 3', [{ method: 'Transferencia 3', amount: 10000 }], 'FACTURACION_3');
casoCola('Efectivo + Transferencia', [{ method: 'Efectivo', amount: 8000 }, { method: 'Transferencia', amount: 12000 }], 'FACTURACION_1', 20000);
casoCola('Efectivo + Transferencia 2', [{ method: 'Efectivo', amount: 8000 }, { method: 'Transferencia 2', amount: 12000 }], 'FACTURACION_2', 20000);
casoCola('Efectivo + Transferencia 3', [{ method: 'Efectivo', amount: 8000 }, { method: 'Transferencia 3', amount: 12000 }], 'FACTURACION_3', 20000);
check('Efectivo solo → REMITO', () => {
  const { decision, encolado } = resolverCaso([{ method: 'Efectivo', amount: 10000 }]);
  assert.strictEqual(decision.comprobante, COMPROBANTE_REMITO);
  assert.strictEqual(encolado.estado, 'sin-factura');
});

console.log('\nEFECTIVO PURO → REMITO SIEMPRE, pase lo que pase:');
check('con imprimeFactura=true en la cuenta Efectivo, sigue siendo REMITO', () => {
  const rotas = [{ nombre: 'Efectivo', imprimeFactura: true, isFavorite: true }];
  const { decision, encolado } = resolverCaso([{ method: 'Efectivo', amount: 5000 }], rotas);
  assert.strictEqual(decision.comprobante, COMPROBANTE_REMITO);
  assert.strictEqual(encolado.estado, 'sin-factura');
  assert.strictEqual(decision.contradicciones.length, 1, 'se avisa la configuración rara');
});
check('ni siquiera el tilde manual convierte una venta en efectivo en factura', () => {
  const venta = { payments: [{ method: 'Efectivo', amount: 5000 }], total: 5000, emiteFactura: true };
  const d = decidirComprobante({ venta, cuentas: CUENTAS_REALES, emiteFacturaManual: true });
  assert.strictEqual(d.comprobante, COMPROBANTE_REMITO);
  assert.strictEqual(d.motivo, 'efectivo-siempre-remito');
  assert.strictEqual(resolverEncolado(d, CUENTAS_REALES).estado, 'sin-factura');
});
check('esVentaSoloEfectivo distingue el efectivo puro del combinado', () => {
  assert.strictEqual(esVentaSoloEfectivo({ payments: [{ method: 'Efectivo', amount: 100 }] }), true);
  assert.strictEqual(esVentaSoloEfectivo({ payments: [{ method: 'EFECTIVO', amount: 100 }, { method: 'efectivo', amount: 50 }] }), true);
  assert.strictEqual(esVentaSoloEfectivo({ payments: [{ method: 'Efectivo', amount: 100 }, { method: 'Transferencia', amount: 50 }] }), false);
  assert.strictEqual(esVentaSoloEfectivo({ payments: [] }), false);
});

console.log('\nPedidosYa NO tiene cola fija: la resuelve el ALIAS FAVORITO:');
for (const escritura of ['PREPAGO PEDIDOSYA', 'prepago pedidosya', 'Prepago PedidosYa', '  PREPAGO   PEDIDOSYA  ', 'PREPAGO PREDIDOSYA']) {
  check(`"${escritura}" → pide resolución por alias`, () => {
    const r = resolverReglaMedioPago(escritura);
    assert.strictEqual(r.regla, REGLA.PEDIDOSYA_PREPAGO);
    assert.strictEqual(r.cola, null, 'no puede tener cola fija');
    assert.strictEqual(r.requiereCuentaAsociada, true);

    const r2 = resolverReglaMedioPago(escritura);
    assert.strictEqual(r2.requiereCuentaAsociada, true);
  });
}

console.log('\nAlias favorito → cuenta asociada → cola (nunca por el texto del alias):');
// Cuentas con la MISMA forma que Firebase: cada una guarda su propio `alias`.
const CUENTAS_CON_ALIAS = {
  'cta-1': { nombre: 'Transferencia', alias: 'HELADERIA.ACHAVAL' },
  'cta-2': { nombre: 'Transferencia 2', alias: 'HELA.LANYULINA.LANUS' },
  'cta-3': { nombre: 'Transferencia 3', alias: 'MONICA.MP' },
  'cta-4': { nombre: 'PREPAGO RAPPI', alias: 'RAPPI' },
};

check('alias de cta-1 → FACTURACION_1', () => {
  const r = resolverCuentaDeAliasFavorito({ alias: 'HELADERIA.ACHAVAL', cuentas: CUENTAS_CON_ALIAS });
  assert.strictEqual(r.estado, 'ok');
  assert.strictEqual(r.cuentaId, 'cta-1');
  assert.strictEqual(r.cola, 'FACTURACION_1');
});
check('alias de cta-2 → FACTURACION_2 (el texto no dice "Transferencia 2")', () => {
  const r = resolverCuentaDeAliasFavorito({ alias: 'HELA.LANYULINA.LANUS', cuentas: CUENTAS_CON_ALIAS });
  assert.strictEqual(r.estado, 'ok');
  assert.strictEqual(r.cuentaId, 'cta-2');
  assert.strictEqual(r.cola, 'FACTURACION_2');
});
check('alias de cta-3 → FACTURACION_3 (caso real de Bynnon)', () => {
  const r = resolverCuentaDeAliasFavorito({ alias: 'MONICA.MP', cuentas: CUENTAS_CON_ALIAS });
  assert.strictEqual(r.estado, 'ok');
  assert.strictEqual(r.cuentaId, 'cta-3');
  assert.strictEqual(r.cola, 'FACTURACION_3');
});
check('tolera mayúsculas y espacios en el alias', () => {
  const r = resolverCuentaDeAliasFavorito({ alias: '  hela.lanyulina.lanus ', cuentas: CUENTAS_CON_ALIAS });
  assert.strictEqual(r.cola, 'FACTURACION_2');
});

console.log('\nAlias mal configurado: error explícito, NUNCA FACTURACION_1 por defecto:');
check('sin alias favorito → sin-alias', () => {
  for (const vacio of [null, undefined, '', '   ']) {
    const r = resolverCuentaDeAliasFavorito({ alias: vacio, cuentas: CUENTAS_CON_ALIAS });
    assert.strictEqual(r.estado, 'sin-alias');
    assert.ok(!r.cola, 'no puede caer a ninguna cola');
  }
});
check('dos cuentas con el mismo alias → alias-ambiguo', () => {
  const duplicadas = { ...CUENTAS_CON_ALIAS, 'cta-5': { nombre: 'Transferencia 2', alias: 'HELADERIA.ACHAVAL' } };
  const r = resolverCuentaDeAliasFavorito({ alias: 'HELADERIA.ACHAVAL', cuentas: duplicadas });
  assert.strictEqual(r.estado, 'alias-ambiguo');
  assert.strictEqual(r.cuentas.length, 2);
});
check('alias sin cuenta asociada → sin-cuenta', () => {
  const r = resolverCuentaDeAliasFavorito({ alias: 'ALIAS.QUE.NO.EXISTE', cuentas: CUENTAS_CON_ALIAS });
  assert.strictEqual(r.estado, 'sin-cuenta');
});
check('una plataforma como alias → cuenta-sin-cola (no tiene cola propia)', () => {
  // RAPPI ya no figura en COLAS_POR_CUENTA: factura por su cuenta asociada, así
  // que como alias destacado no resuelve nada.
  const r = resolverCuentaDeAliasFavorito({ alias: 'RAPPI', cuentas: CUENTAS_CON_ALIAS });
  assert.strictEqual(r.estado, 'cuenta-sin-cola');
  assert.match(r.motivo, /no resuelve ninguna cola fiscal \(FACTURACION_1 a 9\)/);
});
check('cambiar el alias favorito cambia la cola, sin tocar el código', () => {
  const c = CUENTAS_CON_ALIAS;
  assert.strictEqual(resolverCuentaDeAliasFavorito({ alias: 'HELADERIA.ACHAVAL', cuentas: c }).cola, 'FACTURACION_1');
  assert.strictEqual(resolverCuentaDeAliasFavorito({ alias: 'HELA.LANYULINA.LANUS', cuentas: c }).cola, 'FACTURACION_2');
  assert.strictEqual(resolverCuentaDeAliasFavorito({ alias: 'MONICA.MP', cuentas: c }).cola, 'FACTURACION_3');
});

console.log('\nLa regla protege contra una configuración accidental:');
check('Transferencia con imprimeFactura=false SIGUE facturando, y se registra la contradicción', () => {
  const rotas = [{ nombre: 'Transferencia', imprimeFactura: false, isFavorite: true }];
  const { decision, encolado } = resolverCaso([{ method: 'Transferencia', amount: 7000 }], rotas);
  assert.strictEqual(decision.comprobante, COMPROBANTE_FACTURA, 'el interruptor apagado no puede cortar la facturación');
  assert.strictEqual(encolado.cola, 'FACTURACION_1');
  assert.strictEqual(decision.contradicciones.length, 1);
  assert.match(decision.contradicciones[0].detalle, /imprimeFactura=false/);
});

check('Efectivo con imprimeFactura=true NO factura, pero avisa la contradicción', () => {
  const rotas = [{ nombre: 'Efectivo', imprimeFactura: true }];
  const { decision, encolado } = resolverCaso([{ method: 'Efectivo', amount: 7000 }], rotas);
  assert.strictEqual(decision.comprobante, COMPROBANTE_REMITO);
  assert.strictEqual(encolado.estado, 'sin-factura');
  assert.strictEqual(decision.contradicciones.length, 1);
  assert.match(decision.contradicciones[0].detalle, /imprimeFactura=true/);
});

check('sin contradicciones cuando la configuración es la correcta', () => {
  for (const m of ['Transferencia', 'Transferencia 2', 'Transferencia 3', 'PREPAGO PEDIDOSYA']) {
    const { decision } = resolverCaso([{ method: m, amount: 1000 }]);
    assert.deepStrictEqual(decision.contradicciones, [], `${m} no debería contradecir`);
  }
});

check('dos colas distintas en la misma venta NO se eligen a dedo', () => {
  const { encolado } = resolverCaso([
    { method: 'Transferencia 2', amount: 5000 },
    { method: 'Transferencia 3', amount: 5000 },
  ]);
  assert.notStrictEqual(encolado.estado, 'encolar', 'no debe elegir una cola por su cuenta');
});

// ---------------------------------------------------------------------------
// PLATAFORMAS: la cola sale de la CUENTA ASOCIADA configurada en su propia
// cuenta (cuentaFacturacionAsociadaId), por ID. El ALIAS del local NO interviene.
// ---------------------------------------------------------------------------
console.log('\nPedidosYa / Rappi → cola de su cuenta asociada (por ID):');

/** Local con las tres transferencias + las dos plataformas. */
const localCon = (asocPedidosYa, asocRappi) => ({
  'cta-1': { nombre: 'Transferencia', imprimeFactura: true, isFavorite: true },
  'cta-2': { nombre: 'Transferencia 2', imprimeFactura: true },
  'cta-3': { nombre: 'Transferencia 3', imprimeFactura: true },
  'cta-py': { nombre: 'PREPAGO PEDIDOSYA', imprimeFactura: true, [CAMPO_CUENTA_ASOCIADA]: asocPedidosYa },
  'cta-ra': { nombre: 'PREPAGO RAPPI', imprimeFactura: true, [CAMPO_CUENTA_ASOCIADA]: asocRappi },
});

const colaDe = (metodo, cuentas, importe = 12000) => {
  const v = { payments: [{ method: metodo, amount: importe }], total: importe };
  const d = decidirComprobante({ venta: v, cuentas });
  return { d, e: resolverEncolado(d, cuentas) };
};

for (const [asoc, cola] of [['cta-1', 'FACTURACION_1'], ['cta-2', 'FACTURACION_2'], ['cta-3', 'FACTURACION_3']]) {
  check(`PedidosYa asociado a ${asoc} → ${cola}`, () => {
    const { d, e } = colaDe('PREPAGO PEDIDOSYA', localCon(asoc, 'cta-1'));
    assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
    assert.strictEqual(e.estado, 'encolar');
    assert.strictEqual(e.cola, cola);
    assert.strictEqual(e.cuentaAsociadaId, asoc);
  });
  check(`Rappi asociado a ${asoc} → ${cola}`, () => {
    const { e } = colaDe('PREPAGO RAPPI', localCon('cta-1', asoc));
    assert.strictEqual(e.estado, 'encolar');
    assert.strictEqual(e.cola, cola);
    assert.strictEqual(e.cuentaAsociadaId, asoc);
  });
}

check('cambiar la asociación cambia la cola, sin recompilar', () => {
  assert.strictEqual(colaDe('PREPAGO PEDIDOSYA', localCon('cta-1', 'cta-1')).e.cola, 'FACTURACION_1');
  assert.strictEqual(colaDe('PREPAGO PEDIDOSYA', localCon('cta-3', 'cta-1')).e.cola, 'FACTURACION_3');
});

check('pago combinado: efectivo + PedidosYa → cola de la plataforma, total COMPLETO', () => {
  const cuentas = localCon('cta-2', 'cta-1');
  const v = { payments: [{ method: 'Efectivo', amount: 5000 }, { method: 'PREPAGO PEDIDOSYA', amount: 20000 }], total: 25000 };
  const d = decidirComprobante({ venta: v, cuentas });
  const e = resolverEncolado(d, cuentas);
  assert.strictEqual(e.estado, 'encolar');
  assert.strictEqual(e.cola, 'FACTURACION_2');
  assert.strictEqual(e.total, 25000);
});

console.log('\nAsociación inválida: error visible, sin cola por defecto y sin remito:');
const casosInvalidos = [
  ['sin asociación', undefined],
  ['asociación vacía', ''],
  ['cuenta eliminada', 'cta-borrada'],
  ['asociada a sí misma', 'cta-py'],
  ['asociada a la otra plataforma', 'cta-ra'],
];
for (const [etq, asoc] of casosInvalidos) {
  check(`PedidosYa ${etq} → se DETIENE`, () => {
    const { d, e } = colaDe('PREPAGO PEDIDOSYA', localCon(asoc, 'cta-1'));
    assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA, 'sigue siendo factura, no remito');
    assert.strictEqual(e.estado, 'sin-cola');
    assert.ok(!e.cola, 'jamás una cola por defecto');
    assert.match(e.motivo, /No se pudo facturar la venta de PedidosYa/);
  });
}
check('Rappi con asociación inválida nombra a Rappi en el error', () => {
  const { e } = colaDe('PREPAGO RAPPI', localCon('cta-1', 'cta-borrada'));
  assert.strictEqual(e.estado, 'sin-cola');
  assert.match(e.motivo, /No se pudo facturar la venta de Rappi/);
});
check('asociada a una cuenta que genera remito / sin cola → inválida', () => {
  const cuentas = { ...localCon('cta-mp', 'cta-1'), 'cta-mp': { nombre: 'Mercado Pago', imprimeFactura: false } };
  const { e } = colaDe('PREPAGO PEDIDOSYA', cuentas);
  assert.strictEqual(e.estado, 'sin-cola');
});

console.log('\nDesplegable "Cuenta asociada para facturación":');
check('sólo ofrece Transferencias (FACTURACION_1 a 5)', () => {
  const cuentas = { ...localCon('cta-1', 'cta-1'), 'cta-mp': { nombre: 'Mercado Pago' }, 'cta-ef': { nombre: 'Efectivo' } };
  const ops = cuentasAsociablesParaFacturacion(cuentas);
  assert.deepStrictEqual(ops.map((o) => o.id).sort(), ['cta-1', 'cta-2', 'cta-3']);
  assert.deepStrictEqual(ops.map((o) => o.cola).sort(), ['FACTURACION_1', 'FACTURACION_2', 'FACTURACION_3']);
});
check('la cantidad de opciones depende de lo que tenga cada local', () => {
  const dos = { a: { nombre: 'Transferencia' }, b: { nombre: 'Transferencia 2' } };
  assert.strictEqual(cuentasAsociablesParaFacturacion(dos).length, 2);
  assert.strictEqual(cuentasAsociablesParaFacturacion({ a: { nombre: 'Transferencia' } }).length, 1);
  assert.strictEqual(cuentasAsociablesParaFacturacion({}).length, 0);
});
check('nunca ofrece otra plataforma como cuenta asociada', () => {
  const ops = cuentasAsociablesParaFacturacion(localCon('cta-1', 'cta-1'));
  assert.ok(!ops.some((o) => plataformaDeCuenta(o.nombre)), 'no puede haber plataformas en el desplegable');
});
check('la validación del formulario rechaza lo mismo que la facturación', () => {
  const cuentas = localCon('cta-1', 'cta-1');
  assert.strictEqual(validarAsociacionPlataforma({ plataformaId: 'cta-py', asociadaId: 'cta-2', cuentas }).ok, true);
  assert.strictEqual(validarAsociacionPlataforma({ plataformaId: 'cta-py', asociadaId: 'cta-py', cuentas }).ok, false);
  assert.strictEqual(validarAsociacionPlataforma({ plataformaId: 'cta-py', asociadaId: 'cta-ra', cuentas }).ok, false);
  assert.strictEqual(validarAsociacionPlataforma({ plataformaId: 'cta-py', asociadaId: '', cuentas }).ok, false);
  assert.strictEqual(validarAsociacionPlataforma({ plataformaId: 'cta-py', asociadaId: 'no-existe', cuentas }).ok, false);
});
check('el vínculo es por ID: renombrar la cuenta asociada no lo rompe', () => {
  const cuentas = localCon('cta-2', 'cta-1');
  assert.strictEqual(colaDe('PREPAGO PEDIDOSYA', cuentas).e.cola, 'FACTURACION_2');
  assert.strictEqual(resolverCuentaAsociadaDePlataforma({ plataformaId: 'cta-py', cuentas }).cuentaId, 'cta-2');
});

// ---------------------------------------------------------------------------
// BARRERA: una CANCELACIÓN o un total <= 0 no entran al flujo fiscal.
// ---------------------------------------------------------------------------
console.log('\nUna cancelación nunca entra a facturación:');

const ventaOk = { total: 14400, payments: [{ method: 'Transferencia', amount: 14400 }] };

check('una venta normal SÍ puede facturarse', () => {
  const r = puedeEntrarAFacturacion(ventaOk);
  assert.strictEqual(r.ok, true);
});

check('el flag esCancelacion bloquea, sea cual sea el estado', () => {
  const r = puedeEntrarAFacturacion(ventaOk, { esCancelacion: true });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, 'cancelacion');
  assert.match(r.detalle, /corresponde a una cancelación/);
});

for (const estado of ['cancelada', 'cancelado', 'cancelled', 'canceled', 'anulada', 'anulado', 'CANCELADO', 'Cancelada']) {
  check(`estado "${estado}" bloquea la facturación`, () => {
    assert.strictEqual(puedeEntrarAFacturacion({ ...ventaOk, estado }).ok, false);
    assert.strictEqual(puedeEntrarAFacturacion({ ...ventaOk, status: estado }).ok, false);
  });
}

check('también lee el estado anidado status.main (forma de los pedidos)', () => {
  const r = puedeEntrarAFacturacion({ ...ventaOk, status: { main: 'CANCELADO' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, 'cancelacion');
});

console.log('\nTotal <= 0: defensa secundaria');
check('total 0, negativo, ausente o no numérico no se factura', () => {
  for (const total of [0, -100, null, undefined, 'abc', NaN]) {
    const r = puedeEntrarAFacturacion({ ...ventaOk, total });
    assert.strictEqual(r.ok, false, `aceptó total=${JSON.stringify(total)}`);
    assert.strictEqual(r.motivo, 'total-invalido');
  }
});
check('acepta TOTAL en mayúsculas (forma del motor)', () => {
  assert.strictEqual(puedeEntrarAFacturacion({ TOTAL: 5000 }).ok, true);
  assert.strictEqual(puedeEntrarAFacturacion({ TOTAL: 0 }).ok, false);
});
check('la cancelación gana sobre el total: se informa cancelación, no total', () => {
  const r = puedeEntrarAFacturacion({ total: 0, estado: 'cancelada' });
  assert.strictEqual(r.motivo, 'cancelacion');
});

console.log('\nEl total de mostrador tiene que llegar a la decisión:');
check('sin total, la venta no se puede facturar (era el bug del comprobante en $0)', () => {
  // Lo que hacía saveCounterSale: pasar sólo los pagos. `totalDeVenta` no suma
  // payments[], así que el total resuelto daba 0 y se encolaba en cero.
  const soloPagos = { payments: [{ method: 'Transferencia', amount: 14400 }] };
  const d = decidirComprobante({ venta: soloPagos, cuentas: CUENTAS_REALES });
  assert.strictEqual(d.total, 0, 'sin `total` el importe resuelto es 0');
  assert.strictEqual(puedeEntrarAFacturacion(soloPagos).ok, false,
    'la barrera tiene que frenar ese encolado en cero');
});
check('con el total incluido, la venta se encola por su importe real', () => {
  const conTotal = { payments: [{ method: 'Transferencia', amount: 14400 }], total: 14400 };
  const d = decidirComprobante({ venta: conTotal, cuentas: CUENTAS_REALES });
  const e = resolverEncolado(d, CUENTAS_REALES);
  assert.strictEqual(d.total, 14400);
  assert.strictEqual(e.estado, 'encolar');
  assert.strictEqual(e.cola, 'FACTURACION_1');
  assert.strictEqual(e.total, 14400);
  assert.strictEqual(puedeEntrarAFacturacion(conTotal).ok, true);
});

// ---------------------------------------------------------------------------
// PLATAFORMAS: "Imprime Factura" DEJÓ DE INTERVENIR
//
// En PedidosYa y Rappi lo único que habilita la facturación es tener una cuenta
// asociada. El interruptor ni se muestra en el formulario, y una cuenta vieja
// que quedó con `imprimeFactura: false` tiene que facturar igual: nadie debería
// tener que volver a editar y guardar todas las cuentas existentes.
// ---------------------------------------------------------------------------
console.log('\nPlataformas: la asociación manda, no `imprimeFactura`:');

/** El caso REAL de Achaval: PREPAGO RAPPI quedó con el interruptor apagado. */
const localConInterruptorApagado = (asocRappi) => ({
  'cta-1': { nombre: 'Transferencia', imprimeFactura: true, isFavorite: true },
  'cta-2': { nombre: 'Transferencia 2', imprimeFactura: true },
  'cta-3': { nombre: 'Transferencia 3', imprimeFactura: true },
  'cta-ra': { nombre: 'PREPAGO RAPPI', imprimeFactura: false, [CAMPO_CUENTA_ASOCIADA]: asocRappi },
});

for (const [asoc, cola] of [['cta-1', 'FACTURACION_1'], ['cta-2', 'FACTURACION_2'], ['cta-3', 'FACTURACION_3']]) {
  check(`Rappi con imprimeFactura:false + asociada ${asoc} → factura igual en ${cola}`, () => {
    const { d, e } = colaDe('PREPAGO RAPPI', localConInterruptorApagado(asoc));
    assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA, 'el interruptor apagado no puede dejarla sin facturar');
    assert.strictEqual(e.estado, 'encolar');
    assert.strictEqual(e.cola, cola);
    assert.strictEqual(e.cuentaAsociadaId, asoc);
  });
}

check('PedidosYa con imprimeFactura:false + asociada → factura igual', () => {
  const cuentas = {
    'cta-1': { nombre: 'Transferencia', imprimeFactura: true, isFavorite: true },
    'cta-py': { nombre: 'PREPAGO PEDIDOSYA', imprimeFactura: false, [CAMPO_CUENTA_ASOCIADA]: 'cta-1' },
  };
  const { d, e } = colaDe('PREPAGO PEDIDOSYA', cuentas);
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
  assert.strictEqual(e.cola, 'FACTURACION_1');
});

check('una sola entrada fiscal: el combinado efectivo + Rappi no duplica', () => {
  const cuentas = localConInterruptorApagado('cta-1');
  const venta = { total: 9000, payments: [{ method: 'Efectivo', amount: 3000 }, { method: 'PREPAGO RAPPI', amount: 6000 }] };
  const d = decidirComprobante({ venta, cuentas });
  const e = resolverEncolado(d, cuentas);
  assert.strictEqual(e.estado, 'encolar');
  assert.strictEqual(e.cola, 'FACTURACION_1');
  assert.strictEqual(e.total, 9000, 'se factura el TOTAL completo, no sólo la parte de la plataforma');
});

check('sin asociación NO factura, NO cae a FACTURACION_1 y NO se degrada a remito', () => {
  const cuentas = {
    'cta-1': { nombre: 'Transferencia', imprimeFactura: true, isFavorite: true },
    'cta-ra': { nombre: 'PREPAGO RAPPI', imprimeFactura: false },
  };
  const { e } = colaDe('PREPAGO RAPPI', cuentas);
  assert.strictEqual(e.estado, 'sin-cola');
  assert.strictEqual(e.cola, undefined);
  assert.match(e.motivo, /Rappi/);
  assert.match(e.motivo, /Seleccioná una cuenta asociada para facturación/);
});

check('las cuentas comunes conservan su comportamiento', () => {
  const cuentas = localConInterruptorApagado('cta-1');
  assert.strictEqual(colaDe('Transferencia', cuentas).e.cola, 'FACTURACION_1');
  assert.strictEqual(colaDe('Transferencia 3', cuentas).e.cola, 'FACTURACION_3');
  assert.strictEqual(decidirComprobante({
    venta: { total: 1000, payments: [{ method: 'Efectivo', amount: 1000 }] }, cuentas,
  }).comprobante, COMPROBANTE_REMITO);
});

// ---------------------------------------------------------------------------
// ESQUEMA DEFINITIVO: TRANSFERENCIAS 1–5
// ---------------------------------------------------------------------------
console.log('\nTransferencia 4 y 5, solas y combinadas con efectivo:');

const localCon5Transferencias = () => ([
  cuenta('Transferencia', true, { isFavorite: true }),
  cuenta('Transferencia 2', true),
  cuenta('Transferencia 3', true),
  cuenta('Transferencia 4', true),
  cuenta('Transferencia 5', true),
  cuenta('Efectivo', false),
]);

for (const [nombre, cola] of [
  ['Transferencia', 'FACTURACION_1'], ['Transferencia 2', 'FACTURACION_2'],
  ['Transferencia 3', 'FACTURACION_3'], ['Transferencia 4', 'FACTURACION_4'],
  ['Transferencia 5', 'FACTURACION_5'],
]) {
  check(`${nombre} sola → ${cola}`, () => {
    const d = resolver(venta([nombre, 12000]), localCon5Transferencias());
    assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
    assert.strictEqual(d.encolado.cola, cola);
    assert.strictEqual(d.encolado.total, 12000);
  });

  check(`Efectivo + ${nombre} → ${cola} por el TOTAL completo`, () => {
    const d = resolver(venta(['Efectivo', 10000], [nombre, 20000]), localCon5Transferencias());
    assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
    assert.strictEqual(d.encolado.cola, cola);
    assert.strictEqual(d.encolado.total, 30000, 'se factura el total, no solo la parte no efectiva');
  });
}

check('Efectivo solo sigue yendo a remito, sin facturación automática', () => {
  const d = resolver(venta(['Efectivo', 5000]), localCon5Transferencias());
  assert.strictEqual(d.comprobante, COMPROBANTE_REMITO);
});

check('"Transferencia 5" no cae en la cola de "Transferencia"', () => {
  // El orden de las reglas es lo que lo garantiza: la 5 y la 4 se evalúan antes
  // que la genérica.
  for (const [n, c] of [['Transferencia 4', 'FACTURACION_4'], ['Transferencia 5', 'FACTURACION_5']]) {
    const r = resolverReglaMedioPago(n);
    assert.strictEqual(r.cola, c);
    assert.notStrictEqual(r.cola, 'FACTURACION_1');
  }
});

// ---------------------------------------------------------------------------
console.log('\nPlataformas asociadas a Transferencia 4 y 5:');

const localPlataformas = (asocPY, asocRa) => ({
  'cta-1': { nombre: 'Transferencia', imprimeFactura: true, isFavorite: true },
  'cta-2': { nombre: 'Transferencia 2', imprimeFactura: true },
  'cta-3': { nombre: 'Transferencia 3', imprimeFactura: true },
  'cta-4': { nombre: 'Transferencia 4', imprimeFactura: true },
  'cta-5': { nombre: 'Transferencia 5', imprimeFactura: true },
  'cta-py': { nombre: 'PREPAGO PEDIDOSYA', [CAMPO_CUENTA_ASOCIADA]: asocPY },
  'cta-ra': { nombre: 'PREPAGO RAPPI', [CAMPO_CUENTA_ASOCIADA]: asocRa },
});

for (const [asoc, cola] of [['cta-4', 'FACTURACION_4'], ['cta-5', 'FACTURACION_5']]) {
  check(`PedidosYa asociado a ${asoc} → ${cola}`, () => {
    const cuentas = localPlataformas(asoc, 'cta-1');
    const d = decidirComprobante({ venta: venta(['PREPAGO PEDIDOSYA', 9000]), cuentas });
    const e = resolverEncolado(d, cuentas);
    assert.strictEqual(e.cola, cola);
    assert.strictEqual(e.cuentaAsociadaId, asoc);
  });
  check(`Rappi asociado a ${asoc} → ${cola}`, () => {
    const cuentas = localPlataformas('cta-1', asoc);
    const d = decidirComprobante({ venta: venta(['PREPAGO RAPPI', 9000]), cuentas });
    const e = resolverEncolado(d, cuentas);
    assert.strictEqual(e.cola, cola);
    assert.strictEqual(e.cuentaAsociadaId, asoc);
  });
}

check('el desplegable ofrece las 5 transferencias y NINGUNA cuenta 6–9', () => {
  const cuentas = {
    ...localPlataformas('cta-1', 'cta-1'),
    'cta-mp': { nombre: 'Mercado Pago', imprimeFactura: true },
    'cta-dni': { nombre: 'Cuenta DNI', imprimeFactura: true },
    'cta-b1': { nombre: 'Banco 1', imprimeFactura: true },
    'cta-b2': { nombre: 'Banco 2', imprimeFactura: true },
  };
  const ofrecidas = cuentasAsociablesParaFacturacion(cuentas).map((c) => c.nombre).sort();
  assert.deepStrictEqual(ofrecidas, [
    'Transferencia', 'Transferencia 2', 'Transferencia 3', 'Transferencia 4', 'Transferencia 5',
  ].sort(), 'las plataformas solo se asocian a una Transferencia');
});

check('asociar una plataforma a Mercado Pago se rechaza', () => {
  const cuentas = { ...localPlataformas('cta-1', 'cta-1'), 'cta-mp': { nombre: 'Mercado Pago', imprimeFactura: true } };
  const v = validarAsociacionPlataforma({ plataformaId: 'cta-py', asociadaId: 'cta-mp', cuentas });
  assert.strictEqual(v.ok, false);
});

// ---------------------------------------------------------------------------
console.log('\nFacturación 2 (alias destacado): acepta cualquier cuenta fiscal 1..9:');

for (const [nombre, cola] of TABLA) {
  check(`alias de "${nombre}" → ${cola}`, () => {
    const cuentas = { 'cta-x': { nombre, alias: 'MI.ALIAS', imprimeFactura: true } };
    const r = resolverCuentaDeAliasFavorito({ alias: 'MI.ALIAS', cuentas });
    assert.strictEqual(r.estado, 'ok', r.motivo);
    assert.strictEqual(r.cola, cola);
  });
}

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
