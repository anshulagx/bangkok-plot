import { coordinatesFor } from "../domain/coordinates.js";
import { checkCounts, designMeasures, modeledLabel } from "./designLabels.js";
import { ShapeSettings } from "./StudyInputs.jsx";

function ScenarioCard({ design, onChecks }) {
  const { summary } = design;
  const failure = design.checks.find((row) => row.status === "Fail");
  return (
    <div className="scenario-card">
      <div className="scenario-top">
        <div>
          <h3>{design.name}</h3>
          <p className="scenario-measures">{designMeasures(design)}</p>
        </div>
        <button
          type="button"
          className="checks-action"
          data-view-selected=""
          aria-haspopup="dialog"
          onClick={() => onChecks(design)}
        >
          View checks
        </button>
      </div>
      <div className="scenario-outcome" data-rank={summary.rank}>
        <strong>{modeledLabel(summary)}</strong>
        {failure && (
          <p>
            {failure.rule}. {failure.measured} against {failure.threshold}.
          </p>
        )}
        <p className="scenario-count">{checkCounts(summary)}</p>
      </div>
    </div>
  );
}

function DesignCatalog({ state, options, onChecks, onSelect }) {
  const { local } = coordinatesFor(state.key);
  const ring = state.input.polygon.slice(0, -1).map(local);
  const points = (polygon) => polygon.map((point) => point.join(",")).join(" ");
  const [minX, minY, maxX, maxY] = ["min", "min", "max", "max"].map(
    (op, index) => Math[op](...ring.map((point) => point[index % 2])),
  );
  const viewBox = [minX - 3, minY - 3, maxX - minX + 6, maxY - minY + 6].join(
    " ",
  );
  return (
    <ul className="design-list">
      {options.map((design, index) => (
        <li key={design.name}>
          <button
            type="button"
            className="design-choice"
            data-design={index}
            aria-pressed={index === state.selectedDesign}
            onClick={() => onSelect(index)}
          >
            <svg aria-hidden="true" viewBox={viewBox}>
              <polygon points={points(ring)} fill="#dce9dc" stroke="#536e5d" />
              {design.bands.map((band, bandIndex) => (
                <polygon
                  key={band.bottomM}
                  points={points(band.outline)}
                  fill={bandIndex ? "#86bca9" : "#397a69"}
                  stroke="#214c42"
                />
              ))}
            </svg>
            <span>
              <strong>{design.name}</strong>
              <small>{designMeasures(design)}</small>
              <small
                className="design-check-summary"
                data-rank={design.summary.rank}
              >
                {modeledLabel(design.summary)}
              </small>
            </span>
          </button>
          <button
            type="button"
            className="design-info-button"
            data-info={index}
            aria-label={`View checks for ${design.name}`}
            aria-haspopup="dialog"
            onClick={() => onChecks(design)}
          >
            Checks
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DesignPanel({ state, study, onChecks }) {
  const { designs, site, selectedDesign, brief } = state;
  const count = designs?.options.length ?? 0;
  const selected = designs?.options[selectedDesign];
  const emptyMessage = designs
    ? "No sampled footprint fits. Try a smaller floor plate or revise the outline."
    : site
      ? "The study has no design options yet."
      : "Design options appear when city data is available.";
  return (
    <section
      className="study-section"
      id="design-panel"
      aria-labelledby="design-title"
    >
      <h2 id="design-title">Design</h2>
      <div id="design-summary" aria-live="polite">
        {selected && <ScenarioCard design={selected} onChecks={onChecks} />}
      </div>
      <p id="design-empty" className="section-note" hidden={Boolean(count)}>
        {count ? "" : emptyMessage}
      </p>
      <details className="panel-disclosure" id="design-options" hidden={!count}>
        <summary id="design-options-title">
          {count
            ? `Compare ${count} ${count === 1 ? "design" : "designs"}`
            : "Compare designs"}
        </summary>
        <div id="design-catalog">
          {count > 0 && (
            <DesignCatalog
              state={state}
              options={designs.options}
              onChecks={onChecks}
              onSelect={study.selectDesign}
            />
          )}
        </div>
      </details>
      <ShapeSettings brief={brief} study={study} hidden={!designs} />
    </section>
  );
}
