import assert from "node:assert/strict";
import test from "node:test";
import { createStudy } from "../src/study/createStudy.js";

function mockCityResponses(points) {
  const lng = points.map(([x]) => x);
  const lat = points.map(([, y]) => y);
  const west = Math.min(...lng) - 0.001;
  const east = Math.max(...lng) + 0.001;
  const south = Math.min(...lat) - 0.001;
  const north = Math.max(...lat) + 0.001;
  const bounds = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  const roads = [south + 0.0008, south + 0.0006].map((y, index) => ({
    geometry: {
      type: "LineString",
      coordinates: [
        [west, y],
        [east, y],
      ],
    },
    properties: {
      OBJECTID: index + 1,
      ROAD_NAME_E: `Test Road ${index + 1}`,
      RC_RWIDTH: 0,
    },
  }));
  const counts = Object.fromEntries(
    [4, 5, 7, 8, 10, 11, 12].map((layer) => [layer, { count: 0 }]),
  );
  return {
    ...counts,
    1: {
      features: [
        {
          geometry: { type: "Polygon", coordinates: [bounds] },
          properties: {
            LUP_ZONE: "พ.๕",
            LUP_SUBZON: "พ.๕-๒",
            LUP_FAR: 10,
            LUP_OSR: 3,
          },
        },
      ],
    },
    2: { features: [] },
    3: { features: [{ geometry: null, properties: {} }] },
    9: { features: roads },
  };
}

function layerFrom(url) {
  return new URL(url).pathname.split("/").at(-2);
}

test("loads synthetic city data, ranks designs, and recomputes for a road override", async (context) => {
  const study = createStudy();
  const responses = mockCityResponses(study.getSnapshot().points);
  const fetch = context.mock.method(globalThis, "fetch", async (url) => {
    const body = responses[layerFrom(url)];
    return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
  });
  context.after(study.stop);
  await study.execute();

  const loaded = study.getSnapshot();
  assert.equal(fetch.mock.callCount(), 11);
  assert.equal(loaded.status, "");
  assert.equal(loaded.view, "3d");
  assert.equal(loaded.site.subzone, "พ.๕-๒");
  assert.equal(loaded.rules.roadWidthM, 24);
  assert.equal(loaded.rules.frontSetbackM, 2);
  assert.ok(loaded.designs.options.length > 1);
  assert.ok(loaded.designs.options.every((design) => design.checks.length > 0));

  const choice = loaded.designs.options.at(-1);
  study.selectDesign(loaded.designs.options.length - 1);
  const alternative = loaded.site.roadCandidates[1];
  study.overrideRoad(alternative.id);
  const revised = study.getSnapshot();
  assert.equal(
    revised.site.roadCandidates[revised.site.roadIndex].id,
    alternative.id,
  );
  assert.equal(
    revised.designs.options[revised.selectedDesign].name,
    choice.name,
  );
});

test("drawing a plot cancels a pending request and ignores its stale results", async (context) => {
  const study = createStudy();
  const responses = mockCityResponses(study.getSnapshot().points);
  const pending = [];
  context.mock.method(
    globalThis,
    "fetch",
    (url, { signal }) =>
      new Promise((resolve) => {
        pending.push({ layer: layerFrom(url), signal, resolve });
      }),
  );
  context.after(study.stop);
  const run = study.execute();
  study.draw();

  assert.equal(pending.length, 11);
  assert.ok(pending.every(({ signal }) => signal.aborted));
  for (const { layer, resolve } of pending) {
    resolve(new Response(JSON.stringify(responses[layer])));
  }
  await run;

  const state = study.getSnapshot();
  assert.equal(state.view, "map");
  assert.equal(state.drawing, true);
  assert.equal(state.site, null);
  assert.equal(state.loading, false);
  assert.deepEqual(state.points, []);
  assert.equal(state.plotIssue, "Place at least three corners on the map.");
});
