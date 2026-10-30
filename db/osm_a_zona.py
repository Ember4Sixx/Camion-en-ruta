#!/usr/bin/env python3
"""
Delimita la zona de recolección con los TRAZADOS REALES de 4 calles y extrae las calles de adentro.

Cómo funciona (resumen):
  1. Lee la exportación JSON de Overpass (OpenStreetMap) con geometría.
  2. Ubica las 4 calles límite y busca las 4 esquinas (cruces entre calles vecinas).
  3. Sobre cada calle límite recorre su propio trazado (con curvas) de una esquina a la otra.
     Solo se usa ese tramo: el resto de la avenida (fuera del perímetro) se descarta.
  4. Con los 4 tramos forma un polígono cerrado y verifica que sea válido (sin cruces).
  5. Recorta TODAS las demás calles contra ese polígono y conserva solo lo que queda adentro,
     respetando su geometría original (sin simplificar ni redibujar).

Entrada : data/osm_jlo.json (consulta de db/consulta_overpass.txt) o --descargar para bajarlo.
Salida  : data/zona.geojson        polígono del perímetro (compatible con la tabla `zonas`)
          data/esquinas.geojson    las 4 esquinas (solo para revisar / previsualizar)
          data/calles.geojson      una calle por nombre (LineString / MultiLineString) con id, nombre, ruta, tipo, orden
          data/estados.json        todas en gris
          data/horarios.json       horario de ejemplo
          db/zona.sql              zonas, rutas, calles, ruta_calles y recorridos para Supabase
          data/calles_sin_nombre.txt

Uso:
    python db/osm_a_zona.py --descargar                       (baja de OpenStreetMap y procesa)
    python db/osm_a_zona.py data/osm_jlo.json                 (usa un archivo ya descargado)
    python db/osm_a_zona.py data/osm_jlo.json --limites "México,Chongoyape,Virrey Toledo,Sáenz Peña"
    python db/osm_a_zona.py data/osm_jlo.json --salida prueba (no pisa data/ ni db/)

Cada nombre de --limites se compara sin tildes ni mayúsculas. Si hay varias calles con un nombre
parecido, el script las lista; para forzar una, escribe el nombre COMPLETO tal como está en OSM
(por ejemplo "Avenida México"). No requiere librerías externas.

El ORDEN de recorrido que genera es PROVISIONAL (de norte a sur). Cámbienlo por el recorrido real
del camión editando la columna `orden` de ruta_calles o el orden en calles.geojson.
"""
import argparse
import heapq
import itertools
import json
import math
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

DIST_BORDE_M = 1.0      # un trozo a menos de esto del borde se considera el propio borde (duplicado)
HUECO_MAX_M = 60.0      # si dos calles vecinas no se tocan, separación máxima aceptada para cerrar la esquina
DEDUP_ESQUINA_M = 3.0   # cruces a menos de esto se consideran la misma esquina
TIPOS_EXCLUIDOS = {"footway", "path", "steps", "cycleway", "bridleway", "corridor",
                   "proposed", "construction", "platform", "elevator", "raceway"}

ENDPOINTS = ["https://overpass-api.de/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter"]
CONSULTA_AREA = ('[out:json][timeout:180];\n'
                 'area["boundary"="administrative"]["name"="José Leonardo Ortiz"]->.jlo;\n'
                 'way(area.jlo)["highway"];\nout geom;')
CONSULTA_BBOX = ('[out:json][timeout:180];\n'
                 'way["highway"](-6.800,-79.880,-6.730,-79.800);\nout geom;')


# ---------- utilidades ----------
def norm(t):
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", t)).strip()


def slug(t):
    return re.sub(r"\s+", "-", norm(t)) or "calle"


def q(t):
    return "'" + str(t).replace("'", "''") + "'"


