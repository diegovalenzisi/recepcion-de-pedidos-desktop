'use strict';

const path = require('node:path');
const fsReal = require('node:fs');

// ---------------------------------------------------------------------------
// BORRADO DE CREDENCIALES DE UNA CUENTA FISCAL (RI o Monotributo).
//
// Solo credenciales/configuración ACTIVA — nunca historial. El motor de
// Monotributo escribe copias locales `factura-<id>.pdf` de facturas YA
// EMITIDAS en el mismo directorio de la cuenta
// (resources/facturacion/monotributo/index.mjs, `fs.writeFileSync(filename, pdf)`
// con cwd = accountDir). El motor de RI no escribe ningún PDF local. En ambos
// casos, cualquier archivo que no esté en ARCHIVOS_CREDENCIALES se preserva
// tal cual, sin excepción — incluida la carpeta en sí si queda con algo adentro.
// ---------------------------------------------------------------------------

const ARCHIVOS_CREDENCIALES = [
  '.env',
  'serviceAccount.json',
  'index.mjs',
  'claimPedido.mjs',
  'TRA.xml', // token de sesión AFIP (WSAA), efímero
  'TA.xml',  // idem, nombre usado por el motor de Monotributo
  path.join('cert', 'certificado.crt'),
  path.join('cert', 'clave.key'),
];

/**
 * Borra de `accountDir` únicamente los archivos de ARCHIVOS_CREDENCIALES que
 * existan. Si la carpeta `cert/` queda vacía después, también se borra (nunca
 * si le queda algo adentro). No toca nada más: ni `factura-*.pdf`, ni ningún
 * otro archivo no reconocido, ni el resto del árbol de `facturacion/locales/`.
 *
 * @param {string} accountDir
 * @param {object} [opts]
 * @param {object} [opts.fs] inyección de fs para tests (default: fs real)
 * @returns {{ removed: string[] }}
 */
function eliminarCredencialesDeCuenta(accountDir, { fs = fsReal } = {}) {
  if (!fs.existsSync(accountDir)) return { removed: [] };

  const removed = [];
  for (const rel of ARCHIVOS_CREDENCIALES) {
    const full = path.join(accountDir, rel);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
      removed.push(rel);
    }
  }

  const certDir = path.join(accountDir, 'cert');
  try {
    if (fs.existsSync(certDir) && fs.readdirSync(certDir).length === 0) {
      fs.rmSync(certDir, { recursive: true, force: true });
    }
  } catch { /* no crítico: si no se puede borrar la carpeta vacía, no pasa nada */ }

  return { removed };
}

module.exports = { ARCHIVOS_CREDENCIALES, eliminarCredencialesDeCuenta };
