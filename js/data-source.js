/* ==========================================================
   Camión En Ruta · acceso a datos
   ÚNICO lugar que sabe de dónde vienen los datos. El resto de
   la página solo llama a estas funciones, así cambiar de archivos
   JSON a base de datos no rompe nada más.

   Contrato (igual para "json" y "supabase"):
     calles()    -> GeoJSON FeatureCollection de TRAMOS; properties { id, nombre, calle, calle_id, carril, ruta, orden }
                    (`calle` = nombre de la calle completa; `nombre` = nombre del tramo, ej. "Calle Unión · entre A y B")
     estados()   -> { actualizado, origen, estados: { "<id calle>": "gris|amarillo|verde|negro" } }
                    origen: "horario" (estimado con la hora) | "gps" (con la ubicación del camión) | "mixto"
     horarios()  -> { nota, rutas: [ { ruta, dias, horario, calles: [...] } ] }
     zona()      -> GeoJSON del cuadrado delimitado (Polygon) o null si no hay
     camion()    -> { lat, lng, actualizado } o null (null si la posición es vieja)
     suscribir(cb) (opcional) -> llama cb() cuando llega una posición nueva del camión

   Cómo se calcula el estado de cada ruta:
     1. Base: se estima con la hora y la tabla `horarios` (Estado.estimarPorHorario).
     2. Con GPS (cfg.gpsActivo): manda el AVANCE REAL que guarda la app del conductor en la
        tabla `avance_tramos` (qué tramos recorrió de verdad hoy). Verde = el camión está ahí,
        negro = la recorrió casi completa, gris = aún no. No se usa el orden de las calles ni
        se marca amarillo, porque el orden oficial de la ruta todavía no se conoce.
   ========================================================== */
