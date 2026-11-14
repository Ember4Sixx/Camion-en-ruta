/* ==========================================================
   Camión En Ruta · lógica principal de la página
   ========================================================== */
(function () {
  const cfg = window.APP_CONFIG;
  const ORDEN = ["gris", "amarillo", "verde", "negro"];
  let calles = null;          
  let estados = {};           
  let estadosIniciales = {};  
  let simulacion = null;

  const $ = (s) => document.querySelector(s);

  const toggle = $(".nav-toggle");
  const menu = $("#menu");
  toggle.addEventListener("click", () => {
    const abierto = menu.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(abierto));
  });
  menu.addEventListener("click", (e) => {
    if (e.target.tagName === "A") { menu.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
  });

  $("#anio").textContent = new Date().getFullYear();
  $("#aviso-datos").hidden = !cfg.datosDemostracion;

  const abiertas = new Set();   

  function crearBadge(estado, texto) {
    const badge = document.createElement("span");
    badge.className = "badge badge-" + estado;
    badge.textContent = texto;
    return badge;
  }

  function renderLista(fecha, origen) {
    const ul = $("#lista-calles");
    ul.textContent = "";
    const grupos = new Map();   
    calles.features.forEach((f) => {
      const base = f.properties.calle || Estado.nombreBase(f.properties.nombre);   
      if (!grupos.has(base)) grupos.set(base, []);
      grupos.get(base).push(f);
    });

    grupos.forEach((feats, base) => {
      const li = document.createElement("li");
      if (feats.length === 1) {             
        const id = feats[0].properties.id;
        const e = estados[id] || "gris";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "street-btn";
        const nombre = document.createElement("span");
        nombre.textContent = base;
        btn.append(nombre, crearBadge(e, cfg.estados[e].etiqueta));
        btn.addEventListener("click", () => AppMap.enfocarCalle(id));
        li.append(btn);
        ul.append(li);
        return;
      }

      const res = Estado.resumenGrupo(feats.map((f) => estados[f.properties.id] || "gris"));
      const det = document.createElement("details");
      det.className = "street-group";
      det.open = abiertas.has(base);
      det.addEventListener("toggle", () => { if (det.open) abiertas.add(base); else abiertas.delete(base); });

      const sum = document.createElement("summary");
      sum.className = "street-btn street-sum";
      const nombre = document.createElement("span");
      nombre.textContent = base;
      const cuenta = document.createElement("small");
      cuenta.className = "street-count";
      cuenta.textContent = feats.length + " tramos";
      nombre.append(" ", cuenta);
      const etiqueta = res.estado === "parcial"
        ? res.negros + " de " + res.total + " terminados"
        : cfg.estados[res.estado].etiqueta;
      sum.append(nombre, crearBadge(res.estado, etiqueta));
      det.append(sum);

      const ver = document.createElement("button");
      ver.type = "button";
      ver.className = "street-btn street-sub street-all";
      ver.textContent = "Ver toda la calle en el mapa";
      ver.addEventListener("click", () => AppMap.enfocarCalles(feats.map((f) => f.properties.id)));
      det.append(ver);

      feats.forEach((f) => {
        const id = f.properties.id;
        const e = estados[id] || "gris";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "street-btn street-sub";
        const detalle = document.createElement("span");
        detalle.textContent = f.properties.nombre.split(" · ").slice(1).join(" · ") || f.properties.nombre;
        btn.append(detalle, crearBadge(e, cfg.estados[e].etiqueta));
        btn.addEventListener("click", () => AppMap.enfocarCalle(id));
        det.append(btn);
      });
      li.append(det);
      ul.append(li);
    });
    if (fecha !== undefined) {
      const ORIGEN = {
        horario: "estimado según el horario",
        gps: "calculado con la ubicación del camión",
        mixto: "varias fuentes"
      };
      const base = fecha
        ? "Última actualización: " + new Date(fecha).toLocaleString("es-PE")
        : "Sin fecha de actualización.";
      $("#ultima-actualizacion").textContent = base + (origen && ORIGEN[origen] ? " · Estado " + ORIGEN[origen] + "." : "");
    }
  }

  function aplicarEstados(nuevos, fecha, origen, progreso) {
    estados = nuevos;
    AppMap.actualizarEstados(estados, progreso);
    renderLista(fecha, origen);
  }

  function renderHorarios(h) {
    $("#horarios-nota").textContent = h.nota || "";
    const tb = $("#tabla-horarios");
    tb.textContent = "";
    h.rutas.forEach((r) => {
      const tr = document.createElement("tr");
      [r.ruta, r.dias, r.horario, (r.calles || []).join(", ")].forEach((txt) => {
        const td = document.createElement("td");
        td.textContent = txt;
        tr.append(td);
      });
      tb.append(tr);
    });
  }

  function iniciarDemo() {
    if (!cfg.modoDemo) return;
    $("#panel-demo").hidden = false;
    const sel = $("#demo-calle");
    calles.features.forEach((f) => {
      const o = document.createElement("option");
      o.value = f.properties.id;
      o.textContent = f.properties.nombre;
      sel.append(o);
    });
    $("#demo-aplicar").addEventListener("click", () => {
      detenerSimulacion();
      aplicarEstados({ ...estados, [sel.value]: $("#demo-estado").value });
    });
    $("#demo-reiniciar").addEventListener("click", () => {
      detenerSimulacion();
      aplicarEstados({ ...estadosIniciales });
    });
    $("#demo-simular").addEventListener("click", simular);
  }

  const PROXIMOS = 2;
  let plan = null;            
  let camionSimulado = false; 

  function detenerSimulacion() {
    if (simulacion) cancelAnimationFrame(simulacion);
    simulacion = null;
    $("#demo-simular").textContent = "Simular recorrido";
    if (camionSimulado) {
      camionSimulado = false;
      AppMap.mostrarCamion(null);   
      actualizarCamion();            
    }
  }

  function simular() {
    if (simulacion) { detenerSimulacion(); return; }
    // Si la ruta tiene orden (ruta_tramos), la simulación lo sigue al pie de la letra;
    // si no, arma un recorrido continuo por su cuenta.
    if (!plan) {
      const tieneOrden = calles.features.some((f) => f.properties.orden > 0);
      plan = tieneOrden ? Simulacion.planificarEnOrden(calles) : Simulacion.planificar(calles);
    }
    if (!plan.length) return;

    const ordenRecoleccion = plan.filter((p) => p.recolecta).map((p) => p.id);
    const total = plan.reduce((s, p) => s + p.largo, 0);
    const metrosPorSeg = total / (cfg.simulacionSegundos || 90);

    const hechos = new Set();
    let i = 0;                   
    let recorrido = 0;           
    let antes = performance.now();
    let anguloActual = 0;

    $("#demo-simular").textContent = "Detener simulación";

    // Calcula el rumbo geométrico estricto entre dos nodos consecutivos de la vía
    function calcularRumboCalle(p1, p2) {
      const rad = Math.PI / 180;
      const dLon = (p2[0] - p1[0]) * rad;
      const lat1 = p1[1] * rad;
      const lat2 = p2[1] * rad;
      const y = Math.sin(dLon) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
      const brng = Math.atan2(y, x) * (180 / Math.PI);
      return (brng + 360) % 360;
    }

    // Extremo de la geometría del tramo por donde entra el camión (para llenar la barra desde ahí).
    const primerPunto = {};
    calles.features.forEach((f) => {
      const c = f.geometry.type === "MultiLineString" ? f.geometry.coordinates[0] : f.geometry.coordinates;
      primerPunto[f.properties.id] = c[0];
    });
    const entraPorInicio = (paso) => {
      const a = paso.coords[0], b = primerPunto[paso.id];
      return !b || (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9);
    };

    function pintar() {
      const actual = plan[i];
      const enCurso = actual && actual.recolecta ? actual.id : null;
      const yaHechos = hechos.size + (enCurso ? 1 : 0);
      const proximos = ordenRecoleccion.slice(yaHechos, yaHechos + PROXIMOS);
      const nuevo = {};
      calles.features.forEach((f) => { nuevo[f.properties.id] = "gris"; });
      proximos.forEach((id) => { nuevo[id] = "amarillo"; });
      hechos.forEach((id) => { nuevo[id] = "negro"; });
      if (enCurso) nuevo[enCurso] = "verde";
      const progreso = {};
      if (enCurso) {
        progreso[enCurso] = { f: Math.min(1, recorrido / (actual.largo || 1)), desde: entraPorInicio(actual) ? "inicio" : "fin" };
      }
      aplicarEstados(nuevo, undefined, undefined, progreso);
    }

    function cuadro(ahora) {
      const dt = Math.min(0.1, (ahora - antes) / 1000);   
      antes = ahora;
      recorrido += metrosPorSeg * dt;
      
      while (i < plan.length && recorrido >= plan[i].largo) {
        recorrido -= plan[i].largo;
        if (plan[i].recolecta) hechos.add(plan[i].id);
        i++;
      }

      if (i >= plan.length) {                            
        pintar();
        const fin = plan[plan.length - 1].coords;
        AppMap.mostrarCamion({ lng: fin[fin.length - 1][0], lat: fin[fin.length - 1][1], rumbo: anguloActual });
        simulacion = null;
        $("#demo-simular").textContent = "Simular recorrido";
        return;
      }

      // Obtenemos el tramo actual y sus coordenadas geométricas para forzar el seguimiento de la pista
      const segmento = plan[i];
      const puntoActual = Simulacion.puntoEn(segmento.coords, recorrido);
      
      // Calculamos el ángulo basándonos en los vértices exactos de la polilínea del tramo
      if (segmento.coords && segmento.coords.length > 1) {
        // Buscamos el subsegmento de coordenadas más cercano dentro de la calle
        let idxCoord = 0;
        let distMin = Infinity;
        for (let c = 0; c < segmento.coords.length - 1; c++) {
          const d = Math.abs(segmento.coords[c][0] - puntoActual.lng) + Math.abs(segmento.coords[c][1] - puntoActual.lat);
          if (d < distMin) {
            distMin = d;
            idxCoord = c;
          }
        }
        anguloActual = calcularRumboCalle(segmento.coords[idxCoord], segmento.coords[idxCoord + 1]);
      }

      // Enviamos las coordenadas estrictas sobre la vía y el ángulo coherente de la calle
      AppMap.mostrarCamion({ lat: puntoActual.lat, lng: puntoActual.lng, rumbo: anguloActual });
      pintar();
      simulacion = requestAnimationFrame(cuadro);
    }

    AppMap.mostrarCamion(null);
    camionSimulado = true;
    simulacion = requestAnimationFrame(cuadro);
  }

  async function actualizarCamion() {
    if (!cfg.gpsActivo || simulacion) return;   
    try { AppMap.mostrarCamion(await AppData.camion()); } catch (e) { console.warn("Sin ubicación", e); }
  }

  async function refrescar() {
    if (simulacion) return;   
    if (camionSimulado) { camionSimulado = false; AppMap.mostrarCamion(null); }
    try {
      const e = await AppData.estados();
      aplicarEstados(e.estados || {}, e.actualizado, e.origen, e.progreso);
      actualizarCamion();
    } catch (err) { console.warn("No se pudo refrescar", err); }
  }

  async function iniciar() {
    AppMap.iniciar();
    try {
      const [c, e, h] = await Promise.all([AppData.calles(), AppData.estados(), AppData.horarios()]);
      calles = c;
      estados = e.estados || {};
      estadosIniciales = { ...estados };
      AppMap.pintarZona(await AppData.zona());
      AppMap.pintarCalles(calles, estados, e.progreso);
      renderLista(e.actualizado, e.origen);
      renderHorarios(h);
      iniciarDemo();
      actualizarCamion();
      if (cfg.refrescarCadaSegundos > 0) setInterval(refrescar, cfg.refrescarCadaSegundos * 1000);
      if (AppData.suscribir) AppData.suscribir(refrescar); 
    } catch (err) {
      console.error(err);
      $("#ultima-actualizacion").textContent = "No se pudieron cargar los datos.";
    }
  }

  iniciar();
})();
