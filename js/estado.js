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

  var API = { estadosDeRuta: estadosDeRuta, estimarPorHorario: estimarPorHorario, indicePorGPS: indicePorGPS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.Estado = API;
})(typeof window !== "undefined" ? window : globalThis);
