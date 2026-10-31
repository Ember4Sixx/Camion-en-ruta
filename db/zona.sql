-- Generado por db/osm_a_zona.py (zona delimitada + calles interiores).
-- Ejecutar DESPUÉS de db/schema.sql. REEMPLAZA los datos anteriores de zonas, rutas, calles y ruta_calles
-- (incluidos los de ejemplo). No toca horarios de la ruta cargada ni la tabla posicion_camion.

begin;

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
  ('avenida-mexico-sentido-este-1', 'Avenida México · sentido este · entre Sáenz Peña y Gonzalo Pizarro', '{"type": "LineString", "coordinates": [[-79.8338137, -6.7562263], [-79.8337457, -6.756234], [-79.833744, -6.7562342], [-79.8337195, -6.756237], [-79.8325091, -6.7563739]]}'::jsonb),
  ('avenida-mexico-sentido-este-2', 'Avenida México · sentido este · entre Gonzalo Pizarro y Hernando de Soto', '{"type": "LineString", "coordinates": [[-79.8325091, -6.7563739], [-79.8319303, -6.7564372]]}'::jsonb),
  ('avenida-mexico-sentido-este-3', 'Avenida México · sentido este · entre Hernando de Soto y Chongoyape', '{"type": "LineString", "coordinates": [[-79.8319303, -6.7564372], [-79.8314292, -6.756492]]}'::jsonb),
  ('avenida-mexico-sentido-este-4', 'Avenida México · sentido este · entre Chongoyape y Carlos Castañeda Iparraguirre', '{"type": "LineString", "coordinates": [[-79.8314292, -6.756492], [-79.8310513, -6.756527]]}'::jsonb),
  ('avenida-mexico-sentido-este-5', 'Avenida México · sentido este · entre Carlos Castañeda Iparraguirre y José Carlos Mariátegui', '{"type": "LineString", "coordinates": [[-79.8310513, -6.756527], [-79.8301877, -6.7566185]]}'::jsonb),
  ('avenida-mexico-sentido-este-6', 'Avenida México · sentido este · entre José Carlos Mariátegui y Túpac Amaru', '{"type": "LineString", "coordinates": [[-79.8301877, -6.7566185], [-79.8301838, -6.7566189], [-79.8293662, -6.7567069], [-79.8293657, -6.756707], [-79.8293654, -6.756707]]}'::jsonb),
  ('calle-cacique-cinto', 'Calle Cacique Cinto', '{"type": "LineString", "coordinates": [[-79.8338714, -6.7567038], [-79.8337874, -6.7567133], [-79.8337764, -6.7567145], [-79.8325583, -6.7568429]]}'::jsonb),
  ('calle-atusparias-1', 'Calle Atusparias · entre Túpac Amaru y San Martín', '{"type": "LineString", "coordinates": [[-79.8294042, -6.7571606], [-79.8294194, -6.7571589], [-79.8298166, -6.7571149]]}'::jsonb),
  ('calle-atusparias-2', 'Calle Atusparias · entre San Martín y José Carlos Mariátegui', '{"type": "LineString", "coordinates": [[-79.8298166, -6.7571149], [-79.8302288, -6.7570692]]}'::jsonb),
  ('calle-atusparias-3', 'Calle Atusparias · entre José Carlos Mariátegui y Perú', '{"type": "LineString", "coordinates": [[-79.8302288, -6.7570692], [-79.8306727, -6.7570204]]}'::jsonb),
  ('calle-atusparias-4', 'Calle Atusparias · entre Perú y Carlos Castañeda Iparraguirre', '{"type": "LineString", "coordinates": [[-79.8306727, -6.7570204], [-79.831114, -6.7569719]]}'::jsonb),
  ('jiron-gonzalo-pizarro-1', 'Jirón Gonzalo Pizarro · entre Caminos del Inca y Cacique Collique', '{"type": "LineString", "coordinates": [[-79.8326603, -6.7578157], [-79.8326067, -6.7573047]]}'::jsonb),
  ('jiron-gonzalo-pizarro-2', 'Jirón Gonzalo Pizarro · entre Cacique Collique y Cacique Cinto', '{"type": "LineString", "coordinates": [[-79.8326067, -6.7573047], [-79.8325583, -6.7568429]]}'::jsonb),
  ('jiron-gonzalo-pizarro-3', 'Jirón Gonzalo Pizarro · entre Cacique Cinto y México', '{"type": "LineString", "coordinates": [[-79.8325583, -6.7568429], [-79.8325091, -6.7563739]]}'::jsonb),
  ('avenida-saenz-pena-sentido-sur-1', 'Avenida Sáenz Peña · sentido sur · entre México y Cacique Cinto', '{"type": "LineString", "coordinates": [[-79.833737, -6.7561572], [-79.8338137, -6.7562263], [-79.8338714, -6.7567038]]}'::jsonb),
  ('avenida-saenz-pena-sentido-sur-2', 'Avenida Sáenz Peña · sentido sur · entre Cacique Cinto y Cacique Collique', '{"type": "LineString", "coordinates": [[-79.8338714, -6.7567038], [-79.8339281, -6.7571727]]}'::jsonb),
  ('avenida-saenz-pena-sentido-sur-3', 'Avenida Sáenz Peña · sentido sur · entre Cacique Collique y Caminos del Inca', '{"type": "LineString", "coordinates": [[-79.8339281, -6.7571727], [-79.8339744, -6.7576691]]}'::jsonb),
  ('avenida-saenz-pena-sentido-sur-4', 'Avenida Sáenz Peña · sentido sur · entre Caminos del Inca y Virrey Toledo', '{"type": "LineString", "coordinates": [[-79.8339744, -6.7576691], [-79.8340208, -6.7581545], [-79.8340208, -6.7581549]]}'::jsonb),
  ('calle-cacique-collique', 'Calle Cacique Collique', '{"type": "LineString", "coordinates": [[-79.8339281, -6.7571727], [-79.8338301, -6.7571838], [-79.8338286, -6.757184], [-79.8326067, -6.7573047]]}'::jsonb),
  ('calle-chongoyape', 'Calle Chongoyape', '{"type": "LineString", "coordinates": [[-79.8316511, -6.7584226], [-79.8316504, -6.7584162], [-79.8314292, -6.756492], [-79.8314177, -6.7564124], [-79.8314173, -6.7564091]]}'::jsonb),
  ('calle-carlos-castaneda-iparraguirre-1', 'Calle Carlos Castañeda Iparraguirre · entre Virrey Toledo y Unión', '{"type": "LineString", "coordinates": [[-79.8312755, -6.7584688], [-79.8312743, -6.7584575], [-79.8312261, -6.7580108]]}'::jsonb),
  ('calle-carlos-castaneda-iparraguirre-2', 'Calle Carlos Castañeda Iparraguirre · entre Unión y Atusparias', '{"type": "LineString", "coordinates": [[-79.8312261, -6.7580108], [-79.831114, -6.7569719]]}'::jsonb),
  ('calle-carlos-castaneda-iparraguirre-3', 'Calle Carlos Castañeda Iparraguirre · entre Atusparias y México', '{"type": "LineString", "coordinates": [[-79.831114, -6.7569719], [-79.8310513, -6.756527], [-79.8310408, -6.7564515], [-79.8310406, -6.75645]]}'::jsonb),
  ('calle-tupac-amaru-1', 'Calle Túpac Amaru · entre Virrey Toledo y Unión', '{"type": "LineString", "coordinates": [[-79.8295957, -6.7586418], [-79.8295404, -6.7581953]]}'::jsonb),
  ('calle-tupac-amaru-2', 'Calle Túpac Amaru · entre Unión y Atusparias', '{"type": "LineString", "coordinates": [[-79.8295404, -6.7581953], [-79.8294042, -6.7571606]]}'::jsonb),
  ('calle-tupac-amaru-3', 'Calle Túpac Amaru · entre Atusparias y México', '{"type": "LineString", "coordinates": [[-79.8294042, -6.7571606], [-79.8293674, -6.7567212], [-79.8293662, -6.7567069], [-79.8293569, -6.7566329]]}'::jsonb),
  ('calle-jose-carlos-mariategui-1', 'Calle José Carlos Mariátegui · entre Virrey Toledo y Unión', '{"type": "LineString", "coordinates": [[-79.830392, -6.7585611], [-79.8303914, -6.7585544], [-79.8303533, -6.7581055]]}'::jsonb),
  ('calle-jose-carlos-mariategui-2', 'Calle José Carlos Mariátegui · entre Unión y Atusparias', '{"type": "LineString", "coordinates": [[-79.8303533, -6.7581055], [-79.8302288, -6.7570692]]}'::jsonb),
  ('calle-jose-carlos-mariategui-3', 'Calle José Carlos Mariátegui · entre Atusparias y México', '{"type": "LineString", "coordinates": [[-79.8302288, -6.7570692], [-79.8301838, -6.7566189], [-79.8301796, -6.7565435], [-79.8301795, -6.7565409]]}'::jsonb),
  ('pasaje-peru', 'Pasaje Perú', '{"type": "LineString", "coordinates": [[-79.8307811, -6.7580591], [-79.8306727, -6.7570204]]}'::jsonb),
  ('pasaje-san-martin', 'Pasaje San Martín', '{"type": "LineString", "coordinates": [[-79.8298166, -6.7571149], [-79.8299499, -6.7581492]]}'::jsonb),
  ('calle-caminos-del-inca-1', 'Calle Caminos del Inca · entre Sáenz Peña y Gonzalo Pizarro', '{"type": "LineString", "coordinates": [[-79.8339744, -6.7576691], [-79.8338758, -6.75768], [-79.8338751, -6.7576801], [-79.8326603, -6.7578157]]}'::jsonb),
  ('calle-caminos-del-inca-2', 'Calle Caminos del Inca · entre Gonzalo Pizarro y Hernando de Soto', '{"type": "LineString", "coordinates": [[-79.8326603, -6.7578157], [-79.832086, -6.7578798]]}'::jsonb),
  ('jiron-hernando-de-soto-1', 'Jirón Hernando de Soto · entre Virrey Toledo y Caminos del Inca', '{"type": "LineString", "coordinates": [[-79.8321381, -6.7583628], [-79.8321381, -6.7583627], [-79.832086, -6.7578798]]}'::jsonb),
  ('jiron-hernando-de-soto-2', 'Jirón Hernando de Soto · entre Caminos del Inca y México', '{"type": "LineString", "coordinates": [[-79.832086, -6.7578798], [-79.8319303, -6.7564372]]}'::jsonb),
  ('calle-union-1', 'Calle Unión · entre Túpac Amaru y San Martín', '{"type": "LineString", "coordinates": [[-79.8295404, -6.7581953], [-79.8295426, -6.7581951], [-79.8299499, -6.7581492]]}'::jsonb),
  ('calle-union-2', 'Calle Unión · entre San Martín y José Carlos Mariátegui', '{"type": "LineString", "coordinates": [[-79.8299499, -6.7581492], [-79.8303533, -6.7581055]]}'::jsonb),
  ('calle-union-3', 'Calle Unión · entre José Carlos Mariátegui y Perú', '{"type": "LineString", "coordinates": [[-79.8303533, -6.7581055], [-79.8307811, -6.7580591]]}'::jsonb),
  ('calle-union-4', 'Calle Unión · entre Perú y Carlos Castañeda Iparraguirre', '{"type": "LineString", "coordinates": [[-79.8307811, -6.7580591], [-79.8312261, -6.7580108]]}'::jsonb),
  ('calle-virrey-toledo-1', 'Calle Virrey Toledo · entre Sáenz Peña y Hernando de Soto', '{"type": "LineString", "coordinates": [[-79.8340208, -6.7581545], [-79.8339192, -6.7581671], [-79.8334417, -6.7582261], [-79.8321381, -6.7583628]]}'::jsonb),
  ('calle-virrey-toledo-2', 'Calle Virrey Toledo · entre Hernando de Soto y Chongoyape', '{"type": "LineString", "coordinates": [[-79.8321381, -6.7583628], [-79.8316511, -6.7584226]]}'::jsonb),
  ('calle-virrey-toledo-3', 'Calle Virrey Toledo · entre Chongoyape y Carlos Castañeda Iparraguirre', '{"type": "LineString", "coordinates": [[-79.8316511, -6.7584226], [-79.8312755, -6.7584688]]}'::jsonb),
  ('calle-virrey-toledo-4', 'Calle Virrey Toledo · entre Carlos Castañeda Iparraguirre y José Carlos Mariátegui', '{"type": "LineString", "coordinates": [[-79.8312755, -6.7584688], [-79.830392, -6.7585611]]}'::jsonb),
  ('calle-virrey-toledo-5', 'Calle Virrey Toledo · entre José Carlos Mariátegui y Túpac Amaru', '{"type": "LineString", "coordinates": [[-79.830392, -6.7585611], [-79.8295957, -6.7586418]]}'::jsonb),
  ('avenida-mexico-sentido-oeste-1', 'Avenida México · sentido oeste · entre Túpac Amaru y José Carlos Mariátegui', '{"type": "LineString", "coordinates": [[-79.8293569, -6.7566329], [-79.8301795, -6.7565409]]}'::jsonb),
  ('avenida-mexico-sentido-oeste-2', 'Avenida México · sentido oeste · entre José Carlos Mariátegui y Carlos Castañeda Iparraguirre', '{"type": "LineString", "coordinates": [[-79.8301795, -6.7565409], [-79.8307331, -6.7564834], [-79.8310408, -6.7564515]]}'::jsonb),
  ('avenida-mexico-sentido-oeste-3', 'Avenida México · sentido oeste · entre Carlos Castañeda Iparraguirre y Chongoyape', '{"type": "LineString", "coordinates": [[-79.8310408, -6.7564515], [-79.8314176, -6.7564124]]}'::jsonb),
  ('avenida-mexico-sentido-oeste-4', 'Avenida México · sentido oeste · entre Chongoyape y Hernando de Soto', '{"type": "LineString", "coordinates": [[-79.8314176, -6.7564124], [-79.8314177, -6.7564124], [-79.8318395, -6.7563702], [-79.8319214, -6.7563607]]}'::jsonb),
  ('avenida-mexico-sentido-oeste-5', 'Avenida México · sentido oeste · entre Hernando de Soto y Gonzalo Pizarro', '{"type": "LineString", "coordinates": [[-79.8319214, -6.7563607], [-79.8322675, -6.7563204], [-79.8325011, -6.7562962]]}'::jsonb),
  ('avenida-mexico-sentido-oeste-6', 'Avenida México · sentido oeste · entre Gonzalo Pizarro y Sáenz Peña', '{"type": "LineString", "coordinates": [[-79.8325011, -6.7562962], [-79.8327407, -6.7562714], [-79.8331437, -6.7562216], [-79.8332193, -6.7562123], [-79.8333412, -6.7562], [-79.8333644, -6.7561977], [-79.8336156, -6.7561724], [-79.833737, -6.7561572]]}'::jsonb),
  ('avenida-saenz-pena-sentido-norte-1', 'Avenida Sáenz Peña · sentido norte · entre Virrey Toledo y Caminos del Inca', '{"type": "LineString", "coordinates": [[-79.8339192, -6.7581671], [-79.8338758, -6.75768]]}'::jsonb),
  ('avenida-saenz-pena-sentido-norte-2', 'Avenida Sáenz Peña · sentido norte · entre Caminos del Inca y Cacique Collique', '{"type": "LineString", "coordinates": [[-79.8338758, -6.75768], [-79.8338598, -6.7575123], [-79.8338286, -6.757184]]}'::jsonb),
  ('avenida-saenz-pena-sentido-norte-3', 'Avenida Sáenz Peña · sentido norte · entre Cacique Collique y Cacique Cinto', '{"type": "LineString", "coordinates": [[-79.8338286, -6.757184], [-79.8337764, -6.7567145]]}'::jsonb),
  ('avenida-saenz-pena-sentido-norte-4', 'Avenida Sáenz Peña · sentido norte · entre Cacique Cinto y México', '{"type": "LineString", "coordinates": [[-79.8337764, -6.7567145], [-79.8337195, -6.756237], [-79.833737, -6.7561572]]}'::jsonb)
