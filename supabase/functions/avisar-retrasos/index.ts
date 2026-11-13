// =====================================================================
// Camión En Ruta · función "avisar-retrasos" (Supabase Edge Function)
//
// Supabase la llama cada minuto (ver db/cron_avisos_retraso.sql). Revisa los
// horarios de hoy y manda una notificación a los celulares que activaron los
// avisos en vecinos.html cuando:
//   · RETRASO:  pasaron TOLERANCIA_MIN minutos desde la hora de inicio de una
//               ruta y el camión todavía no manda su ubicación.
//   · ADELANTO: faltan TOLERANCIA_MIN minutos o más para la hora de inicio y el
//               camión YA está mandando su ubicación (salió antes).
// Avisa UNA sola vez por ruta y turno (tabla avisos_retraso, guarda los dos tipos).
//
// Secretos que necesita (Supabase > Edge Functions > Secrets):
//   VAPID_PUBLICA, VAPID_PRIVADA  -> las claves de notificaciones (npx web-push generate-vapid-keys)
//   VAPID_CONTACTO                -> "mailto:" + un correo del equipo
//   CLAVE_PRUEBA                  -> una palabra secreta para mandar avisos de prueba
//   TOLERANCIA_MIN (opcional)     -> minutos de tolerancia, por defecto 15
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya los pone Supabase solo.
//
// Aviso de prueba (editor de la función > "Test", o el botón del modo demo de index.html):
//   {"prueba": true, "clave": "<CLAVE_PRUEBA>"}                       -> aviso genérico
//   {"prueba": true, "clave": "<CLAVE_PRUEBA>", "tipo": "retraso"}     -> simula un aviso de retraso
//   {"prueba": true, "clave": "<CLAVE_PRUEBA>", "tipo": "adelanto"}    -> simula un aviso de adelanto
// Las pruebas no se anotan en avisos_retraso: no bloquean los avisos reales.
// =====================================================================
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const TOLERANCIA_MIN = Number(Deno.env.get("TOLERANCIA_MIN") ?? "15");
const ADELANTO_MIN = 30;     // si el camión empezó a mandar ubicación hasta 30 min antes de la hora, cuenta como "salió"
const VENTANA_ADELANTO_MIN = 120; // se vigila si sale antes desde 2 horas antes de la hora de inicio
const RECIENTE_MIN = 5;      // la ubicación tiene que ser de los últimos 5 min: el camión está andando AHORA
const LIMA_UTC_MIN = -300;   // Perú: UTC-5 todo el año (no hay horario de verano)
const URL_PAGINA = Deno.env.get("URL_PAGINA") ?? "https://ember4sixx.github.io/Camion-en-ruta/vecinos.html";

// ---------- Cálculo del retraso (sin internet: fácil de probar) ----------

type Horario = { ruta_id: string; dias: number[] | string | null; hora_inicio: string; hora_fin: string };
type Posicion = { ruta_id: string; actualizado: string };
type Retraso = { ruta_id: string; hora_inicio: string; minutos: number };
type Aviso = Retraso & { tipo: "retraso" | "adelanto" };
type Mensaje = { titulo: string; cuerpo: string; url: string; tag: string };

/** Fecha, día de la semana (0 = domingo) y minutos del día en hora de Lima. */
export function horaLima(ahora: Date) {
  const l = new Date(ahora.getTime() + LIMA_UTC_MIN * 60_000);
  return {
    fecha: l.toISOString().slice(0, 10),
    dia: l.getUTCDay(),
    minutos: l.getUTCHours() * 60 + l.getUTCMinutes(),
  };
}

/**
 * Días del horario como números 0-6 (0 = domingo). En la tabla pueden venir como texto
 * ("Lunes, Martes, Miercoles") o como lista de números: igual que diasANumeros() de js/data-source.js.
 */
