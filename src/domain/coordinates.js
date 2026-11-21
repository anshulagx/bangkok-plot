import atlas from "../data/atlas.json" with { type: "json" };

export function coordinatesFor(siteId) {
  const { center, scale } = atlas[siteId];
  return {
    local: ([lng, lat]) => [
      (lng - center[0]) * scale[0],
      (center[1] - lat) * scale[1],
    ],
    geographic: ([x, y]) => [
      center[0] + x / scale[0],
      center[1] - y / scale[1],
    ],
  };
}
