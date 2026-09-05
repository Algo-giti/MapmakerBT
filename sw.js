'use strict';
// Version an einer Stelle pflegen. Bei jedem Deploy hochzaehlen — nicht wegen des
// network-first-Zweigs (der holt ohnehin frisch), sondern wegen der Rueckfallebene:
// scheitert der Netzabruf (draussen am Maeher oft der Fall), liefert der Cache die
// Dateien aus, die beim *Installieren* dieser Version geholt wurden. Bleibt die Version
// stehen, ist das monatelang derselbe alte Stand. Eine neue Version legt einen frischen
// Cache an und zeigt dem Nutzer ausserdem die Update-Leiste.
const APP_VERSION = 'v22';
const CACHE = `mapcreator-ardumower-${APP_VERSION}`;

// Die App selbst. Diese Dateien werden IMMER zuerst aus dem Netz geholt (network-first),
// damit ein Deploy sofort ankommt. Frueher war der Service Worker durchgaengig cache-first
// mit festem Cache-Namen — dadurch blieben Korrekturen an styles.css/app.js auf dem Geraet
// unsichtbar, bis jemand daran dachte, den Cache-Namen zu erhoehen.
const SHELL = ['./', './index.html', './styles.css', './protocol.js', './app.js'];
// Alles Weitere aendert sich praktisch nie und darf aus dem Cache kommen (cache-first).
const ASSETS = [...SHELL, './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

function isShellRequest(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return /(^|\/)(index\.html|styles\.css|app\.js|protocol\.js)$/.test(url.pathname) || url.pathname.endsWith('/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' umgeht den HTTP-Cache des Browsers, sonst landet beim Neuaufbau
      // womoeglich wieder eine alte Datei im Service-Worker-Cache.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
  );
  // Kein skipWaiting() hier: die neue Fassung bleibt im Wartestand, bis der Nutzer den
  // Hinweis auf der Hauptseite antippt. Sonst wuerde die Seite mitten in der Aufnahme
  // unter dem Nutzer weg neu laden — oder schlimmer: die Seite laeuft mit altem Code
  // weiter, waehrend der neue Worker schon neue Dateien ausliefert.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (isShellRequest(event.request)) {
    event.respondWith(
      // cache: 'no-cache' erzwingt eine Rueckfrage beim Server (If-None-Match). Ohne das
      // liefert der HTTP-Cache des Browsers wegen GitHub Pages' max-age=600 bis zu zehn
      // Minuten lang die alte Datei — auch bei network-first.
      fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }))
  );
});
