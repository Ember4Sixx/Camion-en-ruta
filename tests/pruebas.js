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

console.log("estado.js · avance real por GPS");
// Calles reales de la zona piloto (db/zona.sql)
const CINTO = [[[-79.8338714, -6.7567038], [-79.83378740756679, -6.756713260200373], [-79.8337764, -6.7567145], [-79.8325583, -6.7568429]]];
const PIZARRO = [[[-79.8326603, -6.7578157], [-79.8326067, -6.7573047], [-79.8325583, -6.7568429], [-79.8325091, -6.7563739]]];
const MEXICO = [[[-79.8293569, -6.7566329], [-79.8310408, -6.7564515], [-79.8322675, -6.7563204], [-79.833737, -6.7561572]]];
// Simula al camión avanzando por una línea, con lecturas cada ~5 m (como la app del conductor).
function recorrer(calle, desde, hasta, puntosCalle, visitados) {
  const a = { lng: desde[0], lat: desde[1] }, b = { lng: hasta[0], lat: hasta[1] };
  Estado.puntosEntre(a, b, 5).concat([a]).forEach((q) => Estado.marcarCercanos(puntosCalle, visitados, q, 15));
}
prueba("una calle recién empezada no se marca terminada", () => {
  const pts = Estado.muestrearCalle(CINTO, 8), vis = new Array(pts.length).fill(0);
  recorrer(CINTO, CINTO[0][0], [-79.8335, -6.75674], pts, vis);              // solo el primer tramo
  assert.ok(Estado.fraccion(vis) < 0.5);
  assert.strictEqual(Estado.estadoPorAvance(false, Estado.fraccion(vis), 0.8), "gris");
  assert.strictEqual(Estado.estadoPorAvance(true, Estado.fraccion(vis), 0.8), "verde");
});
prueba("recorrerla completa la deja en negro al salir", () => {
  const pts = Estado.muestrearCalle(CINTO, 8), vis = new Array(pts.length).fill(0);
  recorrer(CINTO, CINTO[0][0], CINTO[0][3], pts, vis);
  assert.ok(Estado.fraccion(vis) >= 0.95);
  assert.strictEqual(Estado.estadoPorAvance(false, Estado.fraccion(vis), 0.8), "negro");
});
prueba("cruzar una esquina no marca la calle transversal", () => {
  const pts = Estado.muestrearCalle(CINTO, 8), vis = new Array(pts.length).fill(0);
  recorrer(PIZARRO, PIZARRO[0][1], PIZARRO[0][3], pts, vis);                // pasa por Gonzalo Pizarro y cruza Cinto
  assert.ok(Estado.fraccion(vis) < 0.3, "avance " + Estado.fraccion(vis));
  assert.strictEqual(Estado.estadoPorAvance(false, Estado.fraccion(vis), 0.8), "gris");
});
prueba("estar en una calle no marca otras como terminadas (el caso del orden fijo)", () => {
  const ptsMex = Estado.muestrearCalle(MEXICO, 8), visMex = new Array(ptsMex.length).fill(0);
  recorrer(CINTO, CINTO[0][0], [-79.8333, -6.75677], ptsMex, visMex);       // camión en Cacique Cinto
  assert.strictEqual(Estado.estadoPorAvance(false, Estado.fraccion(visMex), 0.8), "gris");
});
prueba("calle actual: elige la más cercana y no salta en la esquina", () => {
  const calles = [{ id: "cinto", lineas: CINTO }, { id: "pizarro", lineas: PIZARRO }];
  assert.strictEqual(Estado.calleActual({ lat: -6.75675, lng: -79.8332 }, calles, null, 40, 8), "cinto");
  // Justo en la esquina Cinto/Pizarro: sigue en la calle donde venía
  assert.strictEqual(Estado.calleActual({ lat: -6.7568429, lng: -79.8325583 }, calles, "cinto", 40, 8), "cinto");
  assert.strictEqual(Estado.calleActual({ lat: -6.7568429, lng: -79.8325583 }, calles, "pizarro", 40, 8), "pizarro");
  assert.strictEqual(Estado.calleActual({ lat: -6.7600, lng: -79.8332 }, calles, "cinto", 40, 8), null); // lejos
});
prueba("estadosPorAvance: verde solo si la posición es reciente; nunca amarillo", () => {
  const ruta = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const filas = [{ calle_id: "a", estado: "negro" }, { calle_id: "b", estado: "verde" }];
  assert.deepStrictEqual(Estado.estadosPorAvance(ruta, filas, true), { a: "negro", b: "verde", c: "gris" });
  assert.deepStrictEqual(Estado.estadosPorAvance(ruta, filas, false), { a: "negro", b: "gris", c: "gris" });
});

