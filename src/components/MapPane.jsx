import { Fragment } from "react";
import atlas from "../data/atlas.json" with { type: "json" };
import { coordinatesFor } from "../domain/coordinates.js";
import { next, roadLines } from "../domain/geometry.js";
import { groundMaterials } from "../map/groundMaterials.js";

function StaticMap({ state, road, onPoint }) {
  const { local } = coordinatesFor(state.key);
  const points = state.points.map(local);
  const edge = points[state.brief.edge];
  const end = next(points, state.brief.edge);
  const paths = atlas[state.key].paths;
  const lines = roadLines(
    state.responses.roads?.features[road?.index]?.geometry,
  );
  const svgPoints = (ring) => ring.map((point) => point.join(",")).join(" ");

  return (
    <svg
      className={`site-editor ${state.drawing && !road ? "drawing" : ""}`}
      id="drawmap"
      viewBox="-130 -100 260 200"
      aria-label="Bangkok municipal street and building map. Numbered corners mark the selected plot."
      onClick={(event) => {
        const svg = event.currentTarget;
        const matrix = svg.getScreenCTM();
        if (!matrix) return;
        const point = new DOMPoint(
          event.clientX,
          event.clientY,
        ).matrixTransform(matrix.inverse());
        onPoint([point.x, point.y]);
      }}
    >
      <rect x="-130" y="-100" width="260" height="200" fill="#f5f2e9" />
      <path
        fill="#d8ddd4"
        stroke="#adb9ae"
        strokeWidth=".35"
        fillRule="evenodd"
        d={paths[0]}
      />
      <path fill="none" stroke="#d4ad72" strokeWidth="3" d={paths[1]} />
      {lines.map((line, index) => (
        <polyline
          key={index}
          points={svgPoints(line.map(local))}
          fill="none"
          stroke="#df6c14"
          strokeWidth="2.1"
        />
      ))}
      <polygon
        points={svgPoints(points)}
        fill="#69baa7"
        fillOpacity=".45"
        stroke="#225b52"
        strokeWidth="1.2"
      />
      {edge && end && (
        <line
          x1={edge[0]}
          y1={edge[1]}
          x2={end[0]}
          y2={end[1]}
          stroke="#a74a17"
          strokeWidth="2.8"
        />
      )}
      {points.map(([x, y], index) => (
        <Fragment key={index}>
          <circle cx={x} cy={y} r="1.8" fill="#10483c" />
          <text
            x={x + 2}
            y={y - 2}
            fontSize="6"
            fill="#102f29"
            stroke="white"
            strokeWidth="1"
            paintOrder="stroke"
          >
            {index + 1}
          </text>
        </Fragment>
      ))}
    </svg>
  );
}

function MapControls({
  state,
  in3D,
  fallback,
  layers,
  orbit,
  panelOpen,
  onPanel,
  onView,
  onOrbit,
  onReset,
  onLayer,
}) {
  const { site, rules, designs } = state;
  const candidate = designs?.options[state.selectedDesign];
  const controls = [
    ["nearby", "Neighbours", !site],
    ["asbuilt", "Existing buildings on plot", !site],
    ["shell3", "Envelope", !rules],
    ["mass3", "Proposed design", !candidate],
    ["measure3", "Measurements", false],
    ["ground3", "Ground plan", !candidate],
  ];
  return (
    <div className="map-controls">
      <div className="map-actions-bar" role="group" aria-label="Map controls">
        <button
          type="button"
          id="layer-controls"
          aria-expanded={panelOpen}
          aria-controls="layer-panel"
          hidden={!in3D}
          onClick={() => onPanel(!panelOpen)}
        >
          Layers
        </button>
        <button
          type="button"
          id="show-3d"
          aria-pressed={in3D}
          disabled={fallback}
          onClick={onView}
        >
          3D view
        </button>
        <button
          type="button"
          id="orbit3"
          aria-pressed={orbit}
          hidden={!in3D}
          onClick={onOrbit}
        >
          Rotate / tilt
        </button>
        <button type="button" id="reset3" disabled={fallback} onClick={onReset}>
          Reset view
        </button>
      </div>
      <section
        className="map-panel"
        id="layer-panel"
        aria-labelledby="layer-panel-title"
        hidden={!panelOpen}
      >
        <header className="map-panel-header">
          <h2 id="layer-panel-title">3D layers</h2>
          <button
            type="button"
            data-close-panel=""
            onClick={() => onPanel(false)}
          >
            Close
          </button>
        </header>
        <div className="scene-controls">
          {controls.map(([id, label, disabled]) => (
            <label key={id}>
              <input
                id={id}
                type="checkbox"
                checked={layers[id]}
                disabled={disabled}
                onChange={(event) => onLayer(id, event.target.checked)}
              />{" "}
              {label}
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

export function MapPane({ state, onPoint, ...controls }) {
  const { in3D, fallback, layers } = controls;
  const road = state.site?.roadCandidates[state.site.roadIndex];
  const drawing = state.drawing && !in3D;
  const caption = drawing
    ? "Tap or click to place the plot corners."
    : road
      ? "Matched road · " + road.name
      : "Orange marks the road-facing edge.";
  return (
    <div className="visual-pane">
      <MapControls state={state} {...controls} />
      <div
        id="scene-frame"
        tabIndex={fallback ? undefined : 0}
        role="group"
        data-drawing={drawing}
        data-static-map={fallback ? "" : undefined}
        aria-label={
          fallback
            ? "Bangkok plot map"
            : "Bangkok map. Drag to pan, scroll or pinch to zoom. In 3D, Shift-drag or right-drag to rotate and tilt. Use arrow keys to pan, Shift and arrow keys to rotate and tilt, plus and minus to zoom."
        }
      >
        {fallback ? (
          <StaticMap state={state} road={road} onPoint={onPoint} />
        ) : (
          <>
            <div id="map-points" aria-hidden="true" />
            <div id="scene-measurements" hidden>
              <div id="scene-dimensions" aria-hidden="true" />
            </div>
          </>
        )}
      </div>
      <div className="map-bottom">
        <div className="map-bottom-left">
          <ul
            id="ground-legend"
            aria-label="Ground plan legend"
            hidden={
              !in3D ||
              !layers.ground3 ||
              !state.designs?.options[state.selectedDesign]
            }
          >
            {Object.values(groundMaterials).map(({ color, label }) => (
              <li key={label}>
                <span
                  className="ground-swatch"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                {label}
              </li>
            ))}
          </ul>
          <div id="scene-metrics" hidden />
        </div>
        <div className="map-notice">
          <p id="map-caption">{caption}</p>
          <small id="basemap-source">
            <a href="https://cpudgiapp.bangkok.go.th/arcgis/rest/services/GI_Platform/BMAGI_Basemap_2564/MapServer">
              Bangkok Metropolitan Administration
            </a>
            <span id="basemap-status">
              {fallback ? " · Bundled map · interactive map unavailable" : ""}
            </span>
          </small>
        </div>
      </div>
    </div>
  );
}
