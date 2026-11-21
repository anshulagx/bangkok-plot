import sites from "../data/sites.json" with { type: "json" };
import { area, cross, hit, next, roadLines } from "../domain/geometry.js";
import { fmt } from "../domain/format.js";

export function requests(s, key, local) {
  const ring = s.polygon.slice();
  if (area(ring.map(local)) < 0) ring.reverse(); // Clockwise on the ground (screen y increases south).
  const xs = ring.map((p) => p[0]),
    ys = ring.map((p) => p[1]);
  const box = [
    Math.min(...xs) - 0.0008,
    Math.min(...ys) - 0.0008,
    Math.max(...xs) + 0.0008,
    Math.max(...ys) + 0.0008,
  ].join(",");
  const same =
    JSON.stringify(s.polygon) === JSON.stringify(sites[key].coordinates);
  return [
    "1",
    "2",
    "4",
    "5",
    "7",
    "8",
    "10",
    "11",
    "12",
    "roads",
    "buildings",
  ].map((id) => {
    const context = isNaN(Number(id)),
      url = new URL(
        context
          ? id === "roads"
            ? sites[key].roadQuery
            : sites[key].buildingQuery
          : sites[key].zoneQuery,
      );
    if (!context)
      url.pathname = url.pathname.replace(/\/1\/query$/, "/" + id + "/query");
    const geom = context
      ? same
        ? url.searchParams.get("geometry")
        : box
      : JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } });
    url.search = new URLSearchParams({
      geometry: geom,
      geometryType: context ? "esriGeometryEnvelope" : "esriGeometryPolygon",
      spatialRel: "esriSpatialRelIntersects",
      where: "1=1",
      inSR: "4326",
      outSR: "4326",
      returnGeometry: String(id === "1" || context),
      f: id === "1" || context ? "geojson" : "json",
      outFields:
        id === "roads"
          ? "OBJECTID,ROAD_NAME_T,ROAD_NAME_E,RC_RWIDTH"
          : id === "buildings"
            ? "BL_HEIGHT"
            : "*",
    });
    if (!["1", "2", "roads", "buildings"].includes(id))
      url.searchParams.set("returnCountOnly", "true");
    return { id, url: url.href };
  });
}
function containsSite(site, geometry) {
  const inside = (p, r) => {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i],
        b = r[j];
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
    return inside;
  };
  const polygons =
    geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polygons.some(
    (poly) =>
      site.every(
        (p) => inside(p, poly[0]) && !poly.slice(1).some((r) => inside(p, r)),
      ) &&
      poly.every(
        (r) =>
          !r
            .slice(0, -1)
            .some(
              (a, j) =>
                inside(a, site) ||
                site.some((b, i) => hit(a, r[j + 1], b, next(site, i))),
            ),
      ),
  );
}
export function roadCandidates(features, plot, local) {
  const ring = plot.polygon.slice(0, -1).map(local),
    edge = plot.frontageEdge - 1;
  const a = ring[edge],
    b = next(ring, edge),
    dx = b[0] - a[0],
    dy = b[1] - a[1];
  const edgeLength = Math.hypot(dx, dy),
    winding = Math.sign(area(ring));
  const samples = [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => [
    a[0] + dx * t,
    a[1] + dy * t,
  ]);
  return features
    .flatMap((feature, index) => {
      const segments = roadLines(feature.geometry).flatMap((line) => {
        const xy = line.map(local);
        return xy
          .slice(1)
          .map((q, i) => [xy[i], q])
          .filter(([p, q]) => p[0] !== q[0] || p[1] !== q[1]);
      });
      if (!segments.length) return [];
      let distances = 0,
        score = 0;
      for (const sample of samples) {
        let bestScore = Infinity,
          bestDistance = Infinity;
        for (const [p, q] of segments) {
          const sx = q[0] - p[0],
            sy = q[1] - p[1],
            length = Math.hypot(sx, sy);
          const t = Math.max(
            0,
            Math.min(
              1,
              ((sample[0] - p[0]) * sx + (sample[1] - p[1]) * sy) /
                (length * length),
            ),
          );
          const closest = [p[0] + t * sx, p[1] + t * sy];
          const distance = Math.hypot(
            sample[0] - closest[0],
            sample[1] - closest[1],
          );
          const alignment = Math.abs(
            (dx * sx + dy * sy) / (edgeLength * length),
          );
          const inside = (winding * cross(a, b, closest)) / edgeLength > 0.5;
          const cost = distance + 15 * (1 - alignment) + (inside ? 20 : 0);
          if (cost < bestScore) {
            bestScore = cost;
            bestDistance = distance;
          }
        }
        score += bestScore;
        distances += bestDistance;
      }
      const props = feature.properties;
      const width = Number(props.RC_RWIDTH);
      const name = props.ROAD_NAME_E || props.ROAD_NAME_T || "Unnamed road";
      return [
        {
          index,
          id: props.OBJECTID ?? feature.id ?? null,
          name,
          distanceM: fmt(distances / samples.length),
          matchScore: fmt(score / samples.length),
          widthM: width > 0 ? width : null,
        },
      ];
    })
    .sort((a, b) => a.matchScore - b.matchScore);
}
export function normalize(raw, source, plot) {
  const z = raw["1"].features,
    over = raw["2"].features,
    roads = raw.roads.features;
  if (
    !Array.isArray(z) ||
    !Array.isArray(over) ||
    !Array.isArray(roads) ||
    Object.values(raw).some(
      (r) => r.exceededTransferLimit || r.properties?.exceededTransferLimit,
    )
  )
    throw Error("Incomplete response. Review the city records and retry.");
  if (z.length !== 1 || !containsSite(plot.polygon.slice(0, -1), z[0].geometry))
    throw Error(
      "A single zone covering the full plot could not be established.",
    );
  const fields = z[0].properties,
    controls = over.map((f) => f.attributes.BD_SHORTNAME);
  const extra = ["4", "5", "7", "8", "10", "11", "12"].map((n) => raw[n].count);
  if (
    extra.some((n) => !Number.isInteger(n)) ||
    !Array.isArray(raw.buildings.features)
  )
    throw Error("A city layer is missing a required count.");
  return {
    source,
    zone: fields.LUP_ZONE,
    subzone: fields.LUP_SUBZON,
    far: fields.LUP_FAR,
    osrPercent: fields.LUP_OSR,
    overlays: controls,
    otherPlanningHits: extra.reduce((a, b) => a + b, 0),
    buildingCount: raw.buildings.features.length,
    roadRecords: roads.length,
    reportedWidths: roads.map((r) => r.properties.RC_RWIDTH),
    roadCandidates: [],
    roadIndex: 0,
    roadWidthAssumedM: null,
  };
}
