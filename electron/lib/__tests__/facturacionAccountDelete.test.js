'use strict';

// BORRADO DE CREDENCIALES DE UNA CUENTA FISCAL (RI/Monotributo).
//
// Verifica, contra filesystem real, que eliminar una cuenta borra SOLO
// credenciales/configuración activa y preserva siempre:
//   - facturas históricas (factura-*.pdf, copia local que escribe el motor
//     de Monotributo de facturas YA EMITIDAS);
//   - cualquier archivo que no reconozcamos explícitamente;
//   - archivos de OTRAS cuentas.
//
// Correr con: node electron/lib/__tests__/facturacionAccountDelete.test.js

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ARCHIVOS_CREDENCIALES, eliminarCredencialesDeCuenta } = require('../facturacionAccountDelete');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e && e.message}`);
    process.exitCode = 1;
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'facturacion-account-delete-'));
const nuevoTmp = (nombre) => {
  const d = path.join(tmpRoot, `${nombre}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

/** Arma una cuenta RI/Monotributo completa y "funcionando" tal como queda en disco. */
function armarCuentaCompleta(accountDir, { conPdfs = false } = {}) {
  fs.mkdirSync(path.join(accountDir, 'cert'), { recursive: true });
  fs.writeFileSync(path.join(accountDir, '.env'), 'LOCAL_ID=40508022\nCUIT=20111111111\n', 'utf-8');
  fs.writeFileSync(path.join(accountDir, 'serviceAccount.json'), '{"type":"service_account"}', 'utf-8');
  fs.writeFileSync(path.join(accountDir, 'index.mjs'), "import 'dotenv';\n", 'utf-8');
  fs.writeFileSync(path.join(accountDir, 'claimPedido.mjs'), 'export const reductorDeClaim = () => {};\n', 'utf-8');
  fs.writeFileSync(path.join(accountDir, 'TRA.xml'), '<tra/>', 'utf-8');
  fs.writeFileSync(path.join(accountDir, 'TA.xml'), '<ta/>', 'utf-8');
  fs.writeFileSync(path.join(accountDir, 'cert', 'certificado.crt'), 'CERT-FALSO', 'utf-8');
  fs.writeFileSync(path.join(accountDir, 'cert', 'clave.key'), 'KEY-FALSA', 'utf-8');
  if (conPdfs) {
    fs.writeFileSync(path.join(accountDir, 'factura-0001-00000123.pdf'), 'PDF-FALSO-FACTURA-1', 'utf-8');
    fs.writeFileSync(path.join(accountDir, 'factura-0001-00000124.pdf'), 'PDF-FALSO-FACTURA-2', 'utf-8');
  }
}

console.log('ARCHIVOS_CREDENCIALES: lista real de archivos de credenciales/config (no historial):');
check('ningún *.pdf está en la lista de borrado', () => {
  assert.ok(ARCHIVOS_CREDENCIALES.every((f) => !f.endsWith('.pdf')));
});
check('incluye exactamente los archivos reales que escribe el flujo de alta (.env, serviceAccount.json, certs, motor, tokens AFIP)', () => {
  assert.deepStrictEqual(
    [...ARCHIVOS_CREDENCIALES].sort(),
    [
      '.env', 'serviceAccount.json', 'index.mjs', 'claimPedido.mjs', 'TRA.xml', 'TA.xml',
      path.join('cert', 'certificado.crt'), path.join('cert', 'clave.key'),
    ].sort(),
  );
});

console.log('\neliminarCredencialesDeCuenta — filesystem real:');

check('RI (sin PDFs): borra todas las credenciales, la carpeta cert/ queda borrada por vacía', () => {
  const dir = nuevoTmp('ri-completo');
  armarCuentaCompleta(dir);
  const { removed } = eliminarCredencialesDeCuenta(dir);

  assert.strictEqual(removed.length, 8);
  for (const rel of ARCHIVOS_CREDENCIALES) {
    assert.strictEqual(fs.existsSync(path.join(dir, rel)), false, `${rel} debería estar borrado`);
  }
  assert.strictEqual(fs.existsSync(path.join(dir, 'cert')), false, 'cert/ vacía debería borrarse');
});

