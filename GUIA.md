# Guía paso a paso · Camión En Ruta

Esta guía lleva el proyecto desde la versión con archivos de ejemplo hasta una versión con base de datos, cambios en tiempo real y GPS. Pueden detenerse en cualquier paso: cada uno deja algo que funciona.

## Cómo encajan las piezas

```
 Personal del camión                      Vecinos
 (admin.html, con sesión)          (index.html, sin sesión)
        │ escribe                          ▲ lee y se actualiza solo
        ▼                                  │
 ┌─────────────────────────  Supabase  ─────────────────────────┐
 │ rutas · calles · ruta_calles · horarios                      │
 │ recorridos (fase + calle actual)   posicion_camion (lat/lng) │
 └───────────────────────────────────────────────────────────────┘
                                   │
              js/data-source.js  →  js/estado.js (algoritmo de colores)  →  js/map.js (pinta el mapa)
```

- **Dónde está el algoritmo:** `js/estado.js`. Recibe la fase de la ruta y en qué calle va el camión, y devuelve el color de cada calle. No sabe nada de la base de datos ni del mapa.
- **Dónde se leen los datos:** `js/data-source.js`. Es el único archivo que habla con la base de datos.
- **Dónde se dibuja:** `js/map.js` y `js/main.js`.

## El algoritmo de colores

Cada ruta tiene sus calles en orden (1, 2, 3…). Solo hay que saber en qué calle va el camión (`orden_actual`) y la fase de la ruta:

| Situación | Color |
|---|---|
| Fase `pendiente` | todas **gris** |
| Calle con orden menor al actual | **negro** (ya pasó) |
| Calle con el orden actual | **verde** (recolectando) |
| Las siguientes N calles (N = `proximas`, por defecto 2) | **amarillo** (próximo) |
| El resto | **gris** (aún no pasa) |
| Fase `finalizado` | todas **negro** |

`orden_actual` puede salir de tres fuentes (columna `fuente` de la tabla `recorridos`, se elige por ruta en el panel):

1. **manual:** una persona toca "Siguiente calle" en `admin.html`. Es la más confiable para empezar.
2. **horario:** se reparte el horario en partes iguales entre las calles. Es una estimación y la página lo avisa; no la presenten como tiempo real.
3. **gps:** se toma la ubicación del camión y se busca la calle más cercana de la ruta (si está a menos de `umbralGpsMetros`, 40 m por defecto).

Las pruebas de esta lógica están hechas con Node; si cambian el algoritmo, vuelvan a probar los casos de arriba.

---

## Paso 1 · Compartir el proyecto con el equipo (GitHub)

