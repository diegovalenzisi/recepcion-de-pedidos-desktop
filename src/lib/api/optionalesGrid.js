// ---------------------------------------------------------------------------
// POSICIONAMIENTO MANUAL 2D DE OPCIONALES/SABORES — lógica pura (sin fs, sin
// IPC), usada por OptionalSelectionModal.jsx para combinar la grilla
// GUARDADA de un grupo (que llega de localOptionalGridApi.js) con los ids
// REALMENTE vigentes del catálogo, y para las operaciones del editor
// (mover/intercambiar, cambiar filas/columnas, títulos de columna).
//
// Gemela de electron/lib/optionalesGridLocal.js (mismo algoritmo, mismos
// tests) — esa vive del lado de Electron/Node para el storage real
// (userData/optionales-grid/{localId}.json) y su propia normalización
// defensiva antes de escribir a disco; esta vive del lado del renderer
// porque el merge con el catálogo (`allOptionals`, `article.opcionalesConfig`)
// solo existe ahí. Mismo criterio que ya sigue este componente con el orden
// lineal viejo (combinarOrdenConVigentes vive en electron/lib pero nunca se
// importa desde el renderer: la combinación se hace del lado de React).
// ---------------------------------------------------------------------------

export const FILAS_POR_DEFECTO = 14;
export const COLUMNAS_POR_DEFECTO = 6;

export function grillaPorDefecto() {
  return { rows: FILAS_POR_DEFECTO, columns: COLUMNAS_POR_DEFECTO, columnTitles: {}, positions: {} };
}

function entPositivo(v, porDefecto) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

/** Normaliza cualquier valor guardado (o ausente/corrupto) a una GridConfig válida. */
export function normalizarGrid(grid) {
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
 * ahora: conserva la posición guardada de cada id vigente cuya celda entra
 * dentro de rows x columns; ignora sin error los ids guardados que ya no
 * existen (su celda queda libre); ubica cualquier id vigente sin posición
 * (nuevo, o reaparecido) en la primera celda libre, en el orden en que
 * aparece en `idsVigentes`; si no alcanzan las celdas, agrega FILAS
 * automáticamente (nunca pierde un id) e informa `filasAgregadas`. Nunca
 * muta los argumentos. Los títulos de columna se conservan tal cual.
 */
export function combinarGridConVigentes(gridGuardada, idsVigentes) {
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
 * Aplica un cambio de tamaño (filas y/o columnas). Cualquier id cuya celda
 * quede fuera de las nuevas dimensiones se REUBICA en la primera celda
 * libre dentro del nuevo tamaño (nunca se pierde) — si ni así entran todos,
 * agrega filas. Los títulos de columnas que siguen existiendo se conservan;
 * los de columnas eliminadas se descartan; las columnas nuevas quedan sin
 * título.
 *
 * @returns {{ rows, columns, columnTitles, positions, reubicados: string[] }}
 */
export function conDimensionesAjustadas(grid, nuevasFilas, nuevasColumnas) {
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
 * tiene otro id, los INTERCAMBIA. Si está vacía, simplemente lo mueve. Pura.
 */
export function conPosicionesIntercambiadas(grid, idOrigen, celdaDestino) {
  const base = normalizarGrid(grid);
  const positions = { ...base.positions };
  const posOrigen = positions[idOrigen];
  if (!posOrigen) {
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
export function conTituloDeColumna(grid, columnIndex, titulo) {
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
