"""
Secciona las calles en TRAMOS entre intersecciones y separa los carriles de las vías de doble sentido.

Lo usa db/osm_a_zona.py. Sin dependencias externas.

Qué hace con las calles ya recortadas a la zona:
  1. Une las corridas que se continúan (por ejemplo, dos tramos de OSM de un mismo carril) en una cadena,
     respetando el sentido de la vía cuando OSM lo indica (oneway=yes).
  2. Si una calle tiene 2 o más cadenas de un solo sentido (avenida de doble vía con carriles separados),
     cada carril es una cadena independiente, nombrada por su sentido de marcha ("sentido oeste").
  3. Corta cada cadena donde otra calle del proyecto la cruza o termina en ella (T). Los cortes demasiado
     cerca de un extremo o entre sí (menos de `tramo_min` m) se ignoran para no crear pedacitos inútiles.
  4. Cada pedazo es un tramo con id y nombre propios, por ejemplo
     "Avenida Sáenz Peña · sentido sur · entre Cacique Cinto y Cacique Collique".
"""
import math
import re
import unicodedata

TIPOS = {"calle", "avenida", "av", "jiron", "jr", "pasaje", "psje", "pje", "ca", "ave"}


def _norm(t):
    t = unicodedata.normalize("NFD", t or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9 ]", " ", t)


def slug(t):
    return re.sub(r"\s+", "-", _norm(t).strip()) or "calle"


def corto(nombre):
    """'Calle Cacique Cinto' -> 'Cacique Cinto' (quita el tipo de vía del inicio)."""
    palabras = nombre.split()
    while len(palabras) > 1 and _norm(palabras[0]).strip() in TIPOS:
        palabras.pop(0)
    return " ".join(palabras)


# ---------- geometría en metros ----------
def _d(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _largo(xy):
    return sum(_d(xy[i], xy[i + 1]) for i in range(len(xy) - 1))


def _acum(xy):
    c = [0.0]
    for i in range(len(xy) - 1):
        c.append(c[-1] + _d(xy[i], xy[i + 1]))
    return c


def _seg_inter(p1, p2, p3, p4):
    d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0])
    if abs(d) < 1e-12:
        return None
    t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d
    u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d
    if -1e-9 <= t <= 1 + 1e-9 and -1e-9 <= u <= 1 + 1e-9:
        return t
    return None


