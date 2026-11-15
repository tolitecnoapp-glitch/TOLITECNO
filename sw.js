/* ============================================================================
   TOLITECNO · Service Worker (PWA + Notificaciones Push en 2do plano/cerrada)
   Repo: https://tolitecnoapp-glitch.github.io/TOLITECNO/
   ============================================================================ */
'use strict';

const CACHE_NAME = 'tolitecno-pwa-v2';
const BASE_FALLBACK = 'https://tolitecnoapp-glitch.github.io/TOLITECNO/';
const ASSETS_BASE = [
  './',
  './index.html',
  './app.html',
  './viaje.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

function urlAbsoluta(ruta) {
  const base = (self.registration && self.registration.scope) || BASE_FALLBACK;
  try {
    return new URL(ruta || './app.html', base).href;
  } catch (e) {
    return BASE_FALLBACK + 'app.html';
  }
}

/* ================= INSTALACIÓN Y ACTIVACIÓN ================= */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_BASE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ================= FETCH (Network-first para HTML · nunca cachea Supabase/APIs) ================= */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const esNavegacion = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (esNavegacion) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copia = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copia)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const enRed = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copia = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copia)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || enRed;
    })
  );
});

/* ================= RECEPCIÓN DE NOTIFICACIONES PUSH ================= */
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload = { title: 'TOLITECNO', body: event.data.text() };
    }
  }

  const data = Object.assign({}, payload.data || {});
  const tipo = data.tipo || payload.tipo || 'aviso';
  const viajeId = data.viaje_id != null ? data.viaje_id : (payload.viaje_id != null ? payload.viaje_id : null);
  const estado = data.estado || payload.estado || '';
  const icono = payload.icon || urlAbsoluta('icon-192.png');
  const badge = payload.badge || urlAbsoluta('icon-192.png');
  const titulo = payload.title || 'TOLITECNO';
  const cuerpo = payload.body || 'Tienes una actualización de tu viaje.';
  const tag = payload.tag || (viajeId != null ? ('tolitecno-' + tipo + '-' + viajeId) : 'tolitecno-aviso');
  const destinoUrl = data.url || payload.url || urlAbsoluta('app.html');

  const opciones = {
    body: cuerpo,
    icon: icono,
    badge: badge,
    tag: tag,
    renotify: payload.renotify !== false,
    silent: false,
    requireInteraction: !!payload.requireInteraction || tipo === 'nuevo_viaje',
    vibrate: Array.isArray(payload.vibrate) ? payload.vibrate : [350, 120, 350, 120, 600],
    timestamp: Date.now(),
    data: {
      tipo: tipo,
      viaje_id: viajeId,
      estado: estado,
      url: destinoUrl
    }
  };

  event.waitUntil((async () => {
    // 1) Avisar a cualquier pestaña abierta de TOLITECNO (para sonido + refresco inmediato)
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let hayVentanaEnFoco = false;
    for (const cliente of ventanas) {
      if (cliente.focused && cliente.visibilityState === 'visible') hayVentanaEnFoco = true;
      try {
        if (tipo === 'nuevo_viaje') {
          cliente.postMessage({ tipo: 'push-viaje', viaje_id: viajeId, estado: estado });
        } else if (tipo === 'estado_viaje') {
          cliente.postMessage({ tipo: 'push-estado', viaje_id: viajeId, estado: estado });
        } else {
          cliente.postMessage({ tipo: 'abrir-viaje', viaje_id: viajeId, estado: estado });
        }
      } catch (e) {}
    }

    // 2) Mostrar SIEMPRE en el cajón de notificaciones del móvil (requisito userVisibleOnly: true)
    await self.registration.showNotification(titulo, opciones);
  })());
});

/* ================= CLIC EN LA NOTIFICACIÓN ================= */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const destino = data.url ? urlAbsoluta(data.url) : urlAbsoluta('app.html');

  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const cliente of ventanas) {
      if (cliente.url === destino && 'focus' in cliente) {
        try { cliente.postMessage({ tipo: 'abrir-viaje', viaje_id: data.viaje_id || null }); } catch (e) {}
        return cliente.focus();
      }
    }
    for (const cliente of ventanas) {
      if (cliente.url.startsWith(urlAbsoluta('./')) && 'focus' in cliente) {
        try {
          if ('navigate' in cliente) await cliente.navigate(destino);
          cliente.postMessage({ tipo: 'abrir-viaje', viaje_id: data.viaje_id || null });
        } catch (e) {}
        return cliente.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(destino);
  })());
});

/* ================= RENOVACIÓN AUTOMÁTICA DE SUSCRIPCIÓN PUSH ================= */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const cliente of ventanas) {
      try { cliente.postMessage({ tipo: 'renovar-push' }); } catch (e) {}
    }
  })());
});