class Plano:
    """Proyección local a metros (suficiente para una zona de pocos km)."""
    def __init__(self, lat0):
        self.kx = 111320 * math.cos(math.radians(lat0))
        self.ky = 110540

    def xy(self, lng, lat):
        return (lng * self.kx, lat * self.ky)

    def ll(self, p):
        return (p[0] / self.kx, p[1] / self.ky)


def seg_inter(p1, p2, p3, p4):
    d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0])
    if abs(d) < 1e-12:
        return None
    t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d
    u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d
    if -1e-9 <= t <= 1 + 1e-9 and -1e-9 <= u <= 1 + 1e-9:
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


def area_firmada(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
               for i in range(len(poly))) / 2


def longitud(poly, cerrado=False):
    n = len(poly)
    return sum(math.dist(poly[i], poly[(i + 1) % n]) for i in range(n if cerrado else n - 1))


def bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def bbox_cruza(a, b, m=0.0):
    return not (a[2] + m < b[0] or b[2] + m < a[0] or a[3] + m < b[1] or b[3] + m < a[1])


def es_simple(ring):
    """True si el anillo (abierto, sin repetir el primer punto) no se cruza consigo mismo."""
    n = len(ring)
    bb = [(min(ring[i][0], ring[(i + 1) % n][0]), min(ring[i][1], ring[(i + 1) % n][1]),
           max(ring[i][0], ring[(i + 1) % n][0]), max(ring[i][1], ring[(i + 1) % n][1])) for i in range(n)]
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if not bbox_cruza(bb[i], bb[j]):
                continue
            if seg_inter(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]):
                return False
    return True


# ---------- grafo de una calle (para seguir su trazado real) ----------
def clave(p):
    return (round(p[0], 3), round(p[1], 3))


class Grafo:
    """Une todos los tramos OSM de una calle en una red: nodos = vértices, aristas = segmentos."""
    def __init__(self):
        self.xy = {}
        self.adj = defaultdict(dict)

    def agregar(self, pts):
        for a, b in zip(pts, pts[1:]):
            ka, kb = clave(a), clave(b)
            if ka == kb:
                continue
            self.xy.setdefault(ka, a)
            self.xy.setdefault(kb, b)
            w = math.dist(a, b)
            self.adj[ka][kb] = w
            self.adj[kb][ka] = w

    def insertar(self, p):
        """Mete el punto p (sobre la calle) como nodo, partiendo el segmento si hace falta."""
        mejor = (float("inf"), None, None, None)
        for u, vs in self.adj.items():
            for v in vs:
                if u < v:
                    d, c = punto_seg(p, self.xy[u], self.xy[v])
                    if d < mejor[0]:
                        mejor = (d, u, v, c)
        d, u, v, c = mejor
        if u is None:
            return None
        for k in (u, v):
            if math.dist(c, self.xy[k]) < 0.05:
                return k
        k = clave(c)
        self.xy[k] = c
        del self.adj[u][v]
        del self.adj[v][u]
        for x in (u, v):
            w = math.dist(c, self.xy[x])
            self.adj[k][x] = w
            self.adj[x][k] = w
        return k

    def camino(self, a, b):
        """Camino más corto por la propia calle entre dos nodos: lista de claves o None."""
        if a == b:
            return [a]
        dist = {a: 0.0}
        prev = {}
        cola = [(0.0, a)]
        while cola:
            d, u = heapq.heappop(cola)
            if u == b:
                break
            if d > dist.get(u, float("inf")):
                continue
            for v, w in self.adj[u].items():
                nd = d + w
                if nd < dist.get(v, float("inf")):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(cola, (nd, v))
        if b not in dist:
            return None
        ruta = [b]
        while ruta[-1] != a:
            ruta.append(prev[ruta[-1]])
        return ruta[::-1]


