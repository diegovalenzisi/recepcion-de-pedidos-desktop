// IMAGEN COMPLETA DEL LOCAL — snapshot total y restauración total.
//
// El concepto es literal y estos tests lo verifican como tal:
//
//     lo que existía al sacar la imagen  →  vuelve
//     lo que apareció después            →  desaparece
//
// Sin clasificar ramas, sin listas de qué conservar. La imagen es la verdad.
//
// Correr con: node src/lib/api/__tests__/imagenLocal.test.js
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import {
  SCHEMA_VERSION, LIMITE_BYTES,
  RUTA_BACKUP, RUTA_IMAGEN, RUTA_METADATA,
  medirImagen, enMB, construirMetadata,
  validarImagen, validarTamanoParaCopiar,
  construirUpdateRestauracion, resumenDeRestauracion, compararConImagen,
} from '../imagenLocal.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}
const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const LOCAL = '57641732';

/** Un local de juguete, con las ramas que importan. */
const localBase = () => ({
  CONFIGURACION: { nombre: 'Heladería', porcentaje: 1 },
  ARTICULOS: { '10A': { nombre: 'Coca', precio: 1500, stock: { propio: 50 } } },
  CAJAS: { turno7: { abierta: true, fondo: 20000 } },
  PEDIDOS: { 125: { estado: 'pendiente' }, 126: { estado: 'entregado' } },
  CLIENTES: { c1: { nombre: 'Juan' } },
  CONTADORES: { mostrador: 720, ARTICULOS: 10 },
  RRHH: { EMPLEADOS: { e1: { nombre: 'Ana' } } },
});

// ---------------------------------------------------------------------------
console.log('\n1. La copia vive FUERA del nodo del local:');

check('las tres rutas cuelgan de BACKUP/{localId}', () => {
  assert.strictEqual(RUTA_BACKUP(LOCAL), 'BACKUP/57641732');
  assert.strictEqual(RUTA_IMAGEN(LOCAL), 'BACKUP/57641732/IMAGEN');
  assert.strictEqual(RUTA_METADATA(LOCAL), 'BACKUP/57641732/METADATA');
});

check('ninguna ruta del backup cae DENTRO del local', () => {
  // Si cayeran adentro, restaurar /{localId} borraría la propia copia.
  for (const r of [RUTA_BACKUP(LOCAL), RUTA_IMAGEN(LOCAL), RUTA_METADATA(LOCAL)]) {
    assert.ok(!r.startsWith(`${LOCAL}/`), `${r} está dentro del local`);
    assert.ok(r.startsWith('BACKUP/'), `${r} no está bajo BACKUP`);
  }
});

check('el update de restauración NO toca el backup', () => {
  const updates = construirUpdateRestauracion(LOCAL, localBase(), Object.keys(localBase()));
  for (const ruta of Object.keys(updates)) {
    assert.ok(ruta.startsWith(`${LOCAL}/`), `${ruta} escribe fuera del local`);
    assert.ok(!ruta.includes('BACKUP/'), `${ruta} pisa el backup`);
  }
});

// ---------------------------------------------------------------------------
console.log('\n2. Restaurar devuelve el local EXACTO a la imagen:');

check('lo que estaba en la imagen, vuelve tal cual', () => {
  const imagen = localBase();
  const updates = construirUpdateRestauracion(LOCAL, imagen, Object.keys(imagen));
  for (const [rama, contenido] of Object.entries(imagen)) {
    assert.deepStrictEqual(updates[`${LOCAL}/${rama}`], contenido, `${rama} no vuelve igual`);
  }
});

