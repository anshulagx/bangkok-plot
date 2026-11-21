import sites from "../data/sites.json" with { type: "json" };

export function PlotControls({ state, study, onDraw, onRetry }) {
  const { key, points, brief, plotIssue, status, input, site, loading } = state;
  return (
    <section
      className="study-section"
      id="plot-panel"
      aria-labelledby="plot-title"
    >
      <h2 id="plot-title">Plot and frontage</h2>
      <div id="workbench">
        <div className="studio-fields workspace-inputs">
          <label>
            Site preset
            <select
              id="location"
              value={key}
              onChange={(event) => study.selectSite(event.target.value)}
            >
              {Object.entries(sites).map(([id, preset]) => (
                <option key={id} value={id}>
                  {preset.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Road-facing edge
            <select
              id="edge"
              aria-describedby="edge-help"
              value={brief.edge}
              disabled={points.length < 3}
              onChange={(event) => study.setEdge(Number(event.target.value))}
            >
              <option value="-1">Choose an edge</option>
              {points.map((_, index) => (
                <option key={index} value={index}>
                  {`Corner ${index + 1} → ${((index + 1) % points.length) + 1}`}
                </option>
              ))}
            </select>
          </label>
          <small className="wide field-note" id="edge-help">
            The orange edge marks the frontage.
          </small>
          <div className="actions map-actions wide">
            <button type="button" id="draw" className="" onClick={onDraw}>
              Draw plot
            </button>
            <button
              type="button"
              id="undo"
              className=""
              disabled={!points.length}
              onClick={(event) => {
                const button = event.currentTarget;
                study.undo();
                (points.length === 1
                  ? button.previousElementSibling
                  : button
                ).focus();
              }}
            >
              Undo corner
            </button>
            <button
              type="button"
              id="restore"
              className=""
              onClick={(event) => {
                study.selectSite(key);
                event.currentTarget.focus();
              }}
            >
              Reset plot
            </button>
          </div>
        </div>
      </div>
      <p id="plot-progress" className="section-note" role="status">
        {plotIssue}
      </p>
      <p id="studio-status" role="status">
        {status}
      </p>
      <button
        type="button"
        id="execute"
        className="primary"
        hidden={!input || Boolean(site || loading)}
        onClick={onRetry}
      >
        Retry loading site data
      </button>
    </section>
  );
}

function BriefNumber({ id, label, brief, study, ...inputProps }) {
  return (
    <label>
      {label}
      <input
        type="number"
        id={id}
        value={Number.isFinite(brief[id]) ? brief[id] : ""}
        onChange={(event) => study.setBrief(id, event.target.valueAsNumber)}
        {...inputProps}
      />
    </label>
  );
}

export function BriefPanel({ brief, status, study }) {
  return (
    <section
      className="study-section"
      id="brief-panel"
      aria-labelledby="brief-title"
    >
      <h2 id="brief-title">Brief</h2>
      <div id="brief-inputs">
        <div className="studio-fields workspace-inputs">
          <label>
            Building type
            <select
              id="use"
              value={brief.use}
              onChange={(event) => study.setBrief("use", event.target.value)}
            >
              {["Apartments", "Offices", "Retail shops"].map((use) => (
                <option key={use}>{use}</option>
              ))}
            </select>
          </label>
          <BriefNumber
            id="floors"
            label="Requested floors"
            min={1}
            step={1}
            {...{ brief, study }}
          />
          <BriefNumber
            id="gross"
            label="Total floor area (m²)"
            min={0}
            step="any"
            {...{ brief, study }}
          />
          {brief.use === "Apartments" && (
            <BriefNumber
              id="homes"
              label="Homes of 65 m²"
              min={1}
              step={1}
              {...{ brief, study }}
            />
          )}
          <div className="wide">
            <BriefNumber
              id="fallbackWidth"
              label="Fallback road width (m)"
              min={0}
              step="any"
              aria-describedby="fallback-help"
              {...{ brief, study }}
            />
            <small className="field-note" id="fallback-help">
              Used if city width is missing. Assumes a straight, parallel road.
            </small>
          </div>
        </div>
      </div>
      <p id="design-status" role="status">
        {status}
      </p>
    </section>
  );
}

export function ShapeSettings({ brief, study, hidden }) {
  const hasUpperFloor = Number.isSafeInteger(brief.floors) && brief.floors > 1;
  return (
    <details className="panel-disclosure" id="shape-settings" hidden={hidden}>
      <summary>Shape settings</summary>
      <div id="design-inputs">
        <div className="studio-fields workspace-inputs">
          <label className="wide">
            Catalog plate proportions
            <select
              id="plateProportion"
              value={brief.plateProportion}
              onChange={(event) =>
                study.setBrief("plateProportion", Number(event.target.value))
              }
            >
              <option value={0.7}>Narrower</option>
              <option value={1}>Standard</option>
              <option value={1.4}>Wider</option>
            </select>
          </label>
          <BriefNumber
            id="podiumFloors"
            label="Podium floors"
            min={1}
            max={hasUpperFloor ? brief.floors - 1 : 1}
            step={1}
            disabled={!hasUpperFloor}
            {...{ brief, study }}
          />
          <BriefNumber
            id="upperPlatePercent"
            label="Upper plate (% of podium)"
            min={35}
            max={85}
            step="any"
            disabled={!hasUpperFloor}
            {...{ brief, study }}
          />
          <small className="wide">
            Podium and upper-floor settings apply to the stepped option with two
            or more floors.
          </small>
        </div>
      </div>
    </details>
  );
}
