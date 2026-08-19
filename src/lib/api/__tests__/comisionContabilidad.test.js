// CONTABILIDAD DE COMISIONES — reglas puras.
//
// Cubre los acumuladores en centavos, la identidad de cada operación, el
// sistema DORMIDO mientras migracionVersion < 1, el aviso y el límite de corte.
// La parte que necesita Firebase de verdad (atomicidad, create-only,
// concurrencia) se prueba aparte, contra el emulador.
//
// Correr con: node src/lib/api/__tests__/comisionContabilidad.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  TIPO_MOVIMIENTO, VERSION_ACTIVA,
  aCentavos, aPesos, esImporteValido,
  opIdVenta, opIdAnulacion, opIdPago, esOpIdValido,
  contabilidadActiva, leerAcumuladores,
  deltasDeVenta, deltasDeAnulacion, deltasDePago,
  validarPago, dejariaNegativo,
  planDeVenta, planDeAnulacion, planDePago,
  tieneEfectoContable, rutaTotales, rutaMovimiento,
} from '../comisionMovimiento.js';
import {
  ESTADO_INICIO, corteActivo, avisoActivo, evaluarInicio,
  bloquea, liberaTrasPago, validarConfiguracion, textoDeBloqueo,
} from '../comisionCorte.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const L = '40508022';

// ---------------------------------------------------------------------------
console.log('\n1. Dinero en centavos enteros:');

check('pesos -> centavos, sin coma flotante', () => {
  assert.strictEqual(aCentavos(1), 100);
  assert.strictEqual(aCentavos(1.5), 150);
  assert.strictEqual(aCentavos(0.1), 10);
  assert.strictEqual(aCentavos(142.02), 14202);
  assert.strictEqual(aCentavos(197686.25), 19768625);
});

check('el caso que ya esta roto en produccion queda entero', () => {
  // COMISIONES/TOTALES/totalAcumulado de Il Capo: 197686.25000000012
  assert.strictEqual(aCentavos(197686.25000000012), 19768625);
  assert.ok(Number.isInteger(aCentavos(197686.25000000012)));
});

check('0.1 + 0.2 en centavos da exacto', () => {
  assert.strictEqual(aCentavos(0.1) + aCentavos(0.2), 30);
  assert.notStrictEqual(0.1 + 0.2, 0.3);   // el problema que evitamos
});

check('centavos -> pesos solo para mostrar', () => {
  assert.strictEqual(aPesos(150), 1.5);
  assert.strictEqual(aPesos(19768625), 197686.25);
});

check('valores raros no rompen', () => {
  for (const v of [null, undefined, '', 'x', NaN, Infinity]) assert.strictEqual(aCentavos(v), 0);
});

check('un importe contable es entero y no negativo', () => {
  assert.strictEqual(esImporteValido(100), true);
  assert.strictEqual(esImporteValido(0), true);
  assert.strictEqual(esImporteValido(-1), false);
  assert.strictEqual(esImporteValido(1.5), false);
});

// ---------------------------------------------------------------------------
console.log('\n2. Identidad de la operacion:');

check('venta, anulacion y pago tienen su propio opId', () => {
  assert.strictEqual(opIdVenta('mostrador', 123), 'V-M123');
  assert.strictEqual(opIdVenta('delivery', 123), 'V-D123');
  assert.strictEqual(opIdAnulacion('mostrador', 123), 'A-M123');
  assert.strictEqual(opIdAnulacion('delivery', 123), 'A-D123');
  assert.strictEqual(opIdPago('abc-123'), 'P-abc-123');
});

check('mostrador 123 y delivery 123 son operaciones DISTINTAS', () => {
  assert.notStrictEqual(opIdVenta('mostrador', 123), opIdVenta('delivery', 123));
  assert.notStrictEqual(opIdAnulacion('mostrador', 123), opIdAnulacion('delivery', 123));
});

check('la venta y su anulacion no comparten opId', () => {
  assert.notStrictEqual(opIdVenta('mostrador', 123), opIdAnulacion('mostrador', 123));
});