check('el ejemplo del pedido, dato por dato', () => {
  // Imagen: Coca 50, caja abierta con fondo 20000, pedido 125 pendiente,
  // 126 entregado, contador mostrador 720.
  const imagen = localBase();
  // Después de las pruebas: Coca 32, caja cerrada, pedidos nuevos, contador 740.
  const despues = {
    ...imagen,
    ARTICULOS: { '10A': { nombre: 'Coca', precio: 1500, stock: { propio: 32 } } },
    CAJAS: { turno7: { abierta: false, fondo: 20000, cierre: 'x' }, turno8: { abierta: true } },
    PEDIDOS: { 125: { estado: 'entregado' }, 130: { estado: 'pendiente' } },
    CONTADORES: { mostrador: 740, ARTICULOS: 10 },
    VENTAS: { v1: { total: 5000 } },        // rama que no existía
  };
  const updates = construirUpdateRestauracion(LOCAL, imagen, Object.keys(despues));

  assert.strictEqual(updates[`${LOCAL}/ARTICULOS`]['10A'].stock.propio, 50, 'Coca no volvió a 50');
  assert.strictEqual(updates[`${LOCAL}/CAJAS`].turno7.abierta, true, 'la caja no volvió abierta');
  assert.strictEqual(updates[`${LOCAL}/CAJAS`].turno7.fondo, 20000);
  assert.strictEqual(updates[`${LOCAL}/CAJAS`].turno8, undefined, 'quedó un turno que no existía');
  assert.strictEqual(updates[`${LOCAL}/PEDIDOS`]['125'].estado, 'pendiente');
  assert.strictEqual(updates[`${LOCAL}/PEDIDOS`]['126'].estado, 'entregado');
  assert.strictEqual(updates[`${LOCAL}/PEDIDOS`]['130'], undefined, 'quedó un pedido nuevo');
  assert.strictEqual(updates[`${LOCAL}/CONTADORES`].mostrador, 720, 'el contador no volvió');
  assert.strictEqual(updates[`${LOCAL}/VENTAS`], null, 'la rama nueva no se borra');
});

check('una rama que apareció DESPUÉS se borra con null', () => {
  const imagen = localBase();
  const updates = construirUpdateRestauracion(LOCAL, imagen, [...Object.keys(imagen), 'ENCUESTA', 'COMISIONES']);
  assert.strictEqual(updates[`${LOCAL}/ENCUESTA`], null);
  assert.strictEqual(updates[`${LOCAL}/COMISIONES`], null);
});

check('una rama de la imagen que hoy NO existe, se recrea', () => {
  const imagen = localBase();
  const updates = construirUpdateRestauracion(LOCAL, imagen, ['CONFIGURACION']);
  assert.deepStrictEqual(updates[`${LOCAL}/ARTICULOS`], imagen.ARTICULOS);
  assert.deepStrictEqual(updates[`${LOCAL}/RRHH`], imagen.RRHH);
});

check('es UNA sola escritura: una entrada por rama, sin rutas profundas', () => {
  const imagen = localBase();
  const updates = construirUpdateRestauracion(LOCAL, imagen, Object.keys(imagen));
  for (const ruta of Object.keys(updates)) {
    assert.strictEqual(ruta.split('/').length, 2, `${ruta} no es una rama de primer nivel`);
  }
});

check('no hay clasificación de ramas: todo entra por igual', () => {
  const src = leer('../imagenLocal.js');
  // El mecanismo anterior tenía listas de qué conservar y qué borrar.
  for (const rastro of ['CONTADORES_CATALOGO', 'CONTADORES_OPERATIVOS', 'RAMAS_A_BORRAR', 'clasificar']) {
    assert.ok(!src.includes(rastro), `quedó lógica selectiva: ${rastro}`);
  }
});

// ---------------------------------------------------------------------------
console.log('\n3. El resumen dice la verdad antes de confirmar:');

check('cuenta lo que se restaura, lo que se recrea y lo que se borra', () => {
  const imagen = localBase();
  const hoy = [...Object.keys(imagen).filter((r) => r !== 'RRHH'), 'VENTAS', 'ENCUESTA'];
  const r = resumenDeRestauracion(imagen, hoy);
  assert.strictEqual(r.ramasEnImagen, 7);
  assert.strictEqual(r.ramasQueSeRecrean, 1, 'RRHH no figura como recreada');
  assert.strictEqual(r.ramasQueSeBorran, 2);
  assert.deepStrictEqual(r.nombresQueSeBorran, ['ENCUESTA', 'VENTAS']);
});

// ---------------------------------------------------------------------------
console.log('\n4. Validación: no se restaura cualquier cosa:');

const metaOk = () => construirMetadata({ localId: LOCAL, databasePathOriginal: LOCAL, ramas: Object.keys(localBase()) });

