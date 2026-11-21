import polygonClipping from "polygon-clipping";

export const next = (p, i) => p[(i + 1) % p.length];
export const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export const area = (p) =>
  p.reduce((s, a, i) => s + cross([0, 0], a, next(p, i)), 0) / 2;
export function hit(a, b, c, d) {
  const orient = (p, q, r) =>
    Math.sign(Math.abs(cross(p, q, r)) < 1e-13 ? 0 : cross(p, q, r));
  const on = (p, q, r) =>
    r.every((v, i) => v >= Math.min(p[i], q[i]) && v <= Math.max(p[i], q[i]));
  const [u, v, w, z] = [
    orient(a, b, c),
    orient(a, b, d),
    orient(c, d, a),
    orient(c, d, b),
  ];
  return (
    (u * v < 0 && w * z < 0) ||
    (!u && on(a, b, c)) ||
    (!v && on(a, b, d)) ||
    (!w && on(c, d, a)) ||
    (!z && on(c, d, b))
  );
}
export function roadLines(geometry) {
  if (geometry?.type === "LineString") return [geometry.coordinates];
  if (geometry?.type === "MultiLineString") return geometry.coordinates;
  return [];
}
function pointDistance(p, a, b) {
  const x = b[0] - a[0],
    y = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / (x * x + y * y)),
    );
  return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * y);
}
export function inspect(shape, ring, edge) {
  let front = Infinity,
    other = Infinity,
    inside = false;
  const p = shape[0],
    a = ring[edge],
    b = next(ring, edge);
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i],
      d = next(ring, i);
    if (
      c[1] > p[1] !== d[1] > p[1] &&
      p[0] < ((d[0] - c[0]) * (p[1] - c[1])) / (d[1] - c[1]) + c[0]
    )
      inside = !inside;
    for (let j = 0; j < shape.length; j++) {
      const u = shape[j],
        v = next(shape, j);
      if (hit(c, d, u, v)) return null;
      const gap = Math.min(
        pointDistance(c, u, v),
        pointDistance(d, u, v),
        pointDistance(u, c, d),
        pointDistance(v, c, d),
      );
      if (i === edge) front = Math.min(front, gap);
      else other = Math.min(other, gap);
    }
  }
  if (!inside) return null;
  const fromRoad = Math.min(
    ...shape.map(
      (p) =>
        (Math.sign(area(ring)) * cross(a, b, p)) /
        Math.hypot(b[0] - a[0], b[1] - a[1]),
    ),
  );
  return { front, other, fromRoad };
}
export function setbackFootprint(ring, edge, r, extraInset = 0) {
  const masks = ring.map((a, i) => {
    const b = next(ring, i),
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]),
      d =
        ((i === edge ? r.frontSetbackM : r.otherSetbackM) + extraInset) /
        Math.cos(Math.PI / 48);
    const arc = (p, start) =>
      Array.from({ length: 25 }, (_, j) => {
        const t = start + (j * Math.PI) / 24;
        return [p[0] + d * Math.cos(t), p[1] + d * Math.sin(t)];
      });
    return [[...arc(a, angle + Math.PI / 2), ...arc(b, angle - Math.PI / 2)]];
  });
  const a = ring[edge],
    b = next(ring, edge),
    len = Math.hypot(b[0] - a[0], b[1] - a[1]),
    direction = Math.sign(area(ring));
  const dx = (b[0] - a[0]) / len,
    dy = (b[1] - a[1]) / len;
  const planePoint = (u, v) => [
    a[0] + u * dx - v * dy * direction,
    a[1] + u * dy + v * dx * direction,
  ];
  const span =
    1 + 2 * Math.max(...ring.map((p) => Math.hypot(p[0] - a[0], p[1] - a[1])));
  // Keep the clipping line just inside the frontage to avoid near-coincident edges.
  // This strip is already removed by the frontage setback.
  const clipInset = Math.min(r.frontSetbackM, 0.001);
  const inside = polygonClipping.intersection(
    [ring],
    [
      [
        planePoint(-span, clipInset),
        planePoint(span, clipInset),
        planePoint(span, span),
        planePoint(-span, span),
      ],
    ],
  );
  return polygonClipping.difference(inside, ...masks);
}