check('el opId es determinístico: mismo input, mismo id', () => {
  assert.strictEqual(opIdVenta('mostrador', 123), opIdVenta('mostrador', '123'));
  assert.strictEqual(opIdPago('x'), opIdPago('x'));
});

check('se reconocen los opId validos', () => {
  for (const v of ['V-M1', 'V-D99', 'A-M1', 'A-D99', 'P-abc']) assert.strictEqual(esOpIdValido(v), true, v);
  for (const v of ['M1', 'X-M1', '', null, 'V-X1']) assert.strictEqual(esOpIdValido(v), false, String(v));
});

// ---------------------------------------------------------------------------
console.log('\n3. Sistema DORMIDO mientras migracionVersion < 1:');

check('sin migracionVersion la contabilidad nueva esta INACTIVA', () => {
  assert.strictEqual(contabilidadActiva(undefined), false);
  assert.strictEqual(contabilidadActiva({}), false);
  assert.strictEqual(contabilidadActiva({ migracionVersion: 0 }), false);
});

check('migracionVersion 0 = inicializada pero NO activa', () => {
  // El paso A de la migracion deja los valores pero NO activa.
  const totales = { totalAcumuladoCentavos: 123, totalPagadoCentavos: 0, saldoPendienteCentavos: 123, migracionVersion: 0 };
  assert.strictEqual(contabilidadActiva(totales), false, 'no debe activarse hasta verificar');
});

check('migracionVersion 1 = verificada y ACTIVA', () => {
  assert.strictEqual(contabilidadActiva({ migracionVersion: VERSION_ACTIVA }), true);
  assert.strictEqual(contabilidadActiva({ migracionVersion: 2 }), true);
});

check('leer acumuladores ausentes da 0, no NaN', () => {
  assert.deepStrictEqual(leerAcumuladores(undefined),
    { totalAcumuladoCentavos: 0, totalPagadoCentavos: 0, saldoPendienteCentavos: 0 });
});

// ---------------------------------------------------------------------------
console.log('\n4. Deltas de cada operacion:');

check('venta: sube historico y sube deuda', () => {
  assert.deepStrictEqual(deltasDeVenta(100), { dHist: 100, dSaldo: 100, dPagado: 0 });
});

check('anulacion: baja historico y baja deuda', () => {
  assert.deepStrictEqual(deltasDeAnulacion(100), { dHist: -100, dSaldo: -100, dPagado: 0 });
});

check('pago: sube pagado y baja deuda, el historico NO se toca', () => {
  assert.deepStrictEqual(deltasDePago(100), { dHist: 0, dSaldo: -100, dPagado: 100 });
});

check('el ejemplo completo del pedido cierra', () => {
  let h = 0, s = 0, p = 0;
  const aplicar = (d) => { h += d.dHist; s += d.dSaldo; p += d.dPagado; };
  aplicar(deltasDeVenta(aCentavos(1)));       // venta $100 al 1% -> $1
  aplicar(deltasDeVenta(aCentavos(1.5)));     // venta $150 al 1% -> $1,50
  assert.deepStrictEqual([h, s, p], [250, 250, 0]);
  aplicar(deltasDeAnulacion(aCentavos(1)));   // anula la de $100
  assert.deepStrictEqual([h, s, p], [150, 150, 0]);
  aplicar(deltasDePago(aCentavos(1)));        // paga $1
  assert.deepStrictEqual([h, s, p], [150, 50, 100]);
  assert.strictEqual(aPesos(s), 0.5, 'la deuda queda en $0,50');
});

// ---------------------------------------------------------------------------
console.log('\n5. La deuda nunca queda negativa:');

check('un pago mayor a la deuda se rechaza', () => {
  const v = validarPago(aCentavos(1000), aCentavos(500));
  assert.strictEqual(v.ok, false);
  assert.match(v.motivo, /supera la deuda/);
});

