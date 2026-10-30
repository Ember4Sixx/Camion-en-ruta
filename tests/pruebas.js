/* Pruebas de la lógica de colores y de la capa de datos (sin navegador ni Supabase real).
   Ejecutar desde la carpeta del proyecto:   node tests/pruebas.js          */
"use strict";
const assert = require("assert");
const path = require("path");

global.window = global;                       // los archivos del navegador usan `window`
const Estado = require(path.join(__dirname, "../js/estado.js"));

let ok = 0;
const prueba = (nombre, fn) => { fn(); ok++; console.log("  ✔ " + nombre); };
const RealDate = Date;
function fijarHora(iso) {                     // iso sin "Z" = hora local
  global.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(iso); }
    static now() { return new RealDate(iso).getTime(); }
  };
}
const restaurarHora = () => { global.Date = RealDate; };

console.log("estado.js");
const ruta = [1, 2, 3, 4, 5].map((n) => ({ id: "c" + n, orden: n }));

prueba("pendiente -> todas grises", () =>
  assert.deepStrictEqual(Object.values(Estado.estadosDeRuta(ruta, "pendiente", 0, 2)), Array(5).fill("gris")));
prueba("finalizado -> todas negras", () =>
  assert.deepStrictEqual(Object.values(Estado.estadosDeRuta(ruta, "finalizado", 5, 2)), Array(5).fill("negro")));
prueba("en curso en la calle 3 (próximas = 1)", () =>
  assert.deepStrictEqual(Estado.estadosDeRuta(ruta, "en_curso", 3, 1),
    { c1: "negro", c2: "negro", c3: "verde", c4: "amarillo", c5: "gris" }));

const lunes = [{ dias: [1], hora_inicio: "07:00", hora_fin: "10:00" }];
prueba("horario: antes, aviso, durante y después", () => {
  const f = (h, m) => new RealDate(2026, 9, 26, h, m);           // lunes 26-oct-2026
  assert.deepStrictEqual(Estado.estimarPorHorario(f(5, 0), lunes, 5, 15), { fase: "pendiente", orden: 0 });
  assert.deepStrictEqual(Estado.estimarPorHorario(f(6, 50), lunes, 5, 15), { fase: "en_curso", orden: 0 });
  assert.deepStrictEqual(Estado.estimarPorHorario(f(8, 30), lunes, 5, 15), { fase: "en_curso", orden: 3 });
  assert.deepStrictEqual(Estado.estimarPorHorario(f(11, 0), lunes, 5, 15), { fase: "finalizado", orden: 5 });
});
prueba("horario: otro día de la semana -> pendiente", () =>
  assert.deepStrictEqual(Estado.estimarPorHorario(new RealDate(2026, 9, 27, 8, 30), lunes, 5, 15), { fase: "pendiente", orden: 0 }));
prueba("sin horarios cargados -> pendiente", () =>
  assert.deepStrictEqual(Estado.estimarPorHorario(new RealDate(2026, 9, 26, 8, 30), [], 5, 15), { fase: "pendiente", orden: 0 }));

prueba("GPS: elige la calle más cercana y no retrocede", () => {
  const calles = [
    { id: "a", orden: 1, lineas: [[[-79.84, -6.75], [-79.83, -6.75]]] },
    { id: "b", orden: 2, lineas: [[[-79.84, -6.76], [-79.83, -6.76]]] }
  ];
  assert.strictEqual(Estado.indicePorGPS({ lat: -6.7601, lng: -79.835 }, calles, 0, 40).orden, 2);
  assert.strictEqual(Estado.indicePorGPS({ lat: -6.7501, lng: -79.835 }, calles, 2, 40).orden, 2);   // no retrocede
  assert.strictEqual(Estado.indicePorGPS({ lat: -6.755, lng: -79.835 }, calles, 0, 40), null);       // lejos de todo
});
prueba("GPS: los tramos separados de una calle no se unen (MultiLineString)", () => {
  const calle = [{ id: "u", orden: 1, lineas: [[[-79.8405, -6.752], [-79.8405, -6.756]], [[-79.8405, -6.7585], [-79.8405, -6.766]]] }];
  // Punto en el hueco entre los dos tramos (≈ 120 m de cada uno): antes daba "sobre la calle".
  assert.strictEqual(Estado.indicePorGPS({ lat: -6.7573, lng: -79.8405 }, calle, 0, 40), null);
  assert.strictEqual(Estado.indicePorGPS({ lat: -6.760, lng: -79.8405 }, calle, 0, 40).orden, 1);
});

