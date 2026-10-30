-- Migración 01 · quitar la tabla `recorridos`
-- Para bases de datos creadas con el esquema anterior. Las bases nuevas (db/schema.sql actual) ya no la tienen.
--
-- `recorridos` guardaba la fase y la calle actual que marcaba una persona a mano desde admin.html.
-- Ahora el estado de las calles se calcula con la tabla `horarios` y con la ubicación del camión
-- (`posicion_camion`), así que ya no hace falta. Al borrar la tabla, Supabase también la quita de
-- la publicación de tiempo real; `posicion_camion` sigue publicada.
drop table if exists recorridos;
