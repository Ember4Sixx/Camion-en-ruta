-- Migración 03 · dos tablas: `calles` (las calles) y `tramos` (sus pedazos)
-- Pégala en Supabase > SQL Editor > New query > Run. Para bases creadas con el esquema anterior (v2).
-- Es una sola transacción: si algo falla, no queda nada a medias. NO se puede ejecutar dos veces.
--
-- Antes: la tabla `calles` guardaba los TRAMOS ("Calle Unión · entre A y B"), y `ruta_calles` / `avance_calles`
--        apuntaban a ellos.
-- Ahora: `calles` = una fila por calle (catálogo) · `tramos` = los pedazos de cada calle (lo que se dibuja)
--        `ruta_calles` -> `ruta_tramos` · `avance_calles` -> `avance_tramos`
-- Los datos que ya existen se conservan; después se recomienda volver a generar y cargar db/zona.sql
-- (python db/osm_a_zona.py ...) para que el catálogo y los tramos salgan limpios.

begin;

-- 1) Lo que hoy está en `calles` son tramos: la tabla pasa a llamarse `tramos`.
alter table calles rename to tramos;
alter index calles_pkey rename to tramos_pkey;
alter table tramos
  add column calle_id text,
  add column carril   text not null default '',
  add column k        int  not null default 1;

-- 2) Las tablas que apuntaban a los tramos cambian de nombre (conservan datos, políticas y tiempo real).
alter table ruta_calles rename to ruta_tramos;
alter table ruta_tramos rename column calle_id to tramo_id;
alter table ruta_tramos rename constraint ruta_calles_pkey          to ruta_tramos_pkey;
alter table ruta_tramos rename constraint ruta_calles_ruta_id_fkey  to ruta_tramos_ruta_id_fkey;
alter table ruta_tramos rename constraint ruta_calles_calle_id_fkey to ruta_tramos_tramo_id_fkey;
alter table ruta_tramos rename constraint ruta_calles_ruta_id_orden_key to ruta_tramos_ruta_id_orden_key;

alter table avance_calles rename to avance_tramos;
alter table avance_tramos rename column calle_id to tramo_id;
alter table avance_tramos rename column tramos   to puntos;
alter table avance_tramos rename constraint avance_calles_pkey          to avance_tramos_pkey;
alter table avance_tramos rename constraint avance_calles_ruta_id_fkey  to avance_tramos_ruta_id_fkey;
alter table avance_tramos rename constraint avance_calles_calle_id_fkey to avance_tramos_tramo_id_fkey;
alter table avance_tramos rename constraint avance_calles_estado_check  to avance_tramos_estado_check;

-- 3) La nueva tabla `calles`: una fila por calle, deducida del nombre de cada tramo ("Calle Unión · entre A y B").
create table calles (
  id      text primary key,
  nombre  text not null,
  tipo    text not null default 'interior' check (tipo in ('limite', 'interior'))
);
alter table calles enable row level security;
create policy "lectura publica"      on calles for select using (true);
create policy "escritura con sesion" on calles for all to authenticated using (true) with check (true);

create or replace function pg_temp.slug(t text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(
    lower(translate(t, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^a-z0-9]+', '-', 'g'))
$$;

insert into calles (id, nombre)
select distinct pg_temp.slug(split_part(nombre, ' · ', 1)), split_part(nombre, ' · ', 1) from tramos;

update tramos set
  calle_id = pg_temp.slug(split_part(nombre, ' · ', 1)),
  carril   = coalesce((regexp_match(nombre, '(sentido [a-z]+)'))[1], ''),
  k        = coalesce((regexp_match(id, '-([0-9]+)$'))[1]::int, 1);

alter table tramos alter column calle_id set not null;
alter table tramos add constraint tramos_calle_id_fkey foreign key (calle_id) references calles(id) on delete cascade;
create index tramos_calle_id_idx on tramos (calle_id);

commit;
