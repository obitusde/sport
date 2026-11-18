/**
 * sw.js – Service Worker der Sport-App
 * Version: 0.14.2 (2026-11-18)
 *
 * Hält die App-Dateien für den Offline-Betrieb bereit.
 * Strategie: zuerst Netz (damit Updates sofort ankommen), sonst Cache.
 * Anfragen an die Web-App (andere Domain) werden nicht angefasst;
 * die Daten speichert app.js selbst im localStorage.
 * Ab 0.9.0: Der Cache „sport-daten“ (Spuren für die Karte, von karte.js) bleibt bei
 * Updates erhalten; nur alte App-Caches werden gelöscht.
 */
const CACHE = 'sport-0.14.2';
const DATEIEN = ['./', 'index.html', 'style.css', 'app.js', 'form.js', 'hilfe.js', 'karte.js', 'historie.js', 'touren.js', 'fotos.js', 'daten/orte.txt', 'manifest.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', ereignis => {
  ereignis.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ereignis => {
  ereignis.waitUntil(
    caches.keys()
      .then(namen => Promise.all(namen.filter(n => n !== CACHE && n !== 'sport-daten').map(n => caches.delete(n))))
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
