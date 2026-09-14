'use strict';

const path = require('node:path');
const fsReal = require('node:fs');

// ---------------------------------------------------------------------------
// POSICIONAMIENTO MANUAL 2D DE OPCIONALES/SABORES — LOCAL POR PC, NUNCA EN
// FIREBASE. Reemplaza (para la UI) al orden lineal de optionalesOrdenLocal.js
// — ese módulo queda intacto y sin usarse, mismo criterio que ya sigue este
// repo con optionalOrderApi.js (el Firebase-compartido, superado por
// optionalesOrdenLocal.js y dejado sin borrar).
//
// ALMACENAMIENTO: un archivo JSON por local, en
//     userData/optionales-grid/{localId}.json
// con la forma:
//     { [deviceId]: { [groupId]: GridConfig } }
// GridConfig:
//     {
//       rows: number,
//       columns: number,
//       columnTitles: { [columnaComoString]: string },
//       positions: { [optionalId]: { row: number, column: number } }
//     }
//
// `deviceId` es el mismo identificador que ya usa la app para
// `{localId}/DISPOSITIVOS/{deviceId}` (obtenerDeviceId,
// src/lib/api/deviceIdentity.js) — no se crea un segundo id de equipo.
//
// Módulo con efectos reales de filesystem, pero con las funciones de fs
// inyectables para poder probarlo contra un directorio temporal real.
// ---------------------------------------------------------------------------

const FILAS_POR_DEFECTO = 14;
const COLUMNAS_POR_DEFECTO = 6;

function grillaPorDefecto() {
  return { rows: FILAS_POR_DEFECTO, columns: COLUMNAS_POR_DEFECTO, columnTitles: {}, positions: {} };
}

/** Nombre de archivo (un archivo por local, nunca uno global). */
function rutaArchivoGrid(userDataDir, localId) {
  return path.join(userDataDir, 'optionales-grid', `${String(localId)}.json`);
}

/**
 * Lee el archivo de grillas de un local. Un archivo ausente, vacío o
 * corrupto se trata como "todavía no hay nada guardado" (nunca rompe la
 * pantalla de pedido): devuelve `{}`.
 */
function leerArchivoGrid(ruta, { existsSyncFn = fsReal.existsSync, readFileSyncFn = fsReal.readFileSync } = {}) {
  if (!existsSyncFn(ruta)) return {};
  try {
    const data = JSON.parse(readFileSyncFn(ruta, 'utf-8'));
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  } catch {
    return {};
  }
}

/** Escribe el archivo completo (ya mergeado por el caller). Crea la carpeta si falta. */
function escribirArchivoGrid(ruta, data, { mkdirSyncFn = fsReal.mkdirSync, writeFileSyncFn = fsReal.writeFileSync } = {}) {
  mkdirSyncFn(path.dirname(ruta), { recursive: true });
  writeFileSyncFn(ruta, JSON.stringify(data, null, 2), 'utf-8');
}

/** Entero positivo válido, o el default si no lo es. */
function entPositivo(v, porDefecto) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

/** Normaliza cualquier valor guardado (o ausente/corrupto) a una GridConfig válida. */
function normalizarGrid(grid) {
  const g = grid && typeof grid === 'object' ? grid : {};
  const rows = entPositivo(g.rows, FILAS_POR_DEFECTO);
  const columns = entPositivo(g.columns, COLUMNAS_POR_DEFECTO);
  const columnTitles = {};
  if (g.columnTitles && typeof g.columnTitles === 'object') {
    for (const [col, titulo] of Object.entries(g.columnTitles)) {
      const c = Number.parseInt(col, 10);
      if (Number.isFinite(c) && c >= 1 && c <= columns && typeof titulo === 'string') {
        columnTitles[String(c)] = titulo;
      }
    }
  }
  const positions = {};
  if (g.positions && typeof g.positions === 'object') {
    for (const [id, pos] of Object.entries(g.positions)) {
      if (!pos || typeof pos !== 'object') continue;
      const row = Number.parseInt(pos.row, 10);
      const column = Number.parseInt(pos.column, 10);
      if (Number.isFinite(row) && Number.isFinite(column) && row >= 1 && column >= 1) {
        positions[id] = { row, column };
      }
    }
  }
  return { rows, columns, columnTitles, positions };
}

