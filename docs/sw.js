/**
 * sw.js – Service Worker der Sport-App
 * Version: 0.6.0 (2026-11-17)
 *
 * Hält die App-Dateien für den Offline-Betrieb bereit.
 * Strategie: zuerst Netz (damit Updates sofort ankommen), sonst Cache.
 * Anfragen an die Web-App (andere Domain) werden nicht angefasst;
 * die Daten speichert app.js selbst im localStorage.
 */
const CACHE = 'sport-0.6.0';
const DATEIEN = ['./', 'index.html', 'style.css', 'app.js', 'form.js', 'hilfe.js', 'manifest.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', ereignis => {
  ereignis.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ereignis => {
  ereignis.waitUntil(
    caches.keys()
      .then(namen => Promise.all(namen.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ereignis => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET' || new URL(anfrage.url).origin !== self.location.origin) return;
  ereignis.respondWith(
    fetch(anfrage)
      .then(antwort => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then(c => c.put(anfrage, kopie));
        }
        return antwort;
      })
      .catch(() => caches.match(anfrage).then(t => t || caches.match('index.html')))
  );
});
