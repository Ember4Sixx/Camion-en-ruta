#!/usr/bin/env python3
"""
Convierte un calles.geojson hecho a mano en SQL para cargar rutas, calles y ruta_calles.
(Si usan db/osm_a_zona.py no hace falta este script: ese ya genera db/zona.sql.)

Uso (desde la carpeta del proyecto):
    python db/geojson_a_sql.py > db/calles.sql

Reglas del archivo GeoJSON:
  - Cada calle (Feature) debe tener properties: id, nombre, ruta (y, opcional, orden).
  - Si no hay `orden`, vale el orden de las calles dentro del archivo, dentro de cada ruta;
    es el orden en que el camión las recorre.
Luego pega db/calles.sql en Supabase > SQL Editor. Los horarios se cargan aparte
(ver db/horarios.sql y GUIA.md, paso 3).
"""
import json
import sys
from collections import OrderedDict
from pathlib import Path

ruta_archivo = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/calles.geojson")
datos = json.loads(ruta_archivo.read_text(encoding="utf-8"))


def q(texto):
    """Escapa un texto para SQL."""
    return "'" + str(texto).replace("'", "''") + "'"


rutas = OrderedDict()
calles_sql = []
feats = sorted(enumerate(datos["features"]), key=lambda t: (t[1]["properties"].get("orden") or t[0] + 1, t[0]))
for _, f in feats:
    p = f["properties"]
    rutas.setdefault(p["ruta"], []).append(p["id"])
    geom = json.dumps(f["geometry"], ensure_ascii=False)
    calles_sql.append(f"({q(p['id'])}, {q(p['nombre'])}, {q(geom)}::jsonb)")

print("-- Generado por db/geojson_a_sql.py. Orden de calles = orden del archivo.")
print("insert into rutas (id, nombre) values")
print(",\n".join(f"  ({q(r)}, {q(r)})" for r in rutas) + "\non conflict (id) do nothing;\n")

print("insert into calles (id, nombre, geom) values")
print(",\n".join("  " + c for c in calles_sql) + "\non conflict (id) do update set nombre = excluded.nombre, geom = excluded.geom;\n")

print("insert into ruta_calles (ruta_id, calle_id, orden) values")
filas = [f"  ({q(r)}, {q(c)}, {i})" for r, ids in rutas.items() for i, c in enumerate(ids, start=1)]
print(",\n".join(filas) + "\non conflict (ruta_id, calle_id) do update set orden = excluded.orden;")
