#!/usr/bin/env node
/**
 * MIGRACIÓN DE `/FACTURACION_OWNERS` → `/{localId}/FACTURACION_OWNERS`
 * (y, opcionalmente, de `/priceHistory/{localId}` y
 *  `/locales/{localId}/whatsappMessages` a sus rutas canónicas).
 *
 * ⚠️  NO SE EJECUTA SOLO. Por defecto corre en modo SIMULACIÓN (dry-run): lee,
 *     compara e informa, pero NO escribe absolutamente nada.
 *     Para aplicar hay que pasar --aplicar Y --confirmo-escribir.
 *     NUNCA borra la ruta anterior: eso requiere --borrar-origen, que además
 *     exige que la comparación haya dado IDÉNTICO.
 *
 * Qué hace, en orden:
 *   1. BACKUP del nodo de origen completo a un archivo JSON local con timestamp.
 *   2. Separa los registros por localId (ver "Cómo se decide el local" abajo).
 *   3. Copia cada registro a `/{localId}/FACTURACION_OWNERS/{key}`.
 *   4. Vuelve a leer origen y destino y los COMPARA campo por campo.
 *   5. Informa diferencias y deja un archivo de rollback.
 *   6. El rollback (--rollback <archivo>) restaura el estado previo del DESTINO.
 *
 * Cómo se decide el localId de cada registro (en este orden):
 *   a. `registro.localId` si está presente (lo escriben Desktop ≥1.3.64 y TAB).
 *   b. `--mapa cuit_ptoVta=localId,...` provisto a mano.
 *   c. `--local <id>` si TODOS los registros son de un solo local.
 *   Si no se puede determinar, el registro se reporta como AMBIGUO y NO se migra.
 *
 * Uso:
 *   node scripts/migrar-facturacion-owners.mjs --db https://xxx.firebaseio.com [--auth <token>]
 *   node scripts/migrar-facturacion-owners.mjs --db ... --local 40508022
 *   node scripts/migrar-facturacion-owners.mjs --db ... --aplicar --confirmo-escribir
 *   node scripts/migrar-facturacion-owners.mjs --db ... --rollback backups/rollback-....json
 *
 * El token de auth es opcional: si las reglas del RTDB permiten lectura/escritura
 * al operador, no hace falta. Nunca se imprime.
 */

import fs from 'node:fs';
import path from 'node:path';

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
const LOCAL_UNICO = valor('local');
const MAPA_CRUDO = valor('mapa');
const APLICAR = flag('aplicar') && flag('confirmo-escribir');
const BORRAR_ORIGEN = flag('borrar-origen');
const ROLLBACK = valor('rollback');
const INCLUIR_EXTRAS = flag('incluir-extras'); // priceHistory + whatsappMessages
const DIR_BACKUP = valor('dir', path.join(process.cwd(), 'backups-migracion'));

const mapaManual = new Map(
  (MAPA_CRUDO || '').split(',').filter(Boolean).map((par) => {
    const [k, v] = par.split('=');
    return [String(k || '').trim(), String(v || '').trim()];
  })
);

