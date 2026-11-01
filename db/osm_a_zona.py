#!/usr/bin/env python3
"""
Delimita la zona de recolección y extrae SOLO las calles del proyecto que quedan dentro.

Perímetro por defecto : 8 calles límite, en orden (cada una se cruza con la siguiente y la última con la primera):
                        México, Túpac Amaru, Virrey Toledo, Carlos Castañeda, Cruz de Chalpón, Próceres, Curacas, José Balta.
                        Es un contorno escalonado de 8 esquinas. Además, Sáenz Peña, Chongoyape y Enrique de la Piedra
                        se marcan como calles 'limite' (cierran las manzanas de la zona) aunque queden dentro del contorno.
Calles del proyecto   : las 32 de CALLES_PROYECTO (más abajo), con los nombres exactos que tienen en OpenStreetMap.
                        Cualquier otra calle de OSM se ignora.

Entrada : exportación JSON de Overpass (ver db/consulta_overpass.txt), con geometría.
Salida  : data/zona.geojson      polígono del perímetro
          data/tramos.geojson    TRAMOS (LineString), con id, nombre, calle, calle_id, carril, k, ruta, tipo, orden.
                                 Cada calle se corta donde otras la cruzan (db/tramos.py) y las avenidas de doble vía
                                 tienen una línea independiente por carril ("sentido este", "sentido oeste"…).
          data/calles.json       catálogo: una fila por calle (id, nombre, tipo, cuántos tramos tiene)
          data/horarios.json     la ruta SIN horario (el horario oficial se carga cuando se confirme)
          db/zona.sql            limpia los datos anteriores y carga zonas, rutas, calles, tramos y ruta_tramos en Supabase
          data/calles_sin_nombre.txt   cantidad de tramos sin nombre que quedaron fuera
          data/calles_no_encontradas.txt  calles del proyecto que NO aparecieron dentro de la zona (si hay)

Uso:
    python db/osm_a_zona.py data/osm_jlo.json
    python db/osm_a_zona.py data/osm_jlo.json --limites "México,Túpac Amaru,Virrey Toledo,Castañeda,Cruz de Chalpón,Próceres,Curacas,José Balta"
    python db/osm_a_zona.py data/osm_jlo.json --salida otra_carpeta   (para probar sin pisar data/)

El ORDEN de recorrido que genera es PROVISIONAL (de norte a sur). Cámbienlo por el
recorrido real del camión editando la columna `orden` de ruta_tramos o la propiedad `orden` en tramos.geojson.
"""
import argparse
import heapq
import json
import math
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tramos import construir_tramos  # noqa: E402  (seccionado en tramos y carriles)

TOL_M = 15  # tolerancia (m) para considerar que un punto está sobre el borde de la zona