console.log("\ncarriles de una avenida de doble vía (Av. México, datos reales)");
// Dos carriles a ~8 m uno del otro. Tramos de db/zona.sql: "sentido este" y "sentido oeste".
const MEX_ESTE = [[-79.8319303, -6.7564372], [-79.8314292, -6.756492]];
const MEX_OESTE = [[-79.8314176, -6.7564124], [-79.8314177, -6.7564124], [-79.8318395, -6.7563702], [-79.8319214, -6.7563607]];
function marcarLecturas(lecturas, calles, conRegla) {
  calles.forEach((c) => { c.puntos = Estado.muestrearCalle(c.lineas, 8); c.visitados = new Array(c.puntos.length).fill(0); });
  lecturas.forEach((q) => {
    const ids = conRegla ? Estado.callesParaMarcar(q, calles, 15, 5) : calles.map((c) => c.id);
    calles.forEach((c) => { if (ids.indexOf(c.id) >= 0) Estado.marcarCercanos(c.puntos, c.visitados, q, 15); });
  });
}
const lecturasEste = (() => { const l = MEX_ESTE; const out = []; for (let i = 0; i < l.length - 1; i++) Estado.puntosEntre({ lng: l[i][0], lat: l[i][1] }, { lng: l[i + 1][0], lat: l[i + 1][1] }, 5).forEach((p) => out.push(p)); return out; })();
prueba("los dos carriles están muy juntos (el radio de 15 m alcanza al carril contrario)", () => {
  const calles = [{ id: "este", lineas: [MEX_ESTE] }, { id: "oeste", lineas: [MEX_OESTE] }];
  marcarLecturas(lecturasEste, calles, false);       // comportamiento anterior
  assert.ok(Estado.fraccion(calles[1].visitados) > 0.8, "sin la regla el otro carril se marcaría: " + Estado.fraccion(calles[1].visitados));
});
prueba("recorrer el carril este NO marca el carril oeste", () => {
  const calles = [{ id: "este", lineas: [MEX_ESTE] }, { id: "oeste", lineas: [MEX_OESTE] }];
  marcarLecturas(lecturasEste, calles, true);
  assert.ok(Estado.fraccion(calles[0].visitados) >= 0.95, "este " + Estado.fraccion(calles[0].visitados));
  assert.ok(Estado.fraccion(calles[1].visitados) < 0.2, "oeste " + Estado.fraccion(calles[1].visitados));
  assert.strictEqual(Estado.estadoPorAvance(false, Estado.fraccion(calles[0].visitados), 0.8), "negro");
  assert.strictEqual(Estado.estadoPorAvance(false, Estado.fraccion(calles[1].visitados), 0.8), "gris");
});
prueba("calle actual: en el carril este no se queda en el oeste", () => {
  const calles = [{ id: "este", lineas: [MEX_ESTE] }, { id: "oeste", lineas: [MEX_OESTE] }];
  const q = lecturasEste[Math.floor(lecturasEste.length / 2)];
  assert.strictEqual(Estado.calleActual(q, calles, "oeste", 40, 4), "este");
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
  posicion_camion: [],
  avance_calles: []
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

  // GPS fresco sobre la calle 2, sin avance guardado todavía: no se inventa nada.
  TABLAS.posicion_camion = [{ ruta_id: "R1", lat: -6.752, lng: -79.835, actualizado: "2026-10-30T09:00:00" }];
  fijarHora("2026-10-30T09:00:30");
  e = await D.estados();
  prueba("GPS fresco sin avance -> todo gris (no supone el orden de las calles)", () => {
    assert.deepStrictEqual(e.estados, { c1: "gris", c2: "gris", c3: "gris", c4: "gris" });
    assert.strictEqual(e.origen, "gps");
  });

  // La app del conductor guardó: c3 recorrida completa, c2 donde está ahora.
  TABLAS.avance_calles = [
    { ruta_id: "R1", calle_id: "c3", estado: "negro", actualizado: "2026-10-30T08:55:00" },
    { ruta_id: "R1", calle_id: "c2", estado: "verde", actualizado: "2026-10-30T09:00:00" }
  ];
  e = await D.estados();
  prueba("GPS fresco con avance -> colores según lo recorrido de verdad", () =>
    assert.deepStrictEqual(e.estados, { c1: "gris", c2: "verde", c3: "negro", c4: "gris" }));
  prueba("camion() devuelve la posición vigente", async () => assert.ok(await D.camion()));
  assert.ok(await D.camion());

  fijarHora("2026-10-30T09:10:00");              // 10 min después: la posición ya es vieja
  e = await D.estados();
  prueba("GPS viejo -> lo terminado sigue negro, la calle verde vuelve a gris, sin camión", () =>
    assert.deepStrictEqual(e.estados, { c1: "gris", c2: "gris", c3: "negro", c4: "gris" }));
  assert.strictEqual(await D.camion(), null);

  fijarHora("2026-10-31T09:00:00");              // al día siguiente el avance de ayer ya no cuenta
  TABLAS.posicion_camion = [];
  e = await D.estados();
  prueba("el avance de ayer no se muestra hoy", () => assert.strictEqual(e.origen, "horario"));
  TABLAS.avance_calles = [];

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
