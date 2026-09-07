// ---------------------------------------------------------------------------
// VENTAS DE MOSTRADOR POR DEPARTAMENTO — LECTURA DE FIREBASE
//
// SOLO LECTURA. No escribe absolutamente nada. Es la capa de consulta de las
// pestañas PedidosYa/Rappi/M.LIBRE de Reportes Prepago cuando clasifican por
// DEPARTAMENTO del artículo (ver `ventasPorDepartamento.js`), a diferencia de
// `ventasAppsFlujo.js` que clasifica por medio de pago e incluye Delivery y el
// ledger PREPAGO_*.
//
// Alcance deliberadamente más chico que `ventasAppsFlujo.js`:
//   - Sólo MOSTRADOR (nunca PEDIDOS/Delivery).
//   - Sin ledger: el importe sale directo de la venta, nunca de un derivado.
//   - Lee además `/{localId}/DEPARTAMENTOS` UNA vez por consulta, para resolver
//     qué departamento es cuál (por nombre, tolerando variantes de escritura).
//
// COSTO DE LA CONSULTA:
//   - MOSTRADOR vivo: 1 lectura (nodo del turno abierto).
//   - DEPARTAMENTOS: 1 lectura (catálogo chico, decenas de filas).
//   - BACKUP: 1 lectura por CADA DÍA del rango pedido, sobre
//     BACKUP/{aaaa}/{mm}/{dd}/TURNO. Un mes = ~30 lecturas.
// ---------------------------------------------------------------------------

import { ref, get } from 'firebase/database';
import { diasDelRango } from './ventasApps.js';
import {
  filasDeVentaPorDepartamento,
  mapaClavePorDepartamento,
  unirSinDuplicarPorDepartamento,
} from './ventasPorDepartamento.js';

const CARPETAS_ESTADO = ['COMPLETADOS', 'ENTREGADOS', 'CANCELADOS'];

const leer = async (db, ruta) => {
  const snap = await get(ref(db, ruta));
  return snap.exists() ? snap.val() : null;
};

/** Ejecuta las promesas de a `tamano` para no abrir cientos de sockets de golpe. */
async function enLotes(items, tamano, fn) {
  const salida = [];
  for (let i = 0; i < items.length; i += tamano) {
    const lote = items.slice(i, i + tamano);
    salida.push(...(await Promise.all(lote.map(fn))));
  }
  return salida;
}

/** Ventas VIVAS de Mostrador del local (el turno abierto). */
export async function leerVentasMostradorVivas(db, raiz, mapaClave) {
  const filas = [];
  const data = await leer(db, `${raiz}/MOSTRADOR`);
  if (!data) return filas;
  for (const [id, venta] of Object.entries(data)) {
    if (!venta || typeof venta !== 'object') continue;
    filas.push(...filasDeVentaPorDepartamento(venta, { id, origen: 'MOSTRADOR', localId: raiz }, mapaClave));
  }
  return filas;
}

/**
 * Ventas de Mostrador de turnos CERRADOS, leyendo únicamente los días del
 * rango. Estructura: BACKUP/{aaaa}/{mm}/{dd}/TURNO/{turno}/MOSTRADOR/{estado}/{id}
 */
export async function leerVentasMostradorRespaldadas(db, raiz, desde, hasta, mapaClave, { concurrencia = 8 } = {}) {
  const dias = diasDelRango(desde, hasta);
  if (dias.length === 0) return { filas: [], diasLeidos: 0 };

  const porDia = await enLotes(dias, concurrencia, async ({ anio, mes, dia }) => {
    const turnos = await leer(db, `${raiz}/BACKUP/${anio}/${mes}/${dia}/TURNO`);
    if (!turnos) return [];
    const filas = [];
    const fecha = `${dia}-${mes}-${anio}`;
    for (const [turno, contenido] of Object.entries(turnos)) {
      if (!contenido || typeof contenido !== 'object') continue;
      for (const estado of CARPETAS_ESTADO) {
        const ventas = contenido?.MOSTRADOR?.[estado];
        if (!ventas || typeof ventas !== 'object') continue;
        for (const [id, venta] of Object.entries(ventas)) {
          if (!venta || typeof venta !== 'object') continue;
          filas.push(...filasDeVentaPorDepartamento(venta, {
            id, turno, estado, fecha, origen: 'BACKUP:MOSTRADOR', localId: raiz,
          }, mapaClave));
        }
      }
    }
    return filas;
  });

  return { filas: porDia.flat(), diasLeidos: dias.length };
}

/**
 * Nodo plano viejo BACKUP/MOSTRADOR/{id}, sin fecha en la ruta. Hay que
 * traerlo entero, así que sólo se usa cuando se pide el historial completo.
 */
export async function leerVentasMostradorRespaldadasPlanas(db, raiz, mapaClave) {
  const filas = [];
  const data = await leer(db, `${raiz}/BACKUP/MOSTRADOR`);
  if (!data || typeof data !== 'object') return filas;
  for (const [id, venta] of Object.entries(data)) {
    if (!venta || typeof venta !== 'object') continue;
    filas.push(...filasDeVentaPorDepartamento(venta, {
      id, origen: 'BACKUP:MOSTRADOR', localId: raiz,
      fecha: venta.fechacaja || venta.date || venta.fecha,
    }, mapaClave));
  }
  return filas;
}

/**
 * Historial completo de ventas de Mostrador por departamento del local, ya
 * unificado y sin duplicar.
 *
 * @param {object} db          base de datos
 * @param {string} raiz        raíz del local (primer segmento de toda ruta)
 * @param {object} opciones    { desde, hasta, historialCompleto, seguirVigente }
 * @param {Function} [opciones.seguirVigente] se consulta entre lecturas; si
 *        devuelve false (cambió el local), se aborta y no se entrega nada.
 */
export async function leerVentasPorDepartamento(db, raiz, { desde, hasta, historialCompleto = false, seguirVigente = null } = {}) {
  const vigente = () => {
    if (seguirVigente && !seguirVigente()) {
      const e = new Error('LOCAL_CHANGED: la consulta empezó en otro local');
      e.code = 'LOCAL_CHANGED';
      throw e;
    }
  };

  vigente();
  const departamentos = await leer(db, `${raiz}/DEPARTAMENTOS`);
  const mapaClave = mapaClavePorDepartamento(departamentos);

  vigente();
  const vivas = await leerVentasMostradorVivas(db, raiz, mapaClave);

  vigente();
  const { filas: respaldadas, diasLeidos } = await leerVentasMostradorRespaldadas(db, raiz, desde, hasta, mapaClave);

  let planas = [];
  if (historialCompleto) {
    vigente();
    planas = await leerVentasMostradorRespaldadasPlanas(db, raiz, mapaClave);
  }

  vigente();
  return {
    filas: unirSinDuplicarPorDepartamento([...vivas, ...respaldadas, ...planas]),
    diagnostico: {
      vivas: vivas.length,
      respaldadas: respaldadas.length,
      planas: planas.length,
      diasLeidos,
      historialCompleto,
      departamentosMapeados: Object.keys(mapaClave).length,
    },
  };
}
