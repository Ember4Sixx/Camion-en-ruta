# Guía paso a paso · Camión En Ruta

Esta guía lleva el proyecto desde la versión con archivos locales hasta una versión con base de datos, cambios en tiempo real y GPS. Pueden detenerse en cualquier paso: cada uno deja algo que funciona.

## Cómo encajan las piezas

```
 Teléfono / GPS del camión                  Vecinos
 (admin.html, con sesión)            (index.html, sin sesión)
        │ escribe su posición                ▲ lee y se actualiza solo
        ▼                                    │
 ┌─────────────────────────  Supabase  ─────────────────────────┐
 │ zonas · rutas · calles · tramos · ruta_tramos · horarios     │
 │ posicion_camion (lat/lng)                                    │
 └───────────────────────────────────────────────────────────────┘
                                   │
              js/data-source.js  →  js/estado.js (algoritmo de colores)  →  js/map.js (pinta el mapa)
```

- **Dónde está el algoritmo:** `js/estado.js`. Recibe la fase de la ruta y en qué calle va el camión, y devuelve el color de cada calle. No sabe nada de la base de datos ni del mapa.
- **Dónde se leen los datos:** `js/data-source.js`. Es el único archivo que habla con la base de datos.
- **Dónde se dibuja:** `js/map.js` y `js/main.js`.
- **No hay tabla de "recorridos":** nadie marca calles a mano. El estado se calcula con el horario y con la posición del camión.

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

La fase y el `orden_actual` salen de dos fuentes (se calculan en `js/data-source.js`, no se guardan en la base de datos):

1. **horario:** se reparte el horario de la tabla `horarios` en partes iguales entre las calles. Es una estimación y la página lo avisa; no la presenten como tiempo real. Si no hay horario cargado, todas las calles quedan en gris.
2. **gps (avance real):** si `gpsActivo` está en `true`, manda lo que el camión **recorrió de verdad**, no el orden de la lista. La app del conductor (`conductor/`) divide cada calle en puntos de control cada 8 m, marca los que el camión pasa a menos de 15 m y lo guarda en la tabla `avance_tramos`:
   - **verde**: el camión está ahora en esa calle;
   - **negro**: la recorrió en un 80 % o más y ya salió (si solo cruzó una esquina, sigue gris);
   - **gris**: todavía no la recorre.
   Con GPS **no se usa amarillo**, porque sin el orden oficial de la ruta no se sabe qué calle sigue. Si la posición del camión tiene más de `gpsVigenciaSegundos` (120), el camión no se dibuja y la calle que estaba en verde se muestra gris; lo terminado sigue en negro. El avance solo vale para el día de hoy.

Las pruebas de esta lógica están en `tests/pruebas.js` (`node tests/pruebas.js`). Si cambian el algoritmo, vuelvan a correrlas.

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
Abre http://localhost:8000. Con `fuente: "json"` todo funciona sin base de datos, con los datos de `data/` (primero hay que generarlos con el paso 2B; vienen vacíos). Hoy `js/config.js` usa `fuente: "supabase"`.

## Paso 2B · Delimitar la zona y sacar sus calles de OpenStreetMap

**Perímetro de la zona:** Av. Sáenz Peña, Av. México, Calle Virrey Toledo y Calle Túpac Amaru.

**Calles del proyecto (16):** Avenida Sáenz Peña, Avenida México, Cacique Cinto, Cacique Collique, Caminos del Inca, Virrey Toledo, Jirón Gonzalo Pizarro, Jirón Hernando de Soto, Chongoyape, Carlos Castañeda Iparraguirre, Atusparias, Pasaje Perú, José Carlos Mariátegui, Unión, Pasaje San Martín y Túpac Amaru. La lista está en `CALLES_PROYECTO`, dentro de `db/osm_a_zona.py`.

