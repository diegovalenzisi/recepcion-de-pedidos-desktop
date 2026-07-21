import { useState, useEffect, useRef, useCallback } from 'react';
import { getLocalId } from '@/lib/firebase/core';
import {
  parseArticleImage,
  resolveArticleImage,
  ARTICLE_IMAGE_PLACEHOLDER,
} from '@/lib/cache/articleImageCache';

// ---------------------------------------------------------------------------
// Hook de imagen de artículo con caché local (stale-while-revalidate).
//
// Devuelve { src, isPlaceholder, onError } para <img>. Muestra de inmediato la
// mejor copia conocida (local dlvimg://...?v=version / remota / placeholder) y
// actualiza a la copia nueva cuando el caché la resuelve en segundo plano.
//
// Estabilidad e integridad:
//  - Depende SOLO de valores estables (localId, bucket, objectPath, lastModified),
//    NUNCA del objeto `article` completo ni de la URL con token (requisito 21).
//  - `lastModified` (que managementApi.saveData actualiza en cada guardado) fuerza
//    una comprobación de metadata cuando cambia — señal de RTDB, sin polling
//    (requisito 4).
//  - Cada corrida del efecto tiene un TOKEN. Una resolución en vuelo de una
//    corrida anterior (p. ej. tras cambiar de local) NO actualiza el estado
//    actual: se descarta por token distinto (requisitos 9, 22). Así nunca se
//    muestra la imagen del local/artículo anterior asociada al nuevo.
//  - onError cae al placeholder empaquetado sin entrar en bucle (requisito 7) y
//    permite volver a resolver cuando cambia la identidad.
// ---------------------------------------------------------------------------
export function useArticleImage(article) {
  const foto = article ? article.foto : null;
  const lastModified = article ? article.lastModified : undefined;
  const localId = getLocalId();

  const identity = parseArticleImage(foto);
  const depKey = identity.kind === 'firebase'
    ? `fb:${identity.bucket}::${identity.objectPath}`
    : `${identity.kind}:${identity.url || ''}`;

  const [src, setSrc] = useState(() => resolveArticleImage(identity, { localId }).src);
  const [isPlaceholder, setIsPlaceholder] = useState(
    () => identity.kind === 'none' || identity.kind === 'placeholder'
  );

  const runTokenRef = useRef(null);   // identidad de la corrida actual del efecto
  const prevLmRef = useRef(lastModified);
  const erroredRef = useRef(false);   // ya cayó al placeholder por error de carga

  useEffect(() => {
    const token = {};
    runTokenRef.current = token;
    erroredRef.current = false; // nueva identidad: se permite volver a resolver
    const idn = parseArticleImage(foto);
    const changedSignal = prevLmRef.current !== lastModified; // señal RTDB
    prevLmRef.current = lastModified;

    const r = resolveArticleImage(idn, {
      localId,
      force: changedSignal,
      onUpdate: (newSrc) => {
        // Solo aplica si sigue siendo la corrida vigente (mismo local/identidad).
        if (runTokenRef.current === token && newSrc) {
          erroredRef.current = false;
          setSrc(newSrc);
          setIsPlaceholder(false);
        }
      },
    });
    // Reset síncrono al valor de ESTA identidad (evita mostrar la anterior).
    setSrc(r.src);
    setIsPlaceholder(!!r.isPlaceholder);

    return () => { if (runTokenRef.current === token) runTokenRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localId, depKey, lastModified]);

  const onError = useCallback(() => {
    // Evita el bucle imagen-fallida ↔ mismo src: si ya está en placeholder, no
    // hacer nada. Si no, caer al placeholder empaquetado (siempre disponible).
    if (erroredRef.current) return;
    erroredRef.current = true;
    if (typeof console !== 'undefined') console.warn('[imageCache] IMG_LOAD_ERROR (cayendo a placeholder)');
    setSrc(ARTICLE_IMAGE_PLACEHOLDER);
    setIsPlaceholder(true);
  }, []);

  return { src, isPlaceholder, onError };
}
