-- Generado por db/osm_a_zona.py (zona delimitada + calles interiores).
-- Ejecutar DESPUÉS de db/schema.sql. REEMPLAZA los datos anteriores de zonas, rutas, calles y ruta_calles
-- (incluidos los de ejemplo). No toca horarios de la ruta cargada ni la tabla posicion_camion.

delete from zonas;
delete from ruta_calles;
delete from calles;
delete from rutas where id <> 'Ruta 1';

insert into zonas (id, nombre, geom) values
  ('zona-1', 'Zona de recolección', '{"type": "Polygon", "coordinates": [[[-79.833737, -6.7561572], [-79.8293569, -6.7566329], [-79.82959569999998, -6.7586418], [-79.8339192, -6.7581671], [-79.833737, -6.7561572]]]}'::jsonb)
on conflict (id) do update set geom = excluded.geom;

insert into rutas (id, nombre) values
  ('Ruta 1', 'Ruta 1')
on conflict (id) do nothing;

insert into calles (id, nombre, geom) values
  ('avenida-mexico', 'Avenida México', '{"type": "MultiLineString", "coordinates": [[[-79.8293569, -6.7566329], [-79.8301795, -6.7565409], [-79.8307330642823, -6.756483441917059], [-79.8310408, -6.7564515], [-79.8314177, -6.7564124], [-79.8318395, -6.7563702], [-79.8322675, -6.7563204], [-79.8327407, -6.7562714], [-79.8331437157921, -6.756221633528387], [-79.8332193, -6.7562123], [-79.8333412, -6.7562], [-79.83336436085656, -6.756197670409471], [-79.8336156, -6.7561724], [-79.833737, -6.7561572]], [[-79.8338137, -6.7562263], [-79.83374572480808, -6.756234021173603], [-79.83374398188415, -6.756234219149039], [-79.8337195, -6.756237], [-79.8325091, -6.7563739], [-79.8319303, -6.7564372], [-79.8314292, -6.756492], [-79.8310513, -6.756527], [-79.8301838, -6.7566189], [-79.8293662, -6.7567069], [-79.82936570322282, -6.756706956927733], [-79.82936538947443, -6.756706992881446]]]}'::jsonb),
  ('calle-cacique-cinto', 'Calle Cacique Cinto', '{"type": "LineString", "coordinates": [[-79.8338714, -6.7567038], [-79.83378740756679, -6.756713260200373], [-79.8337764, -6.7567145], [-79.8325583, -6.7568429]]}'::jsonb),
  ('calle-atusparias', 'Calle Atusparias', '{"type": "LineString", "coordinates": [[-79.8294042, -6.7571606], [-79.82941942765063, -6.757158912551809], [-79.8298166, -6.7571149], [-79.8302288, -6.7570692], [-79.8306727, -6.7570204], [-79.831114, -6.7569719]]}'::jsonb),
  ('jiron-gonzalo-pizarro', 'Jirón Gonzalo Pizarro', '{"type": "LineString", "coordinates": [[-79.8326603, -6.7578157], [-79.8326067, -6.7573047], [-79.8325583, -6.7568429], [-79.8325091, -6.7563739]]}'::jsonb),
  ('avenida-saenz-pena', 'Avenida Sáenz Peña', '{"type": "MultiLineString", "coordinates": [[[-79.8339192, -6.7581671], [-79.8338758, -6.75768], [-79.83385984340836, -6.757512320562361], [-79.8338286, -6.757184], [-79.8337764, -6.7567145], [-79.8337195, -6.756237], [-79.833737, -6.7561572]], [[-79.833737, -6.7561572], [-79.8338137, -6.7562263], [-79.8338714, -6.7567038], [-79.8339281, -6.7571727], [-79.8339744, -6.7576691], [-79.8340208, -6.7581545], [-79.83402084279365, -6.758154855275101]]]}'::jsonb),
  ('calle-cacique-collique', 'Calle Cacique Collique', '{"type": "LineString", "coordinates": [[-79.8339281, -6.7571727], [-79.8338300656415, -6.757183833550262], [-79.8338286, -6.757184], [-79.8326067, -6.7573047]]}'::jsonb),
  ('calle-chongoyape', 'Calle Chongoyape', '{"type": "LineString", "coordinates": [[-79.8316511, -6.7584226], [-79.83165036524541, -6.758416207403261], [-79.8314292, -6.756492], [-79.8314177, -6.7564124], [-79.83141730474877, -6.756409130099999]]}'::jsonb),
  ('calle-carlos-castaneda-iparraguirre', 'Calle Carlos Castañeda Iparraguirre', '{"type": "LineString", "coordinates": [[-79.8312755, -6.7584688], [-79.83127428114365, -6.758457499671818], [-79.8312261, -6.7580108], [-79.831114, -6.7569719], [-79.8310513, -6.756527], [-79.8310408, -6.7564515], [-79.83104062301845, -6.7564500395539175]]}'::jsonb),
  ('calle-tupac-amaru', 'Calle Túpac Amaru', '{"type": "LineString", "coordinates": [[-79.8295957, -6.7586418], [-79.8295404, -6.7581953], [-79.8294042, -6.7571606], [-79.82936740103823, -6.756721239764338], [-79.8293662, -6.7567069], [-79.8293569, -6.7566329]]}'::jsonb),
  ('calle-jose-carlos-mariategui', 'Calle José Carlos Mariátegui', '{"type": "LineString", "coordinates": [[-79.830392, -6.7585611], [-79.83039143361626, -6.758554432185117], [-79.8303533, -6.7581055], [-79.8302288, -6.7570692], [-79.8301838, -6.7566189], [-79.83017964585979, -6.756543545828746], [-79.8301795, -6.7565409]]}'::jsonb),
  ('pasaje-peru', 'Pasaje Perú', '{"type": "LineString", "coordinates": [[-79.8307811, -6.7580591], [-79.8306727, -6.7570204]]}'::jsonb),
  ('pasaje-san-martin', 'Pasaje San Martín', '{"type": "LineString", "coordinates": [[-79.8298166, -6.7571149], [-79.8299499, -6.7581492]]}'::jsonb),
  ('calle-caminos-del-inca', 'Calle Caminos del Inca', '{"type": "LineString", "coordinates": [[-79.8339744, -6.7576691], [-79.8338758, -6.75768], [-79.83387505134013, -6.757680083581361], [-79.8326603, -6.7578157], [-79.832086, -6.7578798]]}'::jsonb),
  ('jiron-hernando-de-soto', 'Jirón Hernando de Soto', '{"type": "LineString", "coordinates": [[-79.8321381, -6.7583628], [-79.83213808469337, -6.758362658097851], [-79.832086, -6.7578798], [-79.8319303, -6.7564372]]}'::jsonb),
  ('calle-union', 'Calle Unión', '{"type": "LineString", "coordinates": [[-79.8295404, -6.7581953], [-79.82954259471795, -6.758195052926745], [-79.8299499, -6.7581492], [-79.8303533, -6.7581055], [-79.8307811, -6.7580591], [-79.8312261, -6.7580108]]}'::jsonb),
  ('calle-virrey-toledo', 'Calle Virrey Toledo', '{"type": "LineString", "coordinates": [[-79.8340208, -6.7581545], [-79.8339192, -6.7581671], [-79.8334417, -6.7582261], [-79.8321381, -6.7583628], [-79.8316511, -6.7584226], [-79.8312755, -6.7584688], [-79.830392, -6.7585611], [-79.8295957, -6.7586418]]}'::jsonb)
