# Camión En Ruta

Página web para saber, calle por calle, si el camión recolector de residuos ya pasó, está cerca, está recolectando o terminó (José Leonardo Ortiz, Chiclayo · ODS 12). HTML + CSS + JavaScript, sin compilar. Datos en Supabase con tiempo real.

> Las calles salen de OpenStreetMap (ver GUIA.md, paso 2B). El **horario oficial** de recolección de la zona todavía está pendiente de confirmar con la municipalidad.

## Qué tiene el proyecto

- **Mapa por tramos:** cada calle se divide en tramos que se pintan según el estado: gris (aún no pasa), amarillo (próximo), verde (recolectando) y negro (finalizado).
- **GPS real del camión:** la app del conductor manda la posición del camión y anota los tramos que de verdad recorrió (`avance_tramos`).
- **Simulación del recorrido:** en `index.html`, el modo demo mueve el camión por la red de tramos sin saltar de calle en calle.
- **Avisos de retraso y de adelanto:** si el camión no sale a su hora o sale antes (15 min de tolerancia), los vecinos que activaron los avisos reciben una notificación en el celular, aunque tengan la página cerrada (Web Push). En el modo demo de `index.html` hay botones para mandar avisos de prueba.

## Estructura

```
camion-en-ruta/
├── index.html           Página pública con modo demo (inicio, ODS 12, mapa, horarios, simulación)
├── vecinos.html         Página para los vecinos: sin modo demo y con el botón "Avísame si el camión se retrasa o se adelanta"
├── admin.html           Panel con sesión: enviar la ubicación del camión (GPS del teléfono)
├── sw.js                Service worker: muestra las notificaciones de retraso aunque la página esté cerrada
├── manifest.webmanifest Permite instalar vecinos.html como app (necesario para avisos en iPhone)
├── css/styles.css       Diseño (variables de color en :root)
├── js/
│   ├── config.js        Ajustes: zona del mapa, fuente de datos, claves de Supabase, GPS, clave PÚBLICA de avisos
│   ├── estado.js        Algoritmo de colores y GPS (funciones puras)
│   ├── data-source.js   Único archivo que lee datos (JSON o Supabase)
│   ├── map.js           Mapa Leaflet y camión (solo mira a la izquierda o a la derecha)
│   ├── simulacion.js    Arma un recorrido continuo por los tramos para el modo demo
│   ├── main.js          Lista de calles, horarios, panel demo, tiempo real
│   ├── vecinos.js       Apaga el modo demo y el aviso de "datos de demostración" en vecinos.html
│   ├── avisos.js        Activa/desactiva las notificaciones de retraso en vecinos.html
│   └── prueba-avisos.js Botones "Aviso de retraso / de adelanto" del modo demo (pide la CLAVE_PRUEBA)
├── conductor/           App web del conductor (PWA): GPS del celular + avance real por tramo
│   ├── index.html, app.js, manifest.json, icon-192.png, icon-512.png
├── supabase/functions/
│   └── avisar-retrasos/index.ts  Edge Function: detecta rutas retrasadas o adelantadas y manda las notificaciones
├── tests/               Pruebas: node tests/pruebas.js · python tests/pruebas_tramos.py
├── data/                Datos del modo "json" (se generan con db/osm_a_zona.py)
│   ├── zona.geojson, tramos.geojson, calles.json, horarios.json
│   └── calles_no_encontradas.txt, calles_sin_nombre.txt  Reportes de las calles que faltan o no tienen nombre
└── db/
    ├── schema.sql       Tablas, seguridad y tiempo real (Supabase)
    ├── zona.sql         Zona, rutas, calles y tramos (generado por osm_a_zona.py; ejecutar después de schema.sql)
    ├── consulta_overpass.txt  Consulta para bajar de OpenStreetMap las calles de la zona
    ├── osm_a_zona.py    Delimita el perímetro (8 calles límite: México, Túpac Amaru, Virrey Toledo, Castañeda, Cruz de Chalpón, Próceres, Curacas, José Balta) y deja las 32 calles del proyecto que quedan adentro
    ├── tramos.py        Corta las calles en tramos y separa los carriles de las avenidas de doble vía
    ├── geojson_a_sql.py Convierte un tramos.geojson hecho a mano en SQL
    ├── migracion_01_quitar_recorridos.sql  Para bases creadas con el esquema anterior
    ├── migracion_02_avance_calles.sql      Tabla del avance real del camión (luego renombrada a `avance_tramos`)
    ├── migracion_03_calles_y_tramos.sql    Separa `calles` (catálogo) y `tramos` (pedazos)
    ├── migracion_04_avisos_retraso.sql     Tablas `suscripciones_push` y `avisos_retraso` para los avisos
    ├── cron_avisos_retraso.sql             Programa la revisión automática de retrasos cada minuto (pg_cron)
    └── horarios.sql     Plantilla para cargar el horario oficial
```

## Avisos de retraso y adelanto (resumen)

1. El vecino abre `vecinos.html`, toca **Activar avisos** y da permiso. Su celular queda guardado en `suscripciones_push` (sin nombre ni número).
2. Cada minuto, Supabase (pg_cron) llama a la función `avisar-retrasos`.
3. **Retraso:** si ya pasaron 15 minutos de la hora de inicio de una ruta y el camión no ha mandado su ubicación, manda "Camión retrasado".
4. **Adelanto:** si faltan 15 minutos o más para la hora de inicio (hasta 2 horas antes) y el camión ya está mandando su ubicación, manda "Camión adelantado".
5. Cada ruta y turno recibe un solo aviso al día (tabla `avisos_retraso`).

**Probar sin esperar al camión:** en `index.html`, panel "Modo demostración" → "Probar avisos al celular". Escribe la `CLAVE_PRUEBA` y toca "Aviso de retraso" o "Aviso de adelanto". Llega a todos los celulares que activaron los avisos, marcado "(prueba)".

Las claves VAPID se crean con `npx web-push generate-vapid-keys`. La **pública** va en `js/config.js`; la **privada** va solo en los secretos de Supabase (Edge Functions → Secrets: `VAPID_PUBLICA`, `VAPID_PRIVADA`, `VAPID_CONTACTO`, `CLAVE_PRUEBA`). Nunca la suban a GitHub.

## Probar en local

```
python -m http.server 8000
```
Abre http://localhost:8000 (el navegador bloquea los datos si abres `index.html` con doble clic).

Pruebas de la lógica: `node tests/pruebas.js` · `python tests/pruebas_tramos.py`

Mapa: © colaboradores de OpenStreetMap · Leaflet. Mantengan la atribución.

