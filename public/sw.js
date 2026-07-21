/* global importScripts, self, workbox */
/* eslint-disable no-restricted-globals, no-undef */

const SW_BUILD_VERSION = '__BUILD_VERSION__';
console.log('[SW] build version:', SW_BUILD_VERSION);

importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Prefijo "dlv-" en los nombres de cache: identifica estos caches como
// propios de la app frente a cualquier otro que pudiera existir en el mismo
// origen, y permite que el botón "Actualizar aplicación" (cacheManager.js,
// clearSafeLocalCache) los encuentre por prefijo en vez de por nombre exacto
// -- si el nombre cambia acá en el futuro (ej. se agrega una versión), la
// limpieza lo sigue encontrando solo con mantener el mismo prefijo.
if (workbox) {
  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'document',
    new workbox.strategies.NetworkFirst({
      cacheName: 'dlv-html-cache',
    })
  );

  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'script' || request.destination === 'style',
    new workbox.strategies.StaleWhileRevalidate({
      cacheName: 'dlv-static-resources',
    })
  );
}