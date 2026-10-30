/* ==========================================================
   Camión En Ruta · configuración central
   Casi todo lo que el equipo quiera ajustar está aquí.
   ========================================================== */
window.APP_CONFIG = {
  // Centro y zoom inicial del mapa (José Leonardo Ortiz, Chiclayo).
  // AJUSTAR cuando el equipo delimite la zona real.
  centro: [-6.7585, -79.8365],
  zoom: 16,

  // Muestra el aviso amarillo "Datos de demostración". Ponlo en false
  // solo cuando los datos sean reales y verificados.
  datosDemostracion: true,

  // Muestra el panel para cambiar estados a mano y simular el recorrido
  // (solo en el navegador de quien lo usa, no guarda nada). Ponlo en false al publicar.
  modoDemo: true,

  // Fuente de datos:
  //   "json"      -> archivos de la carpeta /data (versión inicial, sin base de datos)
  //   "supabase"  -> base de datos en línea con tiempo real (ver GUIA.md)
  fuente: "supabase",

  // Solo si fuente === "supabase". Se copian desde Supabase: Project Settings > API.
  // La clave "anon" es pública por diseño; la seguridad la dan las políticas RLS de db/schema.sql.
  // NUNCA pegues aquí la clave "service_role".
  supabase: { url: "https://bltyftujdfowhyjsjjrj.supabase.co", anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsdHlmdHVqZGZvd2h5anNqanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTcxMDgsImV4cCI6MjEwODczMzEwOH0.Ex_YcG7qbprILpf3KZHHFQYfQz8x4l1r8JAC_4wqRDo" },

  // Cada cuántos segundos se vuelven a pedir los estados (0 = no repetir).
  // Con supabase el tiempo real avisa cuando llega una posición del camión; esto sirve
  // además para el cálculo por horario, que cambia con el reloj (30 es un buen valor).
  refrescarCadaSegundos: 30,

  // Minutos antes del inicio del horario en que las primeras calles pasan a amarillo (cálculo por horario).
  avisoMinutos: 15,

  // Distancia máxima (metros) entre el camión y una calle para considerarlo "en esa calle" (GPS).
  umbralGpsMetros: 40,

  // GPS del camión (fuente supabase). En true: se dibuja el camión en el mapa y los colores
  // de las calles salen de su posición; en false, los colores salen solo del horario.
  gpsActivo: false,

  // Segundos máximos de antigüedad de la posición del camión para considerarla vigente.
  // Si es más vieja, no se dibuja el camión y los colores vuelven a calcularse por horario.
  gpsVigenciaSegundos: 120,

  // Textos y colores de los 4 estados. Los colores deben coincidir con css/styles.css.
  estados: {
    gris:     { etiqueta: "Aún no pasa",   descripcion: "El camión todavía no ha pasado",  color: "#8a8f98" },
    amarillo: { etiqueta: "Próximo",       descripcion: "El camión está próximo",          color: "#f2c200" },
    verde:    { etiqueta: "Recolectando",  descripcion: "El camión está recolectando",     color: "#2e9e5b" },
    negro:    { etiqueta: "Finalizado",    descripcion: "La recolección ha finalizado",    color: "#1a1a1a" }
  },

  // Mapa base. Respeta la atribución de OpenStreetMap y sus condiciones de uso
  // (https://operations.osmfoundation.org/policies/tiles/). Para mucho tráfico
  // usa un proveedor de teselas propio.
  teselas: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    atribucion: "&copy; colaboradores de <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>"
  }
};
