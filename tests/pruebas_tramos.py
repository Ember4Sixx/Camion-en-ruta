#!/usr/bin/env python3
"""
Pruebas de data/calles.geojson y data/zona.geojson (tramos y carriles).
Uso:  python tests/pruebas_tramos.py        (desde la carpeta del proyecto)
"""
import json
import math
import sys
from pathlib import Path

raiz = Path(__file__).resolve().parent.parent
calles = json.loads((raiz / "data/calles.geojson").read_text(encoding="utf-8"))["features"]
zona = json.loads((raiz / "data/zona.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"]["coordinates"][0]
ok = 0


def prueba(nombre, cond, detalle=""):
    global ok
    if not cond:
        print(f"  ✘ {nombre} {detalle}")
        sys.exit(1)
    ok += 1
    print(f"  ✔ {nombre}")


KX, KY = 111320 * math.cos(math.radians(-6.757)), 110540
m = lambda p: (p[0] * KX, p[1] * KY)
largo = lambda l: sum(math.dist(m(l[i]), m(l[i + 1])) for i in range(len(l) - 1))
P = lambda f: f["properties"]

print("calles.geojson · tramos y carriles")
ids = [P(f)["id"] for f in calles]
prueba("ids únicos", len(ids) == len(set(ids)))
prueba("órdenes 1..N sin repetir", sorted(P(f)["orden"] for f in calles) == list(range(1, len(calles) + 1)))
prueba("todo es LineString con 2+ puntos", all(f["geometry"]["type"] == "LineString" and len(f["geometry"]["coordinates"]) >= 2 for f in calles))
prueba("ningún tramo es un pedacito (mínimo 20 m)", all(largo(f["geometry"]["coordinates"]) >= 20 for f in calles),
       str([(P(f)["id"], round(largo(f["geometry"]["coordinates"]))) for f in calles if largo(f["geometry"]["coordinates"]) < 20]))

# carriles separados
for calle in ("Avenida México", "Avenida Sáenz Peña"):
    car = {P(f)["carril"] for f in calles if P(f)["calle"] == calle}
    prueba(f"{calle}: dos carriles independientes", len(car) == 2 and "" not in car, str(car))
    por = {c: [f for f in calles if P(f)["calle"] == calle and P(f)["carril"] == c] for c in car}
    prueba(f"{calle}: cada carril está en tramos propios (ninguno comparte id)", len({P(f)["id"] for fs in por.values() for f in fs}) == sum(map(len, por.values())))
    n = [len(v) for v in por.values()]
    prueba(f"{calle}: los dos carriles tienen los mismos cortes", n[0] == n[1], str(n))

# los carriles de una avenida no van seguidos en el orden de recorrido (el amarillo "próximas N" no los enciende juntos)
for calle in ("Avenida México", "Avenida Sáenz Peña"):
    por = {}
    for f in calles:
        if P(f)["calle"] == calle:
            por.setdefault(P(f)["carril"], []).append(P(f)["orden"])
    (a, b) = [sorted(v) for v in por.values()]
    prueba(f"{calle}: un carril termina y el otro empieza al menos 5 puestos después", abs(a[0] - b[-1]) >= 5 or abs(b[0] - a[-1]) >= 5, f"{a} / {b}")

# Av. Sáenz Peña se corta en las calles que la cruzan
sp = [P(f)["nombre"] for f in calles if P(f)["calle"] == "Avenida Sáenz Peña" and P(f)["carril"] == "sentido sur"]
prueba("Sáenz Peña (sentido sur) se corta en Cacique Cinto, Cacique Collique y Caminos del Inca", len(sp) == 4, str(sp))

# cada calle con más de un tramo lleva sufijo -1, -2…
prueba("ids de tramos: calle-N", all(P(f)["id"][-2] == "-" and P(f)["id"][-1].isdigit() for f in calles if " · " in P(f)["nombre"]))

# todo dentro de la zona (con 2 m de tolerancia respecto del borde)
def dentro(p, poly):
    d = False
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            d = not d
    return d
def dist_borde(p, poly):
    best = 1e9
    for i in range(len(poly) - 1):
        (ax, ay), (bx, by), (px, py) = m(poly[i]), m(poly[i + 1]), m(p)
        dx, dy = bx - ax, by - ay
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(px - ax - t * dx, py - ay - t * dy))
    return best
fuera = [(P(f)["id"]) for f in calles for p in f["geometry"]["coordinates"] if not dentro(p, zona) and dist_borde(p, zona) > 15]
prueba("ningún tramo sale de la zona (tolerancia 15 m, la del script)", not fuera, str(set(fuera)))

print(f"\n{ok} pruebas correctas.")
