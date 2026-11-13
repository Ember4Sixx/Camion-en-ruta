/* ==========================================================
    Camión En Ruta · mapa (Leaflet con ResizeObserver definitivo)
    ========================================================== */
(function () {
  const cfg = window.APP_CONFIG;
  let mapa, capaCalles, capaZona, marcadorCamion;
  const capasPorId = {};      
  const nombrePorId = {};     
  const estadoPorId = {};     
  let posicionAnterior = null;
  let ultimoAngulo = 0;       

  function iniciar() {
    mapa = L.map("map", { zoomControl: true }).setView(cfg.centro, cfg.zoom);
    const opcionesTeselas = { maxZoom: 19, subdomains: "abc", keepBuffer: 4, attribution: cfg.teselas.atribucion };
    L.tileLayer(cfg.teselas.url, opcionesTeselas).addTo(mapa);

    if (cfg.teselas.etiquetas) {
      mapa.createPane("nombres");
      mapa.getPane("nombres").style.zIndex = 450;
      mapa.getPane("nombres").style.pointerEvents = "none";
      L.tileLayer(cfg.teselas.etiquetas, { ...opcionesTeselas, pane: "nombres", attribution: "" }).addTo(mapa);
    }

    // Forzar redimensionamiento múltiple para sincronizar las teselas
    setTimeout(() => { if (mapa) mapa.invalidateSize(true); }, 100);
    setTimeout(() => { if (mapa) mapa.invalidateSize(true); }, 500);

    // Observador automático de cambios de tamaño en el contenedor `#map`
    const contenedorMapa = document.getElementById("map");
    if (window.ResizeObserver && contenedorMapa) {
      const observer = new ResizeObserver(() => {
        if (mapa) {
          mapa.invalidateSize(true);
        }
      });
      observer.observe(contenedorMapa);
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
    if (b.isValid()) {
      mapa.fitBounds(b.pad(0.1));
      setTimeout(() => mapa.invalidateSize(true), 100);
    }
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
      if (b.isValid()) {
        mapa.fitBounds(b.pad(0.2));
        setTimeout(() => mapa.invalidateSize(true), 100);
      }
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
    mapa.invalidateSize(true);
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
    mapa.invalidateSize(true);
    document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function calcularRumbo(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLon = (lon2 - lon1) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2 * rad);
    const x =
      Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
      Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * (180 / Math.PI);
    return (brng + 360) % 360;
  }

  function mostrarCamion(pos) {
    if (!pos) {  
      if (marcadorCamion) { marcadorCamion.remove(); marcadorCamion = null; }  
      posicionAnterior = null;
      ultimoAngulo = 0;
      return;  
    }

    const ll = [pos.lat, pos.lng];
    let angulo = ultimoAngulo;

    if (typeof pos.rumbo === "number") {
      angulo = pos.rumbo;
      ultimoAngulo = angulo;
    } else if (posicionAnterior) {
      const dLat = pos.lat - posicionAnterior.lat;
      const dLng = pos.lng - posicionAnterior.lng;
      const distancia = Math.sqrt(dLat * dLat + dLng * dLng);

      if (distancia > 0.000008) {
        angulo = calcularRumbo(posicionAnterior.lat, posicionAnterior.lng, pos.lat, pos.lng);
        ultimoAngulo = angulo;
        posicionAnterior = { lat: pos.lat, lng: pos.lng };
      }
    } else {
      posicionAnterior = { lat: pos.lat, lng: pos.lng };
    }

    const angNorm = (angulo % 360 + 360) % 360;
    let transformStyle = "";

    if (angNorm >= 315 || angNorm < 45) {
      transformStyle = "transform: scaleX(1);"; // Derecha
    } else if (angNorm >= 45 && angNorm < 135) {
      transformStyle = "transform: rotate(90deg);"; // Abajo
    } else if (angNorm >= 135 && angNorm < 225) {
      transformStyle = "transform: scaleX(-1);"; // Izquierda
    } else {
      transformStyle = "transform: rotate(-90deg);"; // Arriba
    }

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
          inner.style.cssText = `font-size: 26px; ${transformStyle} transition: transform 0.2s ease; display: inline-block; line-height: 1;`;
        }
      }
    }
  }

  window.AppMap = { iniciar, pintarZona, pintarCalles, actualizarEstados, enfocarCalle, enfocarCalles, mostrarCamion };
})();
