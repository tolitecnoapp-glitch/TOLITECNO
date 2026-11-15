/* ============================================================
   TOLITECNO · Service Worker (PWA + Web Push)
   Repo: https://tolitecnoapp-glitch.github.io/TOLITECNO/
   Debe vivir en la RAÍZ del repo, junto a index.html / app.html / viaje.html
   ============================================================ */
const CACHE = "tolitecno-cache-v1";
const BASE = new URL("./", self.registration.scope).pathname; // /TOLITECNO/
const CORE = [
  BASE,
  BASE + "index.html",
  BASE + "app.html",
  BASE + "viaje.html",
  BASE + "manifest.json",
  BASE + "icon-192.png",
  BASE + "icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Red primero (la app es en tiempo real); caché solo como respaldo offline.
   Nunca se cachean llamadas a Supabase ni a Google Maps. */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/supabase\.co|googleapis\.com|gstatic\.com/i.test(url.href)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copia = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copia)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((r) => r || caches.match(BASE + "index.html")))
  );
});

/* ================= PUSH (app cerrada / segundo plano) =================
   La Edge Function `enviar-push` envía un JSON así:
   { "tipo":"push-viaje"|"push-estado", "viaje_id":123, "estado":"aceptado",
     "title":"...", "body":"...", "url":".../viaje.html?id=123&rol=pasajero", "tag":"..." } */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : "" }; }

  const tipo = data.tipo || data.type || "push-estado";
  const viajeId = data.viaje_id || data.viajeId || null;
  const estado = data.estado || null;
  const esViajeNuevo = tipo === "push-viaje";

  const title = data.title || (esViajeNuevo ? "🚖 Nueva solicitud · TOLITECNO" : "TOLITECNO · Tu viaje se actualizó");
  const urlViaje = viajeId
    ? new URL("viaje.html?id=" + encodeURIComponent(viajeId) + "&rol=" + encodeURIComponent(data.rol || "pasajero"), self.registration.scope).href
    : null;

  const options = {
    body: data.body || data.mensaje || "",
    icon: new URL("icon-192.png", self.registration.scope).href,
    badge: new URL("icon-192.png", self.registration.scope).href,
    tag: data.tag || ("tolitecno-" + tipo + "-" + (viajeId || "general") + (estado ? "-" + estado : "")),
    renotify: true,
    requireInteraction: esViajeNuevo,
    vibrate: esViajeNuevo ? [350, 120, 350, 120, 700] : [250, 100, 250],
    timestamp: Date.now(),
    data: {
      url: data.url || urlViaje || self.registration.scope,
      viaje_id: viajeId,
      estado: estado,
      tipo: tipo,
    },
  };

  event.waitUntil((async () => {
    // Avisar a las ventanas abiertas para que se actualicen sin duplicar la notificación si ya están en primer plano
    const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    let hayVisible = false;
    for (const cliente of clientes) {
      if (cliente.visibilityState === "visible") hayVisible = true;
      try { cliente.postMessage({ tipo: tipo, viaje_id: viajeId, estado: estado }); } catch (e) {}
    }
    if (!hayVisible) {
      await self.registration.showNotification(title, options);
    } else if (esViajeNuevo) {
      // Con la app abierta el sonido/toast lo maneja la página; no duplicamos notificación del sistema
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const destino = d.url || self.registration.scope;

  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const cliente of clientes) {
      try { cliente.postMessage({ tipo: "abrir-viaje", viaje_id: d.viaje_id, estado: d.estado }); } catch (e) {}
      if ("focus" in cliente) {
        try { if (cliente.navigate) await cliente.navigate(destino); } catch (e) {}
        return cliente.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(destino);
  })());
});

/* Si una suscripción caduca, las páginas abiertas la renuevan (app/viaje ya escuchan 'renovar-push') */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const cliente of clientes) {
      try { cliente.postMessage({ tipo: "renovar-push" }); } catch (e) {}
    }
  })());
});
