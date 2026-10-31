-- ==========================================================
-- Camión En Ruta · esquema de base de datos (Supabase / PostgreSQL)
-- Pégalo completo en Supabase > SQL Editor > New query > Run.
-- Se puede ejecutar una sola vez; para empezar de cero borra las tablas antes.
-- ==========================================================

-- Rutas del camión (ej. "Ruta 1"). `proximas` = cuántas calles siguientes salen en amarillo.
create table rutas (
  id        text primary key,
  nombre    text not null,
  proximas  int  not null default 2
);

-- Zona de recolección: el cuadrado delimitado por las 4 calles (GeoJSON Polygon).
create table zonas (
  id      text  primary key,
  nombre  text  not null,
  geom    jsonb not null
);

-- Calles. `geom` es una geometría GeoJSON (LineString o MultiLineString), con coordenadas [longitud, latitud].
create table calles (
  id      text  primary key,
  nombre  text  not null,
  geom    jsonb not null
);

-- Qué calles tiene cada ruta y en qué ORDEN las recorre el camión (1, 2, 3…).
-- El orden inicial que genera db/osm_a_zona.py es PROVISIONAL: hay que ajustarlo al recorrido real.
create table ruta_calles (
  ruta_id  text not null references rutas(id)  on delete cascade,
  calle_id text not null references calles(id) on delete cascade,
  orden    int  not null,
  primary key (ruta_id, calle_id),
  unique (ruta_id, orden)
);

-- Horarios por ruta. `dias`: 0 = domingo, 1 = lunes … 6 = sábado.
create table horarios (
  id           bigint generated always as identity primary key,
  ruta_id      text   not null references rutas(id) on delete cascade,
  dias         int[]  not null,
  hora_inicio  time   not null,
  hora_fin     time   not null
);

-- Última posición conocida del camión (una fila por ruta). Hoy la escribe el teléfono del
-- camión desde admin.html; más adelante la puede escribir el GPS dedicado del camión.
-- El estado de las calles (colores) se calcula con esta posición y con la tabla `horarios`.
create table posicion_camion (
  ruta_id      text primary key references rutas(id) on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  actualizado  timestamptz not null default now()
);

-- Avance REAL del camión por calle (lo escribe la app del conductor, carpeta conductor/).
-- estado: 'verde' = el camión está ahí, 'negro' = la recorrió casi completa, 'gris' = aún no.
-- El mapa solo usa las filas de hoy. Ver db/migracion_02_avance_calles.sql.
create table avance_calles (
  ruta_id      text not null references rutas(id)  on delete cascade,
  calle_id     text not null references calles(id) on delete cascade,
  estado       text not null default 'gris' check (estado in ('gris', 'verde', 'negro')),
  avance       real not null default 0,
  tramos       text not null default '',
  actualizado  timestamptz not null default now(),
  primary key (ruta_id, calle_id)
);

-- ---------- Seguridad (RLS) ----------
-- Cualquiera puede LEER (la página es pública). Solo usuarios con sesión pueden ESCRIBIR.
alter table zonas           enable row level security;
alter table rutas           enable row level security;
alter table calles          enable row level security;
alter table ruta_calles     enable row level security;
alter table horarios        enable row level security;
alter table posicion_camion enable row level security;
alter table avance_calles   enable row level security;

create policy "lectura publica" on zonas           for select using (true);
create policy "lectura publica" on rutas           for select using (true);
create policy "lectura publica" on calles          for select using (true);
create policy "lectura publica" on ruta_calles     for select using (true);
create policy "lectura publica" on horarios        for select using (true);
create policy "lectura publica" on posicion_camion for select using (true);
create policy "lectura publica" on avance_calles   for select using (true);

create policy "escritura con sesion" on zonas           for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on rutas           for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on calles          for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on ruta_calles     for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on horarios        for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on posicion_camion for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on avance_calles   for all to authenticated using (true) with check (true);

-- ---------- Tiempo real ----------
-- Hace que Supabase avise a la página cuando cambia la posición del camión.
alter publication supabase_realtime add table posicion_camion;
alter publication supabase_realtime add table avance_calles;
