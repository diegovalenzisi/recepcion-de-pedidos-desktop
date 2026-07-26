#!/usr/bin/env node
/**
 * MIGRACIÓN DE REMITOS HISTÓRICOS  `/{localId}/VENTAS/FCX…`  →  `/{localId}/Remitos/FCX…`
 *
 * ⚠️  NO SE EJECUTA SOLO. Por defecto corre en modo SIMULACIÓN (dry-run): lee,
 *     compara e informa, pero NO escribe absolutamente nada.
 *     Para aplicar hay que pasar --aplicar Y --confirmo-escribir.
 *     NUNCA borra el origen: eso requiere --borrar-origen, que además exige que
 *     la comparación haya dado IDÉNTICO y una confirmación aparte.
 *
 * Qué hace, en orden:
 *   1. Lista las claves de /{localId}/VENTAS y se queda SOLO con las que
 *      empiezan con FCX. Las facturas FCB/FCC ni se leen: no se tocan nunca.
 *   2. BACKUP a un archivo JSON local con timestamp (origen tal cual está).
 *   3. Copia cada FCX a /{localId}/Remitos/{FCX…} con la estructura canónica,
 *      conservando además el registro original completo en `legacy`.
 *   4. Relee origen y destino y los COMPARA registro por registro.
 *   5. Informa diferencias y deja un archivo de rollback del DESTINO.
 *
 * Qué NO hace, por diseño:
 *   - no toca facturas (FCB / FCC) ni ningún otro nodo de VENTAS;
 *   - no descuenta ni repone stock;
 *   - no toca CAJAS, MOSTRADOR, PEDIDOS, BACKUP ni comisiones;
 *   - no borra el origen;
 *   - si el destino ya existe, NO lo pisa (idempotente: correrlo dos veces no
 *     duplica ni modifica nada).
 *
 * Uso:
 *   # Diagnóstico de TODOS los locales conocidos (solo lectura):
 *   node scripts/migrar-remitos-fcx.mjs --auditar
 *
 *   # Simulación para un local:
 *   node scripts/migrar-remitos-fcx.mjs --db https://bdtemperley-default-rtdb.firebaseio.com --local 38827976
 *
 *   # Aplicar de verdad (doble confirmación):
 *   node scripts/migrar-remitos-fcx.mjs --db ... --local ... --aplicar --confirmo-escribir
 *
 *   # Deshacer SOLO el destino:
 *   node scripts/migrar-remitos-fcx.mjs --db ... --rollback backups-migracion/rollback-remitos-....json --aplicar --confirmo-escribir
 *
 * El token de auth (--auth) es opcional: si las reglas del RTDB permiten la
 * operación al operador, no hace falta. Nunca se imprime.
 */

import fs from 'node:fs';
import path from 'node:path';

