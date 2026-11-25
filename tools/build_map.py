#!/usr/bin/env python3
"""Convierte datos de OpenStreetMap (JSON de Overpass) de Los Mochis
en data/mochis.js, el mapa compacto que usa el juego.

Uso:
  python3 tools/build_map.py raw.json data/mochis.js [lugares1.json lugares2.json ...]

Los archivos de lugares (opcionales) salen de tools/overpass_pois.txt.

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

SKIP_AMENITY = {"parking", "parking_entrance", "toilets", "bench", "waste_basket", "atm", "vending_machine",
                "bicycle_parking", "shelter", "drinking_water", "parking_space", "telephone", "recycling"}

def poi_category(t):
    a, sh, le, to = t.get("amenity", ""), t.get("shop", ""), t.get("leisure", ""), t.get("tourism", "")
    if a in SKIP_AMENITY:
        return None
    if sh == "mall" or a == "marketplace":
        return 11, 1
    if a in ("restaurant", "fast_food", "cafe", "bar", "pub", "ice_cream", "food_court", "biergarten"):
        return 0, 0
    if a in ("school", "university", "college", "kindergarten", "language_school"):
        return 2, 1 if a in ("university", "college") else 0
    if a in ("hospital", "clinic", "doctors", "pharmacy", "dentist"):
        return 3, 1 if a == "hospital" else 0
    if a == "place_of_worship":
        return 4, 1
    if a in ("bank", "bureau_de_change"):
        return 5, 0
    if a in ("townhall", "police", "fire_station", "courthouse", "post_office", "public_building"):
        return 6, 1
    if a == "fuel":
        return 7, 0
    if to in ("hotel", "motel", "guest_house", "hostel"):
        return 8, 0
    if le in ("park", "garden", "playground", "dog_park"):
        return 9, 1 if le == "park" else 0
    if le in ("stadium", "sports_centre", "pitch", "fitness_centre", "swimming_pool", "track"):
        return 10, 1 if le == "stadium" else 0
    if a in ("theatre", "cinema", "arts_centre", "library", "community_centre") or to in ("museum", "attraction", "artwork", "gallery") or t.get("historic"):
        return 12, 1
    if sh in ("supermarket", "department_store", "wholesale"):
        return 1, 1
    if sh:
        return 1, 0
    if a or to or le:
        return 13, 0
    return None

def load_pois(files):
    seen, out = set(), []
    for fn in files:
        for el in json.load(open(fn)).get("elements", []):
            t = el.get("tags", {})
            name = t.get("name", "").strip()
            if not name:
                continue
            lat = el.get("lat") or el.get("center", {}).get("lat")
            lon = el.get("lon") or el.get("center", {}).get("lon")
            if lat is None:
                continue
            cat = poi_category(t)
            if not cat:
                continue
            key = (name.lower(), round(lat, 3), round(lon, 3))
            if key in seen:
                continue
            seen.add(key)
            x, y = proj(lat, lon)
            out.append([round(x), round(y), cat[0], name, cat[1]])
    return out

def main(src, dst, poi_files=()):
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
    # ---------- edificios emblemáticos en lugares reales importantes ----------
    pois = load_pois(poi_files)
    LANDMARK = {11: (60, 45, 10, 8), 4: (16, 30, 11, 9), 3: (34, 24, 16, 10), 2: (44, 22, 10, 11),
                6: (26, 20, 13, 12), 10: (70, 50, 9, 13), 12: (24, 22, 11, 14), 1: (40, 30, 8, 8)}
    road_tree = STRtree(road_geoms)
    marks = []
    for x, y, cat, name, imp in pois:
        if not imp or cat not in LANDMARK:
            continue
        w, d, h, col = LANDMARK[cat]
        # orientar con la calle más cercana
        near = road_tree.query(Point(x, y).buffer(80))
        ang = 0.0
        if len(near):
            g = min((road_geoms[i] for i in near), key=lambda g: g.distance(Point(x, y)))
            c = list(g.exterior.coords)
            best = max(zip(c, c[1:]), key=lambda ab: math.hypot(ab[1][0] - ab[0][0], ab[1][1] - ab[0][1]))
            ang = math.atan2(best[1][1] - best[0][1], best[1][0] - best[0][0])
        placed_mark = None
        for k in range(6):
            sc = 0.82 ** k
            rect = affinity.translate(affinity.rotate(box(-w * sc / 2, -d * sc / 2, w * sc / 2, d * sc / 2), ang, use_radians=True), x, y)
            if not any(road_geoms[i].intersects(rect) for i in road_tree.query(rect)) and not any(m.intersects(rect) for m in marks):
                placed_mark = (rect, w * sc, d * sc)
                break
        if not placed_mark:
            continue
        rect, ww, dd = placed_mark
        marks.append(rect.buffer(2))
        buildings += [round(x, 1), round(y, 1), round(ww, 1), round(dd, 1), round(ang, 3), h, col]
    if marks:
        mt = STRtree(marks)
        kept = []
        for i in range(0, len(buildings), 7):
            bx = buildings[i:i + 7]
            if bx[6] >= 8:
                kept += bx
                continue
            rect = affinity.translate(affinity.rotate(box(-bx[2] / 2, -bx[3] / 2, bx[2] / 2, bx[3] / 2), bx[4], use_radians=True), bx[0], bx[1])
            if not any(marks[j].intersects(rect) for j in mt.query(rect)):
                kept += bx
        buildings = kept
    print(f"emblemáticos={len(marks)} edificios={len(buildings)//7}")

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
        "pois": pois,
    }
    print(f"lugares={len(out['pois'])}")
    with open(dst, "w") as f:
        f.write("// Generado por tools/build_map.py a partir de datos de OpenStreetMap\n")
        f.write("// (c) colaboradores de OpenStreetMap, licencia ODbL - openstreetmap.org/copyright\n")
        f.write("window.MOCHIS_MAP=")
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
