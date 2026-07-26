// REGLA OBLIGATORIA DE ALMACENAMIENTO POR LOCAL
//
//   Realtime Database →  /{localId}/...
//   Firebase Storage  →  {localId}/...
//
// Este archivo es idéntico en Desktop y Tablet (paridadCanonica.test.js lo
// compara byte a byte) y cubre las pruebas obligatorias de la regla.
//
// Correr con: node src/lib/api/__tests__/rutasLocales.test.js
import assert from 'node:assert';
import {
  LOCAL_ID_REQUERIDO,
  LocalIdRequeridoError,
  normalizarLocalId,
  esLocalIdValido,
  construirRutaLocal,
  construirRutaStorageLocal,
  rutaPerteneceAlLocal,
  primerSegmento,
  esStorageGlobalPermitido,
  esRtdbGlobalPermitido,
  verificarMismoLocal,
  STORAGE_GLOBALES,
  RTDB_GLOBALES,
} from '../rutasLocales.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const ACHAVAL = '40508022';
const OTRO = '34734081';

// Nodos que deben quedar SIEMPRE dentro del local.
const NODOS_DEL_LOCAL = [
  'ARTICULOS', 'MATERIA_PRIMA', 'DEPARTAMENTOS', 'GRUPOS_OPCIONALES', 'OPCIONALES',
  'PEDIDOS', 'VENTAS', 'HISTORIAL', 'FACTURACION', 'FACTURACION_1', 'FACTURACION_OWNERS',
  'CONTADORES', 'USUARIOS', 'CONFIGURACION', 'COMISIONES', 'PAGOS', 'CAJAS', 'STOCK',
  'STOCK_LEDGER', 'LOCKS', 'LEASES', 'DISPOSITIVOS', 'IMPRESION', 'REVERSIONES',
  'PROMOTIONS', 'CLIENTES', 'DIRECCIONES', 'IMAGENES', 'ARCHIVOS', 'LOGS',
  'priceHistory', 'whatsappMessages', 'MOSTRADOR', 'CUENTAS', 'REPARTIDORES', 'BACKUP', 'RRHH',
];

// Carpetas de Storage que deben quedar SIEMPRE dentro del local.
const CARPETAS_STORAGE = [
  'productos', 'articulos', 'materias-primas', 'facturas', 'comprobantes', 'logos',
  'configuracion', 'pedidos', 'impresion', 'backups', 'web', 'app-icons', 'actualizaciones',
  'facturacion',
];

// Valores que NUNCA deben producir una ruta.
const INVALIDOS = [undefined, null, '', '   ', 'undefined', 'null', 'NULL', 'default',
  'NaN', 0, '0', NaN, Infinity, {}, [], true, false];

// ---------------------------------------------------------------------------
console.log('normalizarLocalId:');
// ---------------------------------------------------------------------------
check('acepta el número de local y lo devuelve limpio', () => {
  assert.strictEqual(normalizarLocalId(ACHAVAL), ACHAVAL);
  assert.strictEqual(normalizarLocalId(`  ${ACHAVAL}  `), ACHAVAL);
  assert.strictEqual(normalizarLocalId(`/${ACHAVAL}/`), ACHAVAL);
  assert.strictEqual(normalizarLocalId(40508022), ACHAVAL);
});
check('rechaza TODOS los valores que generarían rutas basura', () => {
  for (const v of INVALIDOS) {
    assert.strictEqual(normalizarLocalId(v), null, `debería rechazar ${JSON.stringify(v)}`);
    assert.strictEqual(esLocalIdValido(v), false, `esLocalIdValido(${JSON.stringify(v)})`);
  }
});
check('rechaza claves con caracteres ilegales de RTDB', () => {
  for (const v of ['4050.8022', 'a#b', 'a$b', 'a[b]', 'con espacio']) {
    assert.strictEqual(normalizarLocalId(v), null, v);
  }
});

