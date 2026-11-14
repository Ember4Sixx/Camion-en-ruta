/* ==========================================================
    Camión En Ruta · mapa (Leaflet; el camión mira hacia donde va: arriba, abajo, izquierda o derecha)
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
  // el camión. El frente de la barra va SIEMPRE en el punto donde se dibuja el camión (se proyecta su
  // posición sobre el tramo), así que los dos avanzan sincronizados. Mientras se llena, la línea de
  // abajo sigue con su color anterior (verde o gris); cuando el camión sale del tramo, la barra se
  // completa y el tramo pasa a negro de verdad.
  // ==========================================================
  const geomPorId = {};   // id -> { pts: [[lat,lng]…], cum: [metros acumulados…], largo }
  const vis = {};         // id -> { base: color que se ve debajo, f: parte negra 0..1, desde, anim, capa }
  let bucle = null;
  let posVisible = null;      // [lat, lng] donde se dibuja el camión ahora mismo
  let tween = null;           // deslizamiento del camión entre dos lecturas: { de, a, t0, dur }
  let ultimaLectura = 0;

  // El negro final se ve con la opacidad de `.leaflet-interactive` (css/styles.css: stroke-opacity 0.75).
  // La barra es opaca, así que se mezcla el negro con el color del fondo del mapa para que, al
  // completarse, el tramo no cambie de tono.
  const OPACIDAD_LINEAS = 0.75;
  const FONDO_MAPA = [220, 220, 217];
  function colorBarra() {
    const hex = (cfg.estados.negro.color || "#1a1a1a").replace("#", "");
    const c = [0, 2, 4].map((i, k) => Math.round(parseInt(hex.substr(i, 2), 16) * OPACIDAD_LINEAS + FONDO_MAPA[k] * (1 - OPACIDAD_LINEAS)));
    return "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
  }

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

  // Punto del tramo más cercano a `ll`: { fraccion: 0 a 1 desde el inicio de la geometría, distancia: metros }.
  function proyectar(g, ll) {
    const ky = 110540, kx = 111320 * Math.cos((ll[0] * Math.PI) / 180);
    let mejor = { fraccion: 0, distancia: Infinity };
    for (let i = 1; i < g.pts.length; i++) {
      const ax = (g.pts[i - 1][1] - ll[1]) * kx, ay = (g.pts[i - 1][0] - ll[0]) * ky;
      const bx = (g.pts[i][1] - ll[1]) * kx, by = (g.pts[i][0] - ll[0]) * ky;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < mejor.distancia) mejor = { fraccion: (g.cum[i - 1] + t * (g.cum[i] - g.cum[i - 1])) / (g.largo || 1), distancia: d };
    }
    return mejor;
  }

  // Dónde debe llegar la barra de un tramo según el camión dibujado, o null si no se puede saber.
  function frenteDelCamion(id) {
    const v = vis[id], g = geomPorId[id];
    if (!v || !v.sigue || !g || !g.largo || !posVisible) return null;
    const pr = proyectar(g, posVisible);
    if (pr.distancia > 40) return null;                    // el camión no está sobre este tramo
    return v.desde === "fin" ? 1 - pr.fraccion : pr.fraccion;
  }

  // Lleva el frente de la barra (de los tramos verdes) hasta el camión dibujado. Nunca retrocede.
  function sincronizar() {
    Object.keys(vis).forEach((id) => {
      if (estadoPorId[id] !== "verde") return;
      const fc = frenteDelCamion(id);
      if (fc === null) return;
      const v = vis[id];
      if (fc > v.f) { v.anim = null; v.f = fc; dibujarBarra(id); }
    });
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
      v.capa = L.polyline(pts, { ...estilo("negro", id), color: colorBarra(), opacity: 1, interactive: false });
      capaAvance.addLayer(v.capa);
    } else {
      v.capa.setLatLngs(pts);
    }
  }

  // Cuando la barra llega al final de un tramo negro, el tramo queda negro de verdad.
  function terminar(id) {
    const v = vis[id];
    if (estadoPorId[id] === "negro" && v.f >= 1) { cambiarBase(id, "negro"); dibujarBarra(id); }   // dibujarBarra quita la barra
  }

  function arrancar() { if (!bucle) bucle = requestAnimationFrame(cuadro); }

  function cuadro(ahora) {
    bucle = null;
    let hayMas = false;
    if (tween && marcadorCamion) {                      // el camión se desliza hasta su nueva posición
      const t = Math.max(0, Math.min(1, (ahora - tween.t0) / tween.dur));
      posVisible = [tween.de[0] + (tween.a[0] - tween.de[0]) * t, tween.de[1] + (tween.a[1] - tween.de[1]) * t];
      marcadorCamion.setLatLng(posVisible);
      if (t >= 1) tween = null; else hayMas = true;
      sincronizar();                                    // y la barra va con él
    }
    if (gestionarPendientes(ahora)) hayMas = true;
    Object.keys(vis).forEach((id) => {
      const v = vis[id];
      if (!v.anim) return;
      const t = Math.max(0, Math.min(1, (ahora - v.anim.t0) / v.anim.dur));
      v.f = v.anim.de + (v.anim.a - v.anim.de) * t;
      if (t >= 1) { v.f = v.anim.a; v.anim = null; terminar(id); } else { hayMas = true; }
      dibujarBarra(id);
    });
    if (hayMas) arrancar();
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
    arrancar();
  }

  // Tramos que ya terminaron (llegó el estado "negro") pero cuyo camión dibujado todavía no llega al final:
  // la barra lo acompaña hasta el final y entonces se completa. Espera como máximo ESPERA_MAX_MS por si el
  // GPS se corta. Devuelve true si queda alguno esperando (el bucle debe seguir).
  const ESPERA_MAX_MS = 4000;
  function gestionarPendientes(ahora) {
    let quedan = false;
    Object.keys(vis).forEach((id) => {
      const v = vis[id];
      if (v.espera == null) return;
      if (estadoPorId[id] !== "negro" || v.base === "negro") { v.espera = null; return; }
      const fc = frenteDelCamion(id);
      if (fc !== null && fc < 0.98 && ahora - v.espera < ESPERA_MAX_MS) {
        v.anim = null; v.f = Math.max(v.f, fc); dibujarBarra(id); quedan = true;
      } else {
        v.espera = null; v.cerrando = true; moverA(id, 1);
      }
    });
    return quedan;
  }

  // Aplica el estado nuevo de un tramo. progreso: { id: { f, desde } } (solo con GPS).
  function aplicar(id, nuevo, progreso) {
    const v = vis[id];
    estadoPorId[id] = nuevo;
    if (nuevo !== "verde" && nuevo !== "negro") {                // gris o amarillo: sin barra
      v.anim = null; v.f = 0; v.espera = null; v.cerrando = false;
      cambiarBase(id, nuevo);
      dibujarBarra(id);
      return;
    }
    const p = progreso && progreso[id];
    if (v.base === "negro" && nuevo === "verde") { v.anim = null; v.f = 0; }   // empieza otra vez
    if (p && p.desde && v.f <= 0.001) v.desde = p.desde;          // si ya hay barra, conserva su sentido
    if (nuevo === "verde") {
      cambiarBase(id, "verde");
      v.cerrando = false; v.espera = null;
      v.sigue = !!(p && (p.directo || p.visitados > 0));          // hay datos para saber por dónde entró
      const fc = frenteDelCamion(id);
      if (fc !== null) {                                          // la barra llega hasta donde se ve el camión
        v.anim = null; v.f = Math.max(v.f, fc); dibujarBarra(id);
      } else if (p && p.directo) {
        v.anim = null; v.f = Math.max(v.f, p.f); dibujarBarra(id);
      } else {
        moverA(id, Math.max(v.f, p ? p.f : 0));
      }
    } else if (v.base !== "negro" && !v.cerrando) {               // la base conserva su color hasta llenarse
      v.sigue = v.sigue || !!(p && (p.directo || p.visitados > 0));
      const fc = frenteDelCamion(id);
      if (fc !== null && fc < 0.98) {                             // el camión dibujado aún no llega al final: la barra lo espera
        if (v.espera == null) v.espera = performance.now();       // (no se reinicia si el aviso "negro" se repite)
        v.anim = null; v.f = Math.max(v.f, fc); dibujarBarra(id);
        arrancar();
      } else {
        v.espera = null; v.cerrando = true;
        moverA(id, 1);
      }
    }
  }

  // Estado inicial (al cargar la página): sin animación.
  function fijar(id, estado, progreso) {
    const p = progreso && progreso[id];
    vis[id] = { base: estado, f: estado === "negro" ? 1 : 0, desde: "inicio", anim: null, capa: null, sigue: false, espera: null, cerrando: false };
    if (estado === "verde" && p) { vis[id].f = p.f; vis[id].desde = p.desde || "inicio"; vis[id].sigue = !!(p.directo || p.visitados > 0); }
  }

  function pintarCalles(geojson, estados, progreso) {
    if (capaCalles) capaCalles.remove();
    if (capaAvance) capaAvance.remove();
    Object.keys(vis).forEach((k) => delete vis[k]);
    tween = null;
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

  // El camión mira hacia donde va: arriba, abajo, izquierda o derecha (se dibuja en SVG, sin imágenes).
  // El dibujo está visto desde arriba y mirando HACIA ABAJO; para las otras direcciones se gira.
  // Si el camión no se mueve (o el GPS solo tiembla, menos de ~3 m) conserva hacia donde miraba.
  const GIRO = { abajo: 0, izquierda: 90, arriba: 180, derecha: 270 };   // grados (sentido del reloj)
  let direccion = "abajo";
  let giroVisible = 0;           // ángulo acumulado, para que siempre gire por el lado más corto

  const SVG_CAMION =
    '<svg viewBox="0 0 28 44" width="28" height="44" style="display:block;overflow:visible">' +
    '<rect x="0.5" y="8" width="4" height="9" rx="1.5" fill="#1f2937"/><rect x="23.5" y="8" width="4" height="9" rx="1.5" fill="#1f2937"/>' +
    '<rect x="0.5" y="29" width="4" height="9" rx="1.5" fill="#1f2937"/><rect x="23.5" y="29" width="4" height="9" rx="1.5" fill="#1f2937"/>' +
    '<rect x="3" y="1.5" width="22" height="27" rx="3" fill="#f59e0b" stroke="#ffffff" stroke-width="1.6"/>' +
    '<rect x="3" y="1.5" width="22" height="27" rx="3" fill="none" stroke="#92400e" stroke-width="0.8"/>' +
    '<path d="M9 5v20M14 5v20M19 5v20" stroke="#b45309" stroke-width="1" stroke-linecap="round"/>' +
    '<rect x="4" y="28.5" width="20" height="14" rx="4" fill="#2563eb" stroke="#ffffff" stroke-width="1.6"/>' +
    '<rect x="4" y="28.5" width="20" height="14" rx="4" fill="none" stroke="#1e3a8a" stroke-width="0.8"/>' +
    '<rect x="7" y="34" width="14" height="5" rx="1.5" fill="#bfdbfe"/></svg>';

  // Rumbo (0 = norte, 90 = este, 180 = sur, 270 = oeste) -> hacia dónde mira en el mapa.
  function direccionDeRumbo(r) {
    const a = ((r % 360) + 360) % 360;
    if (a >= 45 && a < 135) return "derecha";
    if (a >= 135 && a < 225) return "abajo";
    if (a >= 225 && a < 315) return "izquierda";
    return "arriba";
  }

  function rumboEntre(a, b) {
    const rad = Math.PI / 180, dLon = (b.lng - a.lng) * rad;
    const y = Math.sin(dLon) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function actualizarDireccion(pos) {
    if (typeof pos.rumbo === "number") {
      direccion = direccionDeRumbo(pos.rumbo);
    } else if (posicionAnterior && L.latLng(posicionAnterior.lat, posicionAnterior.lng).distanceTo([pos.lat, pos.lng]) > 3) {
      direccion = direccionDeRumbo(rumboEntre(posicionAnterior, pos));
    }
    if (!posicionAnterior || L.latLng(posicionAnterior.lat, posicionAnterior.lng).distanceTo([pos.lat, pos.lng]) > 3) {
      posicionAnterior = { lat: pos.lat, lng: pos.lng };
    }
    // Gira por el lado más corto (de izquierda a derecha no da la vuelta completa).
    const meta = GIRO[direccion];
    giroVisible += ((meta - giroVisible) % 360 + 540) % 360 - 180;
  }

  function mostrarCamion(pos) {
    if (!pos) {
      if (marcadorCamion) { marcadorCamion.remove(); marcadorCamion = null; }
      posicionAnterior = null; posVisible = null; tween = null;
      return;
    }

    const ll = [pos.lat, pos.lng];
    actualizarDireccion(pos);
    const transform = `rotate(${giroVisible}deg)`;
    const ahora = performance.now();
    const entreLecturas = ahora - ultimaLectura;                 // ms desde la lectura anterior
    ultimaLectura = ahora;

    if (!marcadorCamion) {
      posVisible = ll; tween = null;
      marcadorCamion = L.marker(ll, {
        icon: L.divIcon({
          className: "",
          html: `<div style="display:flex;justify-content:center;align-items:center;width:48px;height:48px;"><div class="camion-inner" style="transform:${transform};transition:transform 0.25s ease;line-height:0;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));">${SVG_CAMION}</div></div>`,
          iconSize: [48, 48],
          iconAnchor: [24, 24]
        }),
        title: "Camión recolector",
        zIndexOffset: 1000,
        interactive: false
      }).addTo(mapa);
      sincronizar();
      return;
    }

    const inner = (marcadorCamion.getElement() || { querySelector: () => null }).querySelector(".camion-inner");
    if (inner) inner.style.transform = transform;

    // Lecturas espaciadas (GPS real): el camión se desliza hasta la nueva posición en vez de saltar.
    // Lecturas continuas (simulación, ~60 por segundo) o un salto grande: se coloca directo.
    const salto = posVisible ? L.latLng(posVisible).distanceTo(ll) : 0;
    const suave = opcionesBarra().activa && !sinMovimiento() && entreLecturas >= 400 && salto > 0.5 && salto < 150;
    if (suave) {
      tween = { de: posVisible.slice(), a: ll, t0: ahora, dur: Math.min(3500, Math.max(800, entreLecturas * 0.8)) };
      arrancar();
    } else {
      tween = null; posVisible = ll;
      marcadorCamion.setLatLng(ll);
      sincronizar();
    }
  }

  window.AppMap = { iniciar, pintarZona, pintarCalles, actualizarEstados, enfocarCalle, enfocarCalles, mostrarCamion };
})();
