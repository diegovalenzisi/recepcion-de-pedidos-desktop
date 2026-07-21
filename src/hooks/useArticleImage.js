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
// Devuelve { src, isPlaceholder, onError } para usar directo en <img>.
//  - Muestra de inmediato la mejor copia conocida (local si existe, si no la
//    URL remota, si no el placeholder) y actualiza a la copia local/nueva
//    cuando el caché la resuelve en segundo plano.
//  - Depende SOLO de valores estables (localId, bucket, objectPath, lastModified),
//    NUNCA del objeto `article` completo ni de la URL con token — así no entra en
//    bucles de re-render y no re-consulta metadata por una rotación de token
//    (requisitos 21, 3).
//  - `lastModified` del artículo (que managementApi.saveData actualiza en cada
//    guardado) actúa como señal de cambio: si cambia, se fuerza una comprobación
//    de metadata de la imagen (requisito 4). Sin polling permanente.
//  - Si el componente se desmonta o cambia el local durante una comprobación, no
//    actualiza el estado viejo (requisito 22). Si cambió el objectPath, la
//    identidad es otra: se muestra la nueva copia/placeholder, nunca la anterior
//    asociada al artículo nuevo (requisito 23).
// ---------------------------------------------------------------------------
export function useArticleImage(article) {
  const foto = article ? article.foto : null;
  const lastModified = article ? article.lastModified : undefined;
  const localId = getLocalId();

  const identity = parseArticleImage(foto);
  // Clave de dependencia ESTABLE: para Firebase, bucket+objectPath (sin token);
  // para el resto, la propia url/kind.
  const depKey = identity.kind === 'firebase'
    ? `fb:${identity.bucket}::${identity.objectPath}`
    : `${identity.kind}:${identity.url || ''}`;

  const [src, setSrc] = useState(() => resolveArticleImage(identity, { localId }).src);
  const [isPlaceholder, setIsPlaceholder] = useState(
    () => identity.kind === 'none' || identity.kind === 'placeholder'
  );

  const mountedRef = useRef(true);
  const prevLmRef = useRef(lastModified);

  useEffect(() => {
    mountedRef.current = true;
    const idn = parseArticleImage(foto);
    // force solo cuando lastModified realmente cambió (señal de RTDB), no en el
    // montaje inicial ni por rotación de token.
    const changedSignal = prevLmRef.current !== lastModified;
    prevLmRef.current = lastModified;

    const r = resolveArticleImage(idn, {
      localId,
      force: changedSignal,
      onUpdate: (newSrc) => {
        if (mountedRef.current && newSrc) {
          setSrc(newSrc);
          setIsPlaceholder(false);
        }
      },
    });
    // Reset síncrono al mejor valor de ESTA identidad (evita mostrar la imagen
    // del artículo anterior mientras se resuelve la nueva).
    setSrc(r.src);
    setIsPlaceholder(!!r.isPlaceholder);

    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localId, depKey, lastModified]);

  const onError = useCallback(() => {
    // Si ni la local ni la remota cargan, caer al placeholder empaquetado.
    setSrc(ARTICLE_IMAGE_PLACEHOLDER);
    setIsPlaceholder(true);
  }, []);

  return { src, isPlaceholder, onError };
}
