/* ==========================================================
   Camión En Ruta · planificador del recorrido simulado
   Arma un recorrido CONTINUO por la red de tramos: el camión nunca salta
   de una calle a otra. Cuando ya no tiene tramos nuevos donde está,
   vuelve por calles ya recorridas (sin recolectar) hasta el tramo
   pendiente más cercano.

   Reglas:
   - Los carriles de avenida ("sentido …") se recorren solo en su sentido
     (la geometría ya viene dibujada en el sentido de circulación).
   - Las calles interiores se pueden recorrer en ambos sentidos.

   Funciones puras (sin DOM ni red) para poder probarlas con node.
   ========================================================== */
(function (root) {
  "use strict";

  var TOL_M = 3; // metros: dos extremos a menos de esto son la misma esquina

  function lineaDe(geom) {
    if (!geom) return [];
    if (geom.type === "LineString") return geom.coordinates.slice();
    if (geom.type === "MultiLineString") return [].concat.apply([], geom.coordinates);
    return [];
  }

  function distM(a, b) {
    var kx = 111320 * Math.cos((a[1] * Math.PI) / 180), ky = 110540;
    var dx = (a[0] - b[0]) * kx, dy = (a[1] - b[1]) * ky;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function largo(coords) {
    var s = 0;
    for (var i = 0; i < coords.length - 1; i++) s += distM(coords[i], coords[i + 1]);
    return s;
  }

  /** Devuelve una lista de pasos [{id, coords:[[lng,lat],…], recolecta:bool, largo}] */
  function planificar(geojson) {
    var nodos = [];      // [[lng,lat]]
    function nodoDe(p) {
      for (var i = 0; i < nodos.length; i++) if (distM(nodos[i], p) < TOL_M) return i;
      nodos.push(p);
      return nodos.length - 1;
    }

    var aristas = [];
    geojson.features.forEach(function (f) {
      var c = lineaDe(f.geometry);
      if (c.length < 2) return;
      var pr = f.properties || {};
      aristas.push({
        id: pr.id,
        calle: pr.calle_id || pr.calle || "",
        orden: pr.orden || 0,
        coords: c,
        a: nodoDe(c[0]),
        b: nodoDe(c[c.length - 1]),
        unaVia: /sentido /.test(pr.carril || pr.nombre || ""),
        largo: largo(c),
        hecha: false
      });
    });
    if (!aristas.length) return [];

    // En los bordes de la zona, los carriles de avenida terminan a unos metros de la esquina
    // (están corridos ~8 m del eje). Un extremo "suelto" se une a la esquina más cercana (≤ 15 m).
    var grado = nodos.map(function () { return 0; });
    aristas.forEach(function (e) { grado[e.a]++; grado[e.b]++; });
    var unir = nodos.map(function (_, i) { return i; });
    grado.forEach(function (g, i) {
      if (g !== 1) return;
      var mejor = -1, dm = 15;
      nodos.forEach(function (q, j) {
        if (j === i) return;
        var d = distM(nodos[i], q);
        if (d < dm) { dm = d; mejor = j; }
      });
      if (mejor >= 0 && unir[mejor] === mejor) unir[i] = mejor;
    });
    aristas.forEach(function (e) { e.a = unir[e.a]; e.b = unir[e.b]; });

    // adyacencia: por cada nodo, las formas de salir [{e, hacia, inv}]
    var ady = nodos.map(function () { return []; });
    aristas.forEach(function (e) {
      ady[e.a].push({ e: e, hacia: e.b, inv: false });
      if (!e.unaVia) ady[e.b].push({ e: e, hacia: e.a, inv: true });
    });

    function paso(sal, recolecta) {
      var c = sal.inv ? sal.e.coords.slice().reverse() : sal.e.coords;
      return { id: sal.e.id, coords: c, recolecta: recolecta, largo: sal.e.largo, contraSentido: sal.inv && sal.e.unaVia };
    }

    // Camino más corto (Dijkstra) hasta el nodo más cercano que tenga un tramo pendiente.
    function caminoAPendiente(desde, respetarSentido) {
      var dist = nodos.map(function () { return Infinity; });
      var prev = nodos.map(function () { return null; });
      var visto = nodos.map(function () { return false; });
      dist[desde] = 0;
      for (;;) {
        var u = -1;
        for (var i = 0; i < nodos.length; i++) if (!visto[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
        if (u < 0) return null;
        visto[u] = true;
        if (u !== desde && ady[u].some(function (s) { return !s.e.hecha; })) {
          var camino = [];
          for (var v = u; prev[v]; v = prev[v].desde) camino.unshift(prev[v].sal);
          return camino;
        }
        var salidas = ady[u].slice();
        if (!respetarSentido) {   // plan B: permitir ir contra el sentido (solo si no hay otra forma)
          aristas.forEach(function (e) { if (e.unaVia && e.b === u) salidas.push({ e: e, hacia: e.a, inv: true }); });
        }
        salidas.forEach(function (s) {
          var d = dist[u] + s.e.largo;
          if (d < dist[s.hacia]) { dist[s.hacia] = d; prev[s.hacia] = { desde: u, sal: s }; }
        });
      }
    }

    var pasos = [];
    var actual = aristas[0].a;   // empieza donde empieza el tramo con orden 1
    var calleAnterior = null;
    var pendientes = aristas.length;

    while (pendientes > 0) {
      var opciones = ady[actual].filter(function (s) { return !s.e.hecha; });
      if (opciones.length) {
        opciones.sort(function (x, y) {
          var mx = x.e.calle === calleAnterior ? 0 : 1, my = y.e.calle === calleAnterior ? 0 : 1;
          return mx - my || x.e.orden - y.e.orden;
        });
        var s = opciones[0];
        s.e.hecha = true;
        pendientes--;
        pasos.push(paso(s, true));
        actual = s.hacia;
        calleAnterior = s.e.calle;
        continue;
      }
      var camino = caminoAPendiente(actual, true) || caminoAPendiente(actual, false);
      if (!camino) {
        // Red partida en pedazos (no debería pasar): salta al siguiente tramo pendiente.
        var sig = aristas.filter(function (e) { return !e.hecha; })[0];
        actual = sig.a;
        calleAnterior = null;
        continue;
      }
      camino.forEach(function (sal) { pasos.push(paso(sal, false)); actual = sal.hacia; calleAnterior = sal.e.calle; });
    }
    return pasos;
  }

  /** Punto a `m` metros desde el inicio de una línea [[lng,lat],…]. Devuelve {lat,lng}. */
  function puntoEn(coords, m) {
    for (var i = 0; i < coords.length - 1; i++) {
      var d = distM(coords[i], coords[i + 1]);
      if (m <= d || i === coords.length - 2) {
        var t = d === 0 ? 1 : Math.max(0, Math.min(1, m / d));
        return {
          lng: coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
          lat: coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t
        };
      }
      m -= d;
    }
    var u = coords[coords.length - 1];
    return { lng: u[0], lat: u[1] };
  }

  var api = { planificar: planificar, puntoEn: puntoEn, distM: distM };
  root.Simulacion = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