def candidatos_esquina(ways_a, ways_b):
    """Posibles esquinas entre dos calles: cruces reales; si no se tocan, el par de puntos más cercano."""
    cruces = []
    for wa in ways_a:
        ba = bbox(wa)
        for wb in ways_b:
            if not bbox_cruza(ba, bbox(wb)):
                continue
            for i in range(len(wa) - 1):
                for j in range(len(wb) - 1):
                    x = seg_inter(wa[i], wa[i + 1], wb[j], wb[j + 1])
                    if x and all(math.dist(x, c) > DEDUP_ESQUINA_M for c, _ in cruces):
                        cruces.append((x, x))
    if cruces:
        return [(c, c, 0.0) for c, _ in cruces]
    mejor = (float("inf"), None, None)
    for wa in ways_a:
        for pa in wa:
            for wb in ways_b:
                for j in range(len(wb) - 1):
                    d, c = punto_seg(pa, wb[j], wb[j + 1])
                    if d < mejor[0]:
                        mejor = (d, pa, c)
    for wb in ways_b:
        for pb in wb:
            for wa in ways_a:
                for i in range(len(wa) - 1):
                    d, c = punto_seg(pb, wa[i], wa[i + 1])
                    if d < mejor[0]:
                        mejor = (d, c, pb)
    return [(mejor[1], mejor[2], mejor[0])] if mejor[0] <= HUECO_MAX_M else []


# ---------- construcción del perímetro ----------
def construir_perimetro(calles_lim):
    """
    calles_lim: 4 listas de polilíneas (en metros), una por calle límite.
    Devuelve (anillo abierto en metros, tramos [(idx_calle, puntos)], esquinas [(punto, idx_a, idx_b, hueco)]).
    Elige, entre todas las formas de unir las 4 calles, el circuito cerrado más corto que sea válido.
    """
    grafos = []
    for ways in calles_lim:
        g = Grafo()
        for w in ways:
            g.agregar(w)
        grafos.append(g)

    opciones = []
    for opuestas in ([(0, 2), (1, 3)], [(0, 1), (2, 3)], [(0, 3), (1, 2)]):
        (a0, a1), (b0, b1) = opuestas
        ciclo = [a0, b0, a1, b1]
        pares = [(ciclo[k], ciclo[(k + 1) % 4]) for k in range(4)]
        cands = []
        for i, j in pares:
            lst = []
            for pa, pb, gap in candidatos_esquina(calles_lim[i], calles_lim[j]):
                ka, kb = grafos[i].insertar(pa), grafos[j].insertar(pb)
                if ka is not None and kb is not None:
                    lst.append((ka, kb, gap))
            cands.append(lst)
        if any(not c for c in cands):
            continue
        for combo in itertools.product(*[sorted(c, key=lambda x: x[2])[:6] for c in cands]):
            partes, total, gaps, ok = [], 0.0, 0.0, True
            for k in range(4):
                s = ciclo[k]
                ruta = grafos[s].camino(combo[k - 1][1], combo[k][0])  # de la esquina anterior a la siguiente
                if ruta is None:
                    ok = False
                    break
                pts = [grafos[s].xy[x] for x in ruta]
                partes.append((s, pts))
                total += longitud(pts)
                gaps += combo[k][2]
            if ok:
                opciones.append((total + 50 * gaps, ciclo, combo, partes, grafos))
    opciones.sort(key=lambda o: o[0])

    for costo, ciclo, combo, partes, grafos in opciones[:40]:
        ring = []
        for _, pts in partes:
            for p in pts:
                if not ring or math.dist(ring[-1], p) > 1e-6:
                    ring.append(p)
        if len(ring) > 1 and math.dist(ring[0], ring[-1]) < 1e-6:
            ring.pop()
        if len(ring) < 3 or abs(area_firmada(ring)) < 2000:
            continue
        if not es_simple(ring):
            continue
        esquinas = [(grafos[ciclo[k]].xy[combo[k][0]], ciclo[k], ciclo[(k + 1) % 4], combo[k][2]) for k in range(4)]
        return ring, [(s, pts) for s, pts in partes], esquinas
    return None


