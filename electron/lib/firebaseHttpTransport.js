'use strict';

// Resolución de transporte HTTP(S) para URLs de Firebase (databaseURL) usando
// el parser estándar de Node (new URL) — NUNCA comparación de texto tipo
// url.startsWith('https'), que es sensible a mayúsculas/minúsculas y elige el
// módulo equivocado si alguien guardó "HTTPS://..." en vez de "https://..."
// (causa raíz confirmada del bug de facturación automática de Canadá: con el
// esquema en mayúsculas, url.startsWith('https') daba false, se usaba el
// módulo `http` contra una URL https, y Node tiraba ERR_INVALID_PROTOCOL).

const https = require('https');
const http = require('http');

const SUPPORTED_PROTOCOLS = new Set(['https:', 'http:']);

/**
 * Parsea `rawUrl` con el parser estándar de Node y devuelve el módulo
 * correcto (http/https) según parsedUrl.protocol — nunca por inspección de
 * texto. Lanza un Error con `.code` si la URL es inválida o el protocolo no
 * es http/https:
 *   - code 'URL_INVALIDA'          → new URL() no pudo parsear el string
 *   - code 'PROTOCOLO_NO_SOPORTADO' → protocolo distinto de http:/https:
 */
function resolveRequestTransport(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(rawUrl).trim());
  } catch (e) {
    const err = new Error(`URL inválida para Firebase: ${rawUrl}`);
    err.code = 'URL_INVALIDA';
    err.cause = e;
    throw err;
  }
  if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
    const err = new Error(`Protocolo no soportado para Firebase: ${parsedUrl.protocol}`);
    err.code = 'PROTOCOLO_NO_SOPORTADO';
    throw err;
  }
  return {
    module: parsedUrl.protocol === 'https:' ? https : http,
    url: parsedUrl,
    protocol: parsedUrl.protocol,
  };
}

/**
 * Normaliza un databaseURL de Firebase antes de guardarlo o consumirlo:
 * recorta espacios, valida protocolo (http/https) vía resolveRequestTransport
 * y devuelve SOLO el origin (esquema normalizado a minúsculas por el parser +
 * host + puerto) — sin barra final, sin path, sin query. No modifica el
 * dominio ni agrega rutas que no existían. Lanza (mismos códigos que
 * resolveRequestTransport) si `rawUrl` no es una URL http/https válida.
 */
function normalizeFirebaseDatabaseURL(rawUrl) {
  const { url } = resolveRequestTransport(rawUrl);
  return url.origin;
}

/**
 * Clasifica un fallo de red/URL para diagnóstico — para no colapsar todo a
 * un genérico "sin conexión" que oculta bugs como el de Canadá. No sustituye
 * el logging: solo decide qué código usar.
 */
function classifyTransportError(error) {
  if (!error) return 'ERROR_DE_RED';
  if (error.code === 'URL_INVALIDA') return 'URL_INVALIDA';
  if (error.code === 'PROTOCOLO_NO_SOPORTADO') return 'PROTOCOLO_NO_SOPORTADO';
  if (error.statusCode === 401 || error.statusCode === 403) return 'PERMISSION_DENIED';
  return 'ERROR_DE_RED';
}

module.exports = {
  SUPPORTED_PROTOCOLS,
  resolveRequestTransport,
  normalizeFirebaseDatabaseURL,
  classifyTransportError,
};