/** Todas las grillas guardadas para ESTE dispositivo. `{}` si no hay nada. */
function obtenerGridsDelDispositivo(data, deviceId) {
  const porDispositivo = data && typeof data === 'object' ? data[deviceId] : null;
  if (!porDispositivo || typeof porDispositivo !== 'object') return {};
  const resultado = {};
  for (const [groupId, grid] of Object.entries(porDispositivo)) {
    resultado[groupId] = normalizarGrid(grid);
  }
  return resultado;
}

/** Grilla guardada de UN grupo para este dispositivo. `null` si no hay nada. */
function obtenerGridGuardada(data, deviceId, groupId) {
  const grids = obtenerGridsDelDispositivo(data, deviceId);
  return grids[groupId] || null;
}

/** Devuelve un `data` NUEVO (inmutable) con la grilla de un grupo actualizada. */
function conGridActualizada(data, deviceId, groupId, gridNueva) {
  const base = data && typeof data === 'object' ? data : {};
  const previoDispositivo = base[deviceId] && typeof base[deviceId] === 'object' ? base[deviceId] : {};
  return {
    ...base,
    [deviceId]: {
      ...previoDispositivo,
      [groupId]: normalizarGrid(gridNueva),
    },
  };
}

/** Primera celda libre en orden fila por fila (1,1) (1,2) ... dentro de `rows`x`columns`, según `ocupadas`. */
function primeraCeldaLibre(rows, columns, ocupadas) {
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const clave = `${row}:${column}`;
      if (!ocupadas.has(clave)) return { row, column };
    }
  }
  return null;
}

/**
 * Combina la grilla GUARDADA de un grupo con los ids REALMENTE vigentes
 * ahora (mismo espíritu que combinarOrdenConVigentes, pero en 2D):
 *   - conserva la posición guardada de cada id que sigue vigente Y cuya
 *     celda entra dentro de rows x columns actuales;
 *   - IGNORA sin error las posiciones guardadas de ids que ya no existen
 *     (sabor eliminado) — su celda queda libre;
 *   - a cualquier id vigente sin posición (sabor nuevo, o reaparecido tras
 *     haber sido eliminado) lo ubica en la primera celda libre, en el orden
 *     en que aparece en `idsVigentes`;
 *   - si no alcanzan las celdas, agrega FILAS automáticamente (nunca pierde
 *     un id) y lo informa en `filasAgregadas`.
 * Nunca muta `gridGuardada` ni `idsVigentes`. Los títulos de columna se
 * conservan tal cual.
 */
function combinarGridConVigentes(gridGuardada, idsVigentes) {
  const base = normalizarGrid(gridGuardada);
  const vigentes = Array.isArray(idsVigentes) ? idsVigentes.filter((id) => typeof id === 'string') : [];
  const vigentesSet = new Set(vigentes);

  const positions = {};
  const ocupadas = new Set();
  const yaUbicados = new Set();

  for (const [id, pos] of Object.entries(base.positions)) {
    if (!vigentesSet.has(id) || yaUbicados.has(id)) continue;
    if (pos.row > base.rows || pos.column > base.columns) continue; // fuera de la grilla actual: se reubica como si fuera nuevo
    positions[id] = pos;
    ocupadas.add(`${pos.row}:${pos.column}`);
    yaUbicados.add(id);
  }

  // dedupe defensivo: un id repetido en idsVigentes no debe consumir dos celdas.
  const pendientes = [...new Set(vigentes.filter((id) => !positions[id]))];

  let { rows } = base;
  let filasAgregadas = 0;
  for (const id of pendientes) {
    let celda = primeraCeldaLibre(rows, base.columns, ocupadas);
    if (!celda) {
      rows += 1;
      filasAgregadas += 1;
      celda = primeraCeldaLibre(rows, base.columns, ocupadas);
    }
    positions[id] = celda;
    ocupadas.add(`${celda.row}:${celda.column}`);
  }

  return { rows, columns: base.columns, columnTitles: base.columnTitles, positions, filasAgregadas };
}

