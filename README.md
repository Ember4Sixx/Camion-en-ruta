# Camión En Ruta

Página web para saber, calle por calle, si el camión recolector de residuos ya pasó, está cerca, está recolectando o terminó (José Leonardo Ortiz, Chiclayo · ODS 12). HTML + CSS + JavaScript, sin compilar.

> Las calles salen de OpenStreetMap (ver GUIA.md, paso 2B). El **horario oficial** de recolección de la zona todavía está pendiente de confirmar con la municipalidad, así que no hay horarios cargados.

**Para trabajar en equipo, conectar la base de datos, el tiempo real y el GPS, sigan [GUIA.md](GUIA.md).**

## Estructura

```
camion-en-ruta/
├── index.html           Página pública (inicio, ODS 12, mapa, horarios)
├── admin.html           Panel con sesión: enviar la ubicación del camión (GPS del teléfono)
├── css/styles.css       Diseño (variables de color en :root)
├── js/
│   ├── config.js        Ajustes: zona del mapa, fuente de datos, claves de Supabase, GPS
│   ├── estado.js        Algoritmo de colores y GPS (funciones puras)
│   ├── data-source.js   Único archivo que lee datos (JSON o Supabase)
│   ├── map.js           Mapa Leaflet
│   └── main.js          Lista de calles, horarios, panel demo, tiempo real
├── tests/               Pruebas: node tests/pruebas.js · python tests/pruebas_tramos.py
├── data/                Datos del modo "json" (se generan con db/osm_a_zona.py)
└── db/
    ├── schema.sql       Tablas, seguridad y tiempo real (Supabase)
    ├── consulta_overpass.txt  Consulta para bajar de OpenStreetMap las calles de la zona
    ├── osm_a_zona.py    Delimita el perímetro (Sáenz Peña, México, Virrey Toledo, Túpac Amaru) y deja las calles de adentro
    ├── tramos.py        Corta las calles en tramos y separa los carriles de las avenidas de doble vía
    ├── geojson_a_sql.py Convierte un tramos.geojson hecho a mano en SQL
    ├── migracion_01_quitar_recorridos.sql  Para bases creadas con el esquema anterior
    ├── migracion_03_calles_y_tramos.sql    Separa `calles` (catálogo) y `tramos` (pedazos)
    └── horarios.sql     Plantilla para cargar el horario oficial (sin datos)
```

## Probar en local

```
python -m http.server 8000
```
Abre http://localhost:8000 (el navegador bloquea los datos si abres `index.html` con doble clic).

Pruebas de la lógica: `node tests/pruebas.js`

Mapa: © colaboradores de OpenStreetMap · Leaflet. Mantengan la atribución.
