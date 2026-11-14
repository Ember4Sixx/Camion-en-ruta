/* ==========================================================
    Camión En Ruta · mapa (Leaflet; el camión solo mira a la izquierda o a la derecha)
    ========================================================== */
(function () {
  const cfg = window.APP_CONFIG;
  let mapa, capaCalles, capaZona, marcadorCamion, capaAvance;
  const capasPorId = {};      
  const nombrePorId = {};     
  const estadoPorId = {};     
  let posicionAnterior = null;

  function iniciar() {
    mapa = L.map("map", { zoomControl: true }).setView(cfg.centro, cfg.zoom);
    const opcionesTeselas = { maxZoom: 19, keepBuffer: 4, attribution: cfg.teselas.atribucion };
    L.tileLayer(cfg.teselas.url, opcionesTeselas).addTo(mapa);

    if (cfg.teselas.etiquetas) {
      mapa.createPane("nombres");
      mapa.getPane("nombres").style.zIndex = 450;
      mapa.getPane("nombres").style.pointerEvents = "none";
      L.tileLayer(cfg.teselas.etiquetas, { ...opcionesTeselas, pane: "nombres", attribution: "" }).addTo(mapa);
    }
    return mapa;
  }

  function pintarZona(geojson) {
    if (capaZona) capaZona.remove();
    if (!geojson) return;
    capaZona = L.geoJSON(geojson, {
      style: { color: "#14532d", weight: 2, dashArray: "6 6", fillColor: "#2e9e5b", fillOpacity: 0.06, interactive: false }
    }).addTo(mapa);
    capaZona.bringToBack();
    const b = capaZona.getBounds();
    if (b.isValid()) mapa.fitBounds(b.pad(0.1));
  }

  const esCarril = (id) => /· sentido /.test(nombrePorId[id] || "");

  function estilo(estado, id) {
    const e = cfg.estados[estado] || cfg.estados.gris;
    const carril = esCarril(id);
    const esGris = (estado === "gris" || !estado);

    return {
      color: e.color,
      weight: esGris ? (carril ? 2 : 3) : (carril ? 4 : 7), 
      opacity: esGris ? 0.20 : 0.95,
      lineCap: carril ? "butt" : "round",
      lineJoin: "round",
      smoothFactor: 0,
      noClip: true
    };
  }

  function textoPopup(id) {
    const est = cfg.estados[estadoPorId[id]] || cfg.estados.gris;
    const div = document.createElement("div");
    const t = document.createElement("strong");
    t.textContent = nombrePorId[id];
    const p = document.createElement("div");
    p.textContent = est.descripcion;
    div.append(t, p);
    return div;
  }

  // ==========================================================
  // Barra negra animada
  // El negro ("recolección finalizada") no se pinta de golpe: sobre la línea del tramo se dibuja
  // otra línea negra que se va llenando como una barra de carga, desde el extremo por donde entró
  // el camión. Mientras se llena, la línea de abajo sigue con su color anterior (verde o gris);
  // cuando la barra llega al final, el tramo pasa a negro de verdad y la barra se quita.
  // ==========================================================
  const geomPorId = {};   // id -> { pts: [[lat,lng]…], cum: [metros acumulados…], largo }
  const vis = {};         // id -> { base: color que se ve debajo, f: parte negra 0..1, desde, anim, capa }
  let bucle = null;

  const opcionesBarra = () => Object.assign(
    { activa: true, metrosPorSegundo: 12, minSeg: 0.3, maxSeg: 4 }, cfg.barraNegro || {});
  const sinMovimiento = () =>
    !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function prepararGeom(id, geometry) {
    const lineas = geometry.type === "MultiLineString" ? geometry.coordinates : [geometry.coordinates];
    const pts = [];
    lineas.forEach((l) => l.forEach((c) => pts.push([c[1], c[0]])));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + L.latLng(pts[i - 1]).distanceTo(pts[i]));
    geomPorId[id] = { pts, cum, largo: cum[cum.length - 1] || 0 };
  }

  // Parte del tramo que ya está en negro: desde un extremo, f (0 a 1) del largo.
  function recorte(id, desde, f) {
    const g = geomPorId[id];
    if (!g || g.pts.length < 2) return [];
    const fin = desde === "fin";
    const pts = fin ? g.pts.slice().reverse() : g.pts;
    const cum = fin ? g.cum.map((c) => g.largo - c).reverse() : g.cum;
    const meta = Math.max(0, Math.min(1, f)) * g.largo;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] <= meta) { out.push(pts[i]); continue; }
      const t = (meta - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      break;
    }
    return out;
  }

  function cambiarBase(id, e) {
    const v = vis[id];
    if (v.base === e) return;
    v.base = e;
    capasPorId[id].setStyle(estilo(e, id));
  }

  function dibujarBarra(id) {
    const v = vis[id];
    if (!v || !capaAvance) return;
    if (v.base === "negro" || v.f <= 0.001) {
      if (v.capa) { capaAvance.removeLayer(v.capa); v.capa = null; }
      return;
    }
    const pts = recorte(id, v.desde, v.f);
    if (pts.length < 2) return;
    if (!v.capa) {
      v.capa = L.polyline(pts, { ...estilo("negro", id), interactive: false });
      capaAvance.addLayer(v.capa);
    } else {
      v.capa.setLatLngs(pts);
    }
  }

  // Cuando la barra llega al final de un tramo negro, el tramo queda negro de verdad.
  function terminar(id) {
    const v = vis[id];
    if (estadoPorId[id] === "negro" && v.f >= 1) cambiarBase(id, "negro");
  }

  function cuadro(ahora) {
    bucle = null;
    let hayMas = false;
    Object.keys(vis).forEach((id) => {
      const v = vis[id];
      if (!v.anim) return;
      const t = Math.max(0, Math.min(1, (ahora - v.anim.t0) / v.anim.dur));
      v.f = v.anim.de + (v.anim.a - v.anim.de) * t;
      if (t >= 1) { v.f = v.anim.a; v.anim = null; terminar(id); } else { hayMas = true; }
      dibujarBarra(id);
    });
    if (hayMas) bucle = requestAnimationFrame(cuadro);
  }

  // Lleva la barra del tramo hasta `a` (0 a 1). Nunca la hace retroceder.
  function moverA(id, a) {
    const v = vis[id], g = geomPorId[id], op = opcionesBarra();
    if (v.anim && Math.abs(v.anim.a - a) < 1e-4) return;          // ya va hacia ahí
    if (!v.anim && Math.abs(v.f - a) < 1e-4) { terminar(id); return; }
    if (!op.activa || sinMovimiento() || !g || !g.largo) {        // sin animación: se pinta de golpe
      v.anim = null; v.f = a; dibujarBarra(id); terminar(id);
      return;
    }
    const metros = Math.max(0, a - v.f) * g.largo;
    const dur = Math.min(op.maxSeg, Math.max(op.minSeg, metros / op.metrosPorSegundo)) * 1000;
    v.anim = { de: v.f, a, t0: performance.now(), dur };
    if (!bucle) bucle = requestAnimationFrame(cuadro);
  }

  // Aplica el estado nuevo de un tramo. progreso: { id: { f, desde } } (solo con GPS).
  function aplicar(id, nuevo, progreso) {
    const v = vis[id];
    estadoPorId[id] = nuevo;
    if (nuevo !== "verde" && nuevo !== "negro") {                // gris o amarillo: sin barra
      v.anim = null; v.f = 0;
      cambiarBase(id, nuevo);
      dibujarBarra(id);
      return;
    }
    const p = progreso && progreso[id];
    if (v.base === "negro" && nuevo === "verde") { v.anim = null; v.f = 0; }   // empieza otra vez
    if (p && p.desde && v.f <= 0.001) v.desde = p.desde;          // si ya hay barra, conserva su sentido
    if (nuevo === "verde") {
      cambiarBase(id, "verde");
      moverA(id, Math.max(v.f, p ? p.f : 0));
    } else if (v.base !== "negro") {
      moverA(id, 1);                                              // la base conserva su color hasta llenarse
    }
  }

  // Estado inicial (al cargar la página): sin animación.
  function fijar(id, estado, progreso) {
    const p = progreso && progreso[id];
    vis[id] = { base: estado, f: estado === "negro" ? 1 : 0, desde: "inicio", anim: null, capa: null };
    if (estado === "verde" && p) { vis[id].f = p.f; vis[id].desde = p.desde || "inicio"; }
  }

  function pintarCalles(geojson, estados, progreso) {
    if (capaCalles) capaCalles.remove();
    if (capaAvance) capaAvance.remove();
    Object.keys(vis).forEach((k) => delete vis[k]);
    capaAvance = L.layerGroup();
    capaCalles = L.geoJSON(geojson, {
      style: (f) => { nombrePorId[f.properties.id] = f.properties.nombre; return estilo((estados && estados[f.properties.id]) || "gris", f.properties.id); },
      onEachFeature: (f, capa) => {
        const id = f.properties.id;
        capasPorId[id] = capa;
        nombrePorId[id] = f.properties.nombre;
        estadoPorId[id] = (estados && estados[id]) || "gris";
        prepararGeom(id, f.geometry);
        fijar(id, estadoPorId[id], progreso);
        capa.bindPopup(() => textoPopup(id));
        capa.bindTooltip(f.properties.nombre, { sticky: true });
      }
    }).addTo(mapa);
    capaAvance.addTo(mapa);   // después de las calles: la barra negra queda encima
    Object.keys(vis).forEach(dibujarBarra);
    if (!capaZona) {
      const b = capaCalles.getBounds();
      if (b.isValid()) mapa.fitBounds(b.pad(0.2));
    }
  }

  function actualizarEstados(estados, progreso) {
    Object.keys(capasPorId).forEach((id) => {
      if (!vis[id]) return;
      aplicar(id, estados[id] || "gris", progreso);
    });
  }

  function enfocarCalle(id) {
    const capa = capasPorId[id];
    if (!capa) return;
    mapa.fitBounds(capa.getBounds().pad(0.8));
    capa.openPopup();
    document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function enfocarCalles(ids) {
    let b = null;
    ids.forEach((id) => {
      const capa = capasPorId[id];
      if (!capa) return;
      const cb = capa.getBounds();
      b = b ? b.extend(cb) : L.latLngBounds(cb.getSouthWest(), cb.getNorthEast());
    });
    if (!b) return;
    mapa.fitBounds(b.pad(0.4));
    document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // El camión SOLO se voltea a la izquierda o a la derecha (nunca se inclina ni se pone de cabeza).
  // El emoji 🚚 mira a la izquierda; para que mire a la derecha se refleja con scaleX(-1).
  // Si el movimiento es casi vertical (subiendo o bajando por una calle), conserva el último lado.
  let mirandoDerecha = false;

  function ladoSegunMovimiento(pos) {
    if (typeof pos.rumbo === "number") {
      const este = Math.sin((pos.rumbo * Math.PI) / 180);   // > 0 va al este (derecha), < 0 al oeste (izquierda)
      if (Math.abs(este) > 0.17) mirandoDerecha = este > 0;  // ~10° de margen para no titilar en calles verticales
      return;
    }
    if (!posicionAnterior) return;
    const dLng = pos.lng - posicionAnterior.lng;
    const dLat = pos.lat - posicionAnterior.lat;
    // Solo voltea si se movió más de ~1 m (temblor del GPS) y no va casi recto al norte o al sur.
    if (Math.abs(dLng) > 0.000008 && Math.abs(dLng) > Math.abs(dLat) * 0.18) mirandoDerecha = dLng > 0;
  }

  function mostrarCamion(pos) {
    if (!pos) {
      if (marcadorCamion) { marcadorCamion.remove(); marcadorCamion = null; }
      posicionAnterior = null;
      return;
    }

    const ll = [pos.lat, pos.lng];
    ladoSegunMovimiento(pos);
    if (!posicionAnterior || Math.abs(pos.lng - posicionAnterior.lng) > 0.000008 || Math.abs(pos.lat - posicionAnterior.lat) > 0.000008) {
      posicionAnterior = { lat: pos.lat, lng: pos.lng };
    }
    const transform = `scaleX(${mirandoDerecha ? -1 : 1})`;

    if (!marcadorCamion) {
      marcadorCamion = L.marker(ll, {
        icon: L.divIcon({
          className: "",
          html: `<div style="display: flex; justify-content: center; align-items: center; width: 40px; height: 40px;"><div class="camion-inner" style="font-size: 26px; transform: ${transform}; transition: transform 0.2s ease; display: inline-block; line-height: 1;">🚚</div></div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        }),
        title: "Camión recolector",
        zIndexOffset: 1000,
        interactive: false
      }).addTo(mapa);
    } else {
      marcadorCamion.setLatLng(ll);
      const elementoDom = marcadorCamion.getElement();
      const inner = elementoDom && elementoDom.querySelector(".camion-inner");
      if (inner) inner.style.transform = transform;
    }
  }

  window.AppMap = { iniciar, pintarZona, pintarCalles, actualizarEstados, enfocarCalle, enfocarCalles, mostrarCamion };
})();