# Las 32 calles del proyecto: nombre que se muestra -> nombres EXACTOS que tiene en OpenStreetMap (sin importar
# mayúsculas ni tildes). Una calle puede tener varios nombres en OSM (por ejemplo "Calle X" y "Pasaje X").
CALLES_OSM = {
    "Avenida México": ["Avenida México"],
    "Avenida José Balta": ["Avenida José Balta"],
    "Los Curacas": ["Los Curacas"],
    "Calle Los Próceres": ["Calle Los Próceres", "Los Próceres", "Pasaje Los Próceres"],
    "Calle Cruz de Chalpón": ["Calle Cruz de Chalpón"],
    "Calle Chongoyape": ["Calle Chongoyape"],
    "Enrique de la Piedra": ["Enrique de la Piedra"],
    "Calle Carlos Castañeda Iparraguirre": ["Calle Carlos Castañeda Iparraguirre", "Carlos Castañeda"],
    "Calle Virrey Toledo": ["Calle Virrey Toledo"],
    "Calle Túpac Amaru": ["Calle Túpac Amaru", "Pasaje Túpac Amaru"],
    "Calle Conquista": ["Calle Conquista", "Conquista"],
    "Los Quipus": ["Los Quipus"],
    "Calle Los Libertadores": ["Calle Los Libertadores"],
    "Jirón El Cabildo": ["Jirón El Cabildo"],
    "Jirón El Intendente": ["Jirón El Intendente"],
    "Jirón El Corregidor": ["Jirón El Corregidor"],
    "Avenida Sáenz Peña": ["Avenida Sáenz Peña"],
    "Calle Horacio Patiño": ["Horacio Patiño", "Pasaje Horacio Patiño"],
    "Santiago Cassinelli": ["Santiago Cassinelli"],
    "Pardo y Miguel": ["Pardo y Miguel"],
    "Filántropo": ["Filántropo"],
    "M. Orellana": ["M. Orellana"],
    "Calle Unión": ["Calle Unión"],
    "Pasaje San Martín": ["Pasaje San Martín"],
    "Calle José Carlos Mariátegui": ["Calle José Carlos Mariátegui", "José Carlos Mariátegui"],
    "Pasaje Perú": ["Pasaje Perú"],
    "Calle Atusparias": ["Calle Atusparias"],
    "Jirón Hernando de Soto": ["Jirón Hernando de Soto"],
    "Jirón Gonzalo Pizarro": ["Jirón Gonzalo Pizarro"],
    "Calle Caminos del Inca": ["Calle Caminos del Inca"],
    "Calle Cacique Collique": ["Calle Cacique Collique"],
    "Calle Cacique Cinto": ["Calle Cacique Cinto"],
}
CALLES_PROYECTO = list(CALLES_OSM)
# Calles que se marcan como 'limite' (las 8 del contorno + las 3 que cierran las manzanas de la zona).
CALLES_LIMITE = {"Avenida México", "Avenida José Balta", "Los Curacas", "Calle Los Próceres", "Calle Cruz de Chalpón",
                 "Calle Chongoyape", "Enrique de la Piedra", "Calle Carlos Castañeda Iparraguirre", "Calle Virrey Toledo",
                 "Calle Túpac Amaru", "Avenida Sáenz Peña"}
LIMITES_POR_DEFECTO = "México,Túpac Amaru,Virrey Toledo,Castañeda,Cruz de Chalpón,Próceres,Curacas,José Balta"
TIPOS_VIA = {"calle", "avenida", "av", "jiron", "jr", "pasaje", "psje", "pje", "ca", "ave"}


# ---------- utilidades ----------
def norm(t):
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9 ]", " ", t)


def clave(t):
    """Nombre sin tildes ni tipo de vía: 'Jirón Gonzalo Pizarro' -> 'gonzalo pizarro'."""
    return " ".join(w for w in norm(t).split() if w not in TIPOS_VIA)


def exacto(t):
    # Nombre normalizado completo (sin tildes ni mayúsculas, CON el tipo de vía): "Pasaje Perú" -> "pasaje peru".
    return " ".join(norm(t).split())


def slug(t):
    return re.sub(r"\s+", "-", norm(t).strip()) or "calle"


def q(t):
    return "'" + str(t).replace("'", "''") + "'"


class Plano:
    """Proyección local a metros (suficiente para una zona de pocos km)."""
    def __init__(self, lat0):
        self.kx = 111320 * math.cos(math.radians(lat0))
        self.ky = 110540

    def xy(self, lng, lat):
        return (lng * self.kx, lat * self.ky)


def seg_inter(p1, p2, p3, p4):
    d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0])
    if abs(d) < 1e-12:
        return None
    t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d
    u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1]))
    return None


def punto_seg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = 0 if l2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    c = (a[0] + t * dx, a[1] + t * dy)
    return math.hypot(p[0] - c[0], p[1] - c[1]), c