check('un pago igual a la deuda se acepta', () => {
  assert.strictEqual(validarPago(aCentavos(500), aCentavos(500)).ok, true);
});

check('un pago de cero o negativo se rechaza', () => {
  assert.strictEqual(validarPago(0, 1000).ok, false);
  assert.strictEqual(validarPago(-100, 1000).ok, false);
});

check('dejariaNegativo detecta cualquiera de los tres acumuladores', () => {
  const a = { totalAcumuladoCentavos: 100, saldoPendienteCentavos: 100, totalPagadoCentavos: 0 };
  assert.strictEqual(dejariaNegativo(a, deltasDePago(200)), true, 'saldo negativo');
  assert.strictEqual(dejariaNegativo(a, deltasDeAnulacion(200)), true, 'historico negativo');
  assert.strictEqual(dejariaNegativo(a, deltasDePago(100)), false);
});

// ---------------------------------------------------------------------------
console.log('\n6. El plan de escritura (movimiento + 3 incrementos juntos):');

check('el plan de una venta apunta a las rutas correctas', () => {
  const p = planDeVenta({ localId: L, modoVenta: 'delivery', idVenta: 744, comisionCentavos: 14202 });
  assert.strictEqual(p.opId, 'V-D744');
  assert.strictEqual(p.movimiento.ruta, `${L}/COMISIONES/MOVIMIENTOS/V-D744`);
  assert.strictEqual(p.movimiento.valor.tipo, TIPO_MOVIMIENTO.VENTA);
  assert.strictEqual(p.movimiento.valor.ref, 'D744');
  assert.strictEqual(p.movimiento.valor.canal, 'delivery');
  assert.strictEqual(p.incrementos.length, 3);
  assert.deepStrictEqual(p.incrementos.map((i) => i.delta), [14202, 14202, 0]);
});

check('los incrementos apuntan a los tres acumuladores', () => {
  const p = planDePago({ localId: L, idPago: 'abc', montoCentavos: 5000 });
  const rutas = p.incrementos.map((i) => i.ruta);
  assert.deepStrictEqual(rutas, [
    `${rutaTotales(L)}/totalAcumuladoCentavos`,
    `${rutaTotales(L)}/saldoPendienteCentavos`,
    `${rutaTotales(L)}/totalPagadoCentavos`,
  ]);
  assert.deepStrictEqual(p.incrementos.map((i) => i.delta), [0, -5000, 5000]);
});

check('la anulacion usa la comision ORIGINAL, no un porcentaje nuevo', () => {
  // La venta genero $1 con 1%. Despues el porcentaje paso a 2%.
  const comisionOriginal = aCentavos(1);
  const p = planDeAnulacion({ localId: L, modoVenta: 'mostrador', idVenta: 123, comisionCentavos: comisionOriginal });
  assert.strictEqual(p.incrementos[0].delta, -100, 'tiene que restar $1, no $2');
  assert.strictEqual(p.opId, 'A-M123');
});

check('rutaMovimiento y rutaTotales son las esperadas', () => {
  assert.strictEqual(rutaTotales(L), `${L}/COMISIONES/TOTALES`);
  assert.strictEqual(rutaMovimiento(L, 'V-M1'), `${L}/COMISIONES/MOVIMIENTOS/V-M1`);
});

// ---------------------------------------------------------------------------
console.log('\n7. Local con comision 0% (Achaval):');

check('una venta de 0 no tiene efecto contable', () => {
  assert.strictEqual(tieneEfectoContable(deltasDeVenta(0)), false);
});

check('una venta con comision si lo tiene', () => {
  assert.strictEqual(tieneEfectoContable(deltasDeVenta(1)), true);
});

check('con 0% los acumuladores no se mueven', () => {
  let h = 0, s = 0;
  const d = deltasDeVenta(aCentavos(0));
  if (tieneEfectoContable(d)) { h += d.dHist; s += d.dSaldo; }
  assert.deepStrictEqual([h, s], [0, 0]);
});