if (!DB) {
  console.error('Falta --db https://<proyecto>-rtdb.firebaseio.com');
  process.exit(2);
}
if (flag('aplicar') && !flag('confirmo-escribir')) {
  console.error('--aplicar requiere además --confirmo-escribir (doble confirmación explícita).');
  process.exit(2);
}
if (BORRAR_ORIGEN && !APLICAR) {
  console.error('--borrar-origen solo tiene sentido junto con --aplicar --confirmo-escribir.');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Utilidades REST sobre RTDB
// ---------------------------------------------------------------------------
const url = (ruta) => `${DB}/${String(ruta).replace(/^\/+/, '')}.json${AUTH ? `?auth=${AUTH}` : ''}`;

const leer = async (ruta) => {
  const r = await fetch(url(ruta));
  if (!r.ok) throw new Error(`GET ${ruta} → HTTP ${r.status}`);
  return r.json();
};

const escribir = async (ruta, data) => {
  if (!APLICAR) return { simulado: true };
  const r = await fetch(url(ruta), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`PUT ${ruta} → HTTP ${r.status}`);
  return r.json();
};

const borrar = async (ruta) => {
  if (!APLICAR) return { simulado: true };
  const r = await fetch(url(ruta), { method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE ${ruta} → HTTP ${r.status}`);
  return true;
};

const normalizarLocalId = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/^\/+|\/+$/g, '');
  if (!s) return null;
  if (['undefined', 'null', 'nan', 'default', 'none', '0'].includes(s.toLowerCase())) return null;
  if (/[.#$[\]\s]/.test(s)) return null;
  return s;
};

const igualProfundo = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const guardar = (nombre, data) => {
  fs.mkdirSync(DIR_BACKUP, { recursive: true });
  const p = path.join(DIR_BACKUP, nombre);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return p;
};

const marca = new Date().toISOString().replace(/[:.]/g, '-');

// ---------------------------------------------------------------------------
// ROLLBACK
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
  console.log('\nRollback terminado. El nodo de ORIGEN nunca se tocó, así que sigue intacto.');
}

// ---------------------------------------------------------------------------
// MIGRACIÓN
// ---------------------------------------------------------------------------
async function migrarFacturacionOwners() {
  console.log('\n== FACTURACION_OWNERS ==');
  const origen = (await leer('FACTURACION_OWNERS')) || {};
  const claves = Object.keys(origen);
  console.log(`Registros en /FACTURACION_OWNERS: ${claves.length}`);
  if (claves.length === 0) return { copiados: [], ambiguos: [], diferencias: [], destinoPrevio: [] };

  const pathBackup = guardar(`backup-FACTURACION_OWNERS-${marca}.json`, origen);
  console.log(`Backup del origen: ${pathBackup}`);

  const copiados = [];
  const ambiguos = [];
  const destinoPrevio = [];

  for (const key of claves) {
    const reg = origen[key];
    const local =
      normalizarLocalId(reg && reg.localId) ||
      normalizarLocalId(mapaManual.get(key)) ||
      normalizarLocalId(LOCAL_UNICO);

    if (!local) {
      ambiguos.push({ key, motivo: 'no se pudo determinar el localId', cuit: reg?.cuit ?? null, ptoVta: reg?.ptoVta ?? null });
      continue;
    }

    const destino = `${local}/FACTURACION_OWNERS/${key}`;
    const previo = await leer(destino);          // para poder revertir
    destinoPrevio.push({ ruta: destino, valorPrevio: previo ?? null });

    if (previo && !igualProfundo(previo, reg)) {
      console.log(`  ! ${destino} YA EXISTE y difiere del origen — se respeta el destino (no se pisa).`);
      ambiguos.push({ key, motivo: 'el destino ya existe con otro contenido', destino });
      continue;
    }

    // El registro migrado deja anotado su local, para que nunca vuelva a ser ambiguo.
    const datos = { ...reg, localId: local, migradoDesde: 'FACTURACION_OWNERS', migradoAt: Date.now() };
    console.log(`  ${APLICAR ? 'copiar ' : '[sim] copiar '}FACTURACION_OWNERS/${key}  →  ${destino}`);
    await escribir(destino, datos);
    copiados.push({ key, destino, local });
  }

  // ---- Comparación origen vs destino ----
  console.log('\n-- Comparación origen/destino --');
  const diferencias = [];
  for (const { key, destino } of copiados) {
    const escrito = APLICAR ? await leer(destino) : { ...origen[key], localId: null, migradoDesde: 'FACTURACION_OWNERS' };
    const campos = new Set([...Object.keys(origen[key] || {}), ...Object.keys(escrito || {})]);
    const dif = [];
    for (const c of campos) {
      if (['localId', 'migradoDesde', 'migradoAt'].includes(c)) continue; // añadidos por la migración
      if (!igualProfundo((origen[key] || {})[c], (escrito || {})[c])) {
        dif.push({ campo: c, origen: (origen[key] || {})[c], destino: (escrito || {})[c] });
      }
    }
    if (dif.length) diferencias.push({ key, destino, dif });
    console.log(`  ${dif.length === 0 ? 'IDÉNTICO' : 'DIFIERE '}  ${key} → ${destino}`);
  }

  if (BORRAR_ORIGEN) {
    if (diferencias.length > 0 || ambiguos.length > 0) {
      console.log('\nNO se borra el origen: hay diferencias o registros ambiguos.');
    } else {
      console.log('\n--borrar-origen indicado y comparación IDÉNTICA. Aun así, el borrado requiere');
      console.log('autorización explícita del dueño del sistema: este script NO lo hace por sí solo.');
      console.log('Para borrarlo, hacelo a mano una vez validado en la app.');
    }
  }

  return { copiados, ambiguos, diferencias, destinoPrevio };
}

async function migrarExtras() {
  const resultados = [];
  console.log('\n== priceHistory (invertido) ==');
  const ph = (await leer('priceHistory')) || {};
  for (const local of Object.keys(ph)) {
    const id = normalizarLocalId(local);
    if (!id) { console.log(`  ! clave no utilizable: ${local}`); continue; }
    const destino = `${id}/priceHistory`;
    const previo = await leer(destino);
    resultados.push({ ruta: destino, valorPrevio: previo ?? null });
    if (previo) { console.log(`  ! ${destino} ya existe — se respeta (no se pisa).`); continue; }
    console.log(`  ${APLICAR ? 'copiar ' : '[sim] copiar '}priceHistory/${local}  →  ${destino}`);
    await escribir(destino, ph[local]);
  }

  console.log('\n== locales/{id}/whatsappMessages (invertido) ==');
  const loc = (await leer('locales')) || {};
  for (const local of Object.keys(loc)) {
    const id = normalizarLocalId(local);
    const msgs = loc[local] && loc[local].whatsappMessages;
    if (!id || !msgs) continue;
    const destino = `${id}/whatsappMessages`;
    const previo = await leer(destino);
    resultados.push({ ruta: destino, valorPrevio: previo ?? null });
    if (previo) { console.log(`  ! ${destino} ya existe — se respeta (no se pisa).`); continue; }
    console.log(`  ${APLICAR ? 'copiar ' : '[sim] copiar '}locales/${local}/whatsappMessages  →  ${destino}`);
    await escribir(destino, msgs);
  }
  return resultados;
}

// ---------------------------------------------------------------------------
(async () => {
  console.log('===============================================================');
  console.log(' MIGRACIÓN DE RUTAS A /{localId}/...');
  console.log(` Base   : ${DB}`);
  console.log(` Modo   : ${APLICAR ? '*** APLICAR (ESCRIBE EN FIREBASE) ***' : 'SIMULACIÓN (no escribe nada)'}`);
  console.log(` Backups: ${DIR_BACKUP}`);
  console.log('===============================================================');

  if (ROLLBACK) { await rollback(ROLLBACK); return; }

  const r = await migrarFacturacionOwners();
  let extras = [];
  if (INCLUIR_EXTRAS) extras = await migrarExtras();

  const planRollback = {
    generadoAt: new Date().toISOString(),
    db: DB,
    aplicado: APLICAR,
    destinoPrevio: [...r.destinoPrevio, ...extras],
  };
  const pathRollback = guardar(`rollback-${marca}.json`, planRollback);

  console.log('\n===================== RESUMEN =====================');
  console.log(`Copiados     : ${r.copiados.length}`);
  console.log(`Ambiguos     : ${r.ambiguos.length}`);
  if (r.ambiguos.length) for (const a of r.ambiguos) console.log(`   - ${a.key}: ${a.motivo}`);
  console.log(`Diferencias  : ${r.diferencias.length}`);
  if (r.diferencias.length) for (const d of r.diferencias) console.log(`   - ${d.key}: ${d.dif.map((x) => x.campo).join(', ')}`);
  console.log(`Rollback     : ${pathRollback}`);
  console.log(`Origen       : INTACTO (este script nunca borra /FACTURACION_OWNERS)`);
  if (!APLICAR) console.log('\nNo se escribió nada. Para aplicar: --aplicar --confirmo-escribir');
  console.log('==================================================');

  if (r.ambiguos.length > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});