# ---------- recorte de calles contra el polígono ----------
def cortes_con_anillo(a, b, ring, ring_bb):
    """Parámetros t (0..1) donde el segmento a-b cruza el borde del polígono."""
    ts = [0.0, 1.0]
    sb = (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))
    n = len(ring)
    for i in range(n):
        c, d = ring[i], ring[(i + 1) % n]
        if not bbox_cruza(sb, (min(c[0], d[0]), min(c[1], d[1]), max(c[0], d[0]), max(c[1], d[1]))):
            continue
        den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])
        if abs(den) < 1e-12:
            continue
        t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den
        u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den
        if 1e-9 < t < 1 - 1e-9 and -1e-9 <= u <= 1 + 1e-9:
            ts.append(t)
    return sorted(ts)


def recortar(tramo_xy, tramo_ll, ring, ring_bb):
    """Devuelve las partes del tramo que quedan ESTRICTAMENTE dentro del polígono (listas de [lng,lat])."""
    corridas, run = [], []

    def punto(i, t):
        if t <= 0:
            return tramo_ll[i]
        if t >= 1:
            return tramo_ll[i + 1]
        la, lb = tramo_ll[i], tramo_ll[i + 1]
        return (la[0] + t * (lb[0] - la[0]), la[1] + t * (lb[1] - la[1]))

    for i in range(len(tramo_xy) - 1):
        a, b = tramo_xy[i], tramo_xy[i + 1]
        sb = (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))
        if not bbox_cruza(sb, ring_bb):
            if len(run) >= 2:
                corridas.append(run)
            run = []
            continue
        ts = cortes_con_anillo(a, b, ring, ring_bb)
        for t0, t1 in zip(ts, ts[1:]):
            if t1 - t0 < 1e-9:
                continue
            tm = (t0 + t1) / 2
            mid = (a[0] + tm * (b[0] - a[0]), a[1] + tm * (b[1] - a[1]))
            if en_poligono(mid, ring) and dist_borde(mid, ring) > DIST_BORDE_M:
                p0, p1 = punto(i, t0), punto(i, t1)
                if not run:
                    run = [p0]
                elif run[-1] != p0:
                    run.append(p0)
                run.append(p1)
            else:
                if len(run) >= 2:
                    corridas.append(run)
                run = []
    if len(run) >= 2:
        corridas.append(run)
    return corridas


def unir_lineas(lineas):
    """Une polilíneas que se encuentran en un extremo donde no hay una tercera (no cruza intersecciones)."""
    k = lambda p: (round(p[0], 7), round(p[1], 7))
    lineas = [list(l) for l in lineas]
    cambio = True
    while cambio:
        cambio = False
        cnt = Counter(k(e) for l in lineas for e in (l[0], l[-1]))
        for i in range(len(lineas)):
            for j in range(len(lineas)):
                if i == j:
                    continue
                a, b = lineas[i], lineas[j]
                if k(a[0]) == k(a[-1]) or k(b[0]) == k(b[-1]):
                    continue
                for ea, eb in ((-1, 0), (-1, -1), (0, 0), (0, -1)):
                    if k(a[ea]) == k(b[eb]) and cnt[k(a[ea])] == 2:
                        aa = a if ea == -1 else a[::-1]
                        bb = b if eb == 0 else b[::-1]
                        lineas[i] = aa + bb[1:]
                        del lineas[j]
                        cambio = True
                        break
                if cambio:
                    break
            if cambio:
                break
    return lineas


def sin_duplicados(lineas):
    vistos, out = set(), []
    for l in lineas:
        t = tuple(tuple(round(c, 7) for c in p) for p in l)
        c = min(t, t[::-1])
        if c not in vistos:
            vistos.add(c)
            out.append(l)
    return out