// ---------------------------------------------------------------------------
console.log('\n8. Aviso y limite de corte — configuracion:');

check('limiteCorte 0 o ausente = corte DESACTIVADO', () => {
  for (const v of [0, null, undefined, '', -5, 'x']) assert.strictEqual(corteActivo(v), false, String(v));
  assert.strictEqual(corteActivo(60000), true);
});

check('alarmaPago 0 o ausente = aviso desactivado', () => {
  for (const v of [0, null, undefined]) assert.strictEqual(avisoActivo(v), false, String(v));
  assert.strictEqual(avisoActivo(50000), true);
});

check('la alarma tiene que ser MENOR que el corte', () => {
  assert.strictEqual(validarConfiguracion({ alarmaPagoPesos: 50000, limiteCortePesos: 60000 }).ok, true);
  assert.strictEqual(validarConfiguracion({ alarmaPagoPesos: 60000, limiteCortePesos: 50000 }).ok, false);
  assert.strictEqual(validarConfiguracion({ alarmaPagoPesos: 60000, limiteCortePesos: 60000 }).ok, false);
});

check('con el corte desactivado no se valida nada', () => {
  assert.strictEqual(validarConfiguracion({ alarmaPagoPesos: 50000, limiteCortePesos: 0 }).ok, true);
});

// ---------------------------------------------------------------------------
console.log('\n9. Evaluacion de inicio — la tabla exacta del pedido:');

const evaluar = (pesos) => evaluarInicio({
  saldoCentavos: aCentavos(pesos), alarmaPagoPesos: 50000, limiteCortePesos: 60000,
});

check('49.999 -> INICIO NORMAL', () => {
  assert.strictEqual(evaluar(49999).estado, ESTADO_INICIO.NORMAL);
});
check('50.000 -> AVISO, permite trabajar', () => {
  const e = evaluar(50000);
  assert.strictEqual(e.estado, ESTADO_INICIO.AVISO);
  assert.strictEqual(bloquea(e), false);
});
check('59.999 -> AVISO, permite trabajar', () => {
  const e = evaluar(59999);
  assert.strictEqual(e.estado, ESTADO_INICIO.AVISO);
  assert.strictEqual(bloquea(e), false);
});
check('60.000 -> BLOQUEA', () => {
  const e = evaluar(60000);
  assert.strictEqual(e.estado, ESTADO_INICIO.BLOQUEADO);
  assert.strictEqual(bloquea(e), true);
});
check('70.000 -> BLOQUEA', () => {
  assert.strictEqual(bloquea(evaluar(70000)), true);
});

check('con el corte desactivado NUNCA bloquea, por alta que sea la deuda', () => {
  const e = evaluarInicio({ saldoCentavos: aCentavos(999999), alarmaPagoPesos: 50000, limiteCortePesos: 0 });
  assert.strictEqual(e.estado, ESTADO_INICIO.AVISO, 'avisa pero no bloquea');
  assert.strictEqual(bloquea(e), false);
});

check('sin alarma ni corte, siempre NORMAL', () => {
  const e = evaluarInicio({ saldoCentavos: aCentavos(999999), alarmaPagoPesos: 0, limiteCortePesos: 0 });
  assert.strictEqual(e.estado, ESTADO_INICIO.NORMAL);
});

// ---------------------------------------------------------------------------
console.log('\n10. Superar el limite DURANTE el turno NO bloquea:');

check('una sesion autorizada no se re-evalua', () => {
  // Arranca en 55.000: autorizada.
  const alInicio = evaluar(55000);
  assert.strictEqual(alInicio.estado, ESTADO_INICIO.AVISO);
  assert.strictEqual(bloquea(alInicio), false);

  // Durante el turno la deuda sube. La sesion YA fue evaluada: la decision
  // guardada es la del inicio y nadie vuelve a llamar a evaluarInicio.
  const decisionDeLaSesion = alInicio;
  for (const saldo of [60000, 70000, 120000]) {
    // Se comprueba que la decision de la sesion sigue siendo la misma...
    assert.strictEqual(bloquea(decisionDeLaSesion), false, `no puede bloquear con ${saldo}`);
    // ...aunque evaluar ESE saldo daria bloqueo si fuese un inicio nuevo.
    assert.strictEqual(bloquea(evaluar(saldo)), true, `un INICIO con ${saldo} si bloquearia`);
  }
});

