/* ==========================================================
   Camión En Ruta · algoritmo del sistema de colores
   Funciones puras (sin red ni DOM) para poder probarlas fácil.

   Idea central: en cada ruta las calles tienen un ORDEN (1, 2, 3…).
   Lo único que hay que saber es en qué calle va el camión
   ("ordenActual") y en qué fase está la ruta. De ahí salen los colores:

     fase "pendiente"   -> todas gris
     fase "finalizado"  -> todas negro
     fase "en_curso"    -> orden <  actual               -> negro    (ya pasó)
                           orden == actual               -> verde    (recolectando)
                           actual < orden <= actual+N    -> amarillo (próximas N calles)
                           el resto                      -> gris     (aún no pasa)

   "ordenActual" puede venir de dos fuentes:
     horario -> se estima con la hora (estimarPorHorario)
     gps     -> se calcula con la posición del camión (indicePorGPS)
   ========================================================== */
(function (root) {
  "use strict";

  /** callesRuta: [{id, orden}], fase: "pendiente"|"en_curso"|"finalizado" */
  function estadosDeRuta(callesRuta, fase, ordenActual, proximas) {
    var n = proximas == null ? 2 : proximas;
    var out = {};
    callesRuta.forEach(function (c) {
      var e = "gris";
      if (fase === "finalizado") {
        e = "negro";
      } else if (fase === "en_curso") {
        if (c.orden < ordenActual) e = "negro";
        else if (c.orden === ordenActual) e = "verde";
        else if (c.orden <= ordenActual + n) e = "amarillo";
      }
      out[c.id] = e;
    });
    return out;
  }

  function aMinutos(hhmm) {
    var p = String(hhmm).split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }

  /**
   * Estima fase y calle actual solo con la hora. Es una ESTIMACIÓN: reparte
   * el tiempo del horario en partes iguales entre las calles. No uses este
   * modo si lo presentas como información en tiempo real.
   *
   * horarios: [{dias:[1,3,5], hora_inicio:"07:00", hora_fin:"10:00"}]  (0 = domingo)
   * avisoMin: minutos antes del inicio en que las primeras calles pasan a amarillo.
   * No contempla horarios que cruzan la medianoche.
   */
  function estimarPorHorario(ahora, horarios, nCalles, avisoMin) {
    var aviso = avisoMin == null ? 15 : avisoMin;
    var dia = ahora.getDay();
    var m = ahora.getHours() * 60 + ahora.getMinutes();
    var hayPasado = false, hayFuturo = false;

    for (var i = 0; i < horarios.length; i++) {
      var h = horarios[i];
      if (h.dias.indexOf(dia) < 0) continue;
      var ini = aMinutos(h.hora_inicio), fin = aMinutos(h.hora_fin);
      if (fin <= ini) continue;
      if (m >= ini && m < fin) {
        var orden = Math.min(nCalles, Math.floor(((m - ini) / (fin - ini)) * nCalles) + 1);
        return { fase: "en_curso", orden: orden };
      }
      if (m >= ini - aviso && m < ini) return { fase: "en_curso", orden: 0 };
      if (m >= fin) hayPasado = true;
      if (m < ini - aviso) hayFuturo = true;
    }
    if (hayPasado && !hayFuturo) return { fase: "finalizado", orden: nCalles };
    return { fase: "pendiente", orden: 0 };
  }

  // ---------- Geometría para el GPS ----------
  // Distancia (metros) de un punto a un segmento, en un plano local.
  // Suficiente para distancias de unas cuadras.
  function distPuntoSegmento(p, a, b, lat0) {
    var kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    var px = p.lng * kx, py = p.lat * ky;
    var ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky;
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }

  /**
   * A partir de la posición del camión, devuelve el orden de la calle más
   * cercana de la ruta, o null si el camión está a más de umbralM metros de
   * todas (fuera de la ruta o señal dudosa).
   * pos: {lat,lng}
   * calles: [{id, orden, lineas:[ [[lng,lat],…], … ]}]  (una calle puede tener varios tramos
   *         separados; cada tramo se recorre por su cuenta, sin unir el final de uno con el inicio del siguiente)
   * previo: orden anterior; el resultado nunca retrocede de él.
   */
  function indicePorGPS(pos, calles, previo, umbralM) {
    var umbral = umbralM == null ? 40 : umbralM;
    var mejor = null;
    calles.forEach(function (c) {
      var lineas = c.lineas || [c.coords || []];
      lineas.forEach(function (linea) {
        for (var i = 0; i < linea.length - 1; i++) {
          var d = distPuntoSegmento(pos, linea[i], linea[i + 1], pos.lat);
          if (!mejor || d < mejor.distancia) mejor = { orden: c.orden, id: c.id, distancia: d };
        }
      });
    });
    if (!mejor || mejor.distancia > umbral) return null;
    return { orden: Math.max(previo || 0, mejor.orden), id: mejor.id, distancia: mejor.distancia };
  }

  // ==========================================================
  // AVANCE REAL POR GPS (lo usa la app del conductor y el mapa)
  //
  // En vez de suponer un orden de calles, se anota qué partes de cada
  // calle recorrió de verdad el camión:
  //   - Cada calle se divide en "puntos de control" cada pocos metros.
  //   - Cuando el camión pasa cerca de un punto, ese punto queda recorrido.
  //   - Verde  = el camión está ahora en esa calle.
  //   - Negro  = el camión recorrió casi toda la calle (umbral, p. ej. 80 %) y ya salió.
  //   - Gris   = todavía no la recorre (o solo cruzó una esquina).
  //   No hay amarillo: sin el orden oficial de la ruta no se puede saber cuál sigue.
  // ==========================================================
  var KX = function (lat) { return 111320 * Math.cos((lat * Math.PI) / 180); }, KY = 110540;

  /** Distancia aproximada en metros entre dos puntos {lat,lng}. */
  function distanciaM(a, b) {
    var dx = (a.lng - b.lng) * KX(a.lat), dy = (a.lat - b.lat) * KY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Distancia (m) de un punto a la calle más cercana de sus tramos. lineas: [[[lng,lat],…],…] */
  function distanciaACalle(pos, lineas) {
    var min = Infinity;
    (lineas || []).forEach(function (linea) {
      for (var i = 0; i < linea.length - 1; i++) {
        var d = distPuntoSegmento(pos, linea[i], linea[i + 1], pos.lat);
        if (d < min) min = d;
      }
      if (linea.length === 1) min = Math.min(min, distanciaM(pos, { lng: linea[0][0], lat: linea[0][1] }));
    });
    return min;
  }

  /** Divide una calle en puntos de control cada pasoM metros. Devuelve [{lat,lng}]. */
  function muestrearCalle(lineas, pasoM) {
    var paso = pasoM || 8, puntos = [];
    (lineas || []).forEach(function (linea) {
      for (var i = 0; i < linea.length - 1; i++) {
        var a = { lng: linea[i][0], lat: linea[i][1] }, b = { lng: linea[i + 1][0], lat: linea[i + 1][1] };
        var n = Math.max(1, Math.ceil(distanciaM(a, b) / paso));
        for (var k = 0; k < n; k++) {
          var t = k / n;
          puntos.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
        }
      }
      if (linea.length) { var u = linea[linea.length - 1]; puntos.push({ lng: u[0], lat: u[1] }); }
    });
    return puntos;
  }

  /** Puntos intermedios entre dos lecturas del GPS (para no saltarse tramos si el camión va rápido). */
  function puntosEntre(a, b, pasoM) {
    var paso = pasoM || 5;
    if (!a) return [b];
    var n = Math.max(1, Math.ceil(distanciaM(a, b) / paso)), out = [];
    for (var k = 1; k <= n; k++) {
      var t = k / n;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
    return out;
  }

  /** Marca como recorridos los puntos de control a menos de radioM de p. Devuelve cuántos se marcaron nuevos. */
  function marcarCercanos(puntos, visitados, p, radioM) {
    var nuevos = 0;
    for (var i = 0; i < puntos.length; i++) {
      if (!visitados[i] && distanciaM(puntos[i], p) <= radioM) { visitados[i] = 1; nuevos++; }
    }
    return nuevos;
  }

  /** Fracción recorrida (0 a 1). */
  function fraccion(visitados) {
    if (!visitados.length) return 0;
    var s = 0;
    for (var i = 0; i < visitados.length; i++) s += visitados[i] ? 1 : 0;
    return s / visitados.length;
  }

  /**
   * En qué calle está el camión. Para que no "salte" en las esquinas, se queda
   * con la calle actual mientras siga cerca y otra no esté claramente más cerca.
   * calles: [{id, lineas}] ; devuelve el id o null si está lejos de todas.
   */
  function calleActual(pos, calles, actualId, umbralM, margenM) {
    var umbral = umbralM == null ? 40 : umbralM, margen = margenM == null ? 8 : margenM;
    var mejor = null, dActual = Infinity;
    calles.forEach(function (c) {
      var d = distanciaACalle(pos, c.lineas);
      if (c.id === actualId) dActual = d;
      if (!mejor || d < mejor.d) mejor = { id: c.id, d: d };
    });
    if (!mejor || mejor.d > umbral) return null;
    if (actualId && dActual <= umbral && dActual - mejor.d < margen) return actualId;
    return mejor.id;
  }

  /** Estado de una calle según su avance. enCalle: el camión está ahora en ella. */
  function estadoPorAvance(enCalle, avance, umbralCompleta) {
    if (enCalle) return "verde";
    return avance >= (umbralCompleta == null ? 0.8 : umbralCompleta) ? "negro" : "gris";
  }

  /**
   * Colores de una ruta a partir de lo guardado en la tabla `avance_calles`.
   * callesRuta: [{id}] ; filas: [{calle_id, estado}] ; vigente: hay posición reciente del camión.
   * Si la posición ya no es reciente, una calle "verde" se muestra gris (no se sabe si sigue ahí).
   */
  function estadosPorAvance(callesRuta, filas, vigente) {
    var porCalle = {};
    (filas || []).forEach(function (f) { porCalle[f.calle_id] = f.estado; });
    var out = {};
    callesRuta.forEach(function (c) {
      var e = porCalle[c.id] || "gris";
      if (e === "verde" && !vigente) e = "gris";
      if (e !== "verde" && e !== "negro") e = "gris";
      out[c.id] = e;
    });
    return out;
  }

  var API = {
    estadosDeRuta: estadosDeRuta, estimarPorHorario: estimarPorHorario, indicePorGPS: indicePorGPS,
    distanciaM: distanciaM, distanciaACalle: distanciaACalle, muestrearCalle: muestrearCalle,
    puntosEntre: puntosEntre, marcarCercanos: marcarCercanos, fraccion: fraccion,
    calleActual: calleActual, estadoPorAvance: estadoPorAvance, estadosPorAvance: estadosPorAvance
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.Estado = API;
})(typeof window !== "undefined" ? window : globalThis);
