/* ==========================================================
    Camión En Ruta · mapa (Leaflet; el camión solo mira a la izquierda o a la derecha)
    ========================================================== */
(function () {
  const cfg = window.APP_CONFIG;
  let mapa, capaCalles, capaZona, marcadorCamion;
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

  function pintarCalles(geojson, estados) {
    if (capaCalles) capaCalles.remove();
    capaCalles = L.geoJSON(geojson, {
      style: (f) => { nombrePorId[f.properties.id] = f.properties.nombre; return estilo((estados && estados[f.properties.id]) || "gris", f.properties.id); },
      onEachFeature: (f, capa) => {
        const id = f.properties.id;
        capasPorId[id] = capa;
        nombrePorId[id] = f.properties.nombre;
        estadoPorId[id] = (estados && estados[id]) || "gris";
        capa.bindPopup(() => textoPopup(id));
        capa.bindTooltip(f.properties.nombre, { sticky: true });
      }
    }).addTo(mapa);
    if (!capaZona) {
      const b = capaCalles.getBounds();
      if (b.isValid()) mapa.fitBounds(b.pad(0.2));
    }
  }

  function actualizarEstados(estados) {
    Object.keys(capasPorId).forEach((id) => {
      const nuevo = estados[id] || "gris";
      estadoPorId[id] = nuevo;
      capasPorId[id].setStyle(estilo(nuevo, id));
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