check('el proximo inicio con 70.000 SI bloquea', () => {
  assert.strictEqual(bloquea(evaluar(70000)), true);
});

// ---------------------------------------------------------------------------
console.log('\n11. Desbloqueo mediante pago:');

check('pagar hasta quedar debajo del limite libera la sesion', () => {
  // Arranca bloqueado con 65.000 y limite 60.000.
  const e = evaluarInicio({ saldoCentavos: aCentavos(65000), alarmaPagoPesos: 50000, limiteCortePesos: 60000 });
  assert.strictEqual(bloquea(e), true);
  // Paga 10.000 -> 55.000
  const saldoDespues = aCentavos(65000) - aCentavos(10000);
  assert.strictEqual(saldoDespues, aCentavos(55000));
  assert.strictEqual(liberaTrasPago({ saldoCentavosDespues: saldoDespues, limiteCortePesos: 60000 }), true);
});

check('un pago que NO alcanza no libera', () => {
  const saldoDespues = aCentavos(65000) - aCentavos(2000);   // 63.000
  assert.strictEqual(liberaTrasPago({ saldoCentavosDespues: saldoDespues, limiteCortePesos: 60000 }), false);
});

check('quedar EXACTO en el limite no alcanza (el corte es >=)', () => {
  assert.strictEqual(liberaTrasPago({ saldoCentavosDespues: aCentavos(60000), limiteCortePesos: 60000 }), false);
  assert.strictEqual(liberaTrasPago({ saldoCentavosDespues: aCentavos(59999), limiteCortePesos: 60000 }), true);
});

check('faltaPagarCentavos dice cuanto hay que pagar como minimo', () => {
  const e = evaluarInicio({ saldoCentavos: aCentavos(65000), alarmaPagoPesos: 50000, limiteCortePesos: 60000 });
  const saldoDespues = e.saldoCentavos - e.faltaPagarCentavos;
  assert.strictEqual(liberaTrasPago({ saldoCentavosDespues: saldoDespues, limiteCortePesos: 60000 }), true);
});

check('el texto de bloqueo nombra deuda y limite', () => {
  const t = textoDeBloqueo(evaluarInicio({ saldoCentavos: aCentavos(65000), alarmaPagoPesos: 50000, limiteCortePesos: 60000 }));
  assert.match(t.titulo, /LÍMITE DE COMISIÓN ALCANZADO/);
  assert.match(t.pendiente, /65\.000/);
  assert.match(t.limite, /60\.000/);
});

// ---------------------------------------------------------------------------
// EL CABLEADO REAL.
//
// La atomicidad y la concurrencia se prueban contra el emulador. Acá se
// verifica sobre el CÓDIGO que el camino dormido siga existiendo y que el
// camino nuevo esté detrás de `contabilidadActiva`, que es lo que garantiza
// que instalar esta versión no altere la contabilidad actual.
// ---------------------------------------------------------------------------
console.log('\n12. El cableado respeta el sistema dormido:');

const fuenteApi = readFileSync(new URL('../comisionesApi.js', import.meta.url), 'utf8');

