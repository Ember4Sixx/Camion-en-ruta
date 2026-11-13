/* ==========================================================
   Camión En Ruta · mapa (Leaflet)
   Expone window.AppMap con: iniciar, pintarCalles, actualizarEstados,
   enfocarCalle, mostrarCamion.
   ========================================================== */
(function () {
  const cfg = window.APP_CONFIG;
  let mapa, capaCalles, capaZona, marcadorCamion;
  const capasPorId = {};      // id calle -> capa Leaflet
  const nombrePorId = {};     // id calle -> nombre
  const estadoPorId = {};     // id calle -> estado actual
  let posicionAnterior = null; 
  let ultimoAnguloValido = 0;  

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
    return {
      color: e.color,
      weight: carril ? 4 : 7,
      opacity: 0.95,
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
      ultimoAnguloValido = 0;
      return; 
    }

    const ll = [pos.lat, pos.lng];
    let anguloBase = ultimoAnguloValido;

    if (typeof pos.rumbo === "number") {
      anguloBase = pos.rumbo;
      ultimoAnguloValido = anguloBase;
    } else if (posicionAnterior) {
      const dLat = Math.abs(pos.lat - posicionAnterior.lat);
      const dLng = Math.abs(pos.lng - posicionAnterior.lng);
      if (dLat > 0.000002 || dLng > 0.000002) {
        anguloBase = calcularRumbo(posicionAnterior.lat, posicionAnterior.lng, pos.lat, pos.lng);
        ultimoAnguloValido = anguloBase;
        posicionAnterior = { lat: pos.lat, lng: pos.lng };
      }
    } else {
      posicionAnterior = { lat: pos.lat, lng: pos.lng };
    }

    // =========================================================================
    // CORRECCIÓN DE LA ORIENTACIÓN (OFFSET DE LA CARA DEL CAMIÓN)
    // El emoji de camión 🚛 por defecto apunta hacia la izquierda o arriba según 
    // la fuente del sistema. Añadimos un desfase de -90 grados (o puedes cambiar a 
    // +90 o +180 si notas que aún apunta al lado opuesto) para alinear su frente 
    // exactamente con la dirección del movimiento en la pista.
    // =========================================================================
    const anguloRotacion = (anguloBase - 90 + 360) % 360;

    if (!marcadorCamion) {
      marcadorCamion = L.marker(ll, {
        icon: L.divIcon({
          className: "",
          html: `<div id="truck-icon-container" style="transform: rotate(${anguloRotacion}deg); transition: transform 0.25s ease-out;" aria-hidden="true">🚛</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        }),
        title: "Camión recolector",
        zIndexOffset: 1000,
        interactive: false
      }).addTo(mapa);
    } else {
      marcadorCamion.setLatLng(ll);
      const truckElement = document.getElementById("truck-icon-container");
      if (truckElement) {
        truckElement.style.transform = `rotate(${anguloRotacion}deg)`;
      }
    }
  }

  window.AppMap = { iniciar, pintarZona, pintarCalles, actualizarEstados, enfocarCalle, enfocarCalles, mostrarCamion };
})();
