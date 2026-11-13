/* ==========================================================
   Camión En Ruta · avisos de retraso (vecinos.html)
   Botón "Activar avisos": pide permiso de notificaciones, crea la
   suscripción del navegador y la guarda en Supabase. Desde ese momento
   la función avisar-retrasos puede mandarle avisos aunque la página
   esté cerrada (el service worker sw.js los muestra).
   Necesita en js/config.js:  avisos: { vapidPublica: "..." }
   ========================================================== */
(function () {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const caja = document.getElementById("avisos");
  if (!caja) return;
  const boton = document.getElementById("avisos-boton");
  const estado = document.getElementById("avisos-estado");
  const clave = cfg.avisos && cfg.avisos.vapidPublica;
  const sb = cfg.supabase || {};

  const soporta = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const enPantallaInicio = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function mostrar(texto, opciones) {
    const op = opciones || {};
    estado.textContent = texto;
    estado.className = "avisos-estado" + (op.ok ? " ok" : "") + (op.error ? " error" : "");
    boton.hidden = !op.boton;
    if (op.boton) boton.textContent = op.boton;
    boton.disabled = false;
  }

  // La clave pública VAPID viene en base64url; el navegador la pide como bytes
  function claveEnBytes(b64) {
    const relleno = "=".repeat((4 - (b64.length % 4)) % 4);
    const crudo = atob((b64 + relleno).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(crudo, (c) => c.charCodeAt(0));
  }

  // Llama a una función de Supabase (guardar_suscripcion / borrar_suscripcion)
  async function rpc(nombre, datos) {
    const r = await fetch(sb.url + "/rest/v1/rpc/" + nombre, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: sb.anonKey, Authorization: "Bearer " + sb.anonKey },
      body: JSON.stringify(datos)
    });
    if (!r.ok) throw new Error("Supabase respondió " + r.status);
  }

  async function guardar(sub) {
    const j = sub.toJSON();
    await rpc("guardar_suscripcion", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ruta: null });
  }

  async function registro() {
    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function activar() {
    boton.disabled = true;
    estado.textContent = "Activando…";
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        return mostrar("No diste permiso de notificaciones. Para activarlo: toca el candado junto a la dirección → Notificaciones → Permitir, y vuelve a intentar.", { error: true, boton: "Activar avisos" });
      }
      const reg = await registro();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveEnBytes(clave) });
      await guardar(sub);
      mostrar("Avisos activados. Te llegará una notificación si el camión se retrasa o se adelanta, aunque cierres esta página.", { ok: true, boton: "Desactivar avisos" });
    } catch (e) {
      mostrar("No se pudieron activar los avisos (" + e.message + "). Revisa tu conexión e inténtalo otra vez.", { error: true, boton: "Activar avisos" });
    }
  }

  async function desactivar() {
    boton.disabled = true;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await rpc("borrar_suscripcion", { p_endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      mostrar("Avisos desactivados.", { boton: "Activar avisos" });
    } catch (e) {
      mostrar("No se pudieron desactivar (" + e.message + ").", { error: true, boton: "Desactivar avisos" });
    }
  }

  boton.addEventListener("click", () => {
    if (boton.textContent.indexOf("Desactivar") === 0) desactivar();
    else activar();
  });

  // ---------- Estado inicial ----------
  async function iniciar() {
    if (!clave || !sb.url) return mostrar("Los avisos todavía no están configurados en esta página.");
    if (!soporta) {
      if (esIOS && !enPantallaInicio) {
        return mostrar("En iPhone: toca Compartir → \"Agregar a pantalla de inicio\", abre la página desde ese ícono y activa los avisos ahí.");
      }
      return mostrar("Este navegador no permite notificaciones. Prueba con Chrome en Android.");
    }
    if (Notification.permission === "denied") {
      return mostrar("Bloqueaste las notificaciones de esta página. Para activarlas: candado junto a la dirección → Notificaciones → Permitir, y recarga.", { error: true });
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub && Notification.permission === "granted") {
        guardar(sub).catch(() => {}); // por si se borró en Supabase, se vuelve a guardar
        return mostrar("Avisos activados en este celular.", { ok: true, boton: "Desactivar avisos" });
      }
    } catch (e) { /* sigue abajo */ }
    mostrar("Recibe una notificación si el camión sale tarde o antes de su hora.", { boton: "Activar avisos" });
  }

  iniciar();
})();
