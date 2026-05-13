const CACHE_NAME = "englishslide-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./offline.html",
  "./privacy.html",
  "./terms.html",
  "./assets/app-icon.png",
  "./assets/mascot-wave.png",
  "./assets/mascot-book.png",
  "./assets/mascot-headset.png",
  "./assets/mascot-spark.png",
  "./assets/mascot-flag.png",
  "./assets/mascot-thinking.png",
  "./assets/mascot-happy.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => caches.match("./offline.html"));
    })
  );
});
