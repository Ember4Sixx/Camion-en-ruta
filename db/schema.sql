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

-- Zona de recolección: el área delimitada por las calles del perímetro (GeoJSON Polygon).
create table zonas (
  id      text  primary key,
  nombre  text  not null,
  geom    jsonb not null
);

-- CALLES: una fila por cada calle del proyecto (ej. "Avenida México"). Es el catálogo; no lleva geometría.
-- `tipo`: 'limite' = calle que cierra el perímetro de la zona; 'interior' = calle de adentro.
create table calles (
  id      text primary key,
  nombre  text not null,
  tipo    text not null default 'interior' check (tipo in ('limite', 'interior'))
);

-- TRAMOS: los pedazos en que se divide cada calle (solo donde hace falta: en las intersecciones con otras
-- calles del proyecto y, en avenidas de doble vía, un carril por sentido). Es lo que se dibuja y se ilumina.
-- `geom` es GeoJSON (LineString), coordenadas [longitud, latitud]. `carril` es '' o 'sentido este', etc.
-- `k` es el número del tramo dentro de su calle/carril (1 = el primero en el sentido de la marcha).
create table tramos (
  id        text primary key,
  calle_id  text not null references calles(id) on delete cascade,
  nombre    text not null,
  carril    text not null default '',
  k         int  not null default 1,
  geom      jsonb not null
);
create index tramos_calle_id_idx on tramos (calle_id);

-- Qué tramos tiene cada ruta y en qué ORDEN los recorre el camión (1, 2, 3…).
-- El orden inicial que genera db/osm_a_zona.py es PROVISIONAL: hay que ajustarlo al recorrido real.
create table ruta_tramos (
  ruta_id  text not null references rutas(id)   on delete cascade,
  tramo_id text not null references tramos(id)  on delete cascade,
  orden    int  not null,
  primary key (ruta_id, tramo_id),
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

-- Avance REAL del camión por tramo (lo escribe la app del conductor, carpeta conductor/).
-- estado: 'verde' = el camión está ahí, 'negro' = lo recorrió casi completo, 'gris' = aún no.
-- `puntos`: qué puntos de control del tramo ya se recorrieron ("0" y "1"), para poder continuar si se recarga.
-- El mapa solo usa las filas de hoy. Ver db/migracion_02_avance_calles.sql y db/migracion_03_calles_y_tramos.sql.
create table avance_tramos (
  ruta_id      text not null references rutas(id)   on delete cascade,
  tramo_id     text not null references tramos(id)  on delete cascade,
  estado       text not null default 'gris' check (estado in ('gris', 'verde', 'negro')),
  avance       real not null default 0,
  puntos       text not null default '',
  actualizado  timestamptz not null default now(),
  primary key (ruta_id, tramo_id)
);

-- ---------- Seguridad (RLS) ----------
-- Cualquiera puede LEER (la página es pública). Solo usuarios con sesión pueden ESCRIBIR.
alter table zonas           enable row level security;
alter table rutas           enable row level security;
alter table calles          enable row level security;
alter table tramos          enable row level security;
alter table ruta_tramos    enable row level security;
alter table horarios        enable row level security;
alter table posicion_camion enable row level security;
alter table avance_tramos   enable row level security;

create policy "lectura publica" on zonas           for select using (true);
create policy "lectura publica" on rutas           for select using (true);
create policy "lectura publica" on calles          for select using (true);
create policy "lectura publica" on tramos          for select using (true);
create policy "lectura publica" on ruta_tramos    for select using (true);
create policy "lectura publica" on horarios        for select using (true);
create policy "lectura publica" on posicion_camion for select using (true);
create policy "lectura publica" on avance_tramos   for select using (true);

create policy "escritura con sesion" on zonas           for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on rutas           for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on calles          for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on tramos          for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on ruta_tramos    for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on horarios        for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on posicion_camion for all to authenticated using (true) with check (true);
create policy "escritura con sesion" on avance_tramos   for all to authenticated using (true) with check (true);

-- ---------- Tiempo real ----------
-- Hace que Supabase avise a la página cuando cambia la posición del camión.
alter publication supabase_realtime add table posicion_camion;
alter publication supabase_realtime add table avance_tramos;
