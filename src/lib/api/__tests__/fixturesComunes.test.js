// ---------------------------------------------------------------------------
// F1.7 — Ejecutor de los FIXTURES CANÓNICOS.
//
// Byte a byte idéntico en Desktop, Tablet y DLV Pedidos. Cada proyecto lo corre
// por su propio camino real:
//   · Desktop / Tablet: directo sobre el módulo canónico.
//   · DLV Pedidos: traduciendo las entradas con dlvCartAdapter y volviendo al
//     canónico, para demostrar que su esquema propio produce lo mismo.
//
// Además de aprobar/desaprobar, escribe `fixtures-resultados.json` en la raíz
// del repo con los valores EXACTOS obtenidos, para poder comparar los tres
// proyectos número por número (no alcanza con "pasa").
//
// Correr con: node src/lib/api/__tests__/fixturesComunes.test.js
// ---------------------------------------------------------------------------
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASOS, CONTRATO_VERSION } from './fixturesCanonicos.js';
import {
  calcularTotalPedido,
  construirLineaPersistible,
  detectarOpcionalesConPrecioInvalido,
  enriquecerOpcionalSnapshot,
  verificarTotalRecibido,
} from '../optionalsPricing.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PROYECTO = path.basename(RAIZ);

// --- Camino de ejecución propio de cada proyecto ----------------------------
// DLV no guarda `valor`/`selectedOptionals`: guarda `price`/`selectedOptionsByGroup`.
// Si su adaptador está presente, las entradas se traducen a SU esquema y se
// vuelven a traer al canónico, ejercitando el camino real de DLV.
let aFormatoDelProyecto = (items) => items;
let adaptador = null;
// El adaptador solo existe en DLV Pedidos. Se comprueba con fs antes de
// importarlo: así el import no es una ruta fija que no resuelve en los otros
// dos repos (y no hace falta silenciar ninguna regla de lint).
const RUTA_ADAPTADOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dlvCartAdapter.js');
if (fs.existsSync(RUTA_ADAPTADOR)) {
  adaptador = await import(`file:///${RUTA_ADAPTADOR.replace(/\\/g, '/')}`);
  aFormatoDelProyecto = (items) => adaptador.carritoCanonico(items.map((it) => ({
    id: it.id,
    name: it.nombre,
    price: it.valor,
    quantity: it.quantity,
    cartId: it.uniqueId,
    unidadIndice: it.unidadIndice,
    unidadTotal: it.unidadTotal,
    // Campos de snapshot que DLV también puede traer de un carrito restaurado.
    precioBaseUnitario: it.precioBaseUnitario,
    totalOpcionales: it.totalOpcionales,
    subtotalLinea: it.subtotalLinea,
    opcionalesIncluidosEnValor: it.opcionalesIncluidosEnValor,
    ...(it.isPromo ? {
      isPromoContainer: true,
      promoSubItems: (it.promoItems || []).map((h) => ({
        id: h.id, name: h.nombre, quantity: h.quantity,
        selectedOptionsByGroup: aGruposDlv(h.selectedOptionals),
      })),
    } : {}),
    selectedOptionsByGroup: aGruposDlv(it.selectedOptionals),
  })));
}
// Desktop y Tablet: camino directo, sin traducción.

function aGruposDlv(selectedOptionals) {
  const salida = {};
  for (const [gid, lista] of Object.entries(selectedOptionals || {})) {
    salida[gid] = {
      name: (lista[0] && (lista[0].grupoNombre || lista[0].groupName)) || '',
      options: (lista || []).map((op) => ({ ...op, name: op.nombre, quantity: op.cantidad ?? op.quantity ?? 1 })),
    };
  }
  return salida;
}

