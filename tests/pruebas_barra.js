/* Prueba de la barra negra animada del mapa (js/map.js) con un Leaflet simulado.
   Ejecutar desde la carpeta del proyecto:   node tests/pruebas_barra.js          */
"use strict";
const assert = require("assert");
const path = require("path");

// ---- Leaflet mínimo: solo lo que usa map.js ----
const estiloDe = {};            // id -> último estilo de la línea base
const barras = [];              // polilíneas negras creadas
const marcadores = [];          // marcadores del camión creados
class Latlng {
  constructor(a) { this.lat = a[0]; this.lng = a[1]; }
  distanceTo(b) { const p = Array.isArray(b) ? { lat: b[0], lng: b[1] } : b;
    return Math.hypot((this.lng - p.lng) * 111320 * Math.cos(this.lat * Math.PI / 180), (this.lat - p.lat) * 110540); }
}
const L = {
  map: () => ({ setView() { return this; }, createPane() {}, getPane: () => ({ style: {} }), fitBounds() {} }),
  tileLayer: () => ({ addTo() {} }),
  latLng: (a, b) => new Latlng(Array.isArray(a) ? a : [a, b]),
  divIcon: (o) => o,
  marker: (ll, o) => { const m = { o, ll, inner: { style: {} }, addTo() { return this; }, setLatLng(x) { m.ll = x; }, remove() {}, getElement: () => ({ querySelector: () => m.inner }) }; marcadores.push(m); return m; },
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
  assert.strictEqual(b.o.color, "#4b4b4a");     // negro mezclado con el fondo al 75 %: igual al negro final que ve el usuario
  assert.strictEqual(b.o.opacity, 1);
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

// ---- La barra puede seguir al camión sin suavizado (simulación): progreso.directo ----
AppMap.actualizarEstados({ t1: "gris" });
APP_CONFIG.barraNegro.activa = true;
barras.length = 0;
AppMap.actualizarEstados({ t1: "verde" }, { t1: { f: 0.2, desde: "inicio", directo: true } });
prueba("directo: la barra aparece de inmediato en su sitio, sin esperar animación", () => {
  assert.ok(barras[0]);
  assert.ok(Math.abs(largoBarra(barras[0]) - 20) < 2, "largo " + largoBarra(barras[0]));
});
AppMap.actualizarEstados({ t1: "verde" }, { t1: { f: 0.6, desde: "inicio", directo: true } });
prueba("directo: sigue al camión cuadro a cuadro y nunca retrocede", () => {
  assert.ok(Math.abs(largoBarra(barras[0]) - 60) < 3);
  AppMap.actualizarEstados({ t1: "verde" }, { t1: { f: 0.4, desde: "inicio", directo: true } });
  assert.ok(Math.abs(largoBarra(barras[0]) - 60) < 3);
});

// ---- El camión mira hacia donde va: arriba, abajo, izquierda o derecha ----
const giro = () => { const m = marcadores[marcadores.length - 1]; return ((Number((m.inner.style.transform || m.o.icon.html.match(/rotate\((-?[\d.]+)deg/)[0].replace(/\D*/, "")).toString().match(/-?[\d.]+/)[0]) % 360) + 360) % 360; };
AppMap.mostrarCamion(null);
marcadores.length = 0;
AppMap.mostrarCamion({ lat: -6.75, lng: -79.833, rumbo: 180 });
prueba("rumbo sur -> el camión mira hacia abajo (0°)", () => {
  assert.match(marcadores[0].o.icon.html, /rotate\(0deg\)/);
  assert.match(marcadores[0].o.icon.html, /<svg/);
});
prueba("rumbo norte -> mira hacia arriba (180°)", () => { AppMap.mostrarCamion({ lat: -6.75, lng: -79.833, rumbo: 0 }); assert.strictEqual(giro(), 180); });
prueba("rumbo este -> mira a la derecha (270°)", () => { AppMap.mostrarCamion({ lat: -6.75, lng: -79.833, rumbo: 90 }); assert.strictEqual(giro(), 270); });
prueba("rumbo oeste -> mira a la izquierda (90°)", () => { AppMap.mostrarCamion({ lat: -6.75, lng: -79.833, rumbo: 270 }); assert.strictEqual(giro(), 90); });
prueba("gira por el lado corto: de derecha a izquierda no da vueltas de más", () => {
  const antes = Number(marcadores[0].inner.style.transform.match(/-?[\d.]+/)[0]);
  AppMap.mostrarCamion({ lat: -6.75, lng: -79.833, rumbo: 90 });
  const despues = Number(marcadores[0].inner.style.transform.match(/-?[\d.]+/)[0]);
  assert.ok(Math.abs(despues - antes) <= 180, antes + " -> " + despues);
});
// Sin rumbo (GPS real): la dirección sale del movimiento entre dos lecturas.
AppMap.mostrarCamion(null);
marcadores.length = 0;
AppMap.mostrarCamion({ lat: -6.7500, lng: -79.8330 });
AppMap.mostrarCamion({ lat: -6.7494, lng: -79.8330 });      // ~66 m al norte
prueba("sin rumbo: si avanza al norte, mira hacia arriba", () => assert.strictEqual(giro(), 180));
AppMap.mostrarCamion({ lat: -6.7500, lng: -79.8330 });      // vuelve al sur
prueba("sin rumbo: si avanza al sur, mira hacia abajo", () => assert.strictEqual(giro(), 0));
AppMap.mostrarCamion({ lat: -6.75001, lng: -79.83300 });    // ~1 m: temblor del GPS
prueba("un temblor de GPS (<3 m) no cambia hacia dónde mira", () => assert.strictEqual(giro(), 0));

// ---- Barra y camión sincronizados ----
const LNG0 = -79.8340, ANCHO = 0.0009;     // el tramo t1 va de oeste a este: 0.0009° de longitud (~100 m)
const aLng = (f) => LNG0 + ANCHO * f;
const desdeInicio = (ll) => new Latlng([-6.75, LNG0]).distanceTo(ll);
APP_CONFIG.barraNegro.activa = true;
AppMap.actualizarEstados({ t1: "gris" });
AppMap.mostrarCamion(null);
barras.length = 0; marcadores.length = 0;
reloj += 10000;
AppMap.mostrarCamion({ lat: -6.75, lng: aLng(0.40), rumbo: 90 });
AppMap.actualizarEstados({ t1: "verde" }, { t1: { f: 0.05, desde: "inicio", visitados: 3 } });
prueba("la barra llega hasta donde está el camión (40 %), no hasta lo que sugiere la máscara (5 %)", () => {
  assert.ok(Math.abs(largoBarra(barras[0]) - desdeInicio(marcadores[0].ll)) < 1);
  assert.ok(Math.abs(largoBarra(barras[0]) - 40) < 3, "largo " + largoBarra(barras[0]));
});
reloj += 5000;                                               // siguiente lectura de GPS, 5 s después
AppMap.mostrarCamion({ lat: -6.75, lng: aLng(0.80), rumbo: 90 });
prueba("con lecturas espaciadas el camión no salta: sigue en su sitio hasta que empieza a deslizarse", () => {
  assert.ok(Math.abs(marcadores[0].ll[1] - aLng(0.40)) < 1e-9);
});
let dif = 0, intermedios = 0;
for (let i = 0; i < 300; i++) {
  avanzar(16);
  const d = desdeInicio(marcadores[0].ll), b = largoBarra(barras[0]);
  dif = Math.max(dif, Math.abs(b - d));
  if (d > 45 && d < 75) intermedios++;
}
prueba("mientras el camión se desliza, el frente de la barra va exactamente con él (diferencia < 1 m)", () => assert.ok(dif < 1, "dif " + dif));
prueba("el deslizamiento es gradual (pasa por posiciones intermedias) y termina en el 80 %", () => {
  assert.ok(intermedios > 20, "intermedios " + intermedios);
  assert.ok(Math.abs(desdeInicio(marcadores[0].ll) - 80) < 2);
  assert.ok(Math.abs(largoBarra(barras[0]) - 80) < 2);
});
reloj += 16; AppMap.mostrarCamion({ lat: -6.75, lng: aLng(0.805), rumbo: 90 });
reloj += 16;                                                  // lecturas continuas (simulación): sin deslizar
AppMap.mostrarCamion({ lat: -6.75, lng: aLng(0.81), rumbo: 90 });
prueba("con lecturas continuas (simulación) el camión y la barra se colocan directo", () => {
  assert.ok(Math.abs(marcadores[0].ll[1] - aLng(0.81)) < 1e-9);
  assert.ok(Math.abs(largoBarra(barras[0]) - desdeInicio(marcadores[0].ll)) < 1);
});
AppMap.actualizarEstados({ t1: "negro" }, { t1: { f: 1, desde: "inicio", visitados: 10 } });
avanzar(16);
prueba("llega 'negro' con el camión dibujado todavía dentro del tramo: la barra lo espera y no se adelanta", () => {
  assert.strictEqual(estiloDe.t1.color, "#2e9e5b");
  assert.ok(Math.abs(largoBarra(barras[0]) - desdeInicio(marcadores[0].ll)) < 1);
});
reloj += 5000; AppMap.mostrarCamion({ lat: -6.75, lng: aLng(1.05), rumbo: 90 });   // el camión sigue su camino, fuera del tramo
for (let i = 0; i < 400; i++) avanzar(16);
prueba("cuando el camión llega al final, la barra se completa y el tramo queda negro", () => assert.strictEqual(estiloDe.t1.color, "#1a1a1a"));

// Si el GPS se corta con el camión dentro del tramo, la barra no se queda esperando para siempre.
AppMap.actualizarEstados({ t1: "gris" });
AppMap.mostrarCamion(null);
barras.length = 0; marcadores.length = 0;
AppMap.mostrarCamion({ lat: -6.75, lng: aLng(0.50), rumbo: 90 });
AppMap.actualizarEstados({ t1: "verde" }, { t1: { f: 0.3, desde: "inicio", visitados: 5 } });
AppMap.actualizarEstados({ t1: "negro" }, { t1: { f: 1, desde: "inicio", visitados: 10 } });
for (let i = 0; i < 300; i++) avanzar(16);       // ~4.8 s sin nuevas lecturas: aún espera o va completándose
for (let i = 0; i < 300; i++) avanzar(16);       // ~9.6 s en total
prueba("GPS cortado con el camión dentro del tramo: pasada la espera máxima (4 s) la barra se completa igual", () => assert.strictEqual(estiloDe.t1.color, "#1a1a1a"));

// Avisos "negro" repetidos (tiempo real) con el camión quieto dentro del tramo: no reinician la espera.
AppMap.actualizarEstados({ t1: "gris" });
AppMap.mostrarCamion(null);
barras.length = 0; marcadores.length = 0;
AppMap.mostrarCamion({ lat: -6.75, lng: aLng(0.50), rumbo: 90 });
AppMap.actualizarEstados({ t1: "verde" }, { t1: { f: 0.3, desde: "inicio", visitados: 5 } });
for (let k = 0; k < 8; k++) {                       // un aviso "negro" cada 1.6 s durante ~13 s
  AppMap.actualizarEstados({ t1: "negro" }, { t1: { f: 1, desde: "inicio", visitados: 10 } });
  for (let i = 0; i < 100; i++) avanzar(16);
}
prueba("avisos 'negro' repetidos con el GPS cortado: la barra igual termina y no se queda atascada", () => assert.strictEqual(estiloDe.t1.color, "#1a1a1a"));

// Sin datos de por dónde entró (máscara vacía), la barra NO se inventa un sentido.
AppMap.actualizarEstados({ t1: "gris" });
AppMap.mostrarCamion(null);
barras.length = 0; marcadores.length = 0;
AppMap.mostrarCamion({ lat: -6.75, lng: aLng(0.90), rumbo: 90 });
AppMap.actualizarEstados({ t1: "verde" }, { t1: { f: 0, desde: "inicio", visitados: 0 } });
prueba("máscara sin puntos recorridos -> no se dibuja barra (no adivina el sentido)", () => assert.strictEqual(barras.length, 0));

console.log("\n" + ok + " pruebas correctas.");