on conflict (id) do update set nombre = excluded.nombre, geom = excluded.geom;

insert into ruta_calles (ruta_id, calle_id, orden) values
  ('Ruta 1', 'avenida-mexico-sentido-este-1', 1),
  ('Ruta 1', 'avenida-mexico-sentido-este-2', 2),
  ('Ruta 1', 'avenida-mexico-sentido-este-3', 3),
  ('Ruta 1', 'avenida-mexico-sentido-este-4', 4),
  ('Ruta 1', 'avenida-mexico-sentido-este-5', 5),
  ('Ruta 1', 'avenida-mexico-sentido-este-6', 6),
  ('Ruta 1', 'calle-cacique-cinto', 7),
  ('Ruta 1', 'calle-atusparias-1', 8),
  ('Ruta 1', 'calle-atusparias-2', 9),
  ('Ruta 1', 'calle-atusparias-3', 10),
  ('Ruta 1', 'calle-atusparias-4', 11),
  ('Ruta 1', 'jiron-gonzalo-pizarro-1', 12),
  ('Ruta 1', 'jiron-gonzalo-pizarro-2', 13),
  ('Ruta 1', 'jiron-gonzalo-pizarro-3', 14),
  ('Ruta 1', 'avenida-saenz-pena-sentido-sur-1', 15),
  ('Ruta 1', 'avenida-saenz-pena-sentido-sur-2', 16),
  ('Ruta 1', 'avenida-saenz-pena-sentido-sur-3', 17),
  ('Ruta 1', 'avenida-saenz-pena-sentido-sur-4', 18),
  ('Ruta 1', 'calle-cacique-collique', 19),
  ('Ruta 1', 'calle-chongoyape', 20),
  ('Ruta 1', 'calle-carlos-castaneda-iparraguirre-1', 21),
  ('Ruta 1', 'calle-carlos-castaneda-iparraguirre-2', 22),
  ('Ruta 1', 'calle-carlos-castaneda-iparraguirre-3', 23),
  ('Ruta 1', 'calle-tupac-amaru-1', 24),
  ('Ruta 1', 'calle-tupac-amaru-2', 25),
  ('Ruta 1', 'calle-tupac-amaru-3', 26),
  ('Ruta 1', 'calle-jose-carlos-mariategui-1', 27),
  ('Ruta 1', 'calle-jose-carlos-mariategui-2', 28),
  ('Ruta 1', 'calle-jose-carlos-mariategui-3', 29),
  ('Ruta 1', 'pasaje-peru', 30),
  ('Ruta 1', 'pasaje-san-martin', 31),
  ('Ruta 1', 'calle-caminos-del-inca-1', 32),
  ('Ruta 1', 'calle-caminos-del-inca-2', 33),
  ('Ruta 1', 'jiron-hernando-de-soto-1', 34),
  ('Ruta 1', 'jiron-hernando-de-soto-2', 35),
  ('Ruta 1', 'calle-union-1', 36),
  ('Ruta 1', 'calle-union-2', 37),
  ('Ruta 1', 'calle-union-3', 38),
  ('Ruta 1', 'calle-union-4', 39),
  ('Ruta 1', 'calle-virrey-toledo-1', 40),
  ('Ruta 1', 'calle-virrey-toledo-2', 41),
  ('Ruta 1', 'calle-virrey-toledo-3', 42),
  ('Ruta 1', 'calle-virrey-toledo-4', 43),
  ('Ruta 1', 'calle-virrey-toledo-5', 44),
  ('Ruta 1', 'avenida-mexico-sentido-oeste-1', 45),
  ('Ruta 1', 'avenida-mexico-sentido-oeste-2', 46),
  ('Ruta 1', 'avenida-mexico-sentido-oeste-3', 47),
  ('Ruta 1', 'avenida-mexico-sentido-oeste-4', 48),
  ('Ruta 1', 'avenida-mexico-sentido-oeste-5', 49),
  ('Ruta 1', 'avenida-mexico-sentido-oeste-6', 50),
  ('Ruta 1', 'avenida-saenz-pena-sentido-norte-1', 51),
  ('Ruta 1', 'avenida-saenz-pena-sentido-norte-2', 52),
  ('Ruta 1', 'avenida-saenz-pena-sentido-norte-3', 53),
  ('Ruta 1', 'avenida-saenz-pena-sentido-norte-4', 54)
on conflict (ruta_id, calle_id) do update set orden = excluded.orden;

commit;
