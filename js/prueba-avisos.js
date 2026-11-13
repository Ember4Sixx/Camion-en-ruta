/* ==========================================================
   Camión En Ruta · botón de prueba de avisos (solo modo demo de index.html)
   Manda una notificación de PRUEBA (retraso o adelanto) a los celulares que
   activaron los avisos en vecinos.html. Llama a la función "avisar-retrasos"
   de Supabase con la CLAVE_PRUEBA que el usuario escribe (no se guarda).
   ========================================================== */
(function () {
  const cfg = window.APP_CONFIG || {};
  const caja = document.getElementById("demo-avisos");
  if (!caja) return;
  const sb = cfg.supabase || {};
  if (!cfg.modoDemo || cfg.fuente !== "supabase" || !sb.url || !sb.anonKey) { caja.hidden = true; return; }

  const clave = document.getElementById("prueba-clave");
  const estado = document.getElementById("prueba-estado");
  const botones = caja.querySelectorAll("button[data-tipo]");

  function mostrar(texto, tipo) {
    estado.textContent = texto;
    estado.className = "avisos-estado" + (tipo ? " " + tipo : "");
  }

  async function probar(tipo) {
    if (!clave.value.trim()) { mostrar("Escribe la clave de prueba primero.", "error"); clave.focus(); return; }
    botones.forEach((b) => (b.disabled = true));
    mostrar("Enviando aviso de " + tipo + "…");
    try {
      const r = await fetch(sb.url + "/functions/v1/avisar-retrasos", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + sb.anonKey, apikey: sb.anonKey },
        body: JSON.stringify({ prueba: true, clave: clave.value.trim(), tipo }),
      });
      const datos = await r.json().catch(() => ({}));
      if (r.status === 401) mostrar("Clave de prueba incorrecta.", "error");
      else if (!r.ok) mostrar("No se pudo enviar (" + (datos.error || datos.message || "error " + r.status) + ").", "error");
      else if (!datos.suscritos) mostrar("No hay celulares con avisos activados. Actívalos primero en vecinos.html.", "error");
      else mostrar("Listo: aviso de " + tipo + " enviado a " + datos.enviados + " de " + datos.suscritos + " celular(es).", "ok");
    } catch (e) {
      mostrar("No se pudo conectar con Supabase. Revisa tu internet.", "error");
    } finally {
      botones.forEach((b) => (b.disabled = false));
    }
  }

  botones.forEach((b) => b.addEventListener("click", () => probar(b.dataset.tipo)));
})();
