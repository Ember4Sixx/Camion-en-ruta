/* ==========================================================
   Camión En Ruta · mapa (Leaflet con Sprites Direccionales)
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

  // Calcula el ángulo de desplazamiento entre dos coordenadas
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

  // Traduce los grados a una de las 4 direcciones exactas
  function obtenerDireccionCardinal(angulo) {
    if (angulo >= 45 && angulo < 135) return "derecha";    // Este -> Sprite de perfil derecho
    if (angulo >= 135 && angulo < 225) return "abajo";     // Sur -> Sprite vertical cabina abajo
    if (angulo >= 225 && angulo < 315) return "izquierda"; // Oeste -> Sprite de perfil izquierdo
    return "arriba";                                       // Norte -> Sprite vertical cabina arriba
  }

  function mostrarCamion(pos) {
    if (!pos) { 
      if (marcadorCamion) { marcadorCamion.remove(); marcadorCamion = null; } 
      posicionAnterior = null;
      return; 
    }

    const ll = [pos.lat, pos.lng];
    let direccion = "derecha"; // Dirección por defecto

    if (typeof pos.rumbo === "number") {
      direccion = obtenerDireccionCardinal(pos.rumbo);
    } else if (posicionAnterior) {
      const dLat = Math.abs(pos.lat - posicionAnterior.lat);
      const dLng = Math.abs(pos.lng - posicionAnterior.lng);
      if (dLat > 0.000002 || dLng > 0.000002) {
        const rumboBruto = calcularRumbo(posicionAnterior.lat, posicionAnterior.lng, pos.lat, pos.lng);
        direccion = obtenerDireccionCardinal(rumboBruto);
        posicionAnterior = { lat: pos.lat, lng: pos.lng };
      }
    } else {
      posicionAnterior = { lat: pos.lat, lng: pos.lng };
    }

    // Ruta de la imagen según la dirección actual
    const urlImagen = `img/camion-${direccion}.png`;
    // Ancho y alto ajustables según el tamaño de tus imágenes (ej. 36px x 36px o rectangular)
    const anchoIcono = (direccion === "derecha" || direccion === "izquierda") ? 40 : 28;
    const altoIcono = (direccion === "derecha" || direccion === "izquierda") ? 28 : 40;

    const htmlSprite = `<img id="img-camion-sprite" src="${urlImagen}" style="width: ${anchoIcono}px; height: ${altoIcono}px; display: block;" alt="Camión">`;

    if (!marcadorCamion) {
      marcadorCamion = L.marker(ll, {
        icon: L.divIcon({
          className: "",
          html: `<div id="truck-icon-container" style="display: flex; justify-content: center; align-items: center;">${htmlSprite}</div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        }),
        title: "Camión recolector",
        zIndexOffset: 1000,
        interactive: false
      }).addTo(mapa);
    } else {
      marcadorCamion.setLatLng(ll);
      const truckElement = document.getElementById("truck-icon-container");
      if (truckElement) {
        truckElement.innerHTML = htmlSprite;
      }
      // Actualizamos las dimensiones del ancla si cambia de horizontal a vertical
      marcadorCamion.setIcon(L.divIcon({
        className: "",
        html: `<div id="truck-icon-container" style="display: flex; justify-content: center; align-items: center;">${htmlSprite}</div>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      }));
    }
  }

  window.AppMap = { iniciar, pintarZona, pintarCalles, actualizarEstados, enfocarCalle, enfocarCalles, mostrarCamion };
})();