// Locales conocidos (misma tabla que src/lib/firebase/core.js). Solo para
// --auditar: la migración real siempre exige --db y --local explícitos.
const LOCALES_CONOCIDOS = {
  40508022: 'https://achava3703-default-rtdb.firebaseio.com',
  38827976: 'https://bdtemperley-default-rtdb.firebaseio.com',
  51501748: 'https://centenario1199-default-rtdb.firebaseio.com',
  25230974: 'https://buranoheladerias-default-rtdb.firebaseio.com',
  34734081: 'https://lanyulinacanada-default-rtdb.firebaseio.com',
  34516605: 'https://heladeriabynnonadrogue-default-rtdb.firebaseio.com',
  31915636: 'https://ilcapogelatojls2026-default-rtdb.firebaseio.com',
};

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const valor = (n, def = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const DB = (valor('db') || '').replace(/\/+$/, '');
const AUTH = valor('auth');
const LOCAL = valor('local');
const AUDITAR = flag('auditar');
const APLICAR = flag('aplicar') && flag('confirmo-escribir');
const BORRAR_ORIGEN = flag('borrar-origen') && flag('confirmo-borrar-origen');
const ROLLBACK = valor('rollback');
const DIR_BACKUP = valor('dir', path.join(process.cwd(), 'backups-migracion'));

if (flag('aplicar') && !flag('confirmo-escribir')) {
  console.error('--aplicar requiere además --confirmo-escribir (doble confirmación explícita).');
  process.exit(2);
}
if (flag('borrar-origen') && !flag('confirmo-borrar-origen')) {
  console.error('--borrar-origen requiere además --confirmo-borrar-origen. Y solo después de una comparación IDÉNTICA.');
  process.exit(2);
}
if (!AUDITAR && !DB) {
  console.error('Falta --db https://<proyecto>-rtdb.firebaseio.com   (o usá --auditar para el diagnóstico de solo lectura)');
  process.exit(2);
}
if (!AUDITAR && !ROLLBACK && !LOCAL) {
  console.error('Falta --local <numeroDeLocal>. La ruta es /{localId}/Remitos y el local nunca se adivina.');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Utilidades REST sobre RTDB
// ---------------------------------------------------------------------------
const url = (base, ruta, qs = '') =>
  `${base}/${String(ruta).replace(/^\/+/, '')}.json${qs}${qs ? (AUTH ? `&auth=${AUTH}` : '') : (AUTH ? `?auth=${AUTH}` : '')}`;

const leer = async (ruta, base = DB, qs = '') => {
  const r = await fetch(url(base, ruta, qs), { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`GET ${ruta} → HTTP ${r.status}`);
  return r.json();
};

const escribir = async (ruta, data) => {
  if (!APLICAR) return { simulado: true };
  const r = await fetch(url(DB, ruta), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`PUT ${ruta} → HTTP ${r.status}`);
  return r.json();
};

const borrar = async (ruta) => {
  if (!APLICAR) return { simulado: true };
  const r = await fetch(url(DB, ruta), { method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE ${ruta} → HTTP ${r.status}`);
  return true;
};

const igualProfundo = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const guardar = (nombre, data) => {
  fs.mkdirSync(DIR_BACKUP, { recursive: true });
  const p = path.join(DIR_BACKUP, nombre);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return p;
};

const marca = new Date().toISOString().replace(/[:.]/g, '-');
const esFCX = (k) => typeof k === 'string' && k.startsWith('FCX');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ---------------------------------------------------------------------------
// Registro canónico a partir de un FCX histórico de VENTAS.
// Mismo contrato que src/lib/api/remitos.js (construirRemitoDesdeVenta), pero
// leyendo las claves en MAYÚSCULA del formato viejo. El registro original se
// conserva íntegro en `legacy`: la migración no pierde ni un dato.
// ---------------------------------------------------------------------------
function remitoDesdeVentaHistorica(clave, v, localId) {
  const productos = {};
  const articulos = Array.isArray(v.ARTICULOS) ? v.ARTICULOS : Object.values(v.ARTICULOS || {});
  articulos.filter(Boolean).forEach((a, i) => {
    productos[String(i + 1)] = {
      nombre: String(a.nombre ?? a.NOMBRE ?? '').trim() || 'Sin nombre',
      cantidad: num(a.cantidad ?? a.CANTIDAD) || 1,
      precioUnitario: num(a.valor ?? a.precioUnitario),
      precioTotal: num(a.precioTotal ?? a.PRECIO ?? a.valor),
    };
  });

  return {
    numeroComprobante: v.NumeroFactura || clave,
    tipo: 'FCX',
    fecha: v.FECHA || v.fecha || null,
    hora: v.HORA || v.hora || null,
    turno: v.TURNO ?? null,
    total: num(v.IMPORTE ?? v.total),
    cliente: String(v.CLIENTE || v.cliente || 'Consumidor Final'),
    productos,
    formaPago: 'Sin especificar',
    pagos: [],
    canal: String(v.MODO || v.modo || 'mostrador').toLowerCase() === 'delivery' ? 'delivery' : 'mostrador',
    localId: String(localId),
    facturado: false,
    origen: { tipo: 'historico', id: String(v.NUMERO ?? clave), ruta: 'VENTAS' },
    migradoDesde: `${localId}/VENTAS/${clave}`,
    migradoAt: Date.now(),
    legacy: v,
  };
}

// ---------------------------------------------------------------------------
// AUDITORÍA (solo lectura, todos los locales)
// ---------------------------------------------------------------------------
async function auditar() {
  console.log('\n== AUDITORÍA DE REMITOS FCX (SOLO LECTURA) ==\n');
  const resumen = [];
  for (const [localId, base] of Object.entries(LOCALES_CONOCIDOS)) {
    let ventas = null;
    let remitos = null;
    try {
      ventas = await leer(`${localId}/VENTAS`, base, '?shallow=true');
    } catch (e) {
      console.log(`  local ${localId}: no se pudo leer VENTAS (${e.message})`);
      continue;
    }
    try {
      remitos = await leer(`${localId}/Remitos`, base, '?shallow=true');
    } catch { /* el nodo puede no existir todavía */ }

    const claves = Object.keys(ventas || {});
    const fcx = claves.filter(esFCX);
    const yaEnRemitos = Object.keys(remitos || {});
    const faltan = fcx.filter((k) => !yaEnRemitos.includes(k));
    resumen.push({ localId, ventas: claves.length, fcxEnVentas: fcx.length, enRemitos: yaEnRemitos.length, porMigrar: faltan.length });
    console.log(`  local ${localId}: VENTAS=${claves.length}  FCX en VENTAS=${fcx.length}  ya en /Remitos=${yaEnRemitos.length}  por migrar=${faltan.length}`);
  }
  const p = guardar(`auditoria-remitos-${marca}.json`, resumen);
  console.log(`\nInforme guardado en ${p}`);
  console.log('No se escribió NADA en Firebase.\n');
}

// ---------------------------------------------------------------------------
// ROLLBACK (solo el destino; el origen nunca se tocó)
// ---------------------------------------------------------------------------
async function rollback(archivo) {
  const plan = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  console.log(`\n== ROLLBACK desde ${archivo} ==`);
  console.log(`Entradas a restaurar: ${plan.destinoPrevio.length}`);
  if (!APLICAR) console.log('MODO SIMULACIÓN — no se escribe nada. Agregá --aplicar --confirmo-escribir.\n');

  for (const { ruta, valorPrevio } of plan.destinoPrevio) {
    if (valorPrevio === null || valorPrevio === undefined) {
      console.log(`  ${APLICAR ? 'borrar ' : '[sim] borrar '}${ruta}   (antes no existía)`);
      await borrar(ruta);
    } else {
      console.log(`  ${APLICAR ? 'restaurar ' : '[sim] restaurar '}${ruta}`);
      await escribir(ruta, valorPrevio);
    }
  }
  console.log('\nRollback terminado. El nodo VENTAS de ORIGEN nunca se tocó, así que sigue intacto.');
}

// ---------------------------------------------------------------------------
// MIGRACIÓN de un local
// ---------------------------------------------------------------------------
async function migrar() {
  console.log(`\n== REMITOS FCX — local ${LOCAL} ==`);
  console.log(APLICAR ? '*** MODO APLICAR: se van a ESCRIBIR datos ***' : 'MODO SIMULACIÓN — no se escribe nada.');

  const claves = Object.keys((await leer(`${LOCAL}/VENTAS`, DB, '?shallow=true')) || {});
  const clavesFCX = claves.filter(esFCX);
  console.log(`VENTAS: ${claves.length} registros — FCX: ${clavesFCX.length} (las facturas FCB/FCC no se leen ni se tocan)`);
  if (clavesFCX.length === 0) {
    console.log('No hay remitos históricos que migrar.');
    return;
  }

  // 1) Backup del origen (solo los FCX).
  const origen = {};
  for (const k of clavesFCX) origen[k] = await leer(`${LOCAL}/VENTAS/${k}`);
  const pathBackup = guardar(`backup-FCX-${LOCAL}-${marca}.json`, origen);
  console.log(`Backup del origen: ${pathBackup}`);

  // 2) Copia idempotente.
  const copiados = [];
  const omitidos = [];
  const destinoPrevio = [];

  for (const k of clavesFCX) {
    const destino = `${LOCAL}/Remitos/${k}`;
    const previo = await leer(destino);
    destinoPrevio.push({ ruta: destino, valorPrevio: previo ?? null });

    if (previo) {
      omitidos.push({ clave: k, motivo: 'el destino ya existe — no se pisa' });
      console.log(`  = ${destino} ya existe — se respeta (idempotente).`);
      continue;
    }

    const remito = remitoDesdeVentaHistorica(k, origen[k] || {}, LOCAL);
    console.log(`  ${APLICAR ? 'copiar ' : '[sim] copiar '}${LOCAL}/VENTAS/${k}  →  ${destino}   ${remito.fecha} ${remito.hora}  $${remito.total}`);
    await escribir(destino, remito);
    copiados.push({ clave: k, destino, remito });
  }

  // 3) Comparación origen vs destino.
  console.log('\n-- Comparación origen/destino --');
  const diferencias = [];
  for (const { clave, destino, remito } of copiados) {
    const escrito = APLICAR ? await leer(destino) : remito;
    const orig = origen[clave] || {};
    const problemas = [];
    if (!igualProfundo(escrito?.legacy, orig)) problemas.push('el registro original no quedó igual en `legacy`');
    if (num(escrito?.total) !== num(orig.IMPORTE ?? orig.total)) problemas.push('el importe no coincide');
    if ((escrito?.fecha || null) !== (orig.FECHA || orig.fecha || null)) problemas.push('la fecha no coincide');
    if ((escrito?.numeroComprobante || null) !== (orig.NumeroFactura || clave)) problemas.push('el número no coincide');
    if (problemas.length) diferencias.push({ clave, destino, problemas });
  }
  if (diferencias.length === 0) {
    console.log(`  IDÉNTICO: ${copiados.length} copiados, ${omitidos.length} omitidos (ya existían), 0 diferencias.`);
  } else {
    console.log(`  ¡ATENCIÓN! ${diferencias.length} registros con diferencias:`);
    diferencias.forEach((d) => console.log(`   - ${d.clave}: ${d.problemas.join('; ')}`));
  }

  // 4) Archivo de rollback (del destino).
  const plan = { local: LOCAL, db: DB, marca, aplicado: APLICAR, copiados: copiados.map(({ clave, destino }) => ({ clave, destino })), omitidos, diferencias, destinoPrevio };
  const pathRollback = guardar(`rollback-remitos-${LOCAL}-${marca}.json`, plan);
  console.log(`\nPlan de rollback: ${pathRollback}`);

  // 5) Borrado del origen: solo si se pidió explícitamente Y todo coincidió.
  if (BORRAR_ORIGEN) {
    if (diferencias.length > 0) {
      console.log('\nNO se borra el origen: hubo diferencias en la comparación.');
    } else if (!APLICAR) {
      console.log('\n[sim] Se borrarían los FCX de VENTAS (requiere --aplicar --confirmo-escribir).');
    } else {
      for (const { clave } of copiados) {
        console.log(`  borrar ${LOCAL}/VENTAS/${clave}`);
        await borrar(`${LOCAL}/VENTAS/${clave}`);
      }
    }
  } else {
    console.log('\nEl origen /{local}/VENTAS/FCX… queda INTACTO (borrarlo requiere --borrar-origen --confirmo-borrar-origen).');
  }

  if (!APLICAR) console.log('\nRecordatorio: esto fue una SIMULACIÓN. No se modificó nada en Firebase.\n');
}

// ---------------------------------------------------------------------------
try {
  if (AUDITAR) await auditar();
  else if (ROLLBACK) await rollback(ROLLBACK);
  else await migrar();
} catch (e) {
  console.error('\nERROR:', e.message);
  process.exitCode = 1;
}
