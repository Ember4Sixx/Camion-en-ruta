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

  /** Arma la red de calles: nodos (esquinas), aristas (tramos) y adyacencia. */
  function construirRed(geojson) {
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
    return { nodos: nodos, aristas: aristas, ady: ady };
  }

  /** Devuelve una lista de pasos [{id, coords:[[lng,lat],…], recolecta:bool, largo}] */
  function planificar(geojson) {
    var red = construirRed(geojson), nodos = red.nodos, aristas = red.aristas, ady = red.ady;
    if (!aristas.length) return [];

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

  /**
   * Recorrido que sigue EXACTAMENTE el orden de la ruta (properties.orden 1, 2, 3…).
   * Solo usa los tramos del plano oficial (properties.en_plano !== false); los demás tramos
   * de la zona se quedan en gris (la app del conductor igual los marca si el camión pasa).
   * Cada tramo se recorre en el sentido en que está dibujado (la geometría ya viene en el
   * sentido de marcha). Entre un tramo y el siguiente:
   *   - si están a pocos metros (cruzar una avenida de doble vía), va directo;
   *   - si no, vuelve por calles ya recorridas (sin recolectar) por el camino más corto;
   *   - si no hay camino dentro del mapa (la ruta sale de la zona), salta al siguiente tramo.
   */
  var CRUCE_M = 25;
  function planificarEnOrden(geojson) {
    var conOrden = { type: "FeatureCollection", features: geojson.features
      .filter(function (f) { return f.properties && f.properties.orden > 0 && f.properties.en_plano !== false; })
      .sort(function (x, y) { return x.properties.orden - y.properties.orden; }) };
    var red = construirRed(conOrden), nodos = red.nodos, aristas = red.aristas, ady = red.ady;
    if (!aristas.length) return [];

    function caminoA(desde, hasta) {   // Dijkstra entre dos esquinas (respeta el sentido de las avenidas)
      var dist = nodos.map(function () { return Infinity; });
      var prev = nodos.map(function () { return null; });
      var visto = nodos.map(function () { return false; });
      dist[desde] = 0;
      for (;;) {
        var u = -1;
        for (var i = 0; i < nodos.length; i++) if (!visto[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
        if (u < 0) return null;
        if (u === hasta) break;
        visto[u] = true;
        ady[u].forEach(function (s) {
          if (!s.e.hecha) return;   // solo vuelve por calles que ya recorrió
          var d = dist[u] + s.e.largo;
          if (d < dist[s.hacia]) { dist[s.hacia] = d; prev[s.hacia] = { desde: u, sal: s }; }
        });
      }
      var camino = [];
      for (var v = hasta; prev[v]; v = prev[v].desde) camino.unshift(prev[v].sal);
      return camino;
    }

    var pasos = [];
    var punto = aristas[0].coords[0], nodo = aristas[0].a;
    function recta(desde, hasta) {
      var d = distM(desde, hasta);
      if (d > 0.5) pasos.push({ id: null, coords: [desde, hasta], recolecta: false, largo: d });
    }
    aristas.forEach(function (e) {
      var inicio = e.coords[0];
      var d = distM(punto, inicio);
      if (d > 0.5) {
        var camino = d <= CRUCE_M ? null : caminoA(nodo, e.a);
        if (d <= CRUCE_M) {
          recta(punto, inicio);                       // cruzar la avenida / la esquina
        } else if (camino && camino.length) {
          camino.forEach(function (sal) {             // vuelve por calles ya recorridas
            var c = sal.inv ? sal.e.coords.slice().reverse() : sal.e.coords;
            recta(punto, c[0]);
            pasos.push({ id: sal.e.id, coords: c, recolecta: false, largo: sal.e.largo });
            punto = c[c.length - 1];
          });
          recta(punto, inicio);
        } else {
          pasos.push({ id: null, coords: [inicio, inicio], recolecta: false, largo: 0, salto: true });   // la ruta sale del mapa
        }
      }
      pasos.push({ id: e.id, coords: e.coords, recolecta: true, largo: e.largo });
      e.hecha = true;
      punto = e.coords[e.coords.length - 1];
      nodo = e.b;
    });
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

  var api = { planificar: planificar, planificarEnOrden: planificarEnOrden, puntoEn: puntoEn, distM: distM };
  root.Simulacion = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
