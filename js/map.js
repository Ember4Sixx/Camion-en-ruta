/* ==========================================================
    Camión En Ruta · mapa (Leaflet con Movimiento Horizontal Fijo)
    ========================================================== */
(function () {
  const cfg = window.APP_CONFIG;
  let mapa, capaCalles, capaZona, marcadorCamion;
  const capasPorId = {};      
  const nombrePorId = {};     
  const estadoPorId = {};     
  let posicionAnterior = null;
  let ultimoAngulo = 0;       
  let latBase = null;         // Guarda la latitud inicial de la ruta para mantenerlo horizontal

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

  function mostrarCamion(pos) {
    if (!pos) {  
      if (marcadorCamion) { marcadorCamion.remove(); marcadorCamion = null; }  
      posicionAnterior = null;
      ultimoAngulo = 0;
      latBase = null;
      return;  
    }

    // Fijar la latitud en el primer punto que reciba para evitar saltos verticales
    if (latBase === null) {
      latBase = pos.lat;
    }

    const ll = [latBase, pos.lng];
    let escalaX = 1;

    if (posicionAnterior) {
      const dLng = pos.lng - posicionAnterior.lng;
      if (dLng !== 0) {
        escalaX = dLng > 0 ? -1 : 1; // Voltea el camión según avance a derecha o izquierda
      }
    }
    posicionAnterior = { lat: latBase, lng: pos.lng };

    const anguloVisual = 0;
    const transformStyle = `transform: rotate(${anguloVisual}deg) scaleX(${escalaX});`;

    if (!marcadorCamion) {
      marcadorCamion = L.marker(ll, {
        icon: L.divIcon({
          className: "",
          html: `<div style="display: flex; justify-content: center; align-items: center; width: 40px; height: 40px;"><div class="camion-inner" style="font-size: 26px; ${transformStyle} transition: transform 0.2s ease; display: inline-block; line-height: 1;">🚚</div></div>`,
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
      if (elementoDom) {
        const inner = elementoDom.querySelector(".camion-inner");
        if (inner) {
          inner.style.transform = `rotate(${anguloVisual}deg) scaleX(${escalaX})`;
        }
      }
    }
  }

  window.AppMap = { iniciar, pintarZona, pintarCalles, actualizarEstados, enfocarCalle, enfocarCalles, mostrarCamion };
})();