/** Enriquece también los opcionales de los hijos de promoción (igual en los 3). */
function persistir(item) {
  const linea = construirLineaPersistible(item);
  if (Array.isArray(linea.promoItems)) {
    linea.promoItems = linea.promoItems.map((hijo) => {
      if (!hijo || !hijo.selectedOptionals) return hijo;
      const enriquecidos = {};
      for (const [gid, lista] of Object.entries(hijo.selectedOptionals)) {
        if (!Array.isArray(lista) || lista.length === 0) continue;
        enriquecidos[gid] = lista.map((op) => enriquecerOpcionalSnapshot(op, gid)).filter(Boolean);
      }
      return { ...hijo, selectedOptionals: enriquecidos };
    });
  }
  return linea;
}

// --- Ejecución --------------------------------------------------------------
const resultados = {};

for (const caso of CASOS) {
  const entrada = aFormatoDelProyecto(JSON.parse(JSON.stringify(caso.items)));
  let lineas = entrada.map(persistir);
  const c = caso.comprobar || {};

  // Reguardar N veces (editar sin cambios / ciclos de serialización).
  const ciclos = Number(c.reguardar) || 0;
  for (let i = 0; i < ciclos; i += 1) {
    lineas = JSON.parse(JSON.stringify(lineas)).map(persistir);
  }
  if (c.serializar) lineas = JSON.parse(JSON.stringify(lineas));

  const total = calcularTotalPedido(lineas).total;
  const invalidos = detectarOpcionalesConPrecioInvalido(entrada).length;

  const r = {
    total,
    lineas: lineas.length,
    quantities: lineas.map((l) => l.quantity),
    uniqueIds: lineas.map((l) => l.uniqueId ?? null),
    unidades: lineas.map((l) => (l.unidadTotal ? `${l.unidadIndice}/${l.unidadTotal}` : null)),
    precioBaseUnitario: lineas.map((l) => l.precioBaseUnitario ?? null),
    totalOpcionales: lineas.map((l) => l.totalOpcionales ?? null),
    subtotalLinea: lineas.map((l) => l.subtotalLinea ?? null),
    opcionalesIncluidosEnValor: lineas.map((l) => l.opcionalesIncluidosEnValor ?? null),
    gruposConOpcionales: lineas.map((l) => Object.keys(l.selectedOptionals || {}).length),
    opcionales: lineas.map((l) => Object.entries(l.selectedOptionals || {}).map(([gid, lista]) => ({
      grupoId: gid,
      opciones: (lista || []).map((op) => ({
        nombre: op.nombre, precioUnitario: op.precioUnitario ?? null,
        cantidad: op.cantidad ?? null, total: op.total ?? null,
      })),
    }))),
    promoHijos: lineas.map((l) => (Array.isArray(l.promoItems) ? l.promoItems.map((h) => ({
      nombre: h.nombre,
      opcionales: Object.entries(h.selectedOptionals || {}).map(([gid, lista]) => ({
        grupoId: gid,
        opciones: (lista || []).map((op) => ({ nombre: op.nombre, precioUnitario: op.precioUnitario ?? null, total: op.total ?? null })),
      })),
    })) : null)),
    invalidos,
  };

  // Total recibido manipulado: el canónico debe imponerse.
  if (c.totalRecibidoFalso !== undefined) {
    const v = verificarTotalRecibido(lineas, c.totalRecibidoFalso);
    r.totalRecibidoFalso = c.totalRecibidoFalso;
    r.totalTrasVerificar = v.total;
    r.difiere = v.difiere;
  }

  resultados[caso.nombre] = r;

  // --- Aserciones del contrato ---
  check(`${caso.nombre} · total`, () => {
    assert.strictEqual(total, caso.totalEsperado, `esperado ${caso.totalEsperado}, obtenido ${total}`);
  });
  if (c.precioBaseUnitario !== undefined) check(`${caso.nombre} · precioBaseUnitario`, () => assert.strictEqual(r.precioBaseUnitario[0], c.precioBaseUnitario));
  if (c.totalOpcionales !== undefined) check(`${caso.nombre} · totalOpcionales`, () => assert.strictEqual(r.totalOpcionales[0], c.totalOpcionales));
  if (c.subtotalLinea !== undefined) check(`${caso.nombre} · subtotalLinea`, () => assert.strictEqual(r.subtotalLinea[0], c.subtotalLinea));
  if (c.subtotales) check(`${caso.nombre} · subtotales por unidad`, () => assert.deepStrictEqual(r.subtotalLinea, c.subtotales));
  if (c.unidades) check(`${caso.nombre} · numeracion de unidades`, () => assert.deepStrictEqual(r.unidades, c.unidades));
  if (c.invalidos !== undefined) check(`${caso.nombre} · precios invalidos detectados`, () => assert.strictEqual(invalidos, c.invalidos));
  if (c.lineas !== undefined) check(`${caso.nombre} · cantidad de lineas`, () => assert.strictEqual(r.lineas, c.lineas));
  if (c.uniqueIds) check(`${caso.nombre} · uniqueIds conservados`, () => assert.deepStrictEqual(r.uniqueIds, c.uniqueIds));
  if (c.quantities) check(`${caso.nombre} · quantities`, () => assert.deepStrictEqual(r.quantities, c.quantities));
  if (c.gruposConOpcionales !== undefined) check(`${caso.nombre} · grupos con opcionales`, () => assert.strictEqual(r.gruposConOpcionales[0], c.gruposConOpcionales));
  if (c.sinUnidad) check(`${caso.nombre} · sin marca de unidad`, () => assert.strictEqual(r.unidades[0], null));
  if (c.nombreOpcional) check(`${caso.nombre} · nombre del opcional historico`, () => {
    assert.strictEqual(r.opcionales[0][0].opciones[0].nombre, c.nombreOpcional);
  });
  if (c.hijoConRocklets !== undefined) check(`${caso.nombre} · el adicional queda en el hijo correcto`, () => {
    const hijos = r.promoHijos[0];
    assert.ok(Array.isArray(hijos) && hijos.length === 2);
    const conPago = hijos.findIndex((h) => h.opcionales.some((g) => g.opciones.some((o) => o.total > 0)));
    assert.strictEqual(conPago, c.hijoConRocklets);
    assert.strictEqual(hijos[c.hijoConRocklets].opcionales[0].opciones[0].precioUnitario, c.precioOpcionalHijo);
  });
  if (c.totalRecibidoFalso !== undefined) check(`${caso.nombre} · manda el total canonico`, () => {
    assert.strictEqual(r.totalTrasVerificar, caso.totalEsperado);
    assert.strictEqual(r.difiere, true);
  });
  // Nunca importes rotos, en ningún caso.
  check(`${caso.nombre} · sin NaN ni undefined en la salida`, () => {
    assert.ok(!/NaN|"undefined"/.test(JSON.stringify(r)), JSON.stringify(r).slice(0, 200));
    assert.ok(Number.isFinite(total));
  });
}

// --- Salida comparable ------------------------------------------------------
const salida = {
  proyecto: PROYECTO,
  contrato: CONTRATO_VERSION,
  caminoDlv: !!adaptador,
  resultados,
};
fs.writeFileSync(path.join(RAIZ, 'fixtures-resultados.json'), JSON.stringify(salida, null, 2));

console.log(`Fixtures canónicos v${CONTRATO_VERSION} — proyecto: ${PROYECTO}${adaptador ? ' (vía dlvCartAdapter)' : ''}`);
console.log(`${CASOS.length} casos ejecutados\n`);
console.log('Caso'.padEnd(52) + 'Total'.padStart(9) + '  Subtotales');
for (const caso of CASOS) {
  const r = resultados[caso.nombre];
  const ok = r.total === caso.totalEsperado ? ' ' : '!';
  console.log(`${ok}${caso.nombre.padEnd(51)}${String(r.total).padStart(9)}  ${JSON.stringify(r.subtotalLinea)}`);
}
console.log(`\nResultados exactos escritos en fixtures-resultados.json`);
console.log(`${passed} comprobaciones OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