# ---------- descarga de OpenStreetMap ----------
def descargar(destino):
    errores = []
    for consulta in (CONSULTA_AREA, CONSULTA_BBOX):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(
                    url, data=urllib.parse.urlencode({"data": consulta}).encode(),
                    headers={"User-Agent": "CamionEnRuta/1.0 (proyecto escolar ODS 12)"})
                with urllib.request.urlopen(req, timeout=200) as r:
                    datos = json.loads(r.read().decode("utf-8"))
                if datos.get("elements"):
                    Path(destino).parent.mkdir(parents=True, exist_ok=True)
                    Path(destino).write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
                    print(f"Descargado de OpenStreetMap: {len(datos['elements'])} elementos -> {destino}")
                    return
                errores.append(f"{url}: respuesta vacía")
            except Exception as e:  # noqa: BLE001
                errores.append(f"{url}: {e}")
    sys.exit("No se pudo descargar de Overpass:\n  " + "\n  ".join(errores) +
             "\nAlternativa: ejecuta db/consulta_overpass.txt en https://overpass-turbo.eu y guarda el JSON en " + str(destino))


# ---------- programa principal ----------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entrada", nargs="?", default="data/osm_jlo.json")
    ap.add_argument("--descargar", action="store_true", help="baja los datos de Overpass antes de procesar")
    ap.add_argument("--limites", default="México,Chongoyape,Virrey Toledo,Sáenz Peña")
    ap.add_argument("--salida", default=".", help="carpeta base donde están data/ y db/")
    ap.add_argument("--ruta", default="Ruta 1")
    ap.add_argument("--incluir-sin-nombre", action="store_true", help="incluye calles interiores sin nombre en OSM")
    ap.add_argument("--sin-limpieza", action="store_true", help="el SQL no borra calles antiguas de la base")
    a = ap.parse_args()

    if a.descargar:
        descargar(a.entrada)
    if not Path(a.entrada).exists():
        sys.exit(f"No existe {a.entrada}. Usa --descargar o guarda ahí la exportación de db/consulta_overpass.txt.")

    datos = json.loads(Path(a.entrada).read_text(encoding="utf-8"))
    elems = [e for e in datos.get("elements", []) if e.get("type") == "way" and e.get("geometry")]
    if not elems:
        sys.exit("El archivo no tiene calles con geometría. Usa 'out geom;' en la consulta (ver db/consulta_overpass.txt).")

    todos = [pt for e in elems for pt in e["geometry"]]
    P = Plano(sum(p["lat"] for p in todos) / len(todos))

    tramos, sin_nombre = [], 0  # (nombre, [(x,y)], [(lng,lat)], osm_id)
    for e in elems:
        tags = e.get("tags") or {}
        if tags.get("highway") in TIPOS_EXCLUIDOS:
            continue
        nom = tags.get("name")
        if not nom:
            sin_nombre += 1
            if not a.incluir_sin_nombre:
                continue
            nom = f"Calle sin nombre (OSM {e['id']})"
        ll = [(p["lon"], p["lat"]) for p in e["geometry"]]
        tramos.append((nom, [P.xy(*p) for p in ll], ll, e["id"]))

    # --- 1) localizar las 4 calles límite ---
    pedidos = [x.strip() for x in a.limites.split(",")]
    if len(pedidos) != 4:
        sys.exit("--limites necesita exactamente 4 nombres separados por coma.")
    nombres_lim, calles_lim = [], []
    for ped in pedidos:
        k = norm(ped)
        todos_n = Counter(n for n, *_ in tramos)
        exactos = sorted(n for n in todos_n if norm(n) == k)
        parecidos = sorted(n for n in todos_n if k in norm(n))
        elegidos = exactos or parecidos
        print(f"[límite '{ped}'] en OSM: " + (", ".join(f"{n} ({todos_n[n]} tramos)" for n in parecidos) or "NINGUNO"))
        if not elegidos:
            sys.exit(f"No se encontró ninguna calle que contenga '{ped}'. Revisa la ortografía en OSM o usa --limites.")
        if len(elegidos) > 1:
            print(f"   AVISO: varias calles coinciden; se usarán todas: {elegidos}. Para una sola, escribe su nombre completo.")
        nombres_lim.append(set(elegidos))
        calles_lim.append([t[1] for t in tramos if t[0] in elegidos])

    # --- 2) perímetro con los trazados reales ---
    res = construir_perimetro(calles_lim)
    if res is None:
        sys.exit("No se pudo cerrar un perímetro válido con esas 4 calles (no se tocan o el circuito se cruza).\n"
                 "Revisa los nombres con --limites o los datos de OSM (calles partidas, nombres distintos).")
    ring, partes, esquinas = res
    if area_firmada(ring) < 0:      # GeoJSON: anillo exterior en sentido antihorario
        ring = ring[::-1]
    area = abs(area_firmada(ring))
    print(f"\nPerímetro cerrado: {len(ring)} vértices, {longitud(ring, True):.0f} m de contorno, {area / 10000:.2f} ha.")
    for s, pts in partes:
        print(f"  lado '{pedidos[s]}': {longitud(pts):.0f} m ({len(pts)} vértices reales)")
    for pt, i, j, hueco in esquinas:
        lng, lat = P.ll(pt)
        extra = f"  (AVISO: no se tocan, separación {hueco:.0f} m)" if hueco > 0.5 else ""
        print(f"  esquina {pedidos[i]} × {pedidos[j]}: {lat:.6f}, {lng:.6f}{extra}")

    ring_bb = bbox(ring)

    # --- 3) calles interiores (recortadas) ---
    nombres_prohibidos = set().union(*nombres_lim)
    por_nombre = defaultdict(list)
    for nom, xy, ll, oid in tramos:
        if nom in nombres_prohibidos:
            continue
        for run in recortar(xy, ll, ring, ring_bb):
            por_nombre[nom].append(run)

    def a_ll(poly_m):
        return [[round(c, 7) for c in P.ll(p)] for p in poly_m]

    interiores = {}
    for nom, lineas in por_nombre.items():
        lineas = unir_lineas(sin_duplicados(lineas))
        interiores[nom] = [[[round(c, 7) for c in p] for p in l] for l in lineas]

    limite_geom = {}
    for s, pts in partes:
        limite_geom[pedidos[s]] = a_ll(pts)

    def geom(lineas):
        return ({"type": "LineString", "coordinates": lineas[0]} if len(lineas) == 1
                else {"type": "MultiLineString", "coordinates": lineas})

    def centro_lat(lineas):
        pts = [pt for l in lineas for pt in l]
        return sum(p[1] for p in pts) / len(pts)

    items = [(pedidos[s], "limite", [limite_geom[pedidos[s]]], nom_completo) for (s, _), nom_completo in
             zip(partes, [sorted(nombres_lim[s])[0] for s, _ in partes])]
    items += [(nom, "interior", ls, nom) for nom, ls in interiores.items()]
    items.sort(key=lambda it: -centro_lat(it[2]))

    usados = defaultdict(int)
    features, filas_ruta = [], []
    for i, (_, tipo, lineas, nom) in enumerate(items, start=1):
        cid = slug(nom)
        usados[cid] += 1
        if usados[cid] > 1:
            cid += f"-{usados[cid]}"
        features.append({"type": "Feature",
                         "properties": {"id": cid, "nombre": nom, "ruta": a.ruta, "tipo": tipo, "orden": i},
                         "geometry": geom(lineas)})
        filas_ruta.append((cid, i))

    # --- 4) escribir archivos ---
    base = Path(a.salida)
    (base / "data").mkdir(parents=True, exist_ok=True)
    (base / "db").mkdir(parents=True, exist_ok=True)
    ll_ring = a_ll(ring)
    poligono = {"type": "Polygon", "coordinates": [ll_ring + [ll_ring[0]]]}
    zona = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": "zona-1", "nombre": "Zona de recolección", "limites": pedidos},
         "geometry": poligono}]}
    esq = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"entre": f"{pedidos[i]} × {pedidos[j]}", "separacion_m": round(h, 1)},
         "geometry": {"type": "Point", "coordinates": [round(c, 7) for c in P.ll(pt)]}}
        for pt, i, j, h in esquinas]}
    dump = lambda o: json.dumps(o, ensure_ascii=False, indent=1)
    (base / "data/zona.geojson").write_text(dump(zona), encoding="utf-8")
    (base / "data/esquinas.geojson").write_text(dump(esq), encoding="utf-8")
    (base / "data/calles.geojson").write_text(dump({
        "type": "FeatureCollection",
        "_aviso": "Calles extraídas de OpenStreetMap con db/osm_a_zona.py. El orden de recorrido (orden) es PROVISIONAL.",
        "features": features}), encoding="utf-8")
    (base / "data/estados.json").write_text(dump(
        {"_aviso": "Todas en gris al inicio.", "actualizado": None,
         "estados": {f["properties"]["id"]: "gris" for f in features}}), encoding="utf-8")
    (base / "data/horarios.json").write_text(dump(
        {"nota": "Horario de ejemplo. Reemplazar por el oficial cuando se verifique con la municipalidad.",
         "rutas": [{"ruta": a.ruta, "dias": "Lunes, miércoles y viernes (ejemplo)", "horario": "07:00 – 10:00 (ejemplo)",
                    "calles": [f["properties"]["nombre"] for f in features]}]}), encoding="utf-8")
    (base / "data/calles_sin_nombre.txt").write_text(
        f"{sin_nombre} tramos sin nombre en OSM " + ("(incluidos)" if a.incluir_sin_nombre else "quedaron fuera") + ".\n",
        encoding="utf-8")

    ids = [f["properties"]["id"] for f in features]
    sql = ["-- Generado por db/osm_a_zona.py (zona delimitada + calles interiores).",
           "-- Ejecutar DESPUÉS de db/schema.sql. Es repetible: reemplaza la zona y las calles anteriores.", ""]
    if not a.sin_limpieza:
        sql += ["-- Limpieza: borra calles que ya no pertenecen a la zona (también sus filas de ruta_calles).",
                "delete from ruta_calles where ruta_id = " + q(a.ruta) + ";",
                "delete from calles where id not in (" + ", ".join(q(i) for i in ids) + ");", ""]
    sql += ["insert into zonas (id, nombre, geom) values",
            f"  ({q('zona-1')}, {q('Zona de recolección')}, {q(json.dumps(poligono))}::jsonb)",
            "on conflict (id) do update set nombre = excluded.nombre, geom = excluded.geom;", "",
            "insert into rutas (id, nombre) values", f"  ({q(a.ruta)}, {q(a.ruta)})", "on conflict (id) do nothing;", "",
            "insert into calles (id, nombre, geom) values"]
    sql.append(",\n".join(f"  ({q(f['properties']['id'])}, {q(f['properties']['nombre'])}, {q(json.dumps(f['geometry']))}::jsonb)"
                          for f in features))
    sql.append("on conflict (id) do update set nombre = excluded.nombre, geom = excluded.geom;\n")
    sql.append("insert into ruta_calles (ruta_id, calle_id, orden) values")
    sql.append(",\n".join(f"  ({q(a.ruta)}, {q(c)}, {o})" for c, o in filas_ruta))
    sql.append("on conflict (ruta_id, calle_id) do update set orden = excluded.orden;\n")
    sql.append(f"insert into recorridos (ruta_id) values ({q(a.ruta)}) on conflict (ruta_id) do nothing;")
    (base / "db/zona.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")

    lim = [f["properties"]["nombre"] for f in features if f["properties"]["tipo"] == "limite"]
    print(f"\nCalles límite (solo el tramo del perímetro): {lim}")
    print(f"Calles dentro de la zona: {len(features)} (interiores: {len(features) - len(lim)})")
    print(f"Tramos sin nombre en OSM: {sin_nombre} ({'incluidos' if a.incluir_sin_nombre else 'fuera de la lista'})")
    print("Archivos escritos en", base.resolve())


if __name__ == "__main__":
    main()