def _proyectar(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    c = (a[0] + t * dx, a[1] + t * dy)
    return _d(p, c), t


def _punto_en(xy, cum, s):
    """Punto a distancia s (m) desde el inicio de la polilínea."""
    s = max(0.0, min(cum[-1], s))
    for i in range(len(xy) - 1):
        if s <= cum[i + 1] + 1e-9:
            seg = cum[i + 1] - cum[i]
            t = 0.0 if seg == 0 else (s - cum[i]) / seg
            return (xy[i][0] + t * (xy[i + 1][0] - xy[i][0]), xy[i][1] + t * (xy[i + 1][1] - xy[i][1])), i
    return xy[-1], len(xy) - 2


def _sub(xy, cum, s0, s1):
    """Trozo de la polilínea entre s0 y s1, conservando los vértices originales intermedios."""
    p0, i0 = _punto_en(xy, cum, s0)
    p1, i1 = _punto_en(xy, cum, s1)
    out = [p0]
    for k in range(i0 + 1, i1 + 1):
        if s0 + 1e-6 < cum[k] < s1 - 1e-6:
            out.append(xy[k])
    out.append(p1)
    return out


# ---------- 1) unir corridas en cadenas ----------
def _da_vuelta(izq, der):
    """True si al unir izq con der la calle se devuelve casi en U (por ejemplo, el retorno de una avenida)."""
    if len(izq) < 2 or len(der) < 2:
        return False
    ux, uy = izq[-1][0] - izq[-2][0], izq[-1][1] - izq[-2][1]
    vx, vy = der[1][0] - der[0][0], der[1][1] - der[0][1]
    nu, nv = math.hypot(ux, uy), math.hypot(vx, vy)
    return nu > 0 and nv > 0 and (ux * vx + uy * vy) / (nu * nv) < -0.3


def _unir(corridas, tol=1.5):
    """Une corridas que se continúan. No une si la calle se devuelve en U: así los dos carriles de una
    avenida que se juntan en un retorno quedan como dos cadenas independientes."""
    cad = [{"xy": list(c["xy"]), "sentido": c["sentido"]} for c in corridas]

    def extremos_cerca(p):
        return sum(1 for c in cad for e in (c["xy"][0], c["xy"][-1]) if _d(e, p) <= tol)

    cambio = True
    while cambio:
        cambio = False
        for i in range(len(cad)):
            for j in range(len(cad)):
                if i == j or cad[i]["sentido"] != cad[j]["sentido"]:
                    continue
                a, b = cad[i]["xy"], cad[j]["xy"]
                opciones = []                                   # (izquierda, derecha, punto de unión)
                opciones.append((a, b, a[-1], _d(a[-1], b[0])))
                if cad[i]["sentido"] == 0:                      # vía de doble sentido: se puede invertir
                    opciones.append((a, b[::-1], a[-1], _d(a[-1], b[-1])))
                    opciones.append((a[::-1], b, a[0], _d(a[0], b[0])))
                for izq, der, punto, dist in opciones:
                    if dist <= tol and extremos_cerca(punto) == 2 and not _da_vuelta(izq, der):
                        cad[i] = {"xy": izq + der[1:], "sentido": cad[i]["sentido"]}
                        del cad[j]
                        cambio = True
                        break
                if cambio:
                    break
            if cambio:
                break
    return cad


def _rumbo(xy):
    dx, dy = xy[-1][0] - xy[0][0], xy[-1][1] - xy[0][1]
    if abs(dx) >= abs(dy):
        return "este" if dx > 0 else "oeste"
    return "norte" if dy > 0 else "sur"


# ---------- API ----------
def construir_tramos(calles, plano, tramo_min=25.0, junta_m=12.0):
    """
    calles: { nombre_calle: [ {"ll": [(lng,lat),…], "sentido": 1|0}, … ] }
            sentido 1 = vía de un solo sentido, con la lista ya en el sentido de la marcha.
    plano : objeto con .kx y .ky (metros por grado) como Plano de osm_a_zona.py
    Devuelve una lista de tramos:
      {calle, carril, k, n, nombre, id, coords:[[lng,lat],…], s0, s1, cadena}
    ordenados por calle, cadena y k (k = 1 es el primer tramo en el sentido de la cadena).
    """
    kx, ky = plano.kx, plano.ky
    a_xy = lambda ll: [(p[0] * kx, p[1] * ky) for p in ll]
    def a_ll(xy):
        out = []
        for p in xy:
            q = [round(p[0] / kx, 7), round(p[1] / ky, 7)]
            if not out or out[-1] != q:        # sin puntos repetidos seguidos
                out.append(q)
        return out

    # cadenas por calle, con etiqueta de carril
    cadenas = []   # {calle, idx, xy, carril}
    for nombre, corridas in calles.items():
        ch = _unir([{"xy": a_xy(c["ll"]), "sentido": c["sentido"]} for c in corridas])
        ch.sort(key=lambda c: (-c["xy"][0][1], c["xy"][0][0]))
        unisentido = [c for c in ch if c["sentido"] == 1]
        doble_via = len(unisentido) >= 2
        usados = {}
        for i, c in enumerate(ch):
            etiqueta = None
            if doble_via and c["sentido"] == 1:
                etiqueta = "sentido " + _rumbo(c["xy"])
                usados[etiqueta] = usados.get(etiqueta, 0) + 1
                if usados[etiqueta] > 1:
                    etiqueta += f" ({usados[etiqueta]})"
            cadenas.append({"calle": nombre, "idx": i, "xy": c["xy"], "carril": etiqueta})

    tramos = []
    for c in cadenas:
        xy = c["xy"]
        cum = _acum(xy)
        L = cum[-1]
        cortes = []                       # (s, nombre_calle_que_cruza)
        for o in cadenas:
            if o["calle"] == c["calle"]:
                continue
            ox = o["xy"]
            for i in range(len(xy) - 1):
                for j in range(len(ox) - 1):
                    t = _seg_inter(xy[i], xy[i + 1], ox[j], ox[j + 1])
                    if t is not None:
                        cortes.append((cum[i] + t * (cum[i + 1] - cum[i]), o["calle"]))
            for e in (ox[0], ox[-1]):      # calles que terminan sobre ésta (T) sin tocarla exactamente
                mejor = None
                for i in range(len(xy) - 1):
                    dist, t = _proyectar(e, xy[i], xy[i + 1])
                    if dist <= junta_m and (mejor is None or dist < mejor[0]):
                        mejor = (dist, cum[i] + t * (cum[i + 1] - cum[i]))
                if mejor:
                    cortes.append((mejor[1], o["calle"]))
        cortes.sort()

        # agrupar cortes cercanos (menos de tramo_min entre sí)
        grupos = []
        for s, nom in cortes:
            if grupos and s - grupos[-1]["s"] < tramo_min:
                grupos[-1]["nombres"].add(nom)
            else:
                grupos.append({"s": s, "nombres": {nom}})
        # los cercanos a un extremo no cortan: solo etiquetan ese extremo
        nombres_ini, nombres_fin, utiles = set(), set(), []
        for g in grupos:
            if g["s"] < tramo_min:
                nombres_ini |= g["nombres"]
            elif L - g["s"] < tramo_min:
                nombres_fin |= g["nombres"]
            else:
                utiles.append(g)

        limites = [(0.0, nombres_ini)] + [(g["s"], g["nombres"]) for g in utiles] + [(L, nombres_fin)]
        n = len(limites) - 1
        for k in range(n):
            (s0, n0), (s1, n1) = limites[k], limites[k + 1]
            pedazo = _sub(xy, cum, s0, s1)
            etq = lambda ns: " / ".join(sorted(corto(x) for x in ns))
            if n0 and n1:
                tramo_txt = f"entre {etq(n0)} y {etq(n1)}"
            elif n1:
                tramo_txt = f"hasta {etq(n1)}"
            elif n0:
                tramo_txt = f"desde {etq(n0)}"
            else:
                tramo_txt = ""
            partes = [c["calle"]] + ([c["carril"]] if c["carril"] else []) + ([tramo_txt] if (tramo_txt and n > 1) else [])
            nombre = " · ".join(partes)
            tramos.append({"calle": c["calle"], "carril": c["carril"], "k": k + 1, "n": n, "cadena": c["idx"],
                           "nombre": nombre, "coords": a_ll(pedazo), "s0": s0, "s1": s1,
                           "largo_m": s1 - s0, "n_cadenas_calle": sum(1 for x in cadenas if x["calle"] == c["calle"])})

    # ids únicos y estables: calle[-carril][-k]; sin sufijo cuando la calle queda en un solo tramo
    usados = {}
    for t in tramos:
        base = slug(t["calle"])
        if t["carril"]:
            base += "-" + slug(t["carril"])
        elif t["n_cadenas_calle"] > 1:
            base += f"-{t['cadena'] + 1}"
        if t["n"] > 1:
            base += f"-{t['k']}"
        usados[base] = usados.get(base, 0) + 1
        t["id"] = base if usados[base] == 1 else f"{base}-{usados[base]}"
    # nombres repetidos (mismos vecinos en dos tramos): se numeran
    por_nombre = {}
    for t in tramos:
        por_nombre.setdefault(t["nombre"], []).append(t)
    for nom, lst in por_nombre.items():
        if len(lst) > 1:
            for i, t in enumerate(lst, 1):
                t["nombre"] = f"{nom} ({i})"
    return tramos
