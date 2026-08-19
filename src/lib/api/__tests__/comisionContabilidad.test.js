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
  frontera, esPosteriorAlCorte, separarPorFrontera, calcularComisionDeVenta,
} from '../comisionMovimiento.js';
import { datosDeRegistro, obtenerDeviceId } from '../deviceIdentity.js';
import {
  ESTADO_INICIO, corteActivo, avisoActivo, evaluarInicio,
  bloquea, liberaTrasPago, validarConfiguracion, textoDeBloqueo,
  ESTADO_SESION, evaluarInicioConLecturas, estadoDeSesion,
  valorLeido, valorNoVerificable, textoNoVerificable,
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
  for (const plan of ['planDeVenta', 'planDeAnulacion', 'planCompletoDePago']) {
    const i = cuerpo.indexOf(plan + '(');
    assert.ok(i > 0, `falta ${plan}`);
    // Hacia atras desde la llamada tiene que aparecer la guarda.
    const antes = cuerpo.slice(Math.max(0, i - 1800), i);
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
  assert.match(fuenteApi, /planCompletoDePago\(\{[\s\S]{0,200}idPago: idPagoIntento/, 'no usa el id del intento');
  // Y el pago entero (contabilidad + detalle) va en UNA sola escritura.
  assert.match(fuenteApi, /aplicarPlanCompleto/, 'el detalle no viaja con la contabilidad');
  assert.match(fuenteApi, /\.\.\.plan\.detalle/, 'los registros no entran en el mismo update');
  assert.match(fuenteApi, /plan\.comprobante\.ruta/, 'el comprobante no entra en el mismo update');
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

// ---------------------------------------------------------------------------
console.log('\n13. Un error de lectura NO puede significar "corte desactivado":');

check('campo ausente -> 0 valido -> desactivado', () => {
  const e = evaluarInicioConLecturas({
    saldo: valorLeido(aCentavos(999999)), alarma: valorLeido(0), limite: valorLeido(0),
  });
  assert.strictEqual(e.estado, ESTADO_INICIO.NORMAL, 'sin limite no bloquea');
  assert.strictEqual(estadoDeSesion(e), ESTADO_SESION.AUTORIZADA);
});

check('campo presente en 0 -> desactivado (igual que ausente)', () => {
  const e = evaluarInicioConLecturas({
    saldo: valorLeido(aCentavos(70000)), alarma: valorLeido(50000), limite: valorLeido(0),
  });
  assert.strictEqual(bloquea(e), false);
});

check('LECTURA FALLIDA del limite -> NO se asume 0', () => {
  const e = evaluarInicioConLecturas({
    saldo: valorLeido(aCentavos(70000)), alarma: valorLeido(50000), limite: valorNoVerificable('timeout'),
  });
  assert.strictEqual(e.estado, ESTADO_INICIO.NO_VERIFICABLE, 'no puede pasar por corte desactivado');
  assert.strictEqual(estadoDeSesion(e), ESTADO_SESION.ERROR);
  assert.strictEqual(bloquea(e), false, 'no es un bloqueo por corte, es un error de verificacion');
});

check('lectura fallida del SALDO o de la ALARMA tambien es no verificable', () => {
  for (const campo of ['saldo', 'alarma']) {
    const args = { saldo: valorLeido(0), alarma: valorLeido(50000), limite: valorLeido(60000) };
    args[campo] = valorNoVerificable('red');
    assert.strictEqual(evaluarInicioConLecturas(args).estado, ESTADO_INICIO.NO_VERIFICABLE, campo);
  }
});

check('no verificable NO habilita la sesion', () => {
  const e = evaluarInicioConLecturas({ saldo: valorNoVerificable('x'), alarma: valorLeido(0), limite: valorLeido(0) });
  assert.notStrictEqual(estadoDeSesion(e), ESTADO_SESION.AUTORIZADA, 'no se puede trabajar sin verificar');
});

check('la pantalla ofrece Reintentar y Salir', () => {
  const t = textoNoVerificable();
  assert.match(t.titulo, /NO SE PUDO VERIFICAR EL ESTADO DE COMISIONES/);
  assert.deepStrictEqual(t.acciones, ['REINTENTAR', 'SALIR']);
});

check('una sesion YA autorizada no se re-evalua: un fallo posterior no bloquea', () => {
  // Se evalua UNA vez, al inicio, y el resultado se guarda.
  const decision = evaluarInicioConLecturas({
    saldo: valorLeido(aCentavos(55000)), alarma: valorLeido(50000), limite: valorLeido(60000),
  });
  assert.strictEqual(estadoDeSesion(decision), ESTADO_SESION.AUTORIZADA);
  // Firebase se cae despues. La sesion NO vuelve a evaluar nada.
  assert.strictEqual(estadoDeSesion(decision), ESTADO_SESION.AUTORIZADA, 'sigue autorizada');
  assert.strictEqual(bloquea(decision), false);
});

// ---------------------------------------------------------------------------
console.log('\n14. La frontera contable (migracionActivadaEn):');

const TOT_ACTIVO = { migracionVersion: 1, migracionActivadaEn: 1000 };

check('sin activar no hay frontera', () => {
  assert.strictEqual(frontera({ migracionVersion: 0 }), null);
  assert.strictEqual(frontera(undefined), null);
});

check('activada, la frontera es el timestamp del servidor', () => {
  assert.strictEqual(frontera(TOT_ACTIVO), 1000);
});

check('un registro ANTERIOR a la frontera es legado', () => {
  assert.strictEqual(esPosteriorAlCorte({ registradoEn: 999 }, TOT_ACTIVO), false);
});

check('un registro EN la frontera o posterior es del sistema nuevo', () => {
  assert.strictEqual(esPosteriorAlCorte({ registradoEn: 1000 }, TOT_ACTIVO), true);
  assert.strictEqual(esPosteriorAlCorte({ registradoEn: 1001 }, TOT_ACTIVO), true);
});

check('un registro SIN registradoEn es legado', () => {
  assert.strictEqual(esPosteriorAlCorte({ comisionGenerada: 10 }, TOT_ACTIVO), false);
});

check('la clave M/D NO define el lado de la frontera', () => {
  // Las claves M/D existen desde el hotfix de identidad, ANTES de activar:
  // hay registros M/D que son legado.
  const mLegado = { ventaKey: 'M1808', canal: 'mostrador', registradoEn: 500 };
  const mNuevo = { ventaKey: 'M1809', canal: 'mostrador', registradoEn: 1500 };
  assert.strictEqual(esPosteriorAlCorte(mLegado, TOT_ACTIVO), false, 'una clave M puede ser legado');
  assert.strictEqual(esPosteriorAlCorte(mNuevo, TOT_ACTIVO), true);
});

check('separarPorFrontera manda cada registro a UN solo lado', () => {
  const REG = {
    '744':   { comisionGenerada: 80 },                          // sin registradoEn: legado
    'M1808': { comisionGenerada: 60, registradoEn: 500 },       // M pero anterior: legado
    'M1809': { comisionGenerada: 70, registradoEn: 1500 },      // nuevo
    'D5220': { comisionGenerada: 142, registradoEn: 2000 },     // nuevo
  };
  const { legado, nuevo } = separarPorFrontera(REG, TOT_ACTIVO);
  assert.deepStrictEqual(legado.map((r) => r.clave).sort(), ['744', 'M1808']);
  assert.deepStrictEqual(nuevo.map((r) => r.clave).sort(), ['D5220', 'M1809']);
  assert.strictEqual(legado.length + nuevo.length, 4, 'ningun registro puede caer en los dos lados');
});

check('sin activar, TODO es legado', () => {
  const REG = { 'M1': { registradoEn: 5 }, 'D2': { registradoEn: 9 } };
  const { legado, nuevo } = separarPorFrontera(REG, { migracionVersion: 0 });
  assert.strictEqual(nuevo.length, 0, 'no puede haber nada nuevo sin frontera');
  assert.strictEqual(legado.length, 2);
});

check('los registros nuevos guardan registradoEn del servidor', () => {
  assert.match(fuenteApi, /registradoEn: serverTimestamp\(\)/, 'no marca el momento del servidor');
});

check('fetchLimiteCorte distingue ausente de no verificable', () => {
  const settings = readFileSync(new URL('../settingsApi.js', import.meta.url), 'utf8');
  assert.match(settings, /valorNoVerificable/, 'no informa cuando no se pudo leer');
  assert.ok(!/console\.error\('Error fetching limiteCorte:[\s\S]{0,80}return 0;/.test(settings),
    'volvio a devolver 0 ante un error de lectura');
});

// ---------------------------------------------------------------------------
console.log('\n15. Determinacion UNICA de la comision de una venta:');

check('venta $100 al 1% -> los tres valores de una sola vez', () => {
  assert.deepStrictEqual(calcularComisionDeVenta(100, 1), {
    porcentajeComision: 1, comisionGenerada: 1, comisionGeneradaCentavos: 100,
  });
});

check('venta $150 al 1% -> $1,50', () => {
  const c = calcularComisionDeVenta(150, 1);
  assert.strictEqual(c.comisionGenerada, 1.5);
  assert.strictEqual(c.comisionGeneradaCentavos, 150);
});

check('los centavos salen del importe, no de redondear los pesos', () => {
  // 18.500 al 1% = 185 exactos
  assert.strictEqual(calcularComisionDeVenta(18500, 1).comisionGeneradaCentavos, 18500);
  // 1.234,56 al 1% = 12,3456 -> 1234,56 centavos -> 1235
  assert.strictEqual(calcularComisionDeVenta(1234.56, 1).comisionGeneradaCentavos, 1235);
});

check('porcentaje 0 -> comision 0, sin romper', () => {
  assert.deepStrictEqual(calcularComisionDeVenta(100000, 0), {
    porcentajeComision: 0, comisionGenerada: 0, comisionGeneradaCentavos: 0,
  });
});

check('valores invalidos no producen NaN', () => {
  for (const [v, p] of [[null, 1], [100, null], ['x', 'y'], [undefined, undefined]]) {
    const c = calcularComisionDeVenta(v, p);
    assert.ok(Number.isFinite(c.comisionGenerada));
    assert.ok(Number.isInteger(c.comisionGeneradaCentavos));
  }
});

check('cambiar el porcentaje despues NO cambia la comision de la venta vieja', () => {
  const alMomentoDeLaVenta = calcularComisionDeVenta(100, 1);   // 1%
  // El local pasa a 2%. La venta ya tiene su importe guardado.
  const conElNuevoPorcentaje = calcularComisionDeVenta(100, 2);
  assert.strictEqual(alMomentoDeLaVenta.comisionGeneradaCentavos, 100);
  assert.strictEqual(conElNuevoPorcentaje.comisionGeneradaCentavos, 200);
  // La anulacion tiene que usar el PRIMERO.
  const d = deltasDeAnulacion(alMomentoDeLaVenta.comisionGeneradaCentavos);
  assert.strictEqual(d.dHist, -100, 'la anulacion resta la comision original');
});

check('myAccountApi calcula UNA vez y pasa los tres valores', () => {
  const my = readFileSync(new URL('../myAccountApi.js', import.meta.url), 'utf8');
  assert.match(my, /calcularComisionDeVenta\(saleValue, porcentajeAplicado\)/, 'no usa la determinacion unica');
  assert.match(my, /comisionGeneradaCentavos: comision\.comisionGeneradaCentavos/, 'no pasa los centavos al registro');
  assert.match(my, /porcentajeComision: comision\.porcentajeComision/, 'no pasa el porcentaje determinado');
  assert.ok(!/porcentajeComision: parseFloat\(percentage\)/.test(my), 'vuelve a leer el porcentaje al registrar');
});

check('registrarComision usa el importe recibido, no lo recalcula', () => {
  assert.match(fuenteApi, /Number\.isInteger\(comisionGeneradaCentavos\)/, 'no acepta el importe ya determinado');
});

// ---------------------------------------------------------------------------
console.log('\n16. El hook expone centavos, sin ida y vuelta:');

const fuenteHook = readFileSync(new URL('../../../hooks/useCommissionTotal.js', import.meta.url), 'utf8');

check('con la contabilidad activa los centavos son la fuente', () => {
  assert.match(fuenteHook, /totalGeneratedCentavos: a\.totalAcumuladoCentavos/);
  assert.match(fuenteHook, /pendingCentavos: a\.saldoPendienteCentavos/);
});

check('los pesos se derivan solo para mostrar', () => {
  assert.match(fuenteHook, /totalGenerated: aPesos\(a\.totalAcumuladoCentavos\)/);
});

check('dormido tambien ofrece centavos, para no convertir en cada llamador', () => {
  assert.match(fuenteHook, /pendingCentavos: aCentavos\(pendienteFinal\)/);
});

check('el hook informa en que modo esta', () => {
  assert.match(fuenteHook, /contabilidadNueva: true/);
  assert.match(fuenteHook, /contabilidadNueva: false/);
});

check('TRANSICION 0 -> 1: desmonta los listeners legados', () => {
  assert.match(fuenteHook, /desmontarModoLegado/, 'no existe el desmontaje');
  assert.match(fuenteHook, /if \(modoNuevo === false\) desmontarModoLegado\(\)/,
    'al activarse no desmonta REGISTRO/PAGOS: seguirian descargando el historial');
});

check('no se duplican listeners si ya estaban montados', () => {
  assert.match(fuenteHook, /if \(regListener \|\| pagosListener\) return;/);
});

check('la limpieza final desmonta TOTALES, REGISTRO y PAGOS', () => {
  assert.match(fuenteHook, /off\(totalesRef, 'value', desuscribirTotales\)/);
  assert.match(fuenteHook, /if \(regListener\) off\(registroRef, 'value', regListener\)/);
  assert.match(fuenteHook, /if \(pagosListener\) off\(pagosRef, 'value', pagosListener\)/);
});

check('el cambio de local reinicia el efecto (firebaseReady en las deps)', () => {
  assert.match(fuenteHook, /\}, \[isActive, firebaseReady\]\);/,
    'sin firebaseReady en las deps quedarian listeners del local anterior');
});

// ---------------------------------------------------------------------------
console.log('\n17. RESUMEN_CUENTA ya no se borra al pagar:');

check('processCommissionPayment no pone fechas en null', () => {
  const settings = readFileSync(new URL('../settingsApi.js', import.meta.url), 'utf8');
  const i = settings.indexOf('export const processCommissionPayment');
  const cuerpo = settings.slice(i, settings.indexOf('export const', i + 50));
  assert.ok(!/updates\[key\] = null;/.test(cuerpo), 'volvio a borrar fechas de RESUMEN_CUENTA');
  assert.match(cuerpo, /EL PAGO YA NO BORRA HISTÓRICO/, 'falta la explicacion de por que no se borra');
});

// ---------------------------------------------------------------------------
console.log('\n18. Registro del dispositivo (adopcion):');

check('el payload tiene los cinco campos, con deviceType desktop', () => {
  const d = datosDeRegistro({ localId: '40508022', deviceId: 'dev-1', clientVersion: '1.3.97', ahora: 555 });
  assert.deepStrictEqual(d, {
    deviceName: 'Desktop 40508022', deviceType: 'desktop',
    localId: '40508022', lastSeenAt: 555, clientVersion: '1.3.97',
  });
});

check('primer inicio: crea la identidad y la persiste', () => {
  const m = new Map();
  const alm = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const id1 = obtenerDeviceId(alm);
  assert.ok(id1, 'no genero id');
  assert.strictEqual(m.size, 1, 'no lo persistio');
});

check('segundo inicio: MISMO deviceId, solo cambia lastSeenAt', () => {
  const m = new Map();
  const alm = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const id1 = obtenerDeviceId(alm);
  const id2 = obtenerDeviceId(alm);
  assert.strictEqual(id2, id1, 'creo un dispositivo nuevo en el segundo arranque');
  const a = datosDeRegistro({ localId: 'L', deviceId: id1, clientVersion: '1.3.97', ahora: 100 });
  const b = datosDeRegistro({ localId: 'L', deviceId: id2, clientVersion: '1.3.97', ahora: 200 });
  assert.notStrictEqual(a.lastSeenAt, b.lastSeenAt);
  assert.strictEqual(a.clientVersion, b.clientVersion);
});

check('nueva version: MISMO deviceId, nueva clientVersion', () => {
  const m = new Map();
  const alm = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const id = obtenerDeviceId(alm);
  const antes = datosDeRegistro({ localId: 'L', deviceId: id, clientVersion: '1.3.97', ahora: 1 });
  const despues = datosDeRegistro({ localId: 'L', deviceId: obtenerDeviceId(alm), clientVersion: '1.3.98', ahora: 2 });
  assert.strictEqual(obtenerDeviceId(alm), id, 'el deviceId tiene que sobrevivir a la actualizacion');
  assert.strictEqual(antes.clientVersion, '1.3.97');
  assert.strictEqual(despues.clientVersion, '1.3.98');
});

check('la version sale de la fuente real, no de una constante duplicada', () => {
  const dev = readFileSync(new URL('../deviceIdentity.js', import.meta.url), 'utf8');
  assert.match(dev, /__APP_VERSION__/, 'no usa la version inyectada desde package.json');
  assert.ok(!/clientVersion: '1\.3\./.test(dev), 'hay un numero de version escrito a mano');
});

check('Desktop se registra en el ARRANQUE, no al abrir una pantalla', () => {
  const app = readFileSync(new URL('../../../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /registrarDispositivo\(\{ localId: id, firebaseUrl: getFirebaseUrl\(\) \}\)/);
  const iCarga = app.indexOf('const loadInitialData');
  const iReg = app.indexOf('registrarDispositivo({');
  assert.ok(iReg > iCarga && iReg > 0, 'no esta dentro de la carga inicial');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
