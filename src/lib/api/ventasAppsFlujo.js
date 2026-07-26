// ---------------------------------------------------------------------------
// VENTAS POR APP (PedidosYa / Rappi) — LECTURA DE FIREBASE
//
// SOLO LECTURA. Este módulo no escribe absolutamente nada: ni ventas, ni caja,
// ni stock, ni el ledger de prepagos. Es la capa de consulta del reporte.
//
// Recibe la base y la raíz del local ya resueltas, así que se puede ejecutar
// tal cual contra el emulador. `ventasAppsApi.js` es la capa delgada que
// resuelve el local activo.
//
// COSTO DE LA CONSULTA (documentado a propósito):
//   - MOSTRADOR y PEDIDOS vivos: 1 lectura cada uno. Son los nodos del turno
//     abierto, chicos por definición (al cerrar la caja se vacían).
//   - BACKUP: 1 lectura por CADA DÍA del rango pedido, sobre
//     BACKUP/{aaaa}/{mm}/{dd}/TURNO. Un mes = ~30 lecturas. NO se recorre la
//     base entera: el rango decide exactamente qué días se piden.
//   - PREPAGO_{APP}: 1 lectura cada uno (nodos chicos, sólo montos).
//   - Los nodos planos viejos BACKUP/MOSTRADOR y BACKUP/PEDIDOS (sin fecha en
//     la ruta) sólo se leen en modo "historial completo", porque hay que
//     traerlos enteros para poder filtrarlos por fecha.
//
// Idéntico en Desktop y Tablet.
// ---------------------------------------------------------------------------

import { ref, get } from 'firebase/database';
import {
  PLATAFORMAS,
  diasDelRango,
  filaDeLedger,
  filasDeVenta,
  normalizarFecha,
  unirSinDuplicar,
} from './ventasApps.js';

/** Carpetas de estado dentro de un turno respaldado. Las anuladas se descartan luego. */
const CARPETAS_ESTADO = ['COMPLETADOS', 'ENTREGADOS', 'CANCELADOS'];

const leer = async (db, ruta) => {
  const snap = await get(ref(db, ruta));
  return snap.exists() ? snap.val() : null;
};

/** Ejecuta las promesas de a `tamano` para no abrir 400 sockets de golpe. */
async function enLotes(items, tamano, fn) {
  const salida = [];
  for (let i = 0; i < items.length; i += tamano) {
    const lote = items.slice(i, i + tamano);
    salida.push(...(await Promise.all(lote.map(fn))));
  }
  return salida;
}

/** Ventas VIVAS de mostrador y delivery del local. */
export async function leerVentasVivas(db, raiz) {
  const filas = [];
  for (const [nodo, canal] of [['MOSTRADOR', 'Mostrador'], ['PEDIDOS', 'Delivery']]) {
    const data = await leer(db, `${raiz}/${nodo}`);
    if (!data) continue;
    for (const [id, venta] of Object.entries(data)) {
      if (!venta || typeof venta !== 'object') continue;
      filas.push(...filasDeVenta(venta, { id, canal, origen: nodo, localId: raiz }));
    }
  }
  return filas;
}

/**
 * Ventas de turnos CERRADOS, leyendo únicamente los días del rango.
 * Estructura: BACKUP/{aaaa}/{mm}/{dd}/TURNO/{turno}/{MOSTRADOR|DELIVERY}/{estado}/{id}
 */
export async function leerVentasRespaldadas(db, raiz, desde, hasta, { concurrencia = 8 } = {}) {
  const dias = diasDelRango(desde, hasta);
  if (dias.length === 0) return { filas: [], diasLeidos: 0 };

  const porDia = await enLotes(dias, concurrencia, async ({ anio, mes, dia }) => {
    const turnos = await leer(db, `${raiz}/BACKUP/${anio}/${mes}/${dia}/TURNO`);
    if (!turnos) return [];
    const filas = [];
    const fecha = `${dia}-${mes}-${anio}`;
    for (const [turno, contenido] of Object.entries(turnos)) {
      if (!contenido || typeof contenido !== 'object') continue;
      for (const [nodo, canal] of [['MOSTRADOR', 'Mostrador'], ['DELIVERY', 'Delivery']]) {
        for (const estado of CARPETAS_ESTADO) {
          const ventas = contenido?.[nodo]?.[estado];
          if (!ventas || typeof ventas !== 'object') continue;
          for (const [id, venta] of Object.entries(ventas)) {
            if (!venta || typeof venta !== 'object') continue;
            filas.push(...filasDeVenta(venta, {
              id, canal, turno, estado, fecha,
              origen: `BACKUP:${nodo}`, localId: raiz,
            }));
          }
        }
      }
    }
    return filas;
  });

  return { filas: porDia.flat(), diasLeidos: dias.length };
}