check('una imagen válida pasa', () => {
  const v = validarImagen(localBase(), metaOk(), LOCAL);
  assert.ok(v.ok, v.problemas.join(' '));
});

check('sin imagen, no se restaura', () => {
  for (const x of [null, undefined]) {
    assert.strictEqual(validarImagen(x, metaOk(), LOCAL).ok, false);
  }
});

check('una imagen VACÍA se rechaza: borraría todo el local', () => {
  const v = validarImagen({}, metaOk(), LOCAL);
  assert.strictEqual(v.ok, false);
  assert.match(v.problemas.join(' '), /vacía/);
});

check('una imagen que no es un nodo se rechaza', () => {
  for (const x of ['texto', 42, [], true]) {
    assert.strictEqual(validarImagen(x, metaOk(), LOCAL).ok, false, `${JSON.stringify(x)} pasó`);
  }
});

check('la imagen de OTRO local se rechaza', () => {
  const meta = construirMetadata({ localId: '40508022', databasePathOriginal: '40508022', ramas: ['X'] });
  const v = validarImagen(localBase(), meta, LOCAL);
  assert.strictEqual(v.ok, false);
  assert.match(v.problemas.join(' '), /es del local 40508022/);
});

check('una schemaVersion distinta se rechaza', () => {
  const meta = { ...metaOk(), schemaVersion: 99 };
  const v = validarImagen(localBase(), meta, LOCAL);
  assert.strictEqual(v.ok, false);
  assert.match(v.problemas.join(' '), /formato distinto/);
});

check('sin metadata se rechaza', () => {
  const v = validarImagen(localBase(), null, LOCAL);
  assert.strictEqual(v.ok, false);
  assert.match(v.problemas.join(' '), /no tiene metadata/);
});

// ---------------------------------------------------------------------------
console.log('\n5. El límite de tamaño de Firebase:');

check('un local chico se puede copiar', () => {
  const r = validarTamanoParaCopiar(localBase());
  assert.ok(r.ok, r.motivo);
  assert.ok(r.bytes > 0);
});

check('un local que supera el límite se rechaza ANTES de escribir', () => {
  // Una escritura del SDK no puede pasar los 16 MB; el límite propio es 12 MB.
  const enorme = { PEDIDOS: { x: 'a'.repeat(LIMITE_BYTES + 1000) } };
  const r = validarTamanoParaCopiar(enorme);
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /pesa .* MB/);
  assert.match(r.motivo, /período de prueba/);
});

check('una imagen demasiado grande tampoco se restaura', () => {
  const enorme = { PEDIDOS: { x: 'a'.repeat(LIMITE_BYTES + 1000) } };
  const v = validarImagen(enorme, metaOk(), LOCAL);
  assert.strictEqual(v.ok, false);
  assert.match(v.problemas.join(' '), /una sola escritura/);
});

check('el límite queda por debajo del máximo real del SDK', () => {
  assert.ok(LIMITE_BYTES < 16 * 1024 * 1024, 'el límite no deja margen');
  assert.strictEqual(enMB(12 * 1024 * 1024), '12.0 MB');
});

// ---------------------------------------------------------------------------
console.log('\n6. Metadata: describe la copia, no forma parte de ella:');

check('los dos timestamps salen del MISMO valor', () => {
  const m = construirMetadata({ localId: LOCAL, ahora: 1788000000000, ramas: ['A'] });
  assert.strictEqual(new Date(m.creadaEnMs).toISOString(), m.creadaEn);
});

check('guarda local, ruta original, versión y ramas', () => {
  const m = construirMetadata({
    localId: LOCAL, databasePathOriginal: LOCAL, versionSistema: '1.3.99',
    creadaPor: 'DiegoL', bytes: 1234, ramas: ['B', 'A'],
  });
  assert.strictEqual(m.localId, LOCAL);
  assert.strictEqual(m.databasePathOriginal, LOCAL);
  assert.strictEqual(m.versionSistema, '1.3.99');
  assert.strictEqual(m.creadaPor, 'DiegoL');
  assert.strictEqual(m.bytes, 1234);
  assert.deepStrictEqual(m.ramas, ['A', 'B'], 'las ramas no quedan ordenadas');
  assert.strictEqual(m.cantidadRamas, 2);
  assert.strictEqual(m.schemaVersion, SCHEMA_VERSION);
});