(function () {
  const cfg = window.APP_CONFIG;
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const vigenciaMs = () => (cfg.gpsVigenciaSegundos || 120) * 1000;

  async function leerJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("No se pudo cargar " + url + " (" + r.status + ")");
    return r.json();
  }

  // Un Feature puede traer LineString o MultiLineString: siempre devolvemos una lista de tramos.
  const lineasDe = (g) => (g.type === "MultiLineString" ? g.coordinates : [g.coordinates]);

  // Estimación por horario de una ruta. Devuelve { fase, orden, origen }.
  //   callesRuta: [{id, orden}] ; horariosRuta: [{dias, hora_inicio, hora_fin}]
  function estadoPorHorario(ahora, callesRuta, horariosRuta) {
    const e = Estado.estimarPorHorario(ahora, horariosRuta, callesRuta.length, cfg.avisoMinutos);
    return { fase: e.fase, orden: e.orden, origen: "horario" };
  }

  // Fecha local "AAAA-MM-DD" (el avance de las calles vale solo para el día de hoy).
  const diaLocal = (d) => {
    const x = new Date(d);
    return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  };

  function resumir(estados, origenes, gpsFechas) {
    const fechas = gpsFechas.filter(Boolean).sort();
    return {
      actualizado: fechas.length ? fechas[fechas.length - 1] : new Date().toISOString(),
      origen: origenes.size === 0 ? "horario" : origenes.size === 1 ? [...origenes][0] : "mixto",
      estados
    };
  }

  // ---------- Fuente 1: archivos JSON en /data ----------
  // tramos.geojson: properties { id, nombre, calle, ruta, orden }.  horarios.json: ver `programa` en cada ruta.
  const fuenteJSON = {
    calles:   () => leerJSON("data/tramos.geojson"),
    zona:     () => leerJSON("data/zona.geojson").catch(() => null),
    horarios: () => leerJSON("data/horarios.json"),
    camion:   async () => null,
    async estados() {
      const [c, h] = await Promise.all([leerJSON("data/tramos.geojson"), leerJSON("data/horarios.json")]);
      const ahora = new Date();
      const estados = {}, origenes = new Set();
      (h.rutas || []).forEach((r) => {
        const feats = c.features
          .filter((f) => f.properties.ruta === r.ruta)
          .sort((a, b) => (a.properties.orden || 0) - (b.properties.orden || 0));
        const callesRuta = feats.map((f, i) => ({ id: f.properties.id, orden: f.properties.orden || i + 1 }));
        const e = estadoPorHorario(ahora, callesRuta, r.programa || []);
        Object.assign(estados, Estado.estadosDeRuta(callesRuta, e.fase, e.orden, r.proximas));
        origenes.add(e.origen);
      });
      return resumir(estados, origenes, []);
    }
  };

  // ---------- Fuente 2: Supabase (Postgres + tiempo real) ----------
  function crearFuenteSupabase() {
    const sc = cfg.supabase || {};
    if (!window.supabase) throw new Error("No se cargó la librería de Supabase (revisa el <script> en index.html).");
    if (!sc.url || !sc.anonKey) throw new Error("Falta supabase.url y supabase.anonKey en js/config.js (ver GUIA.md, paso 4).");
    const sb = window.supabase.createClient(sc.url, sc.anonKey);

    const chk = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

    // Calles, rutas y horarios casi no cambian: se piden una vez.
    let estaticos = null;
    function cargarEstaticos() {
      if (!estaticos) {
        estaticos = Promise.all([
          sb.from("calles").select("id,nombre,tipo"),
          sb.from("tramos").select("id,calle_id,nombre,carril,k,geom"),
          sb.from("rutas").select("id,nombre,proximas"),
          sb.from("ruta_tramos").select("ruta_id,tramo_id,orden"),
          sb.from("horarios").select("ruta_id,dias,hora_inicio,hora_fin")
        ]).then((r) => ({ calles: chk(r[0]), tramos: chk(r[1]), rutas: chk(r[2]), rt: chk(r[3]), horarios: chk(r[4]) }))
          .catch((e) => { estaticos = null; throw e; });
      }
      return estaticos;
    }

    // Tramos de una ruta, en orden de recorrido.
    const tramosDeRuta = (s, rutaId) =>
      s.rt.filter((x) => x.ruta_id === rutaId).sort((a, b) => a.orden - b.orden);

    return {
      async calles() {
        const s = await cargarEstaticos();
        const rutaDe = {}, ordenDe = {}, calleDe = {};
        s.rt.forEach((x) => { if (!rutaDe[x.tramo_id]) { rutaDe[x.tramo_id] = x.ruta_id; ordenDe[x.tramo_id] = x.orden; } });
        s.calles.forEach((c) => { calleDe[c.id] = c.nombre; });
        return {
          type: "FeatureCollection",
          // Un Feature por TRAMO; `calle` es el nombre de la calle completa (la lista lateral agrupa por él).
          features: s.tramos.map((t) => ({
            type: "Feature",
            properties: { id: t.id, nombre: t.nombre, calle: calleDe[t.calle_id] || Estado.nombreBase(t.nombre),
                          calle_id: t.calle_id, carril: t.carril || "", ruta: rutaDe[t.id] || "", orden: ordenDe[t.id] || 0 },
            geometry: t.geom
          })).sort((a, b) => (a.properties.orden || 1e9) - (b.properties.orden || 1e9))   // en orden de recorrido
        };
      },

      // Aquí se aplica el algoritmo de colores (js/estado.js) a cada ruta.
      async estados() {
        const s = await cargarEstaticos();
        const pos = chk(await sb.from("posicion_camion").select("*"));
        let avance = [];
        if (cfg.gpsActivo) {
          // Si la tabla aún no existe (falta db/migracion_03_calles_y_tramos.sql), se sigue sin ella.
          const r = await sb.from("avance_tramos").select("ruta_id,tramo_id,estado,actualizado");
          if (r.error) console.warn("Sin tabla avance_tramos:", r.error.message);
          else avance = r.data || [];
        }

        const ahora = new Date();
        const hoy = diaLocal(ahora);
        const estados = {}, origenes = new Set(), gpsFechas = [];
        s.rutas.forEach((ruta) => {
          const callesRuta = tramosDeRuta(s, ruta.id).map((x) => ({ id: x.tramo_id, orden: x.orden }));   // cada elemento es un tramo
          const p = pos.find((x) => x.ruta_id === ruta.id);
          const fresca = !!p && ahora - new Date(p.actualizado) <= vigenciaMs();
          const filasHoy = avance.filter((f) => f.ruta_id === ruta.id && diaLocal(f.actualizado) === hoy);

          if (cfg.gpsActivo && (filasHoy.length || fresca)) {
            // Avance real del camión (lo escribe la app del conductor).
            Object.assign(estados, Estado.estadosPorAvance(callesRuta, filasHoy, fresca));
            origenes.add("gps");
            gpsFechas.push(fresca ? p.actualizado : filasHoy.map((f) => f.actualizado).sort().pop());
          } else {
            const e = estadoPorHorario(ahora, callesRuta, s.horarios.filter((h) => h.ruta_id === ruta.id));
            Object.assign(estados, Estado.estadosDeRuta(callesRuta, e.fase, e.orden, ruta.proximas));
            origenes.add(e.origen);
          }
        });
        return resumir(estados, origenes, gpsFechas);
      },

      async zona() {
        const r = await sb.from("zonas").select("id,nombre,geom").limit(1);
        if (r.error || !r.data.length) return null; // sin tabla o sin filas: la página funciona igual
        return { type: "FeatureCollection", features: [{ type: "Feature", properties: { nombre: r.data[0].nombre }, geometry: r.data[0].geom }] };
      },

      async horarios() {
        const s = await cargarEstaticos();
        const nombreCalle = {}, calleDeTramo = {};
        s.calles.forEach((c) => { nombreCalle[c.id] = c.nombre; });
        s.tramos.forEach((t) => { calleDeTramo[t.id] = t.calle_id; });
        return {
          nota: s.horarios.length
            ? "Horarios cargados desde la base de datos."
            : "El horario oficial de esta zona aún está pendiente de confirmar con la municipalidad.",
          rutas: s.rutas.map((r) => {
            const hs = s.horarios.filter((h) => h.ruta_id === r.id);
            return {
              ruta: r.nombre,
              dias: hs.map((h) => h.dias.map((d) => DIAS[d]).join(", ")).join(" / ") || "—",
              horario: hs.map((h) => h.hora_inicio.slice(0, 5) + " – " + h.hora_fin.slice(0, 5)).join(" / ") || "—",
              // Cada calle una sola vez (aunque tenga varios tramos).
              calles: [...new Set(tramosDeRuta(s, r.id).map((x) => nombreCalle[calleDeTramo[x.tramo_id]]).filter(Boolean))]
            };
          })
        };
      },

      // Última posición conocida, solo si es reciente (una posición vieja no se dibuja).
      async camion() {
        const r = chk(await sb.from("posicion_camion").select("*").order("actualizado", { ascending: false }).limit(1));
        if (!r[0] || new Date() - new Date(r[0].actualizado) > vigenciaMs()) return null;
        return { lat: r[0].lat, lng: r[0].lng, actualizado: r[0].actualizado };
      },

      // Tiempo real: Supabase avisa cuando cambia la posición del camión o el avance de las calles.
      suscribir(callback) {
        sb.channel("camion-en-ruta")
          .on("postgres_changes", { event: "*", schema: "public", table: "posicion_camion" }, callback)
          .on("postgres_changes", { event: "*", schema: "public", table: "avance_tramos" }, callback)
          .subscribe();
      }
    };
  }

  window.AppData = cfg.fuente === "supabase" ? crearFuenteSupabase() : fuenteJSON;
})();
