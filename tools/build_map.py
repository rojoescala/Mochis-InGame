#!/usr/bin/env python3
"""Convierte datos de OpenStreetMap (JSON de Overpass) de Los Mochis
en data/mochis.js, el mapa compacto que usa el juego.

Uso:
  python3 tools/build_map.py raw.json data/mochis.js

El JSON se obtiene con la consulta en tools/overpass_query.txt:
  curl --data-urlencode data@tools/overpass_query.txt \
       https://overpass-api.de/api/interpreter -o raw.json
"""
import json, math, random, sys
from shapely.geometry import LineString, Polygon, Point, box
from shapely.strtree import STRtree
from shapely import affinity

LAT0, LON0 = 25.7905, -108.9937  # centro de Los Mochis
MLAT = 111320.0
MLON = 111320.0 * math.cos(math.radians(LAT0))

def proj(lat, lon):
    return (round((lon - LON0) * MLON, 1), round(-(lat - LAT0) * MLAT, 1))

ROAD_TYPES = ["motorway", "trunk", "primary", "secondary", "tertiary",
              "unclassified", "residential", "living_street", "service"]
# medio ancho de cada tipo de calle (m)
HALF_W = [9, 8, 7.5, 6.5, 5.5, 4.5, 4.5, 3.5, 3]

def half_w(t, oneway):
    # los bulevares divididos vienen como dos vías de un sentido: más angostas
    return HALF_W[t] * (0.6 if oneway else 1.0)

def road_type(hw):
    hw = hw.replace("_link", "")
    return ROAD_TYPES.index(hw) if hw in ROAD_TYPES else None

