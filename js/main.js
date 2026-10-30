/* ==========================================================
   Camión En Ruta · lógica principal de la página
   ========================================================== */
(function () {
  const cfg = window.APP_CONFIG;
  const ORDEN = ["gris", "amarillo", "verde", "negro"];
  let calles = null;          // GeoJSON
  let estados = {};           // id -> estado
  let estadosIniciales = {};  // para "Reiniciar"
  let simulacion = null;

  const $ = (s) => document.querySelector(s);

  // ---------- Menú móvil ----------
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

  // ---------- Lista lateral ----------
  function renderLista(fecha, origen) {
    const ul = $("#lista-calles");
    ul.textContent = "";
    calles.features.forEach((f) => {
      const id = f.properties.id;
      const est = cfg.estados[estados[id] || "gris"];
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "street-btn";
      const nombre = document.createElement("span");
      nombre.textContent = f.properties.nombre;
      const badge = document.createElement("span");
      badge.className = "badge badge-" + (estados[id] || "gris");
      badge.textContent = est.etiqueta;
      btn.append(nombre, badge);
      btn.addEventListener("click", () => AppMap.enfocarCalle(id));
      li.append(btn);
      ul.append(li);
    });
    if (fecha !== undefined) {
      const ORIGEN = {
        horario: "estimado según el horario (no es en tiempo real)",
        gps: "calculado con la ubicación del camión",
        mixto: "varias fuentes"
      };
      const base = fecha
        ? "Última actualización: " + new Date(fecha).toLocaleString("es-PE")
        : "Sin fecha de actualización.";
      $("#ultima-actualizacion").textContent = base + (origen && ORIGEN[origen] ? " · Estado " + ORIGEN[origen] + "." : "");
    }
  }

  function aplicarEstados(nuevos, fecha, origen) {
    estados = nuevos;
    AppMap.actualizarEstados(estados);
    renderLista(fecha, origen);
  }

  // ---------- Horarios ----------
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

  // ---------- Panel demo ----------
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

  function detenerSimulacion() {
    if (simulacion) { clearInterval(simulacion); simulacion = null; $("#demo-simular").textContent = "Simular recorrido"; }
  }

  // Simula el paso del camión: cada calle avanza gris -> amarillo -> verde -> negro en orden.
  function simular() {
    if (simulacion) { detenerSimulacion(); return; }
    const ids = calles.features.map((f) => f.properties.id);
    let paso = 0;
    const total = ids.length + 3;
    aplicarEstados(Object.fromEntries(ids.map((id) => [id, "gris"])));
    $("#demo-simular").textContent = "Detener simulación";
    simulacion = setInterval(() => {
      paso++;
      const nuevo = {};
      ids.forEach((id, i) => {
        const avance = paso - i; // cuántos pasos lleva esta calle en la secuencia
        nuevo[id] = ORDEN[Math.max(0, Math.min(3, avance))];
      });
      aplicarEstados(nuevo);
      if (paso >= total) detenerSimulacion();
    }, 1500);
  }

  // ---------- GPS (opcional) ----------
  async function actualizarCamion() {
    if (!cfg.gpsActivo) return;
    try { AppMap.mostrarCamion(await AppData.camion()); } catch (e) { console.warn("Sin ubicación del camión", e); }
  }

  // ---------- Refresco periódico ----------
  async function refrescar() {
    try {
      const e = await AppData.estados();
      aplicarEstados(e.estados || {}, e.actualizado, e.origen);
      actualizarCamion();
    } catch (err) { console.warn("No se pudo refrescar", err); }
  }

  // ---------- Arranque ----------
  async function iniciar() {
    AppMap.iniciar();
    try {
      const [c, e, h] = await Promise.all([AppData.calles(), AppData.estados(), AppData.horarios()]);
      calles = c;
      estados = e.estados || {};
      estadosIniciales = { ...estados };
      AppMap.pintarZona(await AppData.zona());
      AppMap.pintarCalles(calles, estados);
      renderLista(e.actualizado, e.origen);
      renderHorarios(h);
      iniciarDemo();
      actualizarCamion();
      if (cfg.refrescarCadaSegundos > 0) setInterval(refrescar, cfg.refrescarCadaSegundos * 1000);
      if (AppData.suscribir) AppData.suscribir(refrescar); // tiempo real (solo fuente supabase)
    } catch (err) {
      console.error(err);
      $("#ultima-actualizacion").textContent =
        "No se pudieron cargar los datos. Si abriste index.html con doble clic, usa un servidor local (ver README).";
    }
  }

  iniciar();
})();
