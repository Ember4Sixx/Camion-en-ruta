# Camión En Ruta

Página web para saber, calle por calle, si el camión recolector de residuos ya pasó, está cerca, está recolectando o terminó (José Leonardo Ortiz, Chiclayo · ODS 12). HTML + CSS + JavaScript, sin compilar.

> Los datos incluidos (calles, estados, horarios) son **de ejemplo**.

**Para trabajar en equipo, conectar la base de datos, el tiempo real y el GPS, sigan [GUIA.md](GUIA.md).**

## Estructura

```
camion-en-ruta/
├── index.html           Página pública (inicio, ODS 12, mapa, horarios)
├── admin.html           Panel con sesión: cambiar estados y enviar ubicación del camión
├── css/styles.css       Diseño (variables de color en :root)
├── js/
│   ├── config.js        Ajustes: zona del mapa, fuente de datos, claves de Supabase
│   ├── estado.js        Algoritmo de colores (funciones puras)
│   ├── data-source.js   Único archivo que lee datos (JSON o Supabase)
│   ├── map.js           Mapa Leaflet
│   └── main.js          Lista de calles, horarios, panel demo, tiempo real
├── data/                Datos de ejemplo (modo "json")
└── db/
    ├── schema.sql       Tablas, seguridad y tiempo real (Supabase)
    ├── consulta_overpass.txt  Consulta para bajar las calles de OpenStreetMap
    ├── osm_a_zona.py    Delimita el cuadrado de 4 calles y extrae las calles de adentro
    ├── geojson_a_sql.py Convierte data/calles.geojson en SQL
    ├── calles.sql       Resultado para las calles de ejemplo
    └── horarios.sql     Horarios de ejemplo
```

## Probar en local

```
python -m http.server 8000
```
Abre http://localhost:8000 (el navegador bloquea los datos si abres `index.html` con doble clic).

Mapa: © colaboradores de OpenStreetMap · Leaflet. Mantengan la atribución.
