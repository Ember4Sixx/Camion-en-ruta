/* ==========================================================
   Camión En Ruta · service worker de los avisos
   Recibe las notificaciones de retraso aunque la página esté cerrada
   y abre vecinos.html cuando el vecino toca la notificación.
   Tiene que estar en la carpeta principal del sitio (junto a vecinos.html).
   ========================================================== */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Llega una notificación desde Supabase (función avisar-retrasos)
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (err) {
    d = { cuerpo: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.titulo || "Camión En Ruta", {
      body: d.cuerpo || "Hay novedades sobre el camión recolector.",
      icon: "conductor/icon-192.png",
      badge: "conductor/icon-192.png",
      tag: d.tag || "camion-en-ruta",     // un aviso nuevo de la misma ruta reemplaza al anterior
      renotify: true,
      data: { url: d.url || "vecinos.html" }
    })
  );
});

// El vecino toca la notificación: abre (o enfoca) la página del mapa
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "vecinos.html", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if (v.url.split("#")[0] === url.split("#")[0] && "focus" in v) return v.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
