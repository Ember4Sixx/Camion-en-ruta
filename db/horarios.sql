-- Horarios de EJEMPLO (reemplazar por los oficiales cuando se verifiquen).
-- dias: 0 = domingo, 1 = lunes, 2 = martes, 3 = miércoles, 4 = jueves, 5 = viernes, 6 = sábado
insert into horarios (ruta_id, dias, hora_inicio, hora_fin) values
  ('Ruta A', '{1,3,5}', '07:00', '10:00'),
  ('Ruta B', '{2,4}',   '07:00', '10:00');