const NUM_DIA: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
export function diasANumeros(d: unknown): number[] {
  if (Array.isArray(d)) return d.map(Number);
  return String(d ?? "")
    .replace(/[{}\[\]"]/g, "")
    .split(/[,;\/\s]+/)
    .map((x) => x.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .filter(Boolean)
    .map((x) => (x in NUM_DIA ? NUM_DIA[x] : Number(x)))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

/** "07:30:00" -> 450 */
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Rutas retrasadas ahora mismo.
 *   avisados: claves "ruta|HH:MM" de los avisos que ya se mandaron hoy.
 */
export function rutasRetrasadas(
  ahora: Date, horarios: Horario[], posiciones: Posicion[], avisados: Set<string>, tolerancia = TOLERANCIA_MIN,
): Retraso[] {
  const { fecha, dia, minutos } = horaLima(ahora);
  const inicioDelDia = Date.parse(fecha + "T00:00:00Z") - LIMA_UTC_MIN * 60_000; // 00:00 de Lima, en milisegundos UTC
  const out: Retraso[] = [];
  for (const h of horarios) {
    if (!diasANumeros(h.dias).includes(dia)) continue;
    const ini = aMinutos(h.hora_inicio), fin = aMinutos(h.hora_fin);
    // Solo entre (inicio + tolerancia) y el fin del turno, el mismo día
    if (minutos < ini + tolerancia) continue;
    if (fin > ini && minutos >= fin) continue;
    const turno = h.hora_inicio.slice(0, 5);
    if (avisados.has(h.ruta_id + "|" + turno)) continue;
    // ¿El camión ya mandó su ubicación en este turno?
    const desde = inicioDelDia + (ini - ADELANTO_MIN) * 60_000;
    const p = posiciones.find((x) => x.ruta_id === h.ruta_id);
    if (p && Date.parse(p.actualizado) >= desde) continue;
    out.push({ ruta_id: h.ruta_id, hora_inicio: turno, minutos: minutos - ini });
  }
  return out;
}

/**
 * Rutas cuyo camión salió ANTES de su hora (está mandando ubicación ahora y todavía
 * faltan `tolerancia` minutos o más para la hora de inicio).
 *   minutos = cuántos minutos antes de la hora salió.
 */
export function rutasAdelantadas(
  ahora: Date, horarios: Horario[], posiciones: Posicion[], avisados: Set<string>, tolerancia = TOLERANCIA_MIN,
): Retraso[] {
  const { dia, minutos } = horaLima(ahora);
  const out: Retraso[] = [];
  for (const h of horarios) {
    if (!diasANumeros(h.dias).includes(dia)) continue;
    const ini = aMinutos(h.hora_inicio);
    // Solo entre (inicio - 2 h) y (inicio - tolerancia)
    if (minutos < ini - VENTANA_ADELANTO_MIN || minutos > ini - tolerancia) continue;
    const turno = h.hora_inicio.slice(0, 5);
    if (avisados.has(h.ruta_id + "|" + turno)) continue;
    // ¿El camión está mandando su ubicación ahora mismo?
    const p = posiciones.find((x) => x.ruta_id === h.ruta_id);
    if (!p || Date.parse(p.actualizado) < ahora.getTime() - RECIENTE_MIN * 60_000) continue;
    out.push({ ruta_id: h.ruta_id, hora_inicio: turno, minutos: ini - minutos });
  }
  return out;
}

/** Textos de la notificación. */
export function mensajeDe(a: Aviso, prueba = false): Mensaje {
  const extra = prueba ? " (prueba)" : "";
  if (a.tipo === "adelanto") {
    return {
      titulo: `Camión adelantado · ${a.ruta_id}${extra}`,
      cuerpo: `El camión salió antes de su hora: debía salir a las ${a.hora_inicio} y ya está recorriendo (${a.minutos} min antes). Saca tus residuos ahora.`,
      url: URL_PAGINA, tag: `adelanto-${a.ruta_id}`,
    };
  }
  return {
    titulo: `Camión retrasado · ${a.ruta_id}${extra}`,
    cuerpo: `El camión debía salir a las ${a.hora_inicio} y todavía no inicia su recorrido (${a.minutos} min de retraso). Mira el mapa para ver cuándo sale.`,
    url: URL_PAGINA, tag: `retraso-${a.ruta_id}`,
  };
}

// ---------- Envío de notificaciones ----------

type Suscripcion = { endpoint: string; p256dh: string; auth: string };

// deno-lint-ignore no-explicit-any
async function enviar(sb: any, rutaId: string | null, msg: Mensaje) {
  let q = sb.from("suscripciones_push").select("endpoint,p256dh,auth");
  if (rutaId) q = q.or(`ruta_id.is.null,ruta_id.eq."${rutaId.replace(/"/g, "")}"`);
  const { data, error } = await q;
  if (error) throw new Error("No se pudieron leer las suscripciones: " + error.message);
  const subs = (data ?? []) as Suscripcion[];

  let enviados = 0, borrados = 0, fallidos = 0;
  const vencidos: string[] = [];
  const payload = JSON.stringify(msg);
  // De 20 en 20 para no saturar
  for (let i = 0; i < subs.length; i += 20) {
    const lote = subs.slice(i, i + 20);
    const res = await Promise.allSettled(lote.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3 * 3600, urgency: "high" })
    ));
    res.forEach((r, k) => {
      if (r.status === "fulfilled") enviados++;
      else {
        const code = (r.reason as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) vencidos.push(lote[k].endpoint); // el vecino ya no tiene esa suscripción
        else fallidos++;
      }
    });
  }
  if (vencidos.length) {
    await sb.from("suscripciones_push").delete().in("endpoint", vencidos);
    borrados = vencidos.length;
  }
  return { suscritos: subs.length, enviados, borrados, fallidos };
}

// CORS: para que el botón de prueba de index.html (GitHub Pages) pueda llamar a la función
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- La función ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const publica = Deno.env.get("VAPID_PUBLICA"), privada = Deno.env.get("VAPID_PRIVADA");
    if (!publica || !privada) return json({ error: "Faltan los secretos VAPID_PUBLICA y VAPID_PRIVADA" }, 500);
    webpush.setVapidDetails(Deno.env.get("VAPID_CONTACTO") ?? "mailto:camionenruta@example.com", publica, privada);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let cuerpo: Record<string, unknown> = {};
    try { cuerpo = await req.json(); } catch { /* sin cuerpo */ }

    // Aviso de prueba (protegido con CLAVE_PRUEBA)
    if (cuerpo.prueba === true) {
      const clave = Deno.env.get("CLAVE_PRUEBA");
      if (!clave || cuerpo.clave !== clave) return json({ error: "Clave de prueba incorrecta" }, 401);
      const tipo = cuerpo.tipo === "retraso" || cuerpo.tipo === "adelanto" ? cuerpo.tipo : null;
      let msg: Mensaje = {
        titulo: "Camión En Ruta · prueba",
        cuerpo: "Si ves esto, los avisos funcionan.",
        url: URL_PAGINA, tag: "prueba",
      };
      if (tipo) {
        // Usa la primera ruta con horario (o "Ruta 1" a las 19:00 si no hay ninguno)
        const { data } = await sb.from("horarios").select("ruta_id,hora_inicio").order("hora_inicio").limit(1);
        const h = data?.[0] ?? { ruta_id: "Ruta 1", hora_inicio: "19:00" };
        msg = mensajeDe({ tipo, ruta_id: h.ruta_id, hora_inicio: String(h.hora_inicio).slice(0, 5), minutos: 20 }, true);
      }
      const r = await enviar(sb, null, msg);
      return json({ prueba: true, tipo: tipo ?? "general", ...r });
    }

    const ahora = new Date();
    const { fecha } = horaLima(ahora);
    const [h, p, a] = await Promise.all([
      sb.from("horarios").select("ruta_id,dias,hora_inicio,hora_fin"),
      sb.from("posicion_camion").select("ruta_id,actualizado"),
      sb.from("avisos_retraso").select("ruta_id,hora_inicio").eq("fecha", fecha),
    ]);
    for (const r of [h, p, a]) if (r.error) throw new Error(r.error.message);
    const avisados = new Set((a.data ?? []).map((x) => x.ruta_id + "|" + String(x.hora_inicio).slice(0, 5)));
    const avisos: Aviso[] = [
      ...rutasRetrasadas(ahora, h.data ?? [], p.data ?? [], avisados).map((r) => ({ ...r, tipo: "retraso" as const })),
      ...rutasAdelantadas(ahora, h.data ?? [], p.data ?? [], avisados).map((r) => ({ ...r, tipo: "adelanto" as const })),
    ];

    const retrasos: unknown[] = [], adelantos: unknown[] = [];
    for (const r of avisos) {
      // Primero se anota el aviso: si dos ejecuciones coinciden, solo una lo logra y no se manda doble.
      const ins = await sb.from("avisos_retraso").insert({ ruta_id: r.ruta_id, fecha, hora_inicio: r.hora_inicio });
      if (ins.error) continue;
      const envio = await enviar(sb, r.ruta_id, mensajeDe(r));
      await sb.from("avisos_retraso").update({ destinatarios: envio.enviados })
        .match({ ruta_id: r.ruta_id, fecha, hora_inicio: r.hora_inicio });
      (r.tipo === "adelanto" ? adelantos : retrasos).push({ ...r, ...envio });
    }
    return json({ hora_lima: horaLima(ahora), horarios: (h.data ?? []).length, retrasos, adelantos });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