on conflict (id) do update set nombre = excluded.nombre, geom = excluded.geom;

insert into ruta_calles (ruta_id, calle_id, orden) values
  ('Ruta 1', 'avenida-mexico', 1),
  ('Ruta 1', 'calle-cacique-cinto', 2),
  ('Ruta 1', 'calle-atusparias', 3),
  ('Ruta 1', 'jiron-gonzalo-pizarro', 4),
  ('Ruta 1', 'avenida-saenz-pena', 5),
  ('Ruta 1', 'calle-cacique-collique', 6),
  ('Ruta 1', 'calle-chongoyape', 7),
  ('Ruta 1', 'calle-carlos-castaneda-iparraguirre', 8),
  ('Ruta 1', 'calle-tupac-amaru', 9),
  ('Ruta 1', 'calle-jose-carlos-mariategui', 10),
  ('Ruta 1', 'pasaje-peru', 11),
  ('Ruta 1', 'pasaje-san-martin', 12),
  ('Ruta 1', 'calle-caminos-del-inca', 13),
  ('Ruta 1', 'jiron-hernando-de-soto', 14),
  ('Ruta 1', 'calle-union', 15),
  ('Ruta 1', 'calle-virrey-toledo', 16)
on conflict (ruta_id, calle_id) do update set orden = excluded.orden;