/**
 * Nodos planos viejos: BACKUP/MOSTRADOR/{id} y BACKUP/PEDIDOS/{id}, sin fecha
 * en la ruta. Hay que traerlos enteros, así que sólo se usan cuando se pide el
 * historial completo. Cada registro se ubica por su propia `fechacaja`/`date`.
 */
export async function leerVentasRespaldadasPlanas(db, raiz) {
  const filas = [];
  for (const [nodo, canal] of [['MOSTRADOR', 'Mostrador'], ['PEDIDOS', 'Delivery']]) {
    const data = await leer(db, `${raiz}/BACKUP/${nodo}`);
    if (!data || typeof data !== 'object') continue;
    for (const [id, venta] of Object.entries(data)) {
      if (!venta || typeof venta !== 'object') continue;
      filas.push(...filasDeVenta(venta, {
        id, canal, origen: `BACKUP:${nodo}`, localId: raiz,
        fecha: venta.fechacaja || venta.date || venta.fecha,
      }));
    }
  }
  return filas;
}

/**
 * Ledger derivado /{localId}/PREPAGO_{APP}. Soporta las dos formas que existen:
 *   PREPAGO_X/{DDMMAAAA|DD-MM-AAAA}/{numero} → { numero, hora, monto, timestamp }
 *   PREPAGO_X/{pushId}                        → { id, type, fecha, hora, monto }
 * Los huecos nulos (Firebase devuelve un array con null en el índice 0 cuando
 * las claves numéricas arrancan en 1) se descartan sin romper nada.
 */
export async function leerLedgerPrepagos(db, raiz) {
  const filas = [];
  for (const plataforma of PLATAFORMAS) {
    const data = await leer(db, `${raiz}/PREPAGO_${plataforma}`);
    if (!data || typeof data !== 'object') continue;

    for (const [clave, valor] of Object.entries(data)) {
      if (!valor || typeof valor !== 'object') continue;

      if (valor.monto !== undefined) {                      // registro suelto (carga manual)
        const fila = filaDeLedger(valor, { plataforma, localId: raiz, fecha: valor.fecha, numero: valor.numero ?? clave });
        if (fila) filas.push(fila);
        continue;
      }

      const fecha = normalizarFecha(clave);                 // carpeta por día
      for (const [numeroClave, registro] of Object.entries(valor)) {
        if (!registro || typeof registro !== 'object') continue;
        const fila = filaDeLedger(registro, {
          plataforma, localId: raiz, fecha,
          numero: registro.numero ?? (Number.isNaN(Number(numeroClave)) ? numeroClave : Number(numeroClave)),
        });
        if (fila) filas.push(fila);
      }
    }
  }
  return filas;
}

/**
 * Historial completo de ventas por app del local, ya unificado y sin duplicar.
 *
 * @param {object} db          base de datos
 * @param {string} raiz        raíz del local (primer segmento de toda ruta)
 * @param {object} opciones    { desde, hasta, historialCompleto, seguirVigente }
 * @param {Function} [opciones.seguirVigente] se consulta entre lecturas; si
 *        devuelve false (cambió el local), se aborta y no se entrega nada.
 */
export async function leerVentasDeApps(db, raiz, { desde, hasta, historialCompleto = false, seguirVigente = null } = {}) {
  const vigente = () => {
    if (seguirVigente && !seguirVigente()) {
      const e = new Error('LOCAL_CHANGED: la consulta empezó en otro local');
      e.code = 'LOCAL_CHANGED';
      throw e;
    }
  };

  vigente();
  const vivas = await leerVentasVivas(db, raiz);

  vigente();
  const { filas: respaldadas, diasLeidos } = await leerVentasRespaldadas(db, raiz, desde, hasta);

  let planas = [];
  if (historialCompleto) {
    vigente();
    planas = await leerVentasRespaldadasPlanas(db, raiz);
  }

  vigente();
  const ledger = await leerLedgerPrepagos(db, raiz);

  vigente();
  return {
    filas: unirSinDuplicar([...vivas, ...respaldadas, ...planas], ledger),
    diagnostico: {
      vivas: vivas.length,
      respaldadas: respaldadas.length,
      planas: planas.length,
      ledger: ledger.length,
      diasLeidos,
      historialCompleto,
    },
  };
}
