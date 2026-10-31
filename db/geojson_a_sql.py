#!/usr/bin/env python3
"""
Convierte un tramos.geojson hecho a mano en SQL para cargar rutas, calles, tramos y ruta_tramos.
(Si usan db/osm_a_zona.py no hace falta este script: ese ya genera db/zona.sql.)

Uso (desde la carpeta del proyecto):
    python db/geojson_a_sql.py > db/tramos.sql

Reglas del archivo GeoJSON (un Feature por TRAMO):
  - properties: id, nombre, ruta  y, opcionales:
      calle   nombre de la calle completa (si falta, se toma lo que va antes de " · " en `nombre`)
      carril  'sentido este', etc. (vacío si no es de doble vía)
      orden   orden de recorrido (si falta, vale el orden del archivo dentro de cada ruta)
  - Los tramos que comparten `calle` forman una sola fila en la tabla `calles`.
Luego pega db/tramos.sql en Supabase > SQL Editor. Los horarios se cargan aparte
(ver db/horarios.sql y GUIA.md, paso 3).
"""
import json
import re
import sys
import unicodedata
from collections import OrderedDict
from pathlib import Path

ruta_archivo = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/tramos.geojson")
datos = json.loads(ruta_archivo.read_text(encoding="utf-8"))


def q(texto):
    """Escapa un texto para SQL."""
    return "'" + str(texto).replace("'", "''") + "'"


def slug(t):
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-") or "calle"


rutas = OrderedDict()
calles = OrderedDict()          # id -> nombre
tramos_sql = []
feats = sorted(enumerate(datos["features"]), key=lambda t: (t[1]["properties"].get("orden") or t[0] + 1, t[0]))
for _, f in feats:
    p = f["properties"]
    calle = p.get("calle") or p["nombre"].split(" · ")[0]
    cid = slug(calle)
    calles[cid] = calle
    rutas.setdefault(p["ruta"], []).append(p["id"])
    geom = json.dumps(f["geometry"], ensure_ascii=False)
    tramos_sql.append(f"({q(p['id'])}, {q(cid)}, {q(p['nombre'])}, {q(p.get('carril') or '')}, {int(p.get('k') or 1)}, {q(geom)}::jsonb)")

print("-- Generado por db/geojson_a_sql.py. Orden de los tramos = orden del archivo.")
print("insert into rutas (id, nombre) values")
print(",\n".join(f"  ({q(r)}, {q(r)})" for r in rutas) + "\non conflict (id) do nothing;\n")

print("insert into calles (id, nombre) values")
print(",\n".join(f"  ({q(i)}, {q(n)})" for i, n in calles.items()) + "\non conflict (id) do update set nombre = excluded.nombre;\n")

print("insert into tramos (id, calle_id, nombre, carril, k, geom) values")
print(",\n".join("  " + t for t in tramos_sql)
      + "\non conflict (id) do update set calle_id = excluded.calle_id, nombre = excluded.nombre, carril = excluded.carril, k = excluded.k, geom = excluded.geom;\n")

print("insert into ruta_tramos (ruta_id, tramo_id, orden) values")
filas = [f"  ({q(r)}, {q(c)}, {i})" for r, ids in rutas.items() for i, c in enumerate(ids, start=1)]
print(",\n".join(filas) + "\non conflict (ruta_id, tramo_id) do update set orden = excluded.orden;")