1. Una persona crea una cuenta en https://github.com y un repositorio nuevo llamado `camion-en-ruta` (público o privado).
2. Instalen Git (https://git-scm.com) y Visual Studio Code en cada computadora.
3. La persona que creó el repositorio sube el proyecto. Desde la carpeta del proyecto:
   ```
   git init
   git add .
   git commit -m "Versión base"
   git branch -M main
   git remote add origin https://github.com/USUARIO/camion-en-ruta.git
   git push -u origin main
   ```
4. En GitHub: **Settings → Collaborators → Add people**, y agreguen a cada amigo por su usuario o correo.
5. Cada amigo hace una vez: `git clone https://github.com/USUARIO/camion-en-ruta.git` y abre la carpeta en VS Code.
6. Forma de trabajar para no pisarse:
   - Antes de empezar: `git pull`.
   - Cada quien trabaja en su rama: `git checkout -b mapa-calles` (un nombre por tarea).
   - Al terminar: `git add .`, `git commit -m "Qué cambié"`, `git push -u origin mapa-calles`, y abre un **Pull Request** en GitHub para que otro integrante lo revise y lo una a `main`.
   - Cada integrante toca principalmente sus archivos (ver "Reparto sugerido" al final), así hay menos choques.

## Paso 2 · Probar en tu computadora

```
python -m http.server 8000
```
Abre http://localhost:8000. Con `fuente: "json"` (valor por defecto) todo funciona sin base de datos, con los datos de `data/`.

## Paso 2B · Delimitar la zona (Virrey Toledo, Sáenz Peña, Av. México y Chongoyape) y sacar sus calles

Las calles que hay hoy en `data/calles.geojson` son de ejemplo. Para reemplazarlas por las reales:

1. Entra a https://overpass-turbo.eu, pega la consulta de `db/consulta_overpass.txt`, toca **Ejecutar**, y en **Exportar → datos → descargar como JSON sin procesar** guarda el archivo como `data/osm_jlo.json`.
2. Ejecuta:
   ```
   python db/osm_a_zona.py data/osm_jlo.json
   ```
3. El programa busca las 4 calles por nombre, calcula las 4 esquinas, dibuja el cuadrado y se queda con todas las calles que quedan adentro (cortando las que se salen). Imprime en pantalla los nombres que encontró para cada límite: **léanlos y confirmen que son las calles correctas**. Si una se llama distinto en OpenStreetMap, ajusten con `--limites "Virrey Toledo,Sáenz Peña,México,Chongoyape"`.
4. Escribe: `data/zona.geojson` (el cuadrado), `data/calles.geojson` (calles con nombre, una por nombre), `data/estados.json` (todas en gris), `data/horarios.json` y `db/zona.sql` (para la base de datos, paso 3).
5. Abran la página en local (paso 2): el cuadrado sale con borde punteado y las calles dentro, con su nombre al pasar el cursor. Comparen con Google Maps o con una visita a la zona.

Límites a tener en cuenta:
- Solo salen las calles que tienen nombre en OpenStreetMap; el programa informa cuántos tramos sin nombre quedaron fuera (`data/calles_sin_nombre.txt`). Si faltan calles, hay que nombrarlas en OpenStreetMap o agregarlas a mano en `calles.geojson`.
- El **orden de recorrido** que genera es provisional (de norte a sur). El orden real del camión hay que definirlo con quien conoce la ruta y cambiarlo en `ruta_calles.orden`.
- Los lados del cuadrado se calculan con las esquinas de las 4 calles; si alguna es curva, el contorno punteado es una aproximación y la calle real se dibuja encima.

## Paso 3 · Crear la base de datos (Supabase)

1. Crea una cuenta y un proyecto en https://supabase.com (hay plan gratuito; revisen sus condiciones actuales, por ejemplo si pausan proyectos sin actividad).
2. En el proyecto: **SQL Editor → New query**. Pega todo `db/schema.sql` y ejecuta. Esto crea las tablas, las reglas de seguridad y activa el tiempo real.
3. Carga las calles y rutas:
   - Si hicieron el paso 2B: pega `db/zona.sql` en el SQL Editor y ejecuta (incluye la zona, las calles y el orden).
   - Si usan calles preparadas a mano: ejecuta `python db/geojson_a_sql.py > db/calles.sql` y pega ese archivo.
4. Carga los horarios: edita `db/horarios.sql` con los horarios oficiales (`dias`: 0 domingo … 6 sábado) y ejecútalo.
5. Revisa en **Table Editor** que `rutas`, `calles`, `ruta_calles`, `horarios` y `recorridos` tengan filas.

## Paso 4 · Conectar la página a la base de datos

1. En Supabase: **Project Settings → API**. Copia la **Project URL** y la clave **anon public**.
2. En `js/config.js`:
   ```js
   fuente: "supabase",
   supabase: { url: "https://TU-PROYECTO.supabase.co", anonKey: "TU-CLAVE-ANON" },
   refrescarCadaSegundos: 30,
   ```
3. Recarga la página. Las calles, los horarios y los colores salen ahora de la base de datos.

Sobre las claves: la `anon` va en el código público y no es un secreto, porque lo que protege los datos son las reglas RLS de `db/schema.sql` (todos leen, solo usuarios con sesión escriben). La clave `service_role` **nunca** debe ir en el código ni subirse a GitHub.

## Paso 5 · Panel para actualizar estados

1. En Supabase: **Authentication → Users → Add user**. Crea una cuenta (correo y contraseña) por cada persona autorizada. En **Authentication → Sign In / Providers** desactiven el registro abierto de usuarios, para que nadie más pueda crear cuentas.
2. Abre `admin.html` (en local: http://localhost:8000/admin.html), entra y elige la ruta.
3. Usa "Iniciar recorrido", "Siguiente calle", "Calle anterior", "Finalizar" o "Reiniciar". El mapa público cambia de color sin recargar.

## Paso 6 · Tiempo real

Ya viene incluido: `AppData.suscribir()` en `js/data-source.js` se suscribe a los cambios de `recorridos` y `posicion_camion`, y `js/main.js` vuelve a pedir los estados cuando llega un aviso. Para probarlo, abre el mapa en una pestaña y `admin.html` en otra, y toca "Siguiente calle".

Si no se actualiza solo: confirmen que se ejecutaron las dos últimas líneas de `db/schema.sql` (`alter publication supabase_realtime …`) y que `refrescarCadaSegundos` esté en 30 como respaldo.

## Paso 7 · Estado por horario (sin que nadie toque botones)

En `admin.html`, cambia "¿De dónde sale el estado?" a **Estimado por horario**. La página calcula la fase con el reloj usando la tabla `horarios`. Es una aproximación: si el camión se atrasa, los colores no lo sabrán. La página muestra el texto "estimado según el horario (no es en tiempo real)".

## Paso 8 · GPS

**Fase A: teléfono en el camión (sin comprar equipos).**
1. Pongan `gpsActivo: true` en `js/config.js`.
2. En el teléfono del camión, abre la página `admin.html` **publicada** (el navegador solo permite ubicación con HTTPS), inicia sesión y toca **Compartir ubicación**. Guarda la posición en `posicion_camion` cada 5 segundos.
3. En el panel, pongan la fuente de la ruta en **Por GPS** y la fase en **En curso** (con "Iniciar recorrido"). El camión 🚛 aparece en el mapa y las calles cambian de color según la calle más cercana.
4. Necesitan permiso del conductor y de quien administre el camión para usar su ubicación. Mantener la pantalla encendida y la página abierta es necesario; los navegadores pausan la ubicación en segundo plano.

**Fase B: dispositivo GPS dedicado.** Si la municipalidad ya tiene GPS en los camiones, hay que preguntarles si comparten esos datos. Se conectaría escribiendo la posición en la tabla `posicion_camion` desde un servicio propio; la página no necesita cambios.

**Limitaciones de la Fase A.** El cálculo de la calle se hace en el navegador de cada visitante; con señal imprecisa el camión puede "saltar" entre calles cercanas (el algoritmo nunca retrocede respecto al `orden_actual` guardado, pero ese valor solo cambia en modo manual). Para algo más estable, el siguiente paso es calcular `orden_actual` en un servicio propio y guardarlo en `recorridos`.

## Paso 9 · Publicar y poner dominio

1. En GitHub: **Settings → Pages → Build and deployment**: Source "Deploy from a branch", rama `main`, carpeta `/ (root)`. En unos minutos queda en `https://USUARIO.github.io/camion-en-ruta/`.
2. Dominio propio: en la misma pantalla, **Custom domain**, y configuren los registros DNS en el proveedor del dominio según la documentación de GitHub Pages. Otras opciones gratuitas con el mismo proceso de subir la carpeta: Netlify o Cloudflare Pages.
3. Antes de entregar: `modoDemo: false`; `datosDemostracion: false` solo con datos reales y verificados; completar las fuentes en "Acerca del proyecto".

## Reparto sugerido por archivos

| Integrante | Archivos principales |
|---|---|
| 1. Investigación y contenido | `index.html` (secciones ODS 12 y cuidado, fuentes) |
| 2. Mapa y delimitación | `data/calles.geojson`, `js/map.js`, `centro` y `zoom` en `js/config.js` |
| 3. Programación | `js/estado.js`, `js/data-source.js`, `js/main.js` |
| 4. Datos y seguimiento | `db/`, Supabase, `admin.html`, horarios |
| 5. Diseño, pruebas y publicación | `css/styles.css`, pruebas en celulares, GitHub Pages |

## Qué falta por verificar

- La conexión con Supabase está escrita siguiendo su API, pero no se probó contra un proyecto real. Si algo falla en el Paso 4, la consola del navegador (F12) mostrará el mensaje de error.
- Los nombres y coordenadas de las calles de ejemplo no son reales.
- Los horarios reales deben confirmarse con la municipalidad.