console.log("data-source.js (Supabase simulado)");
global.APP_CONFIG = { fuente: "supabase", supabase: { url: "x", anonKey: "y" }, avisoMinutos: 15,
  umbralGpsMetros: 40, gpsActivo: true, gpsVigenciaSegundos: 120 };

const TABLAS = {
  calles: ["c1", "c2", "c3", "c4"].map((id, i) => ({ id, nombre: "Calle " + (i + 1),
    geom: { type: "LineString", coordinates: [[-79.84, -6.75 - i * 0.002], [-79.83, -6.75 - i * 0.002]] } })),
  rutas: [{ id: "R1", nombre: "Ruta 1", proximas: 1 }],
  ruta_calles: ["c1", "c2", "c3", "c4"].map((c, i) => ({ ruta_id: "R1", calle_id: c, orden: i + 1 })),
  horarios: [{ ruta_id: "R1", dias: [5], hora_inicio: "07:00:00", hora_fin: "11:00:00" }],   // viernes
  posicion_camion: []
};
function crearBuilder(tabla) {
  const b = { select: () => b, order: () => b, limit: () => b,
    then: (res, rej) => Promise.resolve({ data: TABLAS[tabla], error: null }).then(res, rej) };
  return b;
}
global.supabase = { createClient: () => ({ from: crearBuilder, channel: () => ({ on() { return this; }, subscribe() {} }) }) };
require(path.join(__dirname, "../js/data-source.js"));
const D = global.AppData;

(async () => {
  // Viernes 30-oct-2026
  fijarHora("2026-10-30T05:00:00");
  let e = await D.estados();
  prueba("antes del horario -> todo gris, origen horario", () => {
    assert.deepStrictEqual(Object.values(e.estados), Array(4).fill("gris"));
    assert.strictEqual(e.origen, "horario");
  });

  fijarHora("2026-10-30T09:00:00");              // 2 de 4 h -> calle 3
  e = await D.estados();
  prueba("durante el horario, sin GPS fresco -> calcula por horario", () =>
    assert.deepStrictEqual(e.estados, { c1: "negro", c2: "negro", c3: "verde", c4: "amarillo" }));

  // GPS fresco sobre la calle 2 (lat -6.752)
  TABLAS.posicion_camion = [{ ruta_id: "R1", lat: -6.752, lng: -79.835, actualizado: "2026-10-30T09:00:00" }];
  fijarHora("2026-10-30T09:00:30");
  e = await D.estados();
  prueba("GPS fresco manda sobre el horario", () => {
    assert.deepStrictEqual(e.estados, { c1: "negro", c2: "verde", c3: "amarillo", c4: "gris" });
    assert.strictEqual(e.origen, "gps");
  });
  prueba("camion() devuelve la posición vigente", async () => assert.ok(await D.camion()));
  assert.ok(await D.camion());

  fijarHora("2026-10-30T09:10:00");              // 10 min después: la posición ya es vieja
  e = await D.estados();
  prueba("GPS viejo -> vuelve al horario y no se dibuja el camión", () => {
    assert.strictEqual(e.origen, "horario");
    assert.strictEqual(e.estados.c3, "verde");
  });
  assert.strictEqual(await D.camion(), null);

  // Los horarios se piden una sola vez, así que se carga una instancia nueva sin horario oficial.
  TABLAS.horarios = [];
  TABLAS.posicion_camion = [];
  delete require.cache[require.resolve("../js/data-source.js")];
  require(path.join(__dirname, "../js/data-source.js"));
  const D2 = global.AppData;
  e = await D2.estados();
  prueba("sin horario ni GPS -> todo gris (no inventa datos)", () =>
    assert.deepStrictEqual(Object.values(e.estados), Array(4).fill("gris")));
  const h = await D2.horarios();
  prueba("sin horarios, la página avisa que están pendientes", () => assert.match(h.nota, /pendiente/));

  restaurarHora();
  console.log("\n" + ok + " pruebas correctas.");
})().catch((err) => { restaurarHora(); console.error("\n✘ FALLÓ:", err.message); process.exit(1); });