check('la metadata NO se restaura: vive en otra ruta que la imagen', () => {
  assert.notStrictEqual(RUTA_METADATA(LOCAL), RUTA_IMAGEN(LOCAL));
  assert.ok(!RUTA_METADATA(LOCAL).startsWith(RUTA_IMAGEN(LOCAL)));
});

// ---------------------------------------------------------------------------
console.log('\n7. Verificación posterior a la restauración:');

check('si el local quedó igual a la imagen, pasa', () => {
  const imagen = localBase();
  assert.strictEqual(compararConImagen(imagen, JSON.parse(JSON.stringify(imagen))).ok, true);
});

check('detecta una rama que quedó distinta', () => {
  const imagen = localBase();
  const mal = JSON.parse(JSON.stringify(imagen));
  mal.ARTICULOS['10A'].stock.propio = 32;
  const c = compararConImagen(imagen, mal);
  assert.strictEqual(c.ok, false);
  assert.match(c.fallas.join(' '), /ARTICULOS/);
});

check('detecta una rama que no se borró', () => {
  const imagen = localBase();
  const c = compararConImagen(imagen, { ...imagen, VENTAS: { v1: {} } });
  assert.strictEqual(c.ok, false);
  assert.match(c.fallas.join(' '), /VENTAS no se borró/);
});

check('detecta una rama que no se restauró', () => {
  const imagen = localBase();
  const sinArticulos = { ...imagen }; delete sinArticulos.ARTICULOS;
  const c = compararConImagen(imagen, sinArticulos);
  assert.strictEqual(c.ok, false);
  assert.match(c.fallas.join(' '), /ARTICULOS no se restauró/);
});

check('null y ausente se tratan igual', () => {
  // Firebase no distingue una rama borrada de una que nunca existió.
  assert.strictEqual(compararConImagen({ A: null }, {}).ok, true);
  assert.strictEqual(compararConImagen({}, { A: null }).ok, true);
});

// ---------------------------------------------------------------------------
console.log('\n8. El mecanismo selectivo anterior ya NO existe:');

check('los cuatro módulos viejos fueron eliminados', () => {
  for (const f of ['../estadoBase.js', '../estadoBaseApi.js', '../planReset.js', '../resetApi.js']) {
    assert.ok(!existsSync(new URL(f, import.meta.url)), `todavía existe ${f}`);
  }
});

check('nadie los importa: no hay código muerto colgando', () => {
  const api = leer('../imagenLocalApi.js');
  const ui = leer('../../../components/settings/local/admin/PeriodoPruebaManager.jsx');
  for (const src of [api, ui]) {
    for (const viejo of ['estadoBase', 'planReset', 'resetApi', 'ESTADO_BASE', 'ARCHIVO_FISCAL', 'RESPALDO_PRUEBAS']) {
      assert.ok(!src.includes(viejo), `quedó una referencia a ${viejo}`);
    }
  }
});

check('la pantalla usa el mecanismo nuevo y pide escribir RESTAURAR', () => {
  const ui = leer('../../../components/settings/local/admin/PeriodoPruebaManager.jsx');
  assert.match(ui, /crearImagen|restaurarImagen|inspeccionarImagen/);
  assert.match(ui, /'RESTAURAR'/, 'no pide la palabra de confirmación');
  assert.match(ui, /Imagen para período de prueba/);
  assert.match(ui, /Crear imagen de base de datos/);
  assert.match(ui, /Recrear imagen de base de datos/);
  assert.match(ui, /Finalizar pruebas/);
});

check('crear la imagen solo LEE del local', () => {
  const api = leer('../imagenLocalApi.js');
  const i = api.indexOf('export const crearImagen');
  const cuerpo = api.slice(i, api.indexOf('export const inspeccionarImagen'));
  // Las únicas escrituras son a las rutas del backup.
  const escrituras = cuerpo.match(/set\(ref\(db, ([^)]+)\)/g) || [];
  assert.ok(escrituras.length > 0, 'no escribe la imagen');
  for (const e of escrituras) {
    assert.ok(/RUTA_IMAGEN|RUTA_METADATA/.test(e), `crearImagen escribe fuera del backup: ${e}`);
  }
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
