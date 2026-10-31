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

  function iniciar() {
    mapa = L.map("map", { zoomControl: true }).setView(cfg.centro, cfg.zoom);
    L.tileLayer(cfg.teselas.url, { maxZoom: 19, attribution: cfg.teselas.atribucion }).addTo(mapa);
    return mapa;
  }

  // Dibuja el cuadrado delimitado por las 4 calles (GeoJSON Polygon). Es solo un contorno, no cambia de color.
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

  // Los carriles de una avenida de doble vía están a ~8 m uno del otro: van más finos y con extremos rectos
  // para que se vean como dos líneas independientes. El nombre del tramo trae "· sentido …" (db/tramos.py).
  const esCarril = (id) => /· sentido /.test(nombrePorId[id] || "");

  function estilo(estado, id) {
    const e = cfg.estados[estado] || cfg.estados.gris;
    const carril = esCarril(id);
    return { color: e.color, weight: carril ? 4 : 7, opacity: 0.95, lineCap: carril ? "butt" : "round" };
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

  function mostrarCamion(pos) {
    if (!pos) { if (marcadorCamion) { marcadorCamion.remove(); marcadorCamion = null; } return; }
    const ll = [pos.lat, pos.lng];
    if (!marcadorCamion) {
      marcadorCamion = L.marker(ll, {
        icon: L.divIcon({ className: "", html: '<div class="truck-icon" aria-hidden="true">🚛</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: "Camión recolector"
      }).addTo(mapa);
    } else {
      marcadorCamion.setLatLng(ll);
    }
  }

  window.AppMap = { iniciar, pintarZona, pintarCalles, actualizarEstados, enfocarCalle, mostrarCamion };
})();
