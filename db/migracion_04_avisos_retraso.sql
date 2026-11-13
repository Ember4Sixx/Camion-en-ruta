-- Migración 04 · avisos de retraso por notificación (Web Push)
-- Pégala en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez sin problema.
--
-- Cómo funciona:
--   1. El vecino toca "Activar avisos" en vecinos.html. Su navegador crea una "suscripción"
--      (una dirección para mandarle notificaciones) y la página la guarda con guardar_suscripcion().
--   2. Cada minuto, Supabase llama a la función avisar-retrasos (supabase/functions/avisar-retrasos).
--   3. Si pasaron 15 minutos de la hora de inicio de una ruta (tabla horarios) y el camión todavía
--      no manda su ubicación, la función manda la notificación a todos los suscritos, una sola vez
--      por ruta y turno (tabla avisos_retraso).

-- Navegadores que activaron los avisos. Nadie la puede leer desde la página (no tiene políticas):
-- solo se escribe con las funciones de abajo y solo la lee la función del servidor.
create table if not exists suscripciones_push (
  endpoint      text primary key,               -- dirección de notificaciones del navegador
  p256dh        text not null,                  -- clave pública del navegador (para cifrar el mensaje)
  auth          text not null,                  -- clave secreta corta del navegador
  ruta_id       text references rutas(id) on delete cascade,  -- null = avisar de todas las rutas
  creado        timestamptz not null default now(),
  ultimo_envio  timestamptz
);
alter table suscripciones_push enable row level security;

-- Avisos ya enviados: uno por ruta, día y turno (para no mandar el mismo aviso cada minuto).
create table if not exists avisos_retraso (
  ruta_id        text not null references rutas(id) on delete cascade,
  fecha          date not null,                 -- día en hora de Lima
  hora_inicio    time not null,                 -- turno (hora de inicio del horario)
  enviado        timestamptz not null default now(),
  destinatarios  int  not null default 0,
  primary key (ruta_id, fecha, hora_inicio)
);
alter table avisos_retraso enable row level security;
drop policy if exists "lectura publica" on avisos_retraso;
create policy "lectura publica" on avisos_retraso for select using (true);

-- Guardar (o actualizar) la suscripción de un navegador. La página la llama sin iniciar sesión.
create or replace function guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text, p_ruta text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then
    raise exception 'Suscripción no válida: endpoint';
  end if;
  if length(coalesce(p_p256dh, '')) not between 40 and 200 or length(coalesce(p_auth, '')) not between 10 and 100 then
    raise exception 'Suscripción no válida: claves';
  end if;
  insert into suscripciones_push (endpoint, p256dh, auth, ruta_id)
  values (p_endpoint, p_p256dh, p_auth, p_ruta)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, ruta_id = excluded.ruta_id;
end;
$$;

-- Borrar la suscripción (cuando el vecino toca "Desactivar avisos").
create or replace function borrar_suscripcion(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from suscripciones_push where endpoint = p_endpoint;
$$;

revoke all on function guardar_suscripcion(text, text, text, text) from public;
revoke all on function borrar_suscripcion(text) from public;
grant execute on function guardar_suscripcion(text, text, text, text) to anon, authenticated;
grant execute on function borrar_suscripcion(text) to anon, authenticated;
