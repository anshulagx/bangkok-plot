import * as THREE from "three";
import polygonClipping from "polygon-clipping";
import atlas from "../data/atlas.json" with { type: "json" };
import sites from "../data/sites.json" with { type: "json" };
import { coordinatesFor } from "../domain/coordinates.js";
import {
  area,
  cross,
  next,
  roadLines,
  setbackFootprint,
} from "../domain/geometry.js";
import { fmt } from "../domain/format.js";
import { logger } from "../logger.js";
import { groundMaterials } from "./groundMaterials.js";

function svgElement(name, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [attribute, value] of Object.entries(attributes))
    element.setAttribute(attribute, value);
  return element;
}

// Construct the model in the same east/south metre coordinates used by the checks.
// Three.js uses Y for elevation, so a local ground point [x,y] becomes [x,height,y].
export function createSiteViewer(root, { onPoint, isPanelOpen }) {
  const el = (id) => root.querySelector("#" + id);
  const events = new AbortController();
  const listenerOptions = { signal: events.signal };
  let state,
    view,
    key,
    brief,
    points,
    drawing,
    selectedDesign,
    responses,
    local,
    geographic;
  let lastCameraReset;
  const selectedRoad = () => state.site?.roadCandidates[state.site.roadIndex];
  const isPlotDrawing = () => drawing && view === "map";

  const frame = el("scene-frame");
  const scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera();
  const groups = {};
  for (const name of [
    "ground",
    "basemap",
    "roads",
    "nearby",
    "asbuilt",
    "plot",
    "ground3",
    "shell3",
    "mass3",
  ]) {
    groups[name] = new THREE.Group();
    scene.add(groups[name]);
  }
  scene.background = new THREE.Color("#f5f2e9");
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc4c6ae, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-160, 260, -90);
  scene.add(sun);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    frame.prepend(renderer.domElement);
  } catch (error) {
    logger.warn("WebGL unavailable, using the bundled plot map", {
      message: error.message,
    });
    return null;
  }
  let azimuth = -0.6,
    elevation = 0.64,
    zoom = 1,
    target = [0, 0],
    radius = 100,
    previousRoad,
    previousKey,
    previousSite,
    previousPlot,
    previousRules,
    previousDesign,
    activeIndex = -1;
  let envelopeSummary = "",
    envelopeHeight = "",
    contextSummary = "",
    dimensions = [],
    mapPoints = [];
  const groundRay = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0));
  const textureLoader = new THREE.TextureLoader();
  const bundledMaps = new Map();
  let mapImage, pendingMap, mapTimer, failedMap;
  function initialCamera() {
    const ring = points.map(local);
    if (!ring.length) return { target: [0, 0], radius: 95 };
    const target = ring.reduce(
      (v, p) => [v[0] + p[0] / ring.length, v[1] + p[1] / ring.length],
      [0, 0],
    );
    const aspect = frame.clientWidth / (frame.clientHeight || 1) || 1;
    const radius = Math.max(
      65,
      Math.max(
        ...ring.map((p) =>
          Math.max(
            Math.abs(p[0] - target[0]) / aspect,
            Math.abs(p[1] - target[1]),
          ),
        ),
      ) * 1.85,
    );
    return { target, radius };
  }
  function groundPoint(clientX, clientY) {
    const bounds = frame.getBoundingClientRect();
    return groundAtPixel(
      clientX - bounds.left - frame.clientLeft,
      clientY - bounds.top - frame.clientTop,
    );
  }
  function groundAtPixel(x, y) {
    if (!frame.clientWidth || !frame.clientHeight) return null;
    groundRay.setFromCamera(
      new THREE.Vector2(
        (2 * x) / frame.clientWidth - 1,
        1 - (2 * y) / frame.clientHeight,
      ),
      camera,
    );
    const point = groundRay.ray.intersectPlane(
      groundPlane,
      new THREE.Vector3(),
    );
    return point ? [point.x, point.z] : null;
  }
  function mapPlane(texture, [west, south, east, north], height, opacity = 1) {
    const [left, top] = local([west, north]),
      [right, bottom] = local([east, south]);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(right - left, bottom - top),
      new THREE.MeshBasicMaterial({
        map: texture,
        opacity,
        transparent: opacity < 1,
        depthWrite: opacity === 1,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((left + right) / 2, height, (top + bottom) / 2);
    return mesh;
  }
  function loadBundledMaps() {
    for (const [id, { center, scale, paths }] of Object.entries(atlas)) {
      if (bundledMaps.has(id)) continue;
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="800" viewBox="-130 -100 260 200"><rect x="-130" y="-100" width="260" height="200" fill="#f5f2e9"/><path fill="#d8ddd4" stroke="#adb9ae" stroke-width=".35" fill-rule="evenodd" d="' +
        paths[0] +
        '"/><path fill="none" stroke="#d4ad72" stroke-width="3" d="' +
        paths[1] +
        '"/></svg>';
      const [lng, lat] = center,
        [east, south] = [130 / scale[0], 100 / scale[1]];
      const bounds = [lng - east, lat - south, lng + east, lat + south];
      bundledMaps.set(id, { bounds, texture: null });
      textureLoader.load(
        "data:image/svg+xml," + encodeURIComponent(svg),
        (texture) => {
          if (events.signal.aborted) {
            texture.dispose();
            return;
          }
          bundledMaps.set(id, { bounds, texture });
          groups.ground.add(mapPlane(texture, bounds, -0.09));
          paint();
        },
      );
    }
  }
  function placeBasemap() {
    clear(groups.ground);
    clear(groups.basemap);
    for (const { bounds, texture } of bundledMaps.values())
      if (texture) groups.ground.add(mapPlane(texture, bounds, -0.09));
    if (mapImage)
      groups.basemap.add(
        mapPlane(mapImage.texture, mapImage.bounds, -0.07, 0.46),
      );
  }
  function fetchBasemap(w, h) {
    const corners = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ].map((p) => groundAtPixel(...p));
    if (corners.some((point) => !point)) return;
    const eastings = corners.map((point) => point[0]),
      southings = corners.map((point) => point[1]);
    const [west, north] = geographic([
      Math.min(...eastings),
      Math.min(...southings),
    ]);
    const [east, south] = geographic([
      Math.max(...eastings),
      Math.max(...southings),
    ]);
    const density = Math.min(w / (east - west), h / (north - south));
    const usable = (entry) => {
      if (
        !entry ||
        density > entry.density * 1.8 ||
        density < entry.density / 1.8
      )
        return false;
      const [a, b, c, d] = entry.bounds;
      return west >= a && south >= b && east <= c && north <= d;
    };
    clearTimeout(mapTimer);
    if (usable(mapImage) || usable(pendingMap) || usable(failedMap)) return;
    mapTimer = setTimeout(() => {
      const width = (east - west) * 1.45,
        height = (north - south) * 1.45;
      const pixelScale = Math.min(density, 1440 / Math.max(width, height));
      const xPixels = Math.max(1, Math.ceil(width * pixelScale)),
        yPixels = Math.max(1, Math.ceil(height * pixelScale));
      const lng = (west + east) / 2,
        lat = (south + north) / 2;
      // Match the export's geographic and pixel aspect ratios so ArcGIS preserves this extent.
      const bounds = [
        lng - xPixels / (2 * pixelScale),
        lat - yPixels / (2 * pixelScale),
        lng + xPixels / (2 * pixelScale),
        lat + yPixels / (2 * pixelScale),
      ];
      const url = new URL(sites[key].roadQuery);
      url.pathname = url.pathname.replace(/\/\d+\/query$/, "/export");
      url.search = new URLSearchParams({
        f: "image",
        bbox: bounds.join(","),
        bboxSR: "4326",
        imageSR: "4326",
        size: xPixels + "," + yPixels,
        format: "png32",
        transparent: "false",
        layers: "show:0,1,2,3,5,8,9,10,11,12,13,14,15,17",
      });
      const request = { bounds, density };
      pendingMap = request;
      textureLoader.load(
        url.href,
        (texture) => {
          if (events.signal.aborted || pendingMap !== request) {
            texture.dispose();
            return;
          }
          pendingMap = null;
          failedMap = null;
          if (mapImage) mapImage.texture.dispose();
          mapImage = { ...request, texture };
          placeBasemap();
          el("basemap-status").textContent = "";
          paint();
        },
        undefined,
        () => {
          if (events.signal.aborted || pendingMap !== request) return;
          pendingMap = null;
          failedMap = request;
          logger.warn("Live basemap could not be loaded", { site: key });
          el("basemap-status").textContent = " · Live map unavailable here";
        },
      );
    }, 300);
  }
  function paint() {
    const w = frame.clientWidth,
      h = frame.clientHeight;
    if (!w || !h) return;
    if (!state || events.signal.aborted) return;
    if (
      renderer.domElement.clientWidth !== w ||
      renderer.domElement.clientHeight !== h
    )
      renderer.setSize(w, h);
    const half = radius / zoom;
    camera.left = (-half * w) / h;
    camera.right = -camera.left;
    camera.top = half;
    camera.bottom = -half;
    const flat = view === "map",
      distance = Math.max(900, half * 18);
    const horizontal = flat ? 0 : distance * Math.cos(elevation);
    camera.up.set(0, flat ? 0 : 1, flat ? -1 : 0);
    camera.position.set(
      target[0] + horizontal * Math.sin(azimuth),
      flat ? distance : distance * Math.sin(elevation),
      target[1] + horizontal * Math.cos(azimuth),
    );
    camera.lookAt(target[0], 0, target[1]);
    camera.near = 1;
    camera.far = distance * 2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    fetchBasemap(w, h);
    el("map-points").replaceChildren(
      ...mapPoints.map(([x, y], index) => {
        const point = new THREE.Vector3(x, 0.25, y).project(camera);
        const left = ((point.x + 1) * w) / 2,
          top = ((1 - point.y) * h) / 2;
        const marker = document.createElement("span");
        marker.className = "map-point";
        marker.style.left = left + "px";
        marker.style.top = top + "px";
        marker.textContent = index + 1;
        return marker;
      }),
    );
    paintMeasurements(w, h);
  }
  function paintMeasurements(w, h) {
    const overlay = el("scene-measurements");
    const visible =
      view === "3d" && state.layers.measure3 && dimensions.length > 0;
    overlay.hidden = !visible;
    el("scene-metrics").hidden = !visible;
    if (!visible) return;
    const project = ([x, y, z]) => {
      const point = new THREE.Vector3(x, y, z).project(camera);
      return [((point.x + 1) * w) / 2, ((1 - point.y) * h) / 2];
    };
    const occupied = [];
    const labels = [];
    const svg = svgElement("svg", { viewBox: "0 0 " + w + " " + h });
    const lines = svgElement("g", {
      stroke: "#3b685a",
      "stroke-width": "1.3",
      fill: "#fffef8",
    });
    svg.append(lines);
    for (const { from, to, label } of dimensions) {
      const [x1, y1] = project(from),
        [x2, y2] = project(to);
      const x = (x1 + x2) / 2,
        y = (y1 + y2) / 2;
      if (x < 0 || x > w || y < 0 || y > h - 34) continue;
      const width = label.length * 6.5 + 16;
      const left = Math.max(6, Math.min(w - width - 6, x - width / 2));
      const top = [y - 30, y + 12, y - 55].find(
        (t) =>
          t >= 5 &&
          t + 22 < h - 42 &&
          occupied.every(
            (box) =>
              left >= box.right + 4 ||
              left + width <= box.left - 4 ||
              t >= box.top + 26 ||
              t + 26 <= box.top,
          ),
      );
      if (top === undefined) continue;
      occupied.push({ left, right: left + width, top });
      lines.append(
        svgElement("path", {
          d:
            "M " +
            x1 +
            " " +
            y1 +
            " L " +
            x2 +
            " " +
            y2 +
            " M " +
            x +
            " " +
            y +
            " L " +
            (left + width / 2) +
            " " +
            (top + 11),
        }),
        svgElement("circle", { cx: x1, cy: y1, r: 2 }),
        svgElement("circle", { cx: x2, cy: y2, r: 2 }),
      );
      const tag = document.createElement("span");
      tag.className = "scene-dimension";
      tag.style.left = left + "px";
      tag.style.top = top + "px";
      tag.textContent = label;
      labels.push(tag);
    }
    el("scene-dimensions").replaceChildren(svg, ...labels);
  }
  function updateMeasurements(ring, rules, candidate) {
    dimensions = [];
    const metrics = el("scene-metrics");
    metrics.replaceChildren();
    if (!rules) return;
    const a = ring[brief.edge],
      b = next(ring, brief.edge);
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy);
    const side = Math.sign(area(ring)),
      outward = [(side * dy) / length, (-side * dx) / length];
    const roadPoint = [a[0] + dx * 0.72, a[1] + dy * 0.72];
    dimensions.push({
      from: [roadPoint[0], 0.3, roadPoint[1]],
      to: [
        roadPoint[0] + outward[0] * rules.roadWidthM,
        0.3,
        roadPoint[1] + outward[1] * rules.roadWidthM,
      ],
      label: fmt(rules.roadWidthM) + " m study road",
    });
    if (groups.shell3.visible && envelopeHeight) {
      const tag = document.createElement("span");
      tag.textContent = envelopeHeight + " height plane";
      metrics.append(tag);
    }
    if (!candidate || !groups.mass3.visible) return;
    const [x, y] = candidate.bands.at(-1).outline[0],
      height = candidate.heightM;
    dimensions.unshift({
      from: [x, 0.3, y],
      to: [x, height, y],
      label: fmt(height) + " m building",
    });
  }
  const observer = new ResizeObserver(paint);
  observer.observe(frame);
  function reset() {
    ({ target, radius } = initialCamera());
    azimuth = -0.6;
    elevation = 0.64;
    zoom = 1;
    paint();
  }

  const pointers = new Map();
  let plotTap = null;
  function frameCenter() {
    const { left, top, width, height } = frame.getBoundingClientRect();
    return [left + width / 2, top + height / 2];
  }
  function navigate(from, to, factor = 1) {
    const nextZoom = Math.max(
      radius / 40000,
      Math.min(radius / 8, zoom * factor),
    );
    const anchor = groundPoint(...from),
      destination = groundPoint(...to);
    const center = groundPoint(...frameCenter());
    if (anchor && destination && center) {
      // Scale around the camera's ground center, keeping the same map point under the pointer.
      const scale = zoom / nextZoom;
      target = target.map(
        (coordinate, i) =>
          coordinate +
          anchor[i] -
          center[i] -
          (destination[i] - center[i]) * scale,
      );
    }
    zoom = nextZoom;
    paint();
  }
  function orbit(dx, dy) {
    azimuth += dx;
    elevation = Math.max(0.28, Math.min(1.51, elevation + dy));
    paint();
  }
  function pinch() {
    const [a, b] = pointers.values();
    return (
      b && {
        center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        distance: Math.hypot(a[0] - b[0], a[1] - b[1]),
      }
    );
  }
  frame.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 && (e.button !== 2 || view !== "3d")) return;
      frame.focus({ preventScroll: true });
      frame.setPointerCapture(e.pointerId);
      const point = [e.clientX, e.clientY];
      pointers.set(e.pointerId, point);
      plotTap =
        pointers.size === 1 &&
        e.button === 0 &&
        !e.shiftKey &&
        isPlotDrawing() &&
        !isPanelOpen()
          ? { id: e.pointerId, start: point }
          : null;
    },
    listenerOptions,
  );
  frame.addEventListener(
    "pointermove",
    (e) => {
      const previous = pointers.get(e.pointerId);
      if (!previous) return;
      const before = pinch(),
        point = [e.clientX, e.clientY];
      if (plotTap) {
        if (
          Math.hypot(
            point[0] - plotTap.start[0],
            point[1] - plotTap.start[1],
          ) <= 4
        )
          return;
        plotTap = null;
      }
      pointers.set(e.pointerId, point);
      if (before) {
        const after = pinch();
        const factor =
          before.distance > 0 && after.distance > 0
            ? after.distance / before.distance
            : 1;
        navigate(before.center, after.center, factor);
      } else if (
        view === "3d" &&
        (state.orbit || e.shiftKey || e.buttons & 2)
      ) {
        orbit(
          (previous[0] - point[0]) * 0.008,
          (point[1] - previous[1]) * 0.006,
        );
      } else navigate(previous, point);
    },
    listenerOptions,
  );
  frame.addEventListener(
    "pointerup",
    (e) => {
      if (plotTap?.id === e.pointerId && isPlotDrawing()) {
        const distance = Math.hypot(
          e.clientX - plotTap.start[0],
          e.clientY - plotTap.start[1],
        );
        const point = distance <= 4 ? groundPoint(e.clientX, e.clientY) : null;
        if (point) onPoint(point);
      }
      finishPointer(e);
    },
    listenerOptions,
  );
  function finishPointer(e) {
    pointers.delete(e.pointerId);
    if (plotTap?.id === e.pointerId) plotTap = null;
  }
  frame.addEventListener("pointercancel", finishPointer, listenerOptions);
  frame.addEventListener("lostpointercapture", finishPointer, listenerOptions);
  frame.addEventListener(
    "contextmenu",
    (e) => {
      if (view === "3d") e.preventDefault();
    },
    listenerOptions,
  );
  frame.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const point = [e.clientX, e.clientY];
      const units =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? frame.clientHeight : 1;
      navigate(point, point, Math.exp(-e.deltaY * units * 0.0015));
    },
    { ...listenerOptions, passive: false },
  );
  frame.addEventListener(
    "keydown",
    (e) => {
      const arrow = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[e.key];
      const [x, y] = frameCenter();
      if (arrow) {
        e.preventDefault();
        const [dx, dy] = arrow;
        if (e.shiftKey && view === "3d") orbit(dx * 0.12, -dy * 0.1);
        else navigate([x, y], [x - dx * 50, y - dy * 50]);
      } else if (["+", "=", "-"].includes(e.key)) {
        e.preventDefault();
        navigate([x, y], [x, y], e.key === "-" ? 1 / 1.15 : 1.15);
      }
    },
    listenerOptions,
  );
  function clear(group) {
    for (const object of [...group.children]) {
      object.geometry.dispose();
      object.material.dispose();
      group.remove(object);
    }
  }
  function line(group, ring, height, color, close = true) {
    const list = close ? [...ring, ring[0]] : ring;
    const pts = list.map(
      (p) =>
        new THREE.Vector3(
          p[0],
          typeof height === "function" ? height(p) : height,
          p[1],
        ),
    );
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color }),
      ),
    );
  }
  function roadHighlight(
    group,
    centerline,
    { halfWidth = 1.65, height = 0.11, color = "#ad7943" } = {},
  ) {
    const coords = [];
    const triangle = (...points) => {
      for (const [x, y] of points) coords.push(x, height, y);
    };
    let previousEnd;
    for (let i = 1; i < centerline.length; i++) {
      const a = centerline[i - 1],
        b = centerline[i];
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      if (!length) continue;
      const x = (-dy * halfWidth) / length,
        y = (dx * halfWidth) / length;
      const start = [
        [a[0] + x, a[1] + y],
        [a[0] - x, a[1] - y],
      ];
      const end = [
        [b[0] + x, b[1] + y],
        [b[0] - x, b[1] - y],
      ];
      triangle(start[0], start[1], end[0]);
      triangle(start[1], end[1], end[0]);
      if (previousEnd) {
        // Fill the join where two centreline segments meet.
        triangle(a, previousEnd[0], start[0]);
        triangle(a, previousEnd[1], start[1]);
      }
      previousEnd = end;
    }
    if (!coords.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(coords, 3),
    );
    group.add(
      new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
      ),
    );
  }
  function solid(group, polygon, top, color, opacity = 1, bottom = 0) {
    const rings = polygon.map((r) =>
      r.length > 1 &&
      r[0][0] === r[r.length - 1][0] &&
      r[0][1] === r[r.length - 1][1]
        ? r.slice(0, -1)
        : r,
    );
    const vectors = rings.map((r) =>
      r.map(([x, y]) => new THREE.Vector2(x, y)),
    );
    const vertices = rings.flat(),
      triangles = THREE.ShapeUtils.triangulateShape(
        vectors[0],
        vectors.slice(1),
      ),
      coords = [];
    const upper = (p) => (typeof top === "function" ? top(p) : top);
    function vert(p, z) {
      coords.push(p[0], z, p[1]);
    }
    for (const tri of triangles)
      for (const j of tri.slice().reverse())
        vert(vertices[j], upper(vertices[j]));
    for (const r of rings)
      for (let i = 0; i < r.length; i++) {
        const a = r[i],
          b = next(r, i);
        vert(a, bottom);
        vert(b, bottom);
        vert(b, upper(b));
        vert(a, bottom);
        vert(b, upper(b));
        vert(a, upper(a));
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
    g.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity === 1,
    });
    group.add(new THREE.Mesh(g, material));
  }
  function context(data, ring) {
    for (const k of ["roads", "nearby", "asbuilt"]) clear(groups[k]);
    let flat = 0,
      overlapping = 0;
    for (const f of data.buildings.features) {
      const g = f.geometry;
      if (!g) continue;
      for (const poly of g.type === "Polygon"
        ? [g.coordinates]
        : g.type === "MultiPolygon"
          ? g.coordinates
          : []) {
        const footprint = poly.map((r) => r.map(local));
        const onPlot =
          ring.length >= 3 &&
          polygonClipping.intersection(footprint, [ring]).length > 0;
        const group = groups[onPlot ? "asbuilt" : "nearby"];
        if (onPlot) overlapping++;
        const h = Number(f.properties.BL_HEIGHT);
        if (h > 0) {
          solid(
            group,
            footprint,
            h,
            onPlot ? "#bea78b" : "#9aa99c",
            onPlot ? 0.3 : 0.23,
          );
          line(group, footprint[0], h + 0.04, "#bac4ba");
        } else {
          line(group, footprint[0], 0.07, "#89958d");
          flat++;
        }
      }
    }
    const selectedIndex = selectedRoad()?.index;
    for (const [idx, f] of data.roads.features.entries()) {
      const g = f.geometry;
      if (!g) continue;
      for (const r of roadLines(g)) {
        const centerline = r.map(local);
        if (idx === selectedIndex) roadHighlight(groups.roads, centerline);
        else line(groups.roads, centerline, 0.1, "#9a7959", false);
      }
    }
    contextSummary =
      data.buildings.features.length +
      " city building records · " +
      flat +
      " footprints without height · " +
      overlapping +
      " intersecting building parts in the existing-on-plot layer. Roads follow mapped centrelines.";
  }
  function envelope(ring, edge, r) {
    const pieces = setbackFootprint(ring, edge, r);
    const a = ring[edge],
      b = next(ring, edge),
      len = Math.hypot(b[0] - a[0], b[1] - a[1]),
      direction = Math.sign(area(ring));
    const roof = (p) => 2 * (r.roadWidthM + (direction * cross(a, b, p)) / len);
    for (const poly of pieces) {
      solid(groups.shell3, poly, roof, "#6ab9cf", 0.105);
      for (const boundary of poly) {
        line(groups.shell3, boundary, 0.2, "#237c95");
        line(groups.shell3, boundary, roof, "#237c95");
      }
    }
    const heights = pieces.flat(2).map(roof);
    envelopeHeight = heights.length
      ? fmt(Math.min(...heights)) + "–" + fmt(Math.max(...heights)) + " m"
      : "";
    envelopeSummary = heights.length
      ? "Road-based height plane " +
        envelopeHeight +
        ". Base setbacks are " +
        r.frontSetbackM +
        " m at the road and " +
        r.otherSetbackM +
        " m elsewhere."
      : "The base setbacks leave no buildable footprint.";
  }
  function update(nextState) {
    state = nextState;
    ({ view, key, brief, points, drawing, selectedDesign, responses } = state);
    ({ local, geographic } = coordinatesFor(key));
    const { input: captured, site, rules, designs } = state;
    const choices = designs?.options || [];
    const ring = (captured ? captured.polygon.slice(0, -1) : points).map(local);
    const plotStamp = JSON.stringify([ring, brief.edge]);
    const changed =
      previousRoad !== selectedRoad()?.index ||
      key !== previousKey ||
      plotStamp !== previousPlot ||
      responses !== previousSite;
    if (key !== previousKey) {
      loadBundledMaps();
      placeBasemap();
    }
    if (changed) {
      if (site) context(responses, ring);
      else {
        for (const k of ["roads", "nearby", "asbuilt"]) clear(groups[k]);
        contextSummary = "";
      }
      clear(groups.plot);
      if (ring.length) {
        if (ring.length >= 3)
          solid(groups.plot, [ring], 0.12, "#add1bb", drawing ? 0.55 : 1);
        line(groups.plot, ring, 0.24, "#165d4b", !!captured || !drawing);
        const edge = brief.edge;
        if (edge >= 0 && edge < ring.length)
          roadHighlight(groups.plot, [ring[edge], next(ring, edge)], {
            halfWidth: 0.95,
            height: 0.32,
            color: "#c65324",
          });
      }
      mapPoints = ring;
    }
    if (changed || rules !== previousRules) {
      clear(groups.shell3);
      envelopeSummary = "";
      envelopeHeight = "";
      if (rules) envelope(ring, brief.edge, rules);
    }
    const index = selectedDesign;
    if (changed || designs !== previousDesign || index !== activeIndex) {
      clear(groups.mass3);
      clear(groups.ground3);
      const c = choices[index];
      if (c) {
        for (const polygon of c.ground.planting)
          solid(groups.ground3, polygon, 0.17, groundMaterials.planting.color);
        for (const polygon of c.ground.paving)
          solid(groups.ground3, polygon, 0.21, groundMaterials.paving.color);
        for (const polygon of c.ground.bays) {
          solid(groups.ground3, polygon, 0.21, groundMaterials.parking.color);
          line(groups.ground3, polygon[0], 0.23, "#fffef1");
        }
        for (const [i, band] of c.bands.entries()) {
          const { outline, count, bottomM, topM } = band;
          solid(
            groups.mass3,
            [outline],
            topM,
            i ? "#3b8b75" : "#287864",
            1,
            bottomM,
          );
          const step = Math.max(1, Math.ceil(count / 100));
          const floorHeight = (topM - bottomM) / count;
          for (let floor = step; floor < count; floor += step)
            line(
              groups.mass3,
              outline,
              bottomM + floor * floorHeight + 0.015,
              "#b5e3cc",
            );
          line(groups.mass3, outline, topM + 0.015, "#b5e3cc");
        }
      }
    }
    previousRoad = selectedRoad()?.index;
    previousKey = key;
    previousPlot = plotStamp;
    previousSite = responses;
    previousRules = rules;
    previousDesign = designs;
    activeIndex = index;
    for (const k of ["nearby", "asbuilt", "shell3", "mass3", "ground3"])
      groups[k].visible = view === "3d" && state.layers[k];
    const candidate = choices[index];
    el("scene-stage").textContent =
      sites[key].title +
      " · " +
      (candidate
        ? candidate.name +
          " · " +
          candidate.floors +
          (candidate.floors === 1 ? " floor" : " floors") +
          " · " +
          fmt(candidate.heightM) +
          " m"
        : rules
          ? "Resolved envelope"
          : site
            ? "Live neighbourhood"
            : captured
              ? "Captured plot"
              : "Plot outline");
    const roadWidthNote =
      rules?.roadWidthSource === "Fallback study width"
        ? " Width is assumed from Brief."
        : " Width comes from the city road record.";
    el("scene-readout").textContent =
      (envelopeSummary ||
        "Load site data and enter a valid brief to see the envelope.") +
      (rules
        ? " The model uses a " + rules.roadWidthM + " m road." + roadWidthNote
        : "");
    el("scene-source").textContent = site
      ? site.source + " · " + contextSummary
      : "Neighbouring buildings and roads appear after the city query.";
    updateMeasurements(ring, rules, candidate);
    if (lastCameraReset !== state.cameraReset) {
      lastCameraReset = state.cameraReset;
      reset();
    } else paint();
  }
  return {
    update,
    reset,
    dispose() {
      events.abort();
      observer.disconnect();
      clearTimeout(mapTimer);
      for (const group of Object.values(groups)) clear(group);
      for (const { texture } of bundledMaps.values()) texture?.dispose();
      mapImage?.texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
