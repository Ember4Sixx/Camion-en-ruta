/* Prueba de la barra negra animada del mapa (js/map.js) con un Leaflet simulado.
   Ejecutar desde la carpeta del proyecto:   node tests/pruebas_barra.js          */
"use strict";
const assert = require("assert");
const path = require("path");

// ---- Leaflet mínimo: solo lo que usa map.js ----
const estiloDe = {};            // id -> último estilo de la línea base
const barras = [];              // polilíneas negras creadas
class Latlng {
  constructor(a) { this.lat = a[0]; this.lng = a[1]; }
  distanceTo(b) { const p = Array.isArray(b) ? { lat: b[0], lng: b[1] } : b;
    return Math.hypot((this.lng - p.lng) * 111320 * Math.cos(this.lat * Math.PI / 180), (this.lat - p.lat) * 110540); }
}
const L = {
  map: () => ({ setView() { return this; }, createPane() {}, getPane: () => ({ style: {} }), fitBounds() {} }),
  tileLayer: () => ({ addTo() {} }),
  latLng: (a) => new Latlng(a),
  layerGroup: () => { const ls = new Set(); return { addTo() { return this; }, remove() {}, addLayer: (l) => ls.add(l), removeLayer: (l) => ls.delete(l), ls }; },
  polyline: (pts, o) => { const l = { pts, o, setLatLngs(p) { l.pts = p; } }; barras.push(l); return l; },
  geoJSON: (gj, opt) => {
    const capas = gj.features.map((f) => {
      const capa = { setStyle(s) { estiloDe[f.properties.id] = s; }, bindPopup() {}, bindTooltip() {}, getBounds: () => ({ isValid: () => false }) };
      opt.style(f); opt.onEachFeature(f, capa); return capa;
    });
    return { addTo() { return this; }, remove() {}, getBounds: () => ({ isValid: () => false }), capas };
  }
};
global.window = global; global.L = L; global.document = { getElementById: () => null };
let reloj = 0, cola = [];
global.performance = { now: () => reloj };
global.requestAnimationFrame = (fn) => { cola.push(fn); return cola.length; };
const avanzar = (ms) => { reloj += ms; const q = cola; cola = []; q.forEach((fn) => fn(reloj)); };
global.APP_CONFIG = { centro: [0, 0], zoom: 16, teselas: { url: "x", atribucion: "" },
  estados: { gris: { color: "#a9aeb6" }, amarillo: { color: "#f2c200" }, verde: { color: "#2e9e5b" }, negro: { color: "#1a1a1a" } },
  barraNegro: { activa: true, metrosPorSegundo: 12, minSeg: 0.3, maxSeg: 4 } };
require(path.join(__dirname, "../js/map.js"));

// Un tramo recto de ~100 m de oeste a este.
const geo = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { id: "t1", nombre: "Calle A" }, geometry: { type: "LineString", coordinates: [[-79.8340, -6.7500], [-79.8331, -6.7500]] } }
] };
let ok = 0;
const prueba = (n, fn) => { fn(); ok++; console.log("  ✔ " + n); };
const largoBarra = (b) => b.pts.length < 2 ? 0 : b.pts.slice(1).reduce((s, p, i) => s + new Latlng(b.pts[i]).distanceTo(p), 0);

AppMap.iniciar();
AppMap.pintarCalles(geo, { t1: "gris" });
barras.length = 0;

AppMap.actualizarEstados({ t1: "verde" }, { t1: { f: 0.3, desde: "inicio" } });
avanzar(16); avanzar(4000);
prueba("verde con progreso 0.3: barra negra de ~30 % desde el inicio, base verde", () => {
  const b = barras[0];
  assert.ok(b, "debe crearse la barra");
  assert.ok(Math.abs(largoBarra(b) - 30) < 3, "largo " + largoBarra(b));
  assert.strictEqual(b.pts[0][1], -79.8340);
  assert.strictEqual(b.o.color, "#1a1a1a");
  assert.strictEqual(b.o.interactive, false);
  assert.strictEqual(estiloDe.t1.color, "#2e9e5b");
});

AppMap.actualizarEstados({ t1: "negro" }, { t1: { f: 1, desde: "inicio" } });
prueba("al pasar a negro NO se pinta de golpe: la base sigue verde al empezar", () => {
  assert.strictEqual(estiloDe.t1.color, "#2e9e5b");
});
avanzar(16); avanzar(500);
prueba("a mitad de la animación la barra crece pero no está completa", () => {
  const l = largoBarra(barras[0]);
  assert.ok(l > 31 && l < 99, "largo " + l);
  assert.strictEqual(estiloDe.t1.color, "#2e9e5b");
});
avanzar(5000);
prueba("al terminar, el tramo queda negro y la barra se quita", () => {
  assert.strictEqual(estiloDe.t1.color, "#1a1a1a");
});

// Sentido contrario: el camión entra por el final del tramo.
AppMap.actualizarEstados({ t1: "gris" });
barras.length = 0;
AppMap.actualizarEstados({ t1: "verde" }, { t1: { f: 0.5, desde: "fin" } });
avanzar(16); avanzar(5000);
prueba("desde 'fin' la barra arranca en el extremo este", () => {
  const b = barras[0];
  assert.strictEqual(b.pts[0][1], -79.8331);
  assert.ok(Math.abs(largoBarra(b) - 50) < 4);
});

// Gris: sin barra y sin retroceso raro
AppMap.actualizarEstados({ t1: "gris" });
prueba("al volver a gris desaparece la barra", () => assert.strictEqual(estiloDe.t1.color, "#a9aeb6"));

// Animación desactivada: se pinta de golpe como antes.
APP_CONFIG.barraNegro.activa = false;
AppMap.actualizarEstados({ t1: "negro" });
prueba("con barraNegro.activa=false el negro aparece de golpe", () => assert.strictEqual(estiloDe.t1.color, "#1a1a1a"));

console.log("\n" + ok + " pruebas correctas.");
