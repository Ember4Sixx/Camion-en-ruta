-- Migración 02 · tabla `avance_calles` (avance REAL del camión por calle)
-- Pégala en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez sin problema.
--
-- La escribe la app del conductor (conductor/) mientras el camión recorre la ruta:
--   estado  'verde' = el camión está ahora en esa calle
--           'negro' = la recorrió casi completa (80 % o más) y ya salió
--           'gris'  = la tocó un poco (por ejemplo, solo cruzó una esquina) pero no la recorrió
--   avance  fracción recorrida, de 0 a 1
--   tramos  qué puntos de control de la calle ya se recorrieron ("0" y "1"), para poder
--           continuar si se recarga la página del conductor
-- El mapa solo usa las filas del día de hoy; al iniciar un recorrido otro día, la app borra las anteriores.

create table if not exists avance_calles (
  ruta_id      text not null references rutas(id)  on delete cascade,
  calle_id     text not null references calles(id) on delete cascade,
  estado       text not null default 'gris' check (estado in ('gris', 'verde', 'negro')),
  avance       real not null default 0,
  tramos       text not null default '',
  actualizado  timestamptz not null default now(),
  primary key (ruta_id, calle_id)
);

alter table avance_calles enable row level security;

drop policy if exists "lectura publica" on avance_calles;
drop policy if exists "escritura con sesion" on avance_calles;
create policy "lectura publica"      on avance_calles for select using (true);
create policy "escritura con sesion" on avance_calles for all to authenticated using (true) with check (true);

-- Tiempo real: el mapa se actualiza solo cuando cambia el avance.
do $$
begin
  alter publication supabase_realtime add table avance_calles;
exception when duplicate_object then null;
end $$;
