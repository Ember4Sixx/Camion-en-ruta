/* ==========================================================
   Camión En Ruta · app del conductor
   1. Lee el GPS del celular y guarda la posición del camión en la
      tabla `posicion_camion` (una fila por ruta).
   2. Anota qué partes de cada calle recorrió de verdad el camión y lo
      guarda en la tabla `avance_calles` (una fila por calle). Con eso
      el mapa pinta:  verde = el camión está ahí,
                      negro = la recorrió casi completa y ya salió,
                      gris  = todavía no.
   Usa la configuración del proyecto (js/config.js) y las funciones de
   geometría de js/estado.js.
   ========================================================== */
(function () {
  "use strict";

  const cfg = window.APP_CONFIG;
  const ENVIAR_CADA_MS = 5000;    // cada cuántos milisegundos se envía la posición y el avance
  const PASO_PUNTOS_M = 8;        // cada calle se divide en puntos de control cada 8 m
  const RADIO_RECORRIDO_M = 15;   // un punto de control queda "recorrido" si el camión pasa a menos de 15 m
  const PRECISION_MAX_M = 35;     // lecturas del GPS menos precisas que esto no cuentan para el avance
  const SALTO_MAX_M = 80;         // si entre dos lecturas hay más de 80 m, no se rellena el tramo intermedio
  const UMBRAL_COMPLETA = 0.8;    // una calle está terminada (negro) cuando se recorrió el 80 %

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
  if (!window.Estado) {
    msg("No se pudo cargar js/estado.js. Recarga la página.", true);
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

  // Avance por calle
  let calles = [];         // [{id, nombre, lineas, puntos, visitados, estado, cambio}]
  let avanceListo = false; // true cuando ya se cargaron las calles de la ruta
  let actualId = null;     // calle donde está el camión ahora
  let ultimoPunto = null;  // última lectura buena del GPS (para rellenar tramos)
  let guardando = false;

  const recorriendo = () => watchId !== null;
  const lineasDe = (g) => (g.type === "MultiLineString" ? g.coordinates : [g.coordinates]);
  const inicioDeHoy = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

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

  // ==========================================================
  // AVANCE POR CALLE
  // ==========================================================

  // Carga las calles de la ruta y lo que ya se avanzó hoy (por si se recargó la página).
  async function prepararAvance() {
    avanceListo = false;
    calles = [];
    actualId = null;
    ultimoPunto = null;

    const rc = await sb.from("ruta_calles").select("calle_id,orden").eq("ruta_id", rutaId);
    if (rc.error) throw new Error("No se pudieron cargar las calles de la ruta: " + rc.error.message);
    const ids = rc.data.map((x) => x.calle_id);
    if (!ids.length) throw new Error("Esta ruta no tiene calles cargadas.");

    const cs = await sb.from("calles").select("id,nombre,geom").in("id", ids);
    if (cs.error) throw new Error("No se pudieron cargar las calles: " + cs.error.message);
    calles = cs.data.map((c) => {
      const lineas = lineasDe(c.geom);
      const puntos = Estado.muestrearCalle(lineas, PASO_PUNTOS_M);
      return { id: c.id, nombre: c.nombre, lineas, puntos, visitados: new Array(puntos.length).fill(0), estado: "gris", cambio: false };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    // Lo de días anteriores se borra; lo de hoy se continúa.
    const borrar = await sb.from("avance_calles").delete().eq("ruta_id", rutaId).lt("actualizado", inicioDeHoy());
    if (borrar.error) throw new Error("Falta crear la tabla avance_calles en Supabase (archivo db/migracion_02_avance_calles.sql).");
    const av = await sb.from("avance_calles").select("calle_id,estado,tramos").eq("ruta_id", rutaId);
    if (av.error) throw new Error("No se pudo leer el avance: " + av.error.message);
    av.data.forEach((f) => {
      const c = calles.find((x) => x.id === f.calle_id);
      if (!c) return;
      if (f.tramos && f.tramos.length === c.visitados.length) c.visitados = f.tramos.split("").map((x) => (x === "1" ? 1 : 0));
      c.estado = Estado.estadoPorAvance(false, Estado.fraccion(c.visitados), UMBRAL_COMPLETA);
      if (c.estado !== f.estado) c.cambio = true; // por ejemplo, quedó "verde" de antes
    });

    avanceListo = true;
    pintarAvance();
  }

  // Recalcula el color de cada calle y marca las que cambiaron.
  function recalcular() {
    calles.forEach((c) => {
      const e = Estado.estadoPorAvance(c.id === actualId, Estado.fraccion(c.visitados), UMBRAL_COMPLETA);
      if (e !== c.estado) { c.estado = e; c.cambio = true; }
    });
  }

  // Cada lectura del GPS: marca lo recorrido y decide en qué calle está el camión.
  function procesarLectura(p) {
    if (!avanceListo) return;
    const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
    if (p.coords.accuracy > PRECISION_MAX_M) {
      $("#d-calle").textContent = "Señal imprecisa (no cuenta para el avance)";
      return;
    }
    const tramo = ultimoPunto && Estado.distanciaM(ultimoPunto, pos) <= SALTO_MAX_M
      ? Estado.puntosEntre(ultimoPunto, pos, 5)
      : [pos];
    ultimoPunto = pos;

    calles.forEach((c) => {
      let nuevos = 0;
      tramo.forEach((q) => { nuevos += Estado.marcarCercanos(c.puntos, c.visitados, q, RADIO_RECORRIDO_M); });
      if (nuevos) c.cambio = true;
    });
    actualId = Estado.calleActual(pos, calles, actualId, cfg.umbralGpsMetros || 40, 8);
    recalcular();
    pintarAvance();
  }

  // Guarda en Supabase solo las calles que cambiaron.
  async function guardarAvance() {
    if (!avanceListo || guardando) return;
    const cambiadas = calles.filter((c) => c.cambio);
    if (!cambiadas.length) return;
    guardando = true;
    cambiadas.forEach((c) => { c.cambio = false; });
    const ahora = new Date().toISOString();
    const { error } = await sb.from("avance_calles").upsert(
      cambiadas.map((c) => ({
        ruta_id: rutaId,
        calle_id: c.id,
        estado: c.estado,
        avance: Math.round(Estado.fraccion(c.visitados) * 100) / 100,
        tramos: c.visitados.join(""),
        actualizado: ahora
      })),
      { onConflict: "ruta_id,calle_id" }
    );
    guardando = false;
    if (error) {
      cambiadas.forEach((c) => { c.cambio = true; }); // se reintenta en el próximo envío
      msg("No se pudo guardar el avance de las calles: " + error.message, true);
    }
  }

  // Muestra en pantalla la calle actual y el avance de cada calle.
  function pintarAvance() {
    const actual = calles.find((c) => c.id === actualId);
    $("#d-calle").textContent = actual ? actual.nombre : (recorriendo() ? "Fuera de la ruta" : "—");
    const terminadas = calles.filter((c) => c.estado === "negro").length;
    $("#d-terminadas").textContent = terminadas + " de " + calles.length;

    const lista = $("#lista-calles");
    lista.textContent = "";
    calles.forEach((c) => {
      const li = document.createElement("li");
      const nombre = document.createElement("span");
      nombre.textContent = c.nombre;
      const pct = document.createElement("span");
      pct.className = "badge badge-" + c.estado;
      pct.textContent = Math.round(Estado.fraccion(c.visitados) * 100) + " %";
      li.append(nombre, pct);
      lista.append(li);
    });
  }

  // Borra el avance de hoy de la ruta elegida (para empezar de cero).
  $("#b-reiniciar").addEventListener("click", async () => {
    if (recorriendo()) return msg("Primero detén el recorrido.", true);
    if (!rutaId) return;
    if (!confirm("¿Borrar el avance de hoy de esta ruta? Todas sus calles volverán a gris en el mapa.")) return;
    const { error } = await sb.from("avance_calles").delete().eq("ruta_id", rutaId);
    if (error) return msg("No se pudo borrar: " + error.message, true);
    calles.forEach((c) => { c.visitados.fill(0); c.estado = "gris"; c.cambio = false; });
    pintarAvance();
    msg("Avance de hoy borrado. Las calles de esta ruta están en gris otra vez.");
  });

  // ==========================================================
  // ENVÍO DE LA POSICIÓN
  // ==========================================================
  async function enviar() {
    guardarAvance();
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
  }

  async function iniciar() {
    if (!rutaId) return msg("Elige una ruta primero.", true);
    if (!navigator.geolocation) return msg("Este celular o navegador no tiene GPS disponible.", true);
    if (!window.isSecureContext) return msg("El GPS solo funciona con https:// (o en localhost). Abre la página publicada.", true);

    $("#b-recorrido").disabled = true;
    msg("Cargando las calles de la ruta…");
    try {
      await prepararAvance();
      msg("");
    } catch (e) {
      // Sin avance igual se manda la posición, pero las calles no cambiarán de color.
      msg("Aviso: " + e.message + " Se enviará solo la ubicación.", true);
    }
    $("#b-recorrido").disabled = false;

    contador = 0;
    ultimaPos = null;
    gpsFalla = false;
    $("#d-contador").textContent = "0";
    $("#d-envio").textContent = "—";
    $("#d-precision").textContent = "—";
    ponerEstado("espera", "Buscando señal GPS…");

    watchId = navigator.geolocation.watchPosition(
      (p) => {
        const primera = ultimaPos === null;
        ultimaPos = p;
        if (gpsFalla) msg(""); // la señal volvió: se quita el aviso de error
        gpsFalla = false;
        $("#d-precision").textContent = "±" + Math.round(p.coords.accuracy) + " m";
        procesarLectura(p);
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
    $("#b-reiniciar").disabled = true;
    $("#b-recorrido").textContent = "■ Detener recorrido";
    $("#b-recorrido").classList.add("activo");
  }

  function detener() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (timerId !== null) clearInterval(timerId);
    watchId = null;
    timerId = null;
    // La calle donde estaba el camión deja de estar en verde: queda negra si se completó, gris si no.
    actualId = null;
    ultimoPunto = null;
    if (avanceListo) { recalcular(); pintarAvance(); guardarAvance(); }
    soltarPantalla();
    ponerEstado("", "Detenido");
    $("#ruta").disabled = false;
    $("#b-reiniciar").disabled = false;
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
