/* ==========================================================
   Camión En Ruta · app del conductor
   Lee el GPS del celular y guarda la posición del camión en la
   tabla `posicion_camion` de Supabase (una fila por ruta).
   Usa la misma configuración que el resto del proyecto (js/config.js).
   ========================================================== */
(function () {
  "use strict";

  const cfg = window.APP_CONFIG;
  const ENVIAR_CADA_MS = 5000;     // cada cuántos milisegundos se envía la posición

  const $ = (s) => document.querySelector(s);
  const msg = (texto, esError) => { $("#msg").textContent = texto || ""; $("#msg").className = esError ? "error" : ""; };

  // ---------- Revisar configuración ----------
  if (!cfg || !cfg.supabase || !cfg.supabase.url || !cfg.supabase.anonKey) {
    msg("Falta configurar supabase.url y supabase.anonKey en js/config.js.", true);
    return;
  }
  if (!window.supabase) {
    msg("No se pudo cargar Supabase. Revisa tu conexión a internet y recarga la página.", true);
    return;
  }
  const sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);

  // ---------- Estado de la app ----------
  let rutaId = null;
  let watchId = null;      // id del seguimiento del GPS
  let timerId = null;      // id del envío cada 5 s
  let ultimaPos = null;    // última lectura del GPS
  let gpsFalla = false;    // true si el GPS reportó un problema y aún no se recupera
  let enviando = false;
  let contador = 0;
  let wakeLock = null;     // bloqueo para que la pantalla no se apague

  const recorriendo = () => watchId !== null;

  // ---------- Pantallas ----------
  function mostrar(conSesion) {
    $("#login").hidden = conSesion;
    $("#panel").hidden = !conSesion;
  }

  function ponerEstado(tipo, texto) {
    $("#luz").className = "luz " + (tipo || "");
    $("#estado-texto").textContent = texto;
  }

  // ---------- Rutas ----------
  async function cargarRutas() {
    const { data, error } = await sb.from("rutas").select("id,nombre").order("nombre");
    if (error) return msg("No se pudieron cargar las rutas: " + error.message, true);
    const sel = $("#ruta");
    sel.textContent = "";
    data.forEach((r) => {
      const o = document.createElement("option");
      o.value = r.id;
      o.textContent = r.nombre;
      sel.append(o);
    });
    if (!data.length) {
      $("#b-recorrido").disabled = true;
      return msg("No hay rutas en la base de datos. Avísale al equipo.", true);
    }
    // Recordar la última ruta usada en este celular
    let guardada = null;
    try { guardada = localStorage.getItem("conductor_ruta"); } catch (e) { /* sin almacenamiento */ }
    rutaId = data.some((r) => r.id === guardada) ? guardada : data[0].id;
    sel.value = rutaId;
    $("#b-recorrido").disabled = false;
    msg("");
  }

  $("#ruta").addEventListener("change", (e) => {
    rutaId = e.target.value;
    try { localStorage.setItem("conductor_ruta", rutaId); } catch (err) { /* sin almacenamiento */ }
  });

  // ---------- Pantalla encendida (Screen Wake Lock) ----------
  async function pedirPantallaEncendida() {
    if (!("wakeLock" in navigator)) {
      $("#d-pantalla").textContent = "No disponible en este navegador";
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      $("#d-pantalla").textContent = "Sí";
      wakeLock.addEventListener("release", () => {
        if (recorriendo()) $("#d-pantalla").textContent = "No (vuelve a abrir la página)";
      });
    } catch (e) {
      $("#d-pantalla").textContent = "No (el navegador no lo permitió)";
    }
  }

  function soltarPantalla() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    $("#d-pantalla").textContent = "—";
  }

  // Cuando el conductor vuelve a la página, se pide otra vez la pantalla encendida
  document.addEventListener("visibilitychange", () => {
    if (!recorriendo()) return;
    if (document.visibilityState === "visible") {
      pedirPantallaEncendida();
      ponerEstado("espera", "Retomando…");
    } else {
      ponerEstado("espera", "En pausa: la página no está abierta");
    }
  });

  // ---------- Envío de la posición ----------
  async function enviar() {
    if (enviando || !ultimaPos) return;
    if (gpsFalla) return; // sin señal GPS no se envía nada (para no mostrar una posición falsa)
    enviando = true;
    const { error } = await sb.from("posicion_camion").upsert(
      {
        ruta_id: rutaId,
        lat: ultimaPos.coords.latitude,
        lng: ultimaPos.coords.longitude,
        // Si el camión está detenido, el GPS no da lecturas nuevas pero la posición sigue siendo válida
        actualizado: new Date().toISOString()
      },
      { onConflict: "ruta_id" } // actualiza la misma fila, no crea filas nuevas
    );
    enviando = false;
    if (!recorriendo()) return;
    if (error) {
      ponerEstado("error", "Error al enviar (se reintenta solo)");
      msg("Detalle: " + error.message, true);
      return;
    }
    contador++;
    $("#d-contador").textContent = contador;
    $("#d-envio").textContent = new Date().toLocaleTimeString("es-PE");
    ponerEstado("ok", "Enviando ubicación");
    msg("");
  }

  function iniciar() {
    if (!rutaId) return msg("Elige una ruta primero.", true);
    if (!navigator.geolocation) return msg("Este celular o navegador no tiene GPS disponible.", true);
    if (!window.isSecureContext) return msg("El GPS solo funciona con https:// (o en localhost). Abre la página publicada.", true);

    contador = 0;
    ultimaPos = null;
    gpsFalla = false;
    $("#d-contador").textContent = "0";
    $("#d-envio").textContent = "—";
    $("#d-precision").textContent = "—";
    ponerEstado("espera", "Buscando señal GPS…");
    msg("");

    watchId = navigator.geolocation.watchPosition(
      (p) => {
        const primera = ultimaPos === null;
        ultimaPos = p;
        gpsFalla = false;
        $("#d-precision").textContent = "±" + Math.round(p.coords.accuracy) + " m";
        if (primera) enviar(); // la primera posición se manda de inmediato
      },
      (err) => {
        const textos = {
          1: "No diste permiso de ubicación. Actívalo en los ajustes del navegador y vuelve a intentar.",
          2: "No se pudo obtener la ubicación. Revisa que el GPS del celular esté encendido.",
          3: "El GPS tardó demasiado en responder. Se sigue intentando…"
        };
        if (err.code === 1) { detener(); }
        else { gpsFalla = true; ponerEstado("espera", "Esperando señal GPS…"); }
        msg(textos[err.code] || err.message, true);
      },
      { enableHighAccuracy: true, maximumAge: 2000 }
    );
    timerId = setInterval(enviar, ENVIAR_CADA_MS);
    pedirPantallaEncendida();

    $("#ruta").disabled = true;
    $("#b-recorrido").textContent = "■ Detener recorrido";
    $("#b-recorrido").classList.add("activo");
  }

  function detener() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (timerId !== null) clearInterval(timerId);
    watchId = null;
    timerId = null;
    soltarPantalla();
    ponerEstado("", "Detenido");
    $("#ruta").disabled = false;
    $("#b-recorrido").textContent = "▶ Iniciar recorrido";
    $("#b-recorrido").classList.remove("activo");
  }

  $("#b-recorrido").addEventListener("click", () => {
    if (recorriendo()) {
      if (confirm("¿Terminar el recorrido? Se dejará de enviar la ubicación.")) detener();
    } else {
      iniciar();
    }
  });

  // Aviso si se intenta cerrar la página en pleno recorrido
  window.addEventListener("beforeunload", (e) => {
    if (recorriendo()) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- Sesión ----------
  $("#login").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#b-entrar").disabled = true;
    msg("Entrando…");
    const { error } = await sb.auth.signInWithPassword({
      email: $("#email").value.trim(),
      password: $("#password").value
    });
    $("#b-entrar").disabled = false;
    if (error) return msg("No se pudo entrar: revisa tu correo y contraseña.", true);
    $("#password").value = "";
    msg("");
    mostrar(true);
    cargarRutas();
  });

  $("#b-salir").addEventListener("click", async () => {
    if (recorriendo() && !confirm("Hay un recorrido en curso. ¿Detenerlo y cerrar sesión?")) return;
    detener();
    await sb.auth.signOut();
    mostrar(false);
  });

  // Al abrir la página: si ya había sesión, pasa directo al panel
  sb.auth.getSession().then(({ data }) => {
    if (data.session) { mostrar(true); cargarRutas(); }
    else mostrar(false);
  });
})();