/**
 * Aplica un cambio de tamaño (filas y/o columnas) a una grilla ya
 * normalizada. Cualquier id cuya celda quede fuera de las nuevas
 * dimensiones se REUBICA en la primera celda libre dentro del nuevo
 * tamaño (nunca se pierde) — si ni así entran todos, agrega filas
 * (mismo mecanismo que combinarGridConVigentes). Los títulos de columnas
 * que siguen existiendo se conservan; los de columnas eliminadas se
 * descartan; las columnas nuevas quedan sin título.
 *
 * @returns {{ rows, columns, columnTitles, positions, reubicados: string[] }}
 */
function conDimensionesAjustadas(grid, nuevasFilas, nuevasColumnas) {
  const base = normalizarGrid(grid);
  const columns = entPositivo(nuevasColumnas, base.columns);
  let rows = entPositivo(nuevasFilas, base.rows);

  const columnTitles = {};
  for (const [col, titulo] of Object.entries(base.columnTitles)) {
    if (Number(col) <= columns) columnTitles[col] = titulo;
  }

  const positions = {};
  const ocupadas = new Set();
  const reubicados = [];
  const huerfanos = [];

  for (const [id, pos] of Object.entries(base.positions)) {
    if (pos.row <= rows && pos.column <= columns) {
      positions[id] = pos;
      ocupadas.add(`${pos.row}:${pos.column}`);
    } else {
      huerfanos.push(id);
    }
  }

  for (const id of huerfanos) {
    let celda = primeraCeldaLibre(rows, columns, ocupadas);
    if (!celda) {
      rows += 1;
      celda = primeraCeldaLibre(rows, columns, ocupadas);
    }
    positions[id] = celda;
    ocupadas.add(`${celda.row}:${celda.column}`);
    reubicados.push(id);
  }

  return { rows, columns, columnTitles, positions, reubicados };
}

/**
 * Mueve `idOrigen` a `celdaDestino` ({row, column}). Si la celda destino ya
 * tiene otro id, los INTERCAMBIA (el que estaba ahí pasa a la celda vieja de
 * `idOrigen`). Si está vacía, simplemente lo mueve (la celda vieja queda
 * libre). Pura — no muta `grid`.
 */
function conPosicionesIntercambiadas(grid, idOrigen, celdaDestino) {
  const base = normalizarGrid(grid);
  const positions = { ...base.positions };
  const posOrigen = positions[idOrigen];
  if (!posOrigen) {
    // Defensivo: si por algún motivo no tenía posición, simplemente se la asigna.
    positions[idOrigen] = { row: celdaDestino.row, column: celdaDestino.column };
    return { ...base, positions };
  }

  const idDestino = Object.entries(positions).find(
    ([id, pos]) => id !== idOrigen && pos.row === celdaDestino.row && pos.column === celdaDestino.column
  )?.[0] || null;

  positions[idOrigen] = { row: celdaDestino.row, column: celdaDestino.column };
  if (idDestino) {
    positions[idDestino] = posOrigen;
  }

  return { ...base, positions };
}

/** Setter puro de un título de columna. `titulo` vacío es válido (borra el título). */
function conTituloDeColumna(grid, columnIndex, titulo) {
  const base = normalizarGrid(grid);
  const columnTitles = { ...base.columnTitles };
  const texto = typeof titulo === 'string' ? titulo : '';
  if (texto === '') {
    delete columnTitles[String(columnIndex)];
  } else {
    columnTitles[String(columnIndex)] = texto;
  }
  return { ...base, columnTitles };
}

module.exports = {
  FILAS_POR_DEFECTO,
  COLUMNAS_POR_DEFECTO,
  grillaPorDefecto,
  rutaArchivoGrid,
  leerArchivoGrid,
  escribirArchivoGrid,
  normalizarGrid,
  obtenerGridsDelDispositivo,
  obtenerGridGuardada,
  conGridActualizada,
  combinarGridConVigentes,
  conDimensionesAjustadas,
  conPosicionesIntercambiadas,
  conTituloDeColumna,
};