def en_poligono(p, poly):
    dentro = False
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if (a[1] > p[1]) != (b[1] > p[1]):
            x = (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
            if p[0] < x:
                dentro = not dentro
    return dentro


def dist_borde(p, poly):
    return min(punto_seg(p, poly[i], poly[(i + 1) % len(poly)])[0] for i in range(len(poly)))


# ---------- componentes conectados por nombre ----------
def componentes(ways):
    """Agrupa tramos de un mismo nombre que se tocan (comparten un vértice)."""
    padre = list(range(len(ways)))

    def raiz(i):
        while padre[i] != i:
            padre[i] = padre[padre[i]]
            i = padre[i]
        return i

    dueno = {}
    for i, w in enumerate(ways):
        for pt in w:
            k = (round(pt[0], 7), round(pt[1], 7))
            if k in dueno:
                padre[raiz(i)] = raiz(dueno[k])
            else:
                dueno[k] = i
    grupos = defaultdict(list)
    for i, w in enumerate(ways):
        grupos[raiz(i)].append(w)
    return list(grupos.values())


def extremos_corner(comp_a, comp_b):
    """Esquina entre dos calles: intersección si se cruzan, si no el punto medio del par más cercano."""
    inters = []
    mejor = (float("inf"), None, None)
    for wa in comp_a:
        for i in range(len(wa) - 1):
            for wb in comp_b:
                for j in range(len(wb) - 1):
                    x = seg_inter(wa[i], wa[i + 1], wb[j], wb[j + 1])
                    if x:
                        inters.append(x)
    if inters:
        return 0.0, inters[0], len(inters)
    for wa in comp_a:
        for pa in wa:
            for wb in comp_b:
                for j in range(len(wb) - 1):
                    d, c = punto_seg(pa, wb[j], wb[j + 1])
                    if d < mejor[0]:
                        mejor = (d, pa, c)
    for wb in comp_b:
        for pb in wb:
            for wa in comp_a:
                for i in range(len(wa) - 1):
                    d, c = punto_seg(pb, wa[i], wa[i + 1])
                    if d < mejor[0]:
                        mejor = (d, c, pb)
    d, p, c = mejor
    return d, ((p[0] + c[0]) / 2, (p[1] + c[1]) / 2), 0


def camino_por_calle(ways, A, B):
    # Recorrido más corto POR LA PROPIA CALLE entre los puntos A y B (ambos en metros). Sirve para que el borde de la zona
    # siga el trazo real de la calle límite (si es curva) y no una línea recta. Devuelve los vértices intermedios.
    # Si la calle no tiene un camino continuo entre A y B, devuelve [] (el borde queda recto).
    ady = defaultdict(list)
    for w in ways:
        for p, q in zip(w, w[1:]):
            kp, kq = (round(p[0], 3), round(p[1], 3)), (round(q[0], 3), round(q[1], 3))
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            ady[kp].append((kq, d))
            ady[kq].append((kp, d))
    if not ady:
        return []
    cerca = lambda pt: min(ady, key=lambda k: math.hypot(k[0] - pt[0], k[1] - pt[1]))
    ini, fin = cerca(A), cerca(B)
    dist, previo, cola = {ini: 0.0}, {}, [(0.0, ini)]
    while cola:
        d, u = heapq.heappop(cola)
        if u == fin:
            break
        if d > dist.get(u, float("inf")):
            continue
        for v, w in ady[u]:
            if d + w < dist.get(v, float("inf")):
                dist[v], previo[v] = d + w, u
                heapq.heappush(cola, (d + w, v))
    if fin not in dist:
        return []
    ruta, u = [fin], fin
    while u != ini:
        u = previo[u]
        ruta.append(u)
    ruta.reverse()
    cuerda = math.hypot(A[0] - B[0], A[1] - B[1])
    if dist[fin] > 1.6 * cuerda + 30:          # un rodeo raro: mejor el borde recto
        return []
    return [(x, y) for x, y in ruta]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entrada")
    ap.add_argument("--limites", default=LIMITES_POR_DEFECTO,
                    help="calles del contorno EN ORDEN (cada una se cruza con la siguiente; la última con la primera)")
    ap.add_argument("--salida", default=".", help="carpeta base donde están data/ y db/")
    ap.add_argument("--ruta", default="Ruta 1")
    ap.add_argument("--tramo-minimo", type=float, default=30.0,
                    help="metros: se descartan los trozos recortados más cortos (calles que solo rozan la zona)")
    ap.add_argument("--tramo-corte-min", type=float, default=25.0,
                    help="metros: no se corta una calle si el tramo resultante quedaría más corto que esto")
    ap.add_argument("--tolerancia", type=float, default=TOL_M,
                    help="metros de tolerancia para considerar que una calle está sobre el borde de la zona")
    a = ap.parse_args()

    datos = json.loads(Path(a.entrada).read_text(encoding="utf-8"))
    elems = [e for e in datos.get("elements", []) if e.get("type") == "way" and e.get("geometry")]
    if not elems:
        sys.exit("El archivo no tiene calles con geometría. Usa 'out geom;' en la consulta (ver db/consulta_overpass.txt).")

    todos = [pt for e in elems for pt in e["geometry"]]
    lat0 = sum(p["lat"] for p in todos) / len(todos)
    P = Plano(lat0)

    # tramos con nombre, solo de las calles del proyecto
    canon = {exacto(v): oficial for oficial, vs in CALLES_OSM.items() for v in vs}   # nombre en OSM -> nombre oficial
    permitidas = set(canon)
    variantes = defaultdict(set)                     # nombre oficial -> nombres distintos que tiene en OSM
    tramos = []  # (nombre, [(x,y)...], [(lng,lat)...], osm_id)
    sin_nombre = 0
    sentido_via = {}   # id OSM -> 1 si es de un solo sentido (lista ya en el sentido de la marcha), 0 si no
    for e in elems:
        nom = (e.get("tags") or {}).get("name")
        if not nom:
            sin_nombre += 1
            continue
        if exacto(nom) not in permitidas:
            continue
        variantes[canon[exacto(nom)]].add(nom)
        ll = [(p["lon"], p["lat"]) for p in e["geometry"]]
        ow = (e.get("tags") or {}).get("oneway")
        if ow == "-1":
            ll = ll[::-1]                      # se deja en el sentido real de la marcha
        sentido_via[e["id"]] = 1 if ow in ("yes", "true", "1", "-1") else 0
        tramos.append((nom, [P.xy(*p) for p in ll], ll, e["id"]))

    # --- localizar las calles límite y cerrar el contorno ---
    # Las calles se dan EN ORDEN alrededor de la zona: la esquina i es donde se cruzan la calle i y la calle i+1.
    claves = [norm(x).strip() for x in a.limites.split(",") if x.strip()]
    if len(claves) < 3:
        sys.exit("--limites necesita al menos 3 calles separadas por coma (en orden alrededor de la zona).")
    vias = []   # por cada límite: todas las polilíneas (en metros) de esa calle
    for k in claves:
        nombres = sorted({n for n, *_ in tramos if k in norm(n)})
        print(f"[límite '{k}'] nombres encontrados: {nombres or 'NINGUNO'}")
        if not nombres:
            sys.exit(f"No se encontró ninguna calle que contenga '{k}'. Revisa la ortografía en OSM o ajusta --limites.")
        vias.append([t[1] for t in tramos if t[0] in nombres])

    def esquina(va, vb):
        # Punto donde se cruzan dos calles. Si hay varios cruces (carriles paralelos) se promedian los que están
        # a menos de 40 m del primero; si no se cruzan, punto medio del par de puntos más cercano.
        pts = []
        for wa in va:
            for i in range(len(wa) - 1):
                for wb in vb:
                    for j in range(len(wb) - 1):
                        x = seg_inter(wa[i], wa[i + 1], wb[j], wb[j + 1])
                        if x:
                            pts.append(x)
        if pts:
            p0 = pts[0]
            cerca = [p for p in pts if math.hypot(p[0] - p0[0], p[1] - p0[1]) <= 40]
            return 0.0, (sum(p[0] for p in cerca) / len(cerca), sum(p[1] for p in cerca) / len(cerca)), len(pts)
        return extremos_corner(va, vb)

    esquinas, costo = [], 0.0
    for i in range(len(claves)):
        d, c, n = esquina(vias[i], vias[(i + 1) % len(claves)])
        esquinas.append(c)
        costo += d
        print(f"  esquina {i + 1}: {claves[i]} x {claves[(i + 1) % len(claves)]}"
              + (f" (cruce, {n} punto(s))" if n else f" (no se cruzan: separación {d:.0f} m)"))
    if costo > len(claves) * 60:
        print(f"AVISO: las calles límite no se cierran bien (separación total {costo:.0f} m). "
              "Puede que alguna calle del OSM tenga otro nombre o esté dividida, o que el orden de --limites no sea el del contorno. "
              "Revisa data/zona.geojson.")
    # El borde entre la esquina anterior y la siguiente sigue el trazo de la calle límite correspondiente.
    poligono = []
    for i in range(len(claves)):
        A, B = esquinas[i - 1], esquinas[i]
        poligono.append(A)
        poligono.extend(pt for pt in camino_por_calle(vias[i], A, B)
                        if math.hypot(pt[0] - A[0], pt[1] - A[1]) > 3 and math.hypot(pt[0] - B[0], pt[1] - B[1]) > 3)
    area = abs(sum(poligono[i][0] * poligono[(i + 1) % len(poligono)][1] - poligono[(i + 1) % len(poligono)][0] * poligono[i][1]
                   for i in range(len(poligono)))) / 2
    print(f"Zona delimitada: {area / 10000:.2f} ha ({len(esquinas)} esquinas, {len(poligono)} vértices)")

    # --- calles dentro del cuadrado (o sobre su borde) ---
    def dentro(p):
        return en_poligono(p, poligono) or dist_borde(p, poligono) <= a.tolerancia

    tol = a.tolerancia
    def t_cortes(a, b):
        """Parámetros (0..1) donde el segmento a-b cruza el borde del polígono."""
        ts = [0.0, 1.0]
        for i in range(len(poligono)):
            c, d = poligono[i], poligono[(i + 1) % len(poligono)]
            den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])
            if abs(den) < 1e-12:
                continue
            t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den
            u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den
            # eps: una calle que pasa justo por una esquina del polígono (caso normal en las calles
            # límite) puede quedar en u = 1.0000000001 por redondeo y no cortarse.
            if 0 < t < 1 and -1e-9 <= u <= 1 + 1e-9:
                ts.append(t)
        # También se corta donde el segmento pasa junto a una esquina del polígono.
        dx, dy = b[0] - a[0], b[1] - a[1]
        l2 = dx * dx + dy * dy
        if l2 > 0:
            for v in poligono:
                t = ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / l2
                if 0 < t < 1 and math.hypot(v[0] - (a[0] + t * dx), v[1] - (a[1] + t * dy)) <= tol:
                    ts.append(t)
        return sorted(ts)

    def largo_m(run):
        lat0 = math.radians(run[0][1])
        return sum(math.hypot((q2[0] - q1[0]) * 111320 * math.cos(lat0), (q2[1] - q1[1]) * 110540)
                   for q1, q2 in zip(run, run[1:]))

    por_nombre = defaultdict(list)
    sentido_corrida = {}   # id(corrida) -> sentido de la vía
    for nom, xy, ll, oid in tramos:
        run = []
        for i in range(len(xy) - 1):
            a_, b_ = xy[i], xy[i + 1]
            la, lb = ll[i], ll[i + 1]
            ts = t_cortes(a_, b_)
            for t0, t1 in zip(ts, ts[1:]):
                if t1 - t0 < 1e-9:
                    continue
                tm = (t0 + t1) / 2
                mid = (a_[0] + tm * (b_[0] - a_[0]), a_[1] + tm * (b_[1] - a_[1]))
                if dentro(mid):
                    p0 = (la[0] + t0 * (lb[0] - la[0]), la[1] + t0 * (lb[1] - la[1]))
                    p1 = (la[0] + t1 * (lb[0] - la[0]), la[1] + t1 * (lb[1] - la[1]))
                    if not run:
                        run = [p0]
                    run.append(p1)
                else:
                    if len(run) >= 2 and largo_m(run) >= a.tramo_minimo:
                        por_nombre[canon[exacto(nom)]].append(run)
                        sentido_corrida[id(run)] = sentido_via[oid]
                    run = []
        if len(run) >= 2 and largo_m(run) >= a.tramo_minimo:
            por_nombre[canon[exacto(nom)]].append(run)
            sentido_corrida[id(run)] = sentido_via[oid]

    nombre_lim_zona = set(CALLES_LIMITE)

    def inv(c):  # lng,lat -> m
        return P.xy(*c)

    def centro_lat(lineas):
        pts = [pt for l in lineas for pt in l]
        return sum(p[1] for p in pts) / len(pts)

    # --- seccionar en tramos entre intersecciones y separar carriles (db/tramos.py) ---
    piezas = construir_tramos(
        {nom: [{"ll": r, "sentido": sentido_corrida[id(r)]} for r in lineas] for nom, lineas in por_nombre.items()},
        P, tramo_min=a.tramo_corte_min)

    # Orden de recorrido PROVISIONAL. Las calles van de norte a sur y, dentro de cada una, los tramos en el sentido
    # de la marcha. Los carriles "de regreso" de las avenidas de doble vía se dejan al final de la ruta, para que
    # el amarillo ("próximas N calles") no ilumine los dos carriles a la vez.
    lat_calle = {nom: centro_lat(lineas) for nom, lineas in por_nombre.items()}
    cadenas_calle = defaultdict(set)
    for t in piezas:
        cadenas_calle[t["calle"]].add((t["cadena"], t["carril"] or ""))
    primer_carril = {c: min(v)[0] for c, v in cadenas_calle.items()}   # cadena que va en la 1.ª pasada

    def clave_orden(t):
        vuelta = 1 if (t["cadena"] != primer_carril[t["calle"]] and t["carril"]) else 0
        return (vuelta, -lat_calle[t["calle"]], t["cadena"], t["k"])

    piezas.sort(key=clave_orden)
    features, filas_ruta = [], []
    for i, t in enumerate(piezas, start=1):
        tipo = "limite" if t["calle"] in nombre_lim_zona else "interior"
        geom = {"type": "LineString", "coordinates": t["coords"]}
        features.append({"type": "Feature",
                         "properties": {"id": t["id"], "nombre": t["nombre"], "calle": t["calle"], "calle_id": slug(t["calle"]),
                                        "carril": t["carril"] or "", "k": t["k"], "ruta": a.ruta, "tipo": tipo, "orden": i},
                         "geometry": geom})
        filas_ruta.append((t["id"], i))

    base = Path(a.salida)
    (base / "data").mkdir(parents=True, exist_ok=True)
    (base / "db").mkdir(parents=True, exist_ok=True)
    ll_poly = [[x / P.kx, y / P.ky] for x, y in poligono]
    zona = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": "zona-1", "nombre": "Zona de recolección",
                                           "limites": [x.strip() for x in a.limites.split(",")]},
         "geometry": {"type": "Polygon", "coordinates": [ll_poly + [ll_poly[0]]]}}]}
    (base / "data/zona.geojson").write_text(json.dumps(zona, ensure_ascii=False, indent=1), encoding="utf-8")
    tramos_geo = {"type": "FeatureCollection",
                  "_aviso": "Tramos extraídos de OpenStreetMap con db/osm_a_zona.py. El orden de recorrido (orden) es PROVISIONAL.",
                  "features": features}
    (base / "data/tramos.geojson").write_text(json.dumps(tramos_geo, ensure_ascii=False, indent=1), encoding="utf-8")
    nombres_zona = list(dict.fromkeys(f["properties"]["calle"] for f in features))   # una vez cada calle
    catalogo = [{"id": slug(n), "nombre": n,
                 "tipo": "limite" if n in nombre_lim_zona else "interior",
                 "tramos": sum(1 for f in features if f["properties"]["calle"] == n)} for n in nombres_zona]
    (base / "data/calles.json").write_text(json.dumps(catalogo, ensure_ascii=False, indent=1), encoding="utf-8")
    (base / "data/horarios.json").write_text(json.dumps(
        {"nota": "El horario oficial de esta zona aún está pendiente de confirmar con la municipalidad.",
         "rutas": [{"ruta": a.ruta, "dias": "—", "horario": "—", "calles": nombres_zona,
                    "programa": []}]}, ensure_ascii=False, indent=1), encoding="utf-8")
    # Calles del proyecto que no aparecieron dentro de la zona
    faltan = [n for n in CALLES_PROYECTO if n not in nombres_zona]
    (base / "data/calles_no_encontradas.txt").write_text(
        ("\n".join(faltan) + "\n") if faltan else "Todas las calles del proyecto aparecen dentro de la zona.\n", encoding="utf-8")
    (base / "data/calles_sin_nombre.txt").write_text(f"{sin_nombre} tramos sin nombre en OSM quedaron fuera.\n", encoding="utf-8")

    # SQL para Supabase
    sql = ["-- Generado por db/osm_a_zona.py (zona delimitada + calles y tramos).",
           "-- Ejecutar DESPUÉS de db/schema.sql. REEMPLAZA los datos anteriores de zonas, rutas, calles, tramos y ruta_tramos",
           "-- (el avance guardado de hoy también se borra: depende de los tramos). No toca horarios ni posicion_camion.", "",
           "begin;", "",
           "delete from zonas;", "delete from ruta_tramos;", "delete from avance_tramos;",
           "delete from tramos;", "delete from calles;",
           f"delete from rutas where id <> {q(a.ruta)};", "",
           "insert into zonas (id, nombre, geom) values",
           f"  ({q('zona-1')}, {q('Zona de recolección')}, {q(json.dumps(zona['features'][0]['geometry']))}::jsonb)",
           "on conflict (id) do update set geom = excluded.geom;", "",
           "insert into rutas (id, nombre) values", f"  ({q(a.ruta)}, {q(a.ruta)})", "on conflict (id) do nothing;", "",
           "-- Calles (una fila por calle)",
           "insert into calles (id, nombre, tipo) values"]
    sql.append(",\n".join(f"  ({q(c['id'])}, {q(c['nombre'])}, {q(c['tipo'])})" for c in catalogo) + ";\n")
    sql.append("-- Tramos (los pedazos de cada calle)")
    sql.append("insert into tramos (id, calle_id, nombre, carril, k, geom) values")
    sql.append(",\n".join(
        f"  ({q(f['properties']['id'])}, {q(f['properties']['calle_id'])}, {q(f['properties']['nombre'])}, "
        f"{q(f['properties']['carril'])}, {f['properties']['k']}, {q(json.dumps(f['geometry']))}::jsonb)" for f in features) + ";\n")
    sql.append("-- Orden de recorrido (PROVISIONAL)")
    sql.append("insert into ruta_tramos (ruta_id, tramo_id, orden) values")
    sql.append(",\n".join(f"  ({q(a.ruta)}, {q(c)}, {o})" for c, o in filas_ruta) + ";\n")
    sql.append("commit;")
    (base / "db/zona.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")

    lim = sorted({f['properties']['calle'] for f in features if f['properties']['tipo'] == 'limite'})
    print(f"Calles límite incluidas: {lim}")
    print(f"Calles dentro de la zona: {len(nombres_zona)} -> {len(features)} tramos")
    for c in nombres_zona:
        ts = [f for f in features if f["properties"]["calle"] == c]
        print(f"  {c}: {len(ts)} tramo(s)" + (f" · carriles: {sorted({f['properties']['carril'] for f in ts if f['properties']['carril']})}"
                                              if any(f["properties"]["carril"] for f in ts) else ""))
    print(f"Tramos sin nombre fuera de la lista: {sin_nombre}")
    print("Nombres que tienen en OSM las calles del proyecto (revisen que sean las correctas):")
    for n in CALLES_PROYECTO:
        print(f"  {n}: {sorted(variantes[n]) or 'NO ENCONTRADA EN EL ARCHIVO'}")
    if faltan:
        print(f"AVISO: {len(faltan)} calle(s) del proyecto no quedaron dentro de la zona: {faltan}")
    print("Archivos escritos en", base.resolve())


if __name__ == "__main__":
    main()
