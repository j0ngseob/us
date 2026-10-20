self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('us-cache').then((cache) => cache.addAll([
      '/',
      '/index.html',
      '/style.css',
      '/script.js'
    ]))
  );
});