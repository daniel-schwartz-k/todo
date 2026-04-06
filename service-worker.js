// service-worker.js
const CACHE_NAME = 'todo-app-cache-v2';
const ASSETS_TO_CACHE = [
  '/todo/',
  '/todo/index.html',
  '/todo/styles.css',
  '/todo/app.js',
  '/todo/models/task.js',
  '/todo/models/taskList.js',
  '/todo/banners/dark-sunday.png',
  '/todo/manifest.webmanifest',
  '/todo/vendor/playpen-sans/playpen-sans.css',
  '/todo/vendor/playpen-sans/playpen-sans-latin-400.woff2',
  '/todo/vendor/playpen-sans/playpen-sans-latin-ext-400.woff2',
  '/todo/vendor/quill/quill.snow.css',
  '/todo/vendor/quill/quill.js',
  '/todo/vendor/highlightjs/base16-dracula.min.css',
  '/todo/vendor/highlightjs/highlight.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