def main(src, dst):
    raw = json.load(open(src))
    rnd = random.Random(1914)  # año de fundación de la ciudad (aprox.)
    node_index = {}
    nodes = []
    roads = []
    names = [""]
    name_idx = {"": 0}
    areas = []
    water = []
    road_geoms = []
    block_geoms = []  # parques / agua: sin edificios

    def nid(osm_id, lat, lon):
        if osm_id not in node_index:
            node_index[osm_id] = len(nodes)
            nodes.append(proj(lat, lon))
        return node_index[osm_id]

    for el in raw["elements"]:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        tags = el.get("tags", {})
        geom = el["geometry"]
        ids = el.get("nodes") or [None] * len(geom)
        if "highway" in tags:
            t = road_type(tags["highway"])
            if t is None:
                continue
            idxs = []
            for osm_id, g in zip(ids, geom):
                if g is None:
                    continue
                key = osm_id if osm_id is not None else (g["lat"], g["lon"])
                idxs.append(nid(key, g["lat"], g["lon"]))
            if len(idxs) < 2:
                continue
            name = tags.get("name", "")
            if name not in name_idx:
                name_idx[name] = len(names)
                names.append(name)
            ow = tags.get("oneway", "no")
            oneway = 1 if ow in ("yes", "true", "1") else (-1 if ow == "-1" else 0)
            if tags.get("junction") == "roundabout":
                oneway = 1
            roads.append([t, name_idx[name], oneway] + idxs)
            pts = [nodes[i] for i in idxs]
            road_geoms.append(LineString(pts).buffer(half_w(t, oneway) + 2.0, cap_style=1))
        else:
            pts = [proj(g["lat"], g["lon"]) for g in geom if g]
            if len(pts) < 2:
                continue
            if "waterway" in tags:
                w = {"river": 14, "canal": 8, "drain": 4}.get(tags["waterway"], 5)
                water.append([w] + [c for p in pts for c in p])
                block_geoms.append(LineString(pts).buffer(w / 2 + 3))
                continue
            if len(pts) < 4:
                continue
            kind = None
            if tags.get("leisure") in ("park",):
                kind = 0
            elif tags.get("leisure") in ("pitch", "stadium"):
                kind = 1
            elif tags.get("landuse") == "grass":
                kind = 0
            elif tags.get("landuse") == "industrial":
                kind = 2
            elif tags.get("landuse") in ("commercial", "retail"):
                kind = 3
            if kind is None:
                continue
            nm = tags.get("name", "")
            areas.append([kind, nm] + [c for p in pts for c in p])
            if kind in (0, 1):
                try:
                    block_geoms.append(Polygon(pts).buffer(0))
                except Exception:
                    pass

    print(f"nodos={len(nodes)} calles={len(roads)} areas={len(areas)} agua={len(water)}")

    # ---------- edificios procedurales a lo largo de las calles ----------
    obstacles = road_geoms + block_geoms
    tree = STRtree(obstacles)
    placed = []
    placed_tree_items = []
    buildings = []
    grid = {}
    G = 40.0

    def grid_hits(poly):
        x0, y0, x1, y1 = poly.bounds
        for gx in range(int(math.floor(x0 / G)), int(math.floor(x1 / G)) + 1):
            for gy in range(int(math.floor(y0 / G)), int(math.floor(y1 / G)) + 1):
                for p in grid.get((gx, gy), ()):
                    if p.intersects(poly):
                        return True
        return False

    def grid_add(poly):
        x0, y0, x1, y1 = poly.bounds
        for gx in range(int(math.floor(x0 / G)), int(math.floor(x1 / G)) + 1):
            for gy in range(int(math.floor(y0 / G)), int(math.floor(y1 / G)) + 1):
                grid.setdefault((gx, gy), []).append(poly)

    for r in roads:
        t = r[0]
        if t in (0, 8):  # ni carretera ni servicio
            continue
        idxs = r[3:]
        for a, b in zip(idxs, idxs[1:]):
            (x0, y0), (x1, y1) = nodes[a], nodes[b]
            L = math.hypot(x1 - x0, y1 - y0)
            if L < 6:
                continue
            ux, uy = (x1 - x0) / L, (y1 - y0) / L
            nx, ny = -uy, ux
            ang = math.atan2(uy, ux)
            for side in (-1, 1):
                s = rnd.uniform(2, 8)
                while s < L - 4:
                    w = rnd.uniform(8, 17)
                    d = rnd.uniform(9, 20)
                    off = half_w(t, r[2]) + 3.0 + d / 2
                    cx = x0 + ux * (s + w / 2) + nx * off * side
                    cy = y0 + uy * (s + w / 2) + ny * off * side
                    rect = affinity.rotate(box(-w / 2, -d / 2, w / 2, d / 2), ang, use_radians=True)
                    rect = affinity.translate(rect, cx, cy)
                    ok = True
                    for i in tree.query(rect):
                        if obstacles[i].intersects(rect):
                            ok = False
                            break
                    if ok and not grid_hits(rect.buffer(1.0)):
                        grid_add(rect)
                        dist = math.hypot(cx, cy)
                        if dist < 1300:
                            h = rnd.uniform(7, 22) if rnd.random() < 0.5 else rnd.uniform(4, 9)
                        elif dist < 3000:
                            h = rnd.uniform(3.5, 9)
                        else:
                            h = rnd.uniform(3, 6)
                        buildings += [round(cx, 1), round(cy, 1), round(w, 1), round(d, 1),
                                      round(ang, 3), round(h, 1), rnd.randrange(8)]
                    s += w + rnd.uniform(1.5, 6)
    print(f"edificios={len(buildings)//7}")

    xs = [p[0] for p in nodes]; ys = [p[1] for p in nodes]
    out = {
        "center": [LAT0, LON0],
        "bounds": [min(xs), min(ys), max(xs), max(ys)],
        "types": ROAD_TYPES,
        "halfW": HALF_W,
        "nodes": [c for p in nodes for c in (round(p[0]), round(p[1]))],
        "names": names,
        "roads": roads,
        "areas": [[a[0], a[1]] + [round(c) for c in a[2:]] for a in areas],
        "water": [[w[0]] + [round(c) for c in w[1:]] for w in water],
        "buildings": buildings,
    }
    with open(dst, "w") as f:
        f.write("// Generado por tools/build_map.py a partir de datos de OpenStreetMap\n")
        f.write("// (c) colaboradores de OpenStreetMap, licencia ODbL - openstreetmap.org/copyright\n")
        f.write("window.MOCHIS_MAP=")
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