1. Entra a https://overpass-turbo.eu, pega la consulta de `db/consulta_overpass.txt`, toca **Ejecutar**, y en **Exportar → datos → descargar como JSON sin procesar** guarda el archivo como `data/osm_jlo.json`.
2. Ejecuta:
   ```
   python db/osm_a_zona.py data/osm_jlo.json
   ```
3. El programa busca las 4 calles del perímetro por nombre, calcula las 4 esquinas, dibuja el cuadrado y se queda **solo con las 16 calles del proyecto** que quedan adentro (cortando las que se salen). Imprime los nombres que tiene cada calle en OSM: **léanlos y confirmen que son las correctas**.
4. Escribe: `data/zona.geojson` (el perímetro), `data/tramos.geojson` y `data/calles.json` (los tramos y el catálogo de calles), `data/horarios.json` (sin horario, hasta que se confirme) y `db/zona.sql` (para la base de datos, paso 3). Si alguna calle del proyecto no quedó dentro de la zona, la lista en `data/calles_no_encontradas.txt` y la avisa en pantalla.
5. Abran la página en local (paso 2): el perímetro sale con borde punteado y las calles dentro, con su nombre al pasar el cursor. Comparen con Google Maps o con una visita a la zona.

Límites a tener en cuenta:
- Una calle que en OpenStreetMap tiene otro nombre (o no tiene nombre) no aparece: corrijan el nombre en OSM o agreguen esa variante en `consulta_overpass.txt` y en `CALLES_PROYECTO`.
- Una calle que queda **fuera del perímetro** (por ejemplo, al norte de Virrey Toledo si esa es la calle de arriba) se descarta y se avisa en `calles_no_encontradas.txt`. Si pasa con calles que sí deben estar, revisen cuáles son las 4 calles del perímetro.
- El **orden de recorrido** que genera es provisional (de norte a sur). El orden real del camión hay que definirlo con quien conoce la ruta y cambiarlo en `ruta_tramos.orden`.
- Los lados del cuadrado se calculan con las esquinas de las 4 calles; si alguna es curva, el contorno punteado es una aproximación y la calle real se dibuja encima.

## Paso 3 · Crear la base de datos (Supabase)

1. Crea una cuenta y un proyecto en https://supabase.com (hay plan gratuito; revisen sus condiciones actuales, por ejemplo si pausan proyectos sin actividad).
2. En el proyecto: **SQL Editor → New query**. Pega todo `db/schema.sql` y ejecuta. Esto crea las tablas, las reglas de seguridad y activa el tiempo real. *(Si la base ya existía con la tabla `recorridos`, ejecuten en cambio `db/migracion_01_quitar_recorridos.sql`.)*
3. Carga las calles y la ruta: pega `db/zona.sql` (paso 2B) en el SQL Editor y ejecuta. Reemplaza los datos anteriores de zona, rutas, calles y orden.
4. Carga el horario oficial cuando la municipalidad lo confirme: edita `db/horarios.sql` (`dias`: 0 domingo … 6 sábado) y ejecútalo. Mientras no haya horario, las calles se muestran en gris y la página avisa que el horario está pendiente.
5. Revisa en **Table Editor** que `zonas`, `rutas`, `calles`, `tramos` y `ruta_tramos` tengan filas.

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

## Paso 5 · Cuentas del personal