check('comisionesApi lee los totales y decide con contabilidadActiva', () => {
  assert.match(fuenteApi, /leerTotales\(/, 'no lee el nodo de totales');
  assert.match(fuenteApi, /contabilidadActiva\(totales\)/, 'no consulta si esta activa');
});

check('el camino DORMIDO conserva la escritura de siempre', () => {
  // La transaccion sobre el totalAcumulado legado y el set() del REGISTRO
  // siguen ocurriendo SIEMPRE, activo o no: es el comportamiento actual.
  assert.match(fuenteApi, /COMISIONES\/TOTALES\/totalAcumulado`\)/, 'se perdio el acumulador legado');
  assert.match(fuenteApi, /estado: 'pendiente'/, 'se perdio el registro de siempre');
});

check('el camino NUEVO esta detras del interruptor, en las tres operaciones', () => {
  const cuerpo = fuenteApi.replace(/\r\n/g, '\n');
  for (const plan of ['planDeVenta', 'planDeAnulacion', 'planDePago']) {
    const i = cuerpo.indexOf(plan + '(');
    assert.ok(i > 0, `falta ${plan}`);
    // Hacia atras desde la llamada tiene que aparecer la guarda.
    const antes = cuerpo.slice(Math.max(0, i - 700), i);
    assert.match(antes, /activa|contabilidadActiva/, `${plan} no esta detras del interruptor`);
  }
});

check('una venta con comision 0 no emite movimiento', () => {
  assert.match(fuenteApi, /tieneEfectoContable\(deltasDeVenta\(comisionCentavos\)\)/);
});

check('la anulacion usa comisionGeneradaCentavos guardado, no un porcentaje', () => {
  assert.match(fuenteApi, /registro\.comisionGeneradaCentavos/, 'no lee el importe guardado');
  assert.ok(!/fetchSalesPercentage/.test(fuenteApi), 'la anulacion no puede consultar el porcentaje actual');
});

check('el registro nuevo guarda comisionGeneradaCentavos', () => {
  assert.match(fuenteApi, /comisionGeneradaCentavos: comisionCentavos/);
});

check('el pago recibe y usa un idPago conservado por el llamador', () => {
  assert.match(fuenteApi, /idPagoIntento/, 'no acepta el id del intento');
  assert.match(fuenteApi, /planDePago\(\{[\s\S]{0,120}idPago: idPagoIntento/, 'no usa el id del intento');
});

check('R2: ordersApi cancela la comision del delivery anulado', () => {
  const orders = readFileSync(new URL('../ordersApi.js', import.meta.url), 'utf8');
  assert.match(orders, /wasEntregado && newStatus === 'CANCELADO'/, 'no detecta la anulacion de un entregado');
  assert.match(orders, /cancelarComision\(String\(orderId\), 'delivery'\)/, 'no revierte la comision del delivery');
});

check('un PERMISSION_DENIED no se asume duplicado: se consulta el movimiento', () => {
  assert.match(fuenteApi, /ComisionRechazadaError/, 'falta el error explicito');
  assert.match(fuenteApi, /operacion_rechazada/, 'falta el motivo de rechazo');
  assert.match(fuenteApi, /ya_aplicado/, 'falta el motivo de duplicado');
  // La consulta del movimiento tiene que ocurrir DESPUES de detectar el rechazo
  // y ANTES de decidir que fue un duplicado. Se mira el CODIGO, sin comentarios:
  // la prosa de arriba tambien nombra los motivos y falsearia el orden.
  const codigo = fuenteApi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const iDenegado = codigo.indexOf('const denegado');
  const iConsulta = codigo.indexOf('plan.movimiento.ruta))).exists()');
  const iDuplicado = codigo.indexOf("motivo: 'ya_aplicado'");
  assert.ok(iDenegado > 0, 'no detecta el rechazo');
  assert.ok(iConsulta > iDenegado, 'no consulta el movimiento tras el rechazo');
  assert.ok(iDuplicado > iConsulta, 'decide "duplicado" sin haber consultado');
});

check('si no se puede verificar el movimiento, se trata como rechazo', () => {
  assert.match(fuenteApi, /no se pudo verificar el movimiento/, 'asume duplicado sin poder comprobarlo');
});

check('mostrador sigue informando su canal', () => {
  const counter = readFileSync(new URL('../counterApi.js', import.meta.url), 'utf8');
  assert.match(counter, /cancelarComision\(String\(sale\.id\), 'mostrador'\)/);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
