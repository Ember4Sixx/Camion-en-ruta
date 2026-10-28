/* ==========================================================
   Camión En Ruta · acceso a datos
   ÚNICO lugar que sabe de dónde vienen los datos. El resto de
   la página solo llama a estas funciones, así cambiar de archivos
   JSON a base de datos no rompe nada más.

   Contrato (igual para "json" y "supabase"):
     calles()    -> GeoJSON FeatureCollection; properties { id, nombre, ruta }
     estados()   -> { actualizado, origen, estados: { "<id calle>": "gris|amarillo|verde|negro" } }
     horarios()  -> { nota, rutas: [ { ruta, dias, horario, calles: [...] } ] }
     zona()      -> GeoJSON del cuadrado delimitado (Polygon) o null si no hay
     camion()    -> { lat, lng, actualizado } o null
     suscribir(cb) (opcional) -> llama cb() cuando la BD cambia
   ========================================================== */
(function () {
  const cfg = window.APP_CONFIG;
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  async function leerJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("No se pudo cargar " + url + " (" + r.status + ")");
    return r.json();
  }

  // ---------- Fuente 1: archivos JSON en /data ----------
  const fuenteJSON = {
    calles:   () => leerJSON("data/calles.geojson"),
    zona:     () => leerJSON("data/zona.geojson").catch(() => null),
    estados:  async () => ({ origen: "manual", ...(await leerJSON("data/estados.json")) }),
    horarios: () => leerJSON("data/horarios.json"),
    camion:   async () => null
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
          sb.from("calles").select("id,nombre,geom"),
          sb.from("rutas").select("id,nombre,proximas"),
          sb.from("ruta_calles").select("ruta_id,calle_id,orden"),
          sb.from("horarios").select("ruta_id,dias,hora_inicio,hora_fin")
        ]).then((r) => ({ calles: chk(r[0]), rutas: chk(r[1]), rc: chk(r[2]), horarios: chk(r[3]) }))
          .catch((e) => { estaticos = null; throw e; });
      }
      return estaticos;
    }

    const coordsDe = (g) => g.type === "MultiLineString" ? [].concat(...g.coordinates) : g.coordinates;
    const callesDeRuta = (s, rutaId) =>
      s.rc.filter((x) => x.ruta_id === rutaId).sort((a, b) => a.orden - b.orden);

    return {
      async calles() {
        const s = await cargarEstaticos();
        const rutaDe = {};
        s.rc.forEach((x) => { if (!rutaDe[x.calle_id]) rutaDe[x.calle_id] = x.ruta_id; });
        return {
          type: "FeatureCollection",
          features: s.calles.map((c) => ({
            type: "Feature",
            properties: { id: c.id, nombre: c.nombre, ruta: rutaDe[c.id] || "" },
            geometry: c.geom
          }))
        };
      },

      // Aquí se aplica el algoritmo de colores (js/estado.js) a cada ruta.
      async estados() {
        const s = await cargarEstaticos();
        const [recs, pos] = await Promise.all([
          sb.from("recorridos").select("*"),
          sb.from("posicion_camion").select("*")
        ]).then((r) => [chk(r[0]), chk(r[1])]);

        const geomPorId = {};
        s.calles.forEach((c) => { geomPorId[c.id] = c.geom; });

        const estados = {};
        const origenes = new Set();
        let ultimo = null;

        s.rutas.forEach((ruta) => {
          const rc = callesDeRuta(s, ruta.id);
          const callesRuta = rc.map((x) => ({ id: x.calle_id, orden: x.orden }));
          const rec = recs.find((r) => r.ruta_id === ruta.id) || { fase: "pendiente", orden_actual: 0, fuente: "manual" };
          let fase = rec.fase, orden = rec.orden_actual;
          const origen = rec.fuente || "manual";

          if (origen === "horario") {
            const e = Estado.estimarPorHorario(
              new Date(), s.horarios.filter((h) => h.ruta_id === ruta.id), callesRuta.length, cfg.avisoMinutos);
            fase = e.fase; orden = e.orden;
          } else if (origen === "gps") {
            const p = pos.find((x) => x.ruta_id === ruta.id);
            if (p && fase === "en_curso") {
              const g = Estado.indicePorGPS(
                { lat: p.lat, lng: p.lng },
                rc.map((x) => ({ id: x.calle_id, orden: x.orden, coords: coordsDe(geomPorId[x.calle_id]) })),
                orden, cfg.umbralGpsMetros);
              if (g) orden = g.orden;
            }
          }

          Object.assign(estados, Estado.estadosDeRuta(callesRuta, fase, orden, ruta.proximas));
          origenes.add(origen);
          if (rec.actualizado && (!ultimo || rec.actualizado > ultimo)) ultimo = rec.actualizado;
        });

        return { actualizado: ultimo, origen: origenes.size === 1 ? [...origenes][0] : "mixto", estados };
      },

      async zona() {
        const r = await sb.from("zonas").select("id,nombre,geom").limit(1);
        if (r.error || !r.data.length) return null; // sin tabla o sin filas: la página funciona igual
        return { type: "FeatureCollection", features: [{ type: "Feature", properties: { nombre: r.data[0].nombre }, geometry: r.data[0].geom }] };
      },

      async horarios() {
        const s = await cargarEstaticos();
        const nombre = {};
        s.calles.forEach((c) => { nombre[c.id] = c.nombre; });
        return {
          nota: "Horarios cargados desde la base de datos.",
          rutas: s.rutas.map((r) => {
            const hs = s.horarios.filter((h) => h.ruta_id === r.id);
            return {
              ruta: r.nombre,
              dias: hs.map((h) => h.dias.map((d) => DIAS[d]).join(", ")).join(" / ") || "—",
              horario: hs.map((h) => h.hora_inicio.slice(0, 5) + " – " + h.hora_fin.slice(0, 5)).join(" / ") || "—",
              calles: callesDeRuta(s, r.id).map((x) => nombre[x.calle_id])
            };
          })
        };
      },

      async camion() {
        const r = chk(await sb.from("posicion_camion").select("*").order("actualizado", { ascending: false }).limit(1));
        return r[0] ? { lat: r[0].lat, lng: r[0].lng, actualizado: r[0].actualizado } : null;
      },

      // Tiempo real: Supabase avisa cuando cambia `recorridos` o `posicion_camion`.
      suscribir(callback) {
        sb.channel("camion-en-ruta")
          .on("postgres_changes", { event: "*", schema: "public", table: "recorridos" }, callback)
          .on("postgres_changes", { event: "*", schema: "public", table: "posicion_camion" }, callback)
          .subscribe();
      }
    };
  }

  window.AppData = cfg.fuente === "supabase" ? crearFuenteSupabase() : fuenteJSON;
})();