1. En Supabase: **Authentication → Users → Add user**. Crea una cuenta (correo y contraseña) por cada persona autorizada. En **Authentication → Sign In / Providers** desactiven el registro abierto de usuarios, para que nadie más pueda crear cuentas.
2. Abre `admin.html` (en local: http://localhost:8000/admin.html), entra y elige la ruta. Desde ahí se comparte la ubicación del camión (paso 8). El panel ya no marca calles a mano: los colores salen del horario y del GPS.

## Paso 6 · Tiempo real

Ya viene incluido: `AppData.suscribir()` en `js/data-source.js` se suscribe a los cambios de `posicion_camion`, y `js/main.js` vuelve a calcular los estados cuando llega un aviso. Los cambios por horario se ven con el refresco periódico (`refrescarCadaSegundos`, 30 por defecto).

Si no se actualiza solo: confirmen que se ejecutó la última línea de `db/schema.sql` (`alter publication supabase_realtime add table posicion_camion`) y que `refrescarCadaSegundos` esté en 30 como respaldo.

## Paso 7 · Estado por horario

Es la base del sistema y no requiere que nadie toque botones: la página calcula la fase con el reloj usando la tabla `horarios`. Es una aproximación: si el camión se atrasa, los colores no lo sabrán. La página muestra el texto "estimado según el horario (no es en tiempo real)". Sin horarios cargados, todo queda en gris.

## Paso 8 · GPS

**Fase A: teléfono en el camión (sin comprar equipos).**
1. En Supabase, SQL Editor: ejecuten `db/migracion_02_avance_calles.sql` y después `db/migracion_03_calles_y_tramos.sql` (crean `avance_tramos` y separan `calles` y `tramos`). Las bases nuevas ya lo tienen en `db/schema.sql`.
2. Pongan `gpsActivo: true` en `js/config.js`.
3. En el teléfono del camión, abre la app del conductor **publicada**: `https://USUARIO.github.io/camion-en-ruta/conductor/` (el navegador solo permite ubicación con HTTPS). Inicia sesión, elige la ruta y toca **Iniciar recorrido**. Cada 5 segundos guarda la posición en `posicion_camion` y el avance de las calles en `avance_tramos`. En "Avance por calle" se ve el porcentaje recorrido de cada calle, y el botón "Borrar el avance de hoy" sirve para empezar de cero en las pruebas.
4. El camión 🚛 aparece en el mapa y las calles cambian de color según lo recorrido. Si la posición deja de llegar por más de `gpsVigenciaSegundos`, el camión desaparece del mapa.
   El botón **Compartir ubicación** de `admin.html` solo manda la posición (dibuja el camión, pero no colorea calles); para colorear usen la app del conductor.
4. Necesitan permiso del conductor y de quien administre el camión para usar su ubicación. Mantener la pantalla encendida y la página abierta es necesario; los navegadores pausan la ubicación en segundo plano.

**Fase B: dispositivo GPS dedicado.** Si la municipalidad ya tiene GPS en los camiones, hay que preguntarles si comparten esos datos. Se conectaría escribiendo la posición en la tabla `posicion_camion` desde un servicio propio; la página no necesita cambios.

**Limitaciones de la Fase A.** El avance lo calcula el teléfono del conductor, así que solo cuenta mientras la app está abierta y en primer plano. Las lecturas del GPS con precisión peor que 35 m no cuentan para el avance. Si el camión recorre una calle por partes en distintos momentos, el avance se va sumando durante el día.

## Paso 9 · Publicar y poner dominio

1. En GitHub: **Settings → Pages → Build and deployment**: Source "Deploy from a branch", rama `main`, carpeta `/ (root)`. En unos minutos queda en `https://USUARIO.github.io/camion-en-ruta/`.
2. Dominio propio: en la misma pantalla, **Custom domain**, y configuren los registros DNS en el proveedor del dominio según la documentación de GitHub Pages. Otras opciones gratuitas con el mismo proceso de subir la carpeta: Netlify o Cloudflare Pages.
3. Antes de entregar: `modoDemo: false`; `datosDemostracion: false` solo con datos reales y verificados; completar las fuentes en "Acerca del proyecto".

## Reparto sugerido por archivos

| Integrante | Archivos principales |
|---|---|
| 1. Investigación y contenido | `index.html` (secciones ODS 12 y cuidado, fuentes) |
| 2. Mapa y delimitación | `data/tramos.geojson`, `js/map.js`, `centro` y `zoom` en `js/config.js` |
| 3. Programación | `js/estado.js`, `js/data-source.js`, `js/main.js` |
| 4. Datos y seguimiento | `db/`, Supabase, `admin.html`, horarios |
| 5. Diseño, pruebas y publicación | `css/styles.css`, pruebas en celulares, GitHub Pages |

## Qué falta por verificar

- Los horarios oficiales de la zona: no se encontró un horario público de recolección para estas calles; hay que pedirlo a la municipalidad.
- Las calles salen de OpenStreetMap: comparar el resultado con la zona real.
- El orden real de recorrido del camión (`ruta_tramos.orden`).
- Probar el GPS en un teléfono real con la página publicada (HTTPS).
- Antes de entregar: `modoDemo: false` y `datosDemostracion: false`.

---

## Tramos, carriles y cómo cambiar rutas, orden y horarios

**Tramos.** `db/osm_a_zona.py` ya no guarda cada calle completa: la corta en **tramos** donde otra calle la cruza o termina en ella (módulo `db/tramos.py`). Cada tramo es una fila de la tabla `tramos` (y la calle completa es una fila de la tabla `calles`); el tramo tiene su propio `id` y nombre, por ejemplo `calle-union-2` = «Calle Unión · entre San Martín y José Carlos Mariátegui». Así el mapa puede iluminar solo la parte por donde pasa el camión. Una calle sin cruces dentro de la zona queda en un solo tramo.

**Carriles.** Las avenidas de doble vía (hoy Av. México y Av. Sáenz Peña) tienen una línea independiente por carril, nombrada por su sentido de marcha («sentido este», «sentido norte»…), tomado de `oneway` en OpenStreetMap. La app del conductor solo marca como recorrido el carril por el que va el camión.

**Dos tablas: `calles` y `tramos`.** `calles` es el catálogo: una fila por calle del proyecto (`id`, `nombre`, `tipo` = `limite` si cierra el perímetro o `interior`). `tramos` tiene los pedazos de cada calle (`calle_id` apunta a `calles`, más `nombre`, `carril`, `k` y `geom`) y es lo que se dibuja y se ilumina. Una calle sin cruces con otras del proyecto tiene un solo tramo. La lista lateral de la página muestra **una fila por calle** (la de la tabla `calles`) y, al abrirla, sus tramos; el mapa pinta cada tramo por separado. `ruta_tramos` guarda el orden de recorrido y `avance_tramos` el avance real del camión, ambos por tramo.

**Qué archivo/tabla se toca para…**

| Quiero… | Dónde |
|---|---|
| Cambiar el **orden** en que se iluminan los tramos | Supabase > Table Editor > `ruta_tramos`, columna `orden` (no puede repetirse dentro de una ruta). Mientras no hay GPS, el amarillo son los siguientes `proximas` tramos en ese orden. |
| Cuántos tramos siguientes salen en amarillo | Tabla `rutas`, columna `proximas` |
| Crear una **ruta nueva** | Una fila en `rutas` (`id`, `nombre`) y, por cada tramo que recorre, una fila en `ruta_tramos` (`ruta_id`, `tramo_id`, `orden`). |
| Agregar o cambiar **horarios** | Tabla `horarios` (`ruta_id`, `dias` con 0 = domingo … 6 = sábado, `hora_inicio`, `hora_fin`). Plantilla: `db/horarios.sql`. Una fila por turno. |
| Cambiar qué calles forman la zona | `CALLES_PROYECTO` en `db/osm_a_zona.py` y volver a generar |
| Cambiar los colores | `js/config.js` (`estados`) y `css/styles.css` (`--estado-*`) |

**Ojo:** `db/zona.sql` BORRA y vuelve a cargar `calles`, `tramos` y `ruta_tramos` (y el avance de hoy). Si ya ajustaste el orden o creaste rutas a mano, no lo ejecutes otra vez sin guardar antes esos cambios.

Pruebas: `node tests/pruebas.js` y `python tests/pruebas_tramos.py`.
