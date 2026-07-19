// Contraparte del renderer de electron/lib/firebaseHttpTransport.js — misma
// normalización (new URL(), nunca comparación de texto), disponible tanto en
// Node (electron/main.js) como en el navegador (esta app). No re-exportar
// entre ambos: son runtimes distintos (CJS vs ESM/Vite), se mantiene una
// copia deliberadamente pequeña y sin dependencias en cada lado.

const SUPPORTED_PROTOCOLS = new Set(['https:', 'http:']);

/**
 * Normaliza un databaseURL de Firebase antes de guardarlo o consumirlo:
 * recorta espacios, valida protocolo (http/https) y devuelve el origin
 * (esquema normalizado a minúsculas + host + puerto) — sin barra final, sin
 * path, sin query. No modifica el dominio ni agrega rutas que no existían.
 * Lanza si `rawUrl` no es una URL http/https válida.
 */
export const normalizeFirebaseDatabaseURL = (rawUrl) => {
  const parsed = new URL(String(rawUrl).trim());
  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Protocolo no soportado para Firebase: ${parsed.protocol}`);
  }
  return parsed.origin;
};