// ---------------------------------------------------------------------------
console.log('\nRealtime Database — toda ruta empieza con el localId:');
// ---------------------------------------------------------------------------
check('cada nodo del local queda bajo /{localId}/', () => {
  for (const nodo of NODOS_DEL_LOCAL) {
    const ruta = construirRutaLocal(ACHAVAL, nodo);
    assert.strictEqual(ruta, `${ACHAVAL}/${nodo}`, nodo);
    assert.strictEqual(primerSegmento(ruta), ACHAVAL, nodo);
    assert.ok(rutaPerteneceAlLocal(ruta, ACHAVAL), nodo);
  }
});
check('Achaval escribe dentro de /40508022/', () => {
  assert.strictEqual(construirRutaLocal(ACHAVAL, 'ARTICULOS'), '40508022/ARTICULOS');
  assert.strictEqual(construirRutaLocal(ACHAVAL, 'MATERIA_PRIMA/11M'), '40508022/MATERIA_PRIMA/11M');
  assert.strictEqual(construirRutaLocal(ACHAVAL), '40508022');
});
check('otro local escribe dentro de su propia ruta', () => {
  assert.strictEqual(construirRutaLocal(OTRO, 'PEDIDOS'), '34734081/PEDIDOS');
});
check('un local NO puede escribir en otro', () => {
  const ruta = construirRutaLocal(ACHAVAL, 'VENTAS');
  assert.ok(rutaPerteneceAlLocal(ruta, ACHAVAL));
  assert.strictEqual(rutaPerteneceAlLocal(ruta, OTRO), false);
  // Y el prefijo no se confunde con un local que empieza igual.
  assert.strictEqual(rutaPerteneceAlLocal('405080221/VENTAS', ACHAVAL), false);
});
check('el orden INVERTIDO no lo produce nunca el helper', () => {
  for (const mal of ['FACTURACION_OWNERS/40508022', 'ARTICULOS/40508022', 'STOCK_LEDGER/40508022', 'CONTADORES/40508022']) {
    assert.strictEqual(rutaPerteneceAlLocal(mal, ACHAVAL), false, mal);
    assert.notStrictEqual(primerSegmento(mal), ACHAVAL, mal);
  }
});
check('barras sobrantes y repetidas se normalizan (nunca //)', () => {
  assert.strictEqual(construirRutaLocal(ACHAVAL, '/ARTICULOS/'), '40508022/ARTICULOS');
  assert.strictEqual(construirRutaLocal(ACHAVAL, 'A//B'), '40508022/A/B');
  assert.ok(!construirRutaLocal(ACHAVAL, '//ARTICULOS').includes('//'));
});

