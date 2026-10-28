-- Generado por db/geojson_a_sql.py. Orden de calles = orden del archivo.
insert into rutas (id, nombre) values
  ('Ruta A', 'Ruta A'),
  ('Ruta B', 'Ruta B')
on conflict (id) do nothing;

insert into calles (id, nombre, geom) values
  ('c1', 'Calle Ejemplo 1', '{"type": "LineString", "coordinates": [[-79.8395, -6.757], [-79.8365, -6.757], [-79.8335, -6.757]]}'::jsonb),
  ('c2', 'Calle Ejemplo 2', '{"type": "LineString", "coordinates": [[-79.8395, -6.7585], [-79.8365, -6.7585], [-79.8335, -6.7585]]}'::jsonb),
  ('c3', 'Calle Ejemplo 3', '{"type": "LineString", "coordinates": [[-79.8395, -6.76], [-79.8365, -6.76], [-79.8335, -6.76]]}'::jsonb),
  ('c4', 'Avenida Ejemplo 4', '{"type": "LineString", "coordinates": [[-79.8365, -6.757], [-79.8365, -6.7585], [-79.8365, -6.76]]}'::jsonb),
  ('c5', 'Pasaje Ejemplo 5', '{"type": "LineString", "coordinates": [[-79.8335, -6.757], [-79.8335, -6.7585], [-79.8335, -6.76]]}'::jsonb)
on conflict (id) do update set nombre = excluded.nombre, geom = excluded.geom;

insert into ruta_calles (ruta_id, calle_id, orden) values
  ('Ruta A', 'c1', 1),
  ('Ruta A', 'c2', 2),
  ('Ruta A', 'c3', 3),
  ('Ruta B', 'c4', 1),
  ('Ruta B', 'c5', 2)
on conflict (ruta_id, calle_id) do update set orden = excluded.orden;

insert into recorridos (ruta_id) values
  ('Ruta A'),
  ('Ruta B')
on conflict (ruta_id) do nothing;
