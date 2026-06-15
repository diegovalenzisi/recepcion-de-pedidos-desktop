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

if (workbox) {
  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'document',
    new workbox.strategies.NetworkFirst({
      cacheName: 'html-cache',
    })
  );

  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'script' || request.destination === 'style',
    new workbox.strategies.StaleWhileRevalidate({
      cacheName: 'static-resources',
    })
  );
}