// ---------------------------------------------------------------------------
console.log('\nEscritura SIN localId: falla, no cae a la raíz:');
// ---------------------------------------------------------------------------
check('construirRutaLocal lanza LOCAL_ID_REQUIRED', () => {
  for (const v of INVALIDOS) {
    assert.throws(() => construirRutaLocal(v, 'PEDIDOS'), (e) => e.code === LOCAL_ID_REQUERIDO,
      `debería lanzar para ${JSON.stringify(v)}`);
  }
});
check('construirRutaStorageLocal lanza LOCAL_ID_REQUIRED', () => {
  for (const v of INVALIDOS) {
    assert.throws(() => construirRutaStorageLocal(v, 'facturas/x.pdf'), (e) => e.code === LOCAL_ID_REQUERIDO);
  }
});
check('el error es identificable y tipado', () => {
  try { construirRutaLocal(undefined, 'X'); assert.fail('debería lanzar'); }
  catch (e) {
    assert.ok(e instanceof LocalIdRequeridoError);
    assert.strictEqual(e.code, 'LOCAL_ID_REQUIRED');
    assert.ok(e.message.includes('LOCAL_ID_REQUIRED'));
  }
});
check('NUNCA se generan /undefined/, /null/, // ni undefined/', () => {
  const prohibidas = [/^undefined\//, /^null\//, /^\//, /\/\//, /^default\//, /^NaN\//];
  for (const v of INVALIDOS) {
    let ruta = null;
    try { ruta = construirRutaLocal(v, 'FACTURACION'); } catch { /* esperado */ }
    try { ruta = ruta ?? construirRutaStorageLocal(v, 'facturas'); } catch { /* esperado */ }
    assert.strictEqual(ruta, null, `${JSON.stringify(v)} produjo "${ruta}"`);
  }
  // Y la ruta buena no cae en ninguno de esos patrones.
  const buena = construirRutaLocal(ACHAVAL, 'FACTURACION');
  for (const p of prohibidas) assert.strictEqual(p.test(buena), false, `${buena} matchea ${p}`);
});

// ---------------------------------------------------------------------------
console.log('\nFACTURACION_OWNERS, lease, heartbeat y locks dentro del local:');
// ---------------------------------------------------------------------------
check('FACTURACION_OWNERS queda dentro del local', () => {
  const ruta = construirRutaLocal(ACHAVAL, 'FACTURACION_OWNERS/20123456789_00003');
  assert.strictEqual(ruta, '40508022/FACTURACION_OWNERS/20123456789_00003');
  assert.strictEqual(primerSegmento(ruta), ACHAVAL);
});
check('cada local tiene su propio FACTURACION_OWNERS', () => {
  const a = construirRutaLocal(ACHAVAL, 'FACTURACION_OWNERS/K');
  const b = construirRutaLocal(OTRO, 'FACTURACION_OWNERS/K');
  assert.notStrictEqual(a, b);
  assert.strictEqual(rutaPerteneceAlLocal(a, OTRO), false);
  assert.strictEqual(rutaPerteneceAlLocal(b, ACHAVAL), false);
});
check('lease, heartbeat, estado y locks cuelgan del mismo nodo del local', () => {
  for (const campo of ['lease', 'heartbeatAt', 'expiresAt', 'status', 'inicioAutomatico', 'lock', 'token']) {
    const ruta = construirRutaLocal(ACHAVAL, `FACTURACION_OWNERS/20123456789_00003/${campo}`);
    assert.ok(ruta.startsWith(`${ACHAVAL}/FACTURACION_OWNERS/`), campo);
  }
});
check('LOCKS y LEASES sueltos también quedan dentro del local', () => {
  assert.strictEqual(construirRutaLocal(ACHAVAL, 'LOCKS/x'), '40508022/LOCKS/x');
  assert.strictEqual(construirRutaLocal(ACHAVAL, 'LEASES/x'), '40508022/LEASES/x');
});
check('la ruta global vieja NO pertenece a ningún local (solo lectura de fallback)', () => {
  assert.strictEqual(rutaPerteneceAlLocal('FACTURACION_OWNERS/20123456789_00003', ACHAVAL), false);
  assert.strictEqual(esRtdbGlobalPermitido('FACTURACION_OWNERS/K'), false,
    'el nodo global viejo NO está autorizado como global');
});

// ---------------------------------------------------------------------------
console.log('\nContadores independientes por local:');
// ---------------------------------------------------------------------------
check('CONTADORES de dos locales son rutas distintas', () => {
  const a = construirRutaLocal(ACHAVAL, 'CONTADORES/turnos');
  const b = construirRutaLocal(OTRO, 'CONTADORES/turnos');
  assert.strictEqual(a, '40508022/CONTADORES/turnos');
  assert.strictEqual(b, '34734081/CONTADORES/turnos');
  assert.notStrictEqual(a, b);
});
check('dos locales simultáneos no comparten ninguna ruta', () => {
  for (const nodo of NODOS_DEL_LOCAL) {
    const a = construirRutaLocal(ACHAVAL, nodo);
    const b = construirRutaLocal(OTRO, nodo);
    assert.notStrictEqual(a, b, nodo);
    assert.strictEqual(rutaPerteneceAlLocal(a, OTRO), false, nodo);
    assert.strictEqual(rutaPerteneceAlLocal(b, ACHAVAL), false, nodo);
  }
});

// ---------------------------------------------------------------------------
console.log('\nCambio de local: la operación pendiente no puede escribir después:');
// ---------------------------------------------------------------------------
check('misma sesión: la verificación pasa y devuelve el local', () => {
  assert.strictEqual(verificarMismoLocal(ACHAVAL, ACHAVAL), ACHAVAL);
});
check('una operación que empezó en A no puede escribir tras cambiar a B', () => {
  assert.throws(() => verificarMismoLocal(ACHAVAL, OTRO), (e) => {
    assert.strictEqual(e.code, 'LOCAL_CHANGED');
    assert.strictEqual(e.localInicial, ACHAVAL);
    assert.strictEqual(e.localActual, OTRO);
    return true;
  });
});
check('si el local desapareció durante la operación, también aborta', () => {
  assert.throws(() => verificarMismoLocal(ACHAVAL, null), (e) => e.code === LOCAL_ID_REQUERIDO);
  assert.throws(() => verificarMismoLocal(undefined, ACHAVAL), (e) => e.code === LOCAL_ID_REQUERIDO);
});
check('simulación: escritura diferida del local anterior queda cancelada', () => {
  const localAlEmpezar = ACHAVAL;
  let localVigente = ACHAVAL;
  const escrituras = [];
  const escribirDiferido = (nodo) => {
    try {
      verificarMismoLocal(localAlEmpezar, localVigente);
      escrituras.push(construirRutaLocal(localVigente, nodo));
      return true;
    } catch (e) {
      return e.code;                       // cancelada
    }
  };
  assert.strictEqual(escribirDiferido('VENTAS'), true);
  localVigente = OTRO;                     // el usuario cambió de local
  assert.strictEqual(escribirDiferido('VENTAS'), 'LOCAL_CHANGED');
  assert.deepStrictEqual(escrituras, ['40508022/VENTAS'], 'no debe haberse escrito nada del local nuevo');
});

// ---------------------------------------------------------------------------
console.log('\nFirebase Storage — toda ruta empieza con {localId}/:');
// ---------------------------------------------------------------------------
check('cada carpeta del local queda bajo {localId}/', () => {
  for (const carpeta of CARPETAS_STORAGE) {
    const ruta = construirRutaStorageLocal(ACHAVAL, `${carpeta}/archivo.bin`);
    assert.strictEqual(ruta, `${ACHAVAL}/${carpeta}/archivo.bin`, carpeta);
    assert.strictEqual(primerSegmento(ruta), ACHAVAL, carpeta);
  }
});
check('sin ruta devuelve el prefijo con barra final', () => {
  assert.strictEqual(construirRutaStorageLocal(ACHAVAL), '40508022/');
});
check('facturas y PDFs usan el local correcto', () => {
  assert.strictEqual(construirRutaStorageLocal(ACHAVAL, 'facturas/A-0001-00000123.pdf'), '40508022/facturas/A-0001-00000123.pdf');
  assert.strictEqual(construirRutaStorageLocal(OTRO, 'facturas/A-0001-00000123.pdf'), '34734081/facturas/A-0001-00000123.pdf');
  assert.strictEqual(construirRutaStorageLocal(ACHAVAL, 'comprobantes/x.pdf').startsWith(`${OTRO}/`), false);
});
check('imágenes y archivos usan el local correcto', () => {
  assert.strictEqual(construirRutaStorageLocal(ACHAVAL, 'articulos/156A_1.png'), '40508022/articulos/156A_1.png');
  assert.strictEqual(construirRutaStorageLocal(ACHAVAL, 'logos/logo'), '40508022/logos/logo');
  assert.ok(rutaPerteneceAlLocal(construirRutaStorageLocal(ACHAVAL, 'web/featured_1.jpg'), ACHAVAL));
});
check('el orden INVERTIDO de Storage no lo produce nunca el helper', () => {
  for (const mal of ['productos/40508022/x.png', 'facturas/40508022/y.pdf', 'locales/40508022/z', 'logos/40508022/l']) {
    assert.strictEqual(rutaPerteneceAlLocal(mal, ACHAVAL), false, mal);
  }
});
check('una subida sin localId falla', () => {
  for (const v of INVALIDOS) {
    assert.throws(() => construirRutaStorageLocal(v, 'articulos/x.png'), (e) => e.code === LOCAL_ID_REQUERIDO);
  }
});

// ---------------------------------------------------------------------------
console.log('\nRutas globales autorizadas:');
// ---------------------------------------------------------------------------
check('el actualizador general sigue siendo global y funcionando', () => {
  assert.ok(esStorageGlobalPermitido('instalaciones/software/latest.json'));
  assert.ok(esStorageGlobalPermitido('instalaciones/software/1.3.64/Recepcion-de-Pedidos-Setup-1.3.64.exe'));
  assert.ok(esStorageGlobalPermitido('instalaciones/software/bootstrap/Recepcion-de-Pedidos-Web-Installer.exe'));
});
check('el registro central de rutas por local es global (bootstrap)', () => {
  assert.ok(esRtdbGlobalPermitido('rutas/40508022'));
  assert.ok(esRtdbGlobalPermitido('ids/40508022'));
  assert.ok(esRtdbGlobalPermitido('.info/connected'));
});
check('NADA más es global: los datos de un local nunca lo son', () => {
  for (const ruta of ['ARTICULOS', 'FACTURACION_OWNERS/K', 'priceHistory/40508022',
    'locales/40508022/whatsappMessages/1', 'PEDIDOS', 'VENTAS']) {
    assert.strictEqual(esRtdbGlobalPermitido(ruta), false, ruta);
  }
  for (const ruta of ['articulos/x.png', 'web/f.jpg', 'facturacion/40508022/c.crt',
    'app-icons/40508022/i.png', 'actualizaciones/40508022/s.exe']) {
    assert.strictEqual(esStorageGlobalPermitido(ruta), false, ruta);
  }
});
check('la lista de globales es corta y explícita (no crece por accidente)', () => {
  assert.deepStrictEqual([...STORAGE_GLOBALES], ['instalaciones/software/']);
  assert.deepStrictEqual([...RTDB_GLOBALES], ['rutas/', 'ids/', '.info/']);
});

// ---------------------------------------------------------------------------
console.log('\nSin doble escritura entre raíz y ruta local:');
// ---------------------------------------------------------------------------
check('para un mismo dato el helper devuelve UNA sola ruta (la del local)', () => {
  const destinos = new Set([
    construirRutaLocal(ACHAVAL, 'FACTURACION_OWNERS/K'),
    construirRutaLocal(ACHAVAL, 'FACTURACION_OWNERS/K'),
  ]);
  assert.strictEqual(destinos.size, 1);
  assert.strictEqual([...destinos][0], '40508022/FACTURACION_OWNERS/K');
  // La ruta legada NO es un destino válido de escritura.
  assert.strictEqual(rutaPerteneceAlLocal('FACTURACION_OWNERS/K', ACHAVAL), false);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
