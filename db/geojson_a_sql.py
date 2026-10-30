#!/usr/bin/env python3
"""
Convierte data/calles.geojson (y, si existe, data/zona.geojson) en SQL para Supabase:
zonas, rutas, calles, ruta_calles y recorridos.

Uso (desde la carpeta del proyecto):
    python db/geojson_a_sql.py > db/calles.sql
    python db/geojson_a_sql.py data/calles.geojson data/zona.geojson > db/calles.sql
    python db/geojson_a_sql.py --sin-limpieza > db/calles.sql

Reglas del archivo GeoJSON:
  - Cada calle (Feature) debe tener properties: id, nombre, ruta, y geometría LineString o MultiLineString.
  - El ORDEN de las calles dentro del archivo, dentro de cada ruta,
    es el orden en que el camión las recorre.
  - Los `id` no pueden repetirse.
Luego pega db/calles.sql en Supabase > SQL Editor. Los horarios se cargan aparte
(ver GUIA.md, paso 3).

Por defecto el SQL borra de la base las calles que ya no están en el archivo (así no quedan
calles antiguas o de ejemplo dibujadas en el mapa). Usa --sin-limpieza para conservarlas.
"""
import json
import sys
from collections import OrderedDict
from pathlib import Path

args = [a for a in sys.argv[1:] if not a.startswith("--")]
limpiar = "--sin-limpieza" not in sys.argv
ruta_archivo = Path(args[0]) if args else Path("data/calles.geojson")
ruta_zona = Path(args[1]) if len(args) > 1 else Path("data/zona.geojson")
datos = json.loads(ruta_archivo.read_text(encoding="utf-8"))


def q(texto):
    """Escapa un texto para SQL."""
    return "'" + str(texto).replace("'", "''") + "'"


rutas = OrderedDict()
calles_sql = []
ids = []
for f in datos["features"]:
    p = f["properties"]
    g = f["geometry"]
    if g["type"] not in ("LineString", "MultiLineString"):
        sys.exit(f"La calle {p['id']} tiene geometría {g['type']}; solo se admiten LineString y MultiLineString.")
    if p["id"] in ids:
        sys.exit(f"El id '{p['id']}' está repetido en {ruta_archivo}. Cada calle necesita un id único.")
    ids.append(p["id"])
    rutas.setdefault(p["ruta"], []).append(p["id"])
    geom = json.dumps(g, ensure_ascii=False)
    calles_sql.append(f"({q(p['id'])}, {q(p['nombre'])}, {q(geom)}::jsonb)")

print("-- Generado por db/geojson_a_sql.py. Orden de calles = orden del archivo.")
if limpiar:
    print("-- Limpieza: quita las calles que ya no están en el archivo (y sus filas de ruta_calles).")
    for r in rutas:
        print(f"delete from ruta_calles where ruta_id = {q(r)};")
    print("delete from calles where id not in (" + ", ".join(q(i) for i in ids) + ");\n")

if ruta_zona.exists():
    zf = json.loads(ruta_zona.read_text(encoding="utf-8"))["features"][0]
    zp = zf["properties"]
    print("insert into zonas (id, nombre, geom) values")
    print(f"  ({q(zp.get('id', 'zona-1'))}, {q(zp.get('nombre', 'Zona de recolección'))}, "
          f"{q(json.dumps(zf['geometry'], ensure_ascii=False))}::jsonb)")
    print("on conflict (id) do update set nombre = excluded.nombre, geom = excluded.geom;\n")

print("insert into rutas (id, nombre) values")
print(",\n".join(f"  ({q(r)}, {q(r)})" for r in rutas) + "\non conflict (id) do nothing;\n")

print("insert into calles (id, nombre, geom) values")
print(",\n".join("  " + c for c in calles_sql) + "\non conflict (id) do update set nombre = excluded.nombre, geom = excluded.geom;\n")

print("insert into ruta_calles (ruta_id, calle_id, orden) values")
filas = [f"  ({q(r)}, {q(c)}, {i})" for r, cs in rutas.items() for i, c in enumerate(cs, start=1)]
print(",\n".join(filas) + "\non conflict (ruta_id, calle_id) do update set orden = excluded.orden;\n")

print("insert into recorridos (ruta_id) values")
print(",\n".join(f"  ({q(r)})" for r in rutas) + "\non conflict (ruta_id) do nothing;")
