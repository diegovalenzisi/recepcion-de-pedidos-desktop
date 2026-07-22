// ---------------------------------------------------------------------------
// SHA-256 síncrono y portable (Node, Electron y navegador).
//
// Por qué no se usa `crypto.subtle`: es asíncrono, y el hash del impacto se
// calcula dentro del reductor de `runTransaction`, que DEBE ser síncrono. Y
// `node:crypto` no existe en el navegador (DLV Pedidos). Así que se implementa
// el algoritmo, que es determinístico y no depende del entorno.
//
// Reemplaza al FNV-1a de 32 bits que se usaba antes: 32 bits son ~4.300
// millones de valores, insuficientes como garantía de identidad económica y de
// stock (dos impactos distintos podrían colisionar y tomarse por el mismo).
//
// Módulo puro. Idéntico en los tres repos.
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** Codifica a UTF-8 sin depender de TextEncoder (disponible igual en todos lados). */
function utf8Bytes(texto) {
  const s = String(texto);
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    let c = s.codePointAt(i);
    if (c > 0xffff) i += 1;                       // par subrogado
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** SHA-256 de una cadena → 64 caracteres hexadecimales en minúscula. */
export function sha256Hex(texto) {
  const bytes = utf8Bytes(texto);
  const bitLen = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // Longitud en 64 bits big-endian (los 32 altos son 0 para entradas realistas).
  const alto = Math.floor(bitLen / 0x100000000);
  const bajo = bitLen >>> 0;
  bytes.push((alto >>> 24) & 255, (alto >>> 16) & 255, (alto >>> 8) & 255, alto & 255);
  bytes.push((bajo >>> 24) & 255, (bajo >>> 16) & 255, (bajo >>> 8) & 255, bajo & 255);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let pos = 0; pos < bytes.length; pos += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = ((bytes[pos + i * 4] << 24) | (bytes[pos + i * 4 + 1] << 16)
        | (bytes[pos + i * 4 + 2] << 8) | bytes[pos + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * Serialización canónica: `JSON.stringify` NO ordena las claves, así que dos
 * objetos equivalentes con distinto orden de propiedades darían hashes
 * distintos. Esto ordena recursivamente antes de serializar.
 */
export function jsonCanonico(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const claves = Object.keys(valor).filter((k) => valor[k] !== undefined).sort();
  return `{${claves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(valor[k])}`).join(',')}}`;
}

/**
 * Normaliza una cantidad a texto estable, sin depender del locale ni de la
 * notación exponencial. 0.50, 0.5 y "0.5" dan el mismo texto.
 */
export function cantidadCanonica(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 'NaN';
  // 6 decimales cubre el stock fraccionado real y evita 0.30000000000000004.
  let s = num.toFixed(6);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