check('Monotributo CON facturas históricas: se borran las credenciales, los PDF quedan intactos', () => {
  const dir = nuevoTmp('mono-con-historial');
  armarCuentaCompleta(dir, { conPdfs: true });
  const pdf1Antes = fs.readFileSync(path.join(dir, 'factura-0001-00000123.pdf'), 'utf-8');
  const pdf2Antes = fs.readFileSync(path.join(dir, 'factura-0001-00000124.pdf'), 'utf-8');

  const { removed } = eliminarCredencialesDeCuenta(dir);

  assert.strictEqual(removed.length, 8);
  assert.strictEqual(fs.existsSync(path.join(dir, '.env')), false);
  assert.strictEqual(fs.existsSync(path.join(dir, 'serviceAccount.json')), false);
  // Las dos facturas históricas, INTACTAS, byte a byte.
  assert.strictEqual(fs.readFileSync(path.join(dir, 'factura-0001-00000123.pdf'), 'utf-8'), pdf1Antes);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'factura-0001-00000124.pdf'), 'utf-8'), pdf2Antes);
  // La carpeta de la cuenta SIGUE EXISTIENDO (tiene los PDF adentro) — nunca un rmSync recursivo de todo el directorio.
  assert.ok(fs.existsSync(dir));
});

check('archivo no reconocido (ej. una nota del operador) se preserva', () => {
  const dir = nuevoTmp('con-archivo-raro');
  armarCuentaCompleta(dir);
  fs.writeFileSync(path.join(dir, 'notas-del-contador.txt'), 'llamar al contador el lunes', 'utf-8');

  eliminarCredencialesDeCuenta(dir);

  assert.strictEqual(fs.existsSync(path.join(dir, 'notas-del-contador.txt')), true);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'notas-del-contador.txt'), 'utf-8'), 'llamar al contador el lunes');
});

check('si cert/ tiene un archivo inesperado, la carpeta NO se borra (solo los dos archivos conocidos)', () => {
  const dir = nuevoTmp('cert-con-archivo-raro');
  armarCuentaCompleta(dir);
  fs.writeFileSync(path.join(dir, 'cert', 'cadena-intermedia.pem'), 'CADENA-FALSA', 'utf-8');

  eliminarCredencialesDeCuenta(dir);

  assert.strictEqual(fs.existsSync(path.join(dir, 'cert', 'certificado.crt')), false);
  assert.strictEqual(fs.existsSync(path.join(dir, 'cert', 'clave.key')), false);
  assert.strictEqual(fs.existsSync(path.join(dir, 'cert', 'cadena-intermedia.pem')), true, 'archivo inesperado en cert/ se preserva');
  assert.strictEqual(fs.existsSync(path.join(dir, 'cert')), true, 'cert/ no se borra si quedó algo adentro');
});

check('cuenta parcialmente configurada (solo .env, sin certs todavía): borra lo que hay, no rompe con lo que falta', () => {
  const dir = nuevoTmp('cuenta-parcial');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.env'), 'LOCAL_ID=1\n', 'utf-8');

  const { removed } = eliminarCredencialesDeCuenta(dir);
  assert.deepStrictEqual(removed, ['.env']);
});

check('directorio de cuenta inexistente (nunca se llegó a crear): no revienta, no hay nada que borrar', () => {
  const dir = path.join(nuevoTmp('padre'), 'nunca-existio');
  const { removed } = eliminarCredencialesDeCuenta(dir);
  assert.deepStrictEqual(removed, []);
});

check('eliminar una cuenta NO afecta los archivos de OTRA cuenta en un directorio hermano', () => {
  const raiz = nuevoTmp('multi-cuenta');
  const cuentaA = path.join(raiz, 'mono', 'cA');
  const cuentaB = path.join(raiz, 'mono', 'cB');
  fs.mkdirSync(cuentaA, { recursive: true });
  fs.mkdirSync(cuentaB, { recursive: true });
  armarCuentaCompleta(cuentaA, { conPdfs: true });
  armarCuentaCompleta(cuentaB, { conPdfs: true });

  eliminarCredencialesDeCuenta(cuentaA);

  // A quedó sin credenciales...
  assert.strictEqual(fs.existsSync(path.join(cuentaA, '.env')), false);
  // ...pero B sigue intacta: credenciales Y facturas.
  assert.strictEqual(fs.existsSync(path.join(cuentaB, '.env')), true);
  assert.strictEqual(fs.existsSync(path.join(cuentaB, 'serviceAccount.json')), true);
  assert.strictEqual(fs.existsSync(path.join(cuentaB, 'cert', 'certificado.crt')), true);
  assert.strictEqual(fs.existsSync(path.join(cuentaB, 'factura-0001-00000123.pdf')), true);
});

check('idempotente: eliminar dos veces la misma cuenta no rompe nada', () => {
  const dir = nuevoTmp('doble-eliminacion');
  armarCuentaCompleta(dir, { conPdfs: true });
  const r1 = eliminarCredencialesDeCuenta(dir);
  const r2 = eliminarCredencialesDeCuenta(dir);
  assert.strictEqual(r1.removed.length, 8);
  assert.deepStrictEqual(r2.removed, []); // ya no había nada más para borrar
  assert.strictEqual(fs.existsSync(path.join(dir, 'factura-0001-00000123.pdf')), true);
});

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporal */ }

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
