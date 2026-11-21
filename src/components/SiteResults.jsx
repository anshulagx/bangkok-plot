import { useRef } from "react";
import { display } from "../domain/format.js";

function SiteFacts({ input, site, road, rules }) {
  const width =
    site.roadWidthAssumedM > 0
      ? `${display(site.roadWidthAssumedM)} m`
      : "Unavailable";
  const widthNote =
    site.widthSource === "Fallback study width"
      ? "Assumed from Brief. Confirm the public right-of-way."
      : "City road record. Confirm the public right-of-way.";
  return (
    <>
      <dl className="site-facts">
        <div>
          <dt>Planning zone</dt>
          <dd>{site.subzone || site.zone || "Unknown"}</dd>
        </div>
        <div>
          <dt>Drawn plot area</dt>
          <dd>{display(input.areaM2)} m²</dd>
        </div>
        {road && (
          <>
            <div>
              <dt>Matched road</dt>
              <dd>{road.name}</dd>
            </div>
            <div>
              <dt>Road width used</dt>
              <dd>{width}</dd>
              <small>{widthNote}</small>
            </div>
          </>
        )}
        {rules && (
          <>
            <div>
              <dt>Floor area cap from zoning</dt>
              <dd>{display(rules.maxFloorAreaM2)} m²</dd>
              <small>FAR {rules.far}:1 × drawn plot area</small>
            </div>
            <div>
              <dt>Base street setback</dt>
              <dd>{display(rules.frontSetbackM)} m</dd>
              <small>Other plot edges {display(rules.otherSetbackM)} m</small>
            </div>
          </>
        )}
      </dl>
      {rules && (
        <p className="section-note">
          The zoning cap is an upper limit. The design and site checks determine
          how much of it may be usable.
        </p>
      )}
    </>
  );
}

function RoadSelector({ site, study, version }) {
  const lastOverride = useRef(null);
  return (
    <details
      className="panel-disclosure"
      key={version}
      ref={(details) => {
        if (!details || !lastOverride.current) return;
        details.open = true;
        details.querySelector("select").focus();
        lastOverride.current = null;
      }}
    >
      <summary>Change matched road</summary>
      <select
        aria-label="Road segment"
        id="road-override"
        value={site.roadIndex}
        onChange={(event) => {
          lastOverride.current = true;
          study.overrideRoad(
            site.roadCandidates[Number(event.target.value)].id,
          );
        }}
      >
        {site.roadCandidates.map((road, index) => (
          <option key={road.index} value={index}>
            {`${road.name} · ${road.distanceM} m average gap · record ${road.index + 1}`}
          </option>
        ))}
      </select>
    </details>
  );
}

export function SiteResults({ state, study, in3D }) {
  const { input, site, rules, designs, errors, jobs, resultsVersion } = state;
  const road = site?.roadCandidates[site.roadIndex];
  const details = input && {
    requests: jobs.map(
      ({ url }) => `curl --fail --show-error --silent '${url}'`,
    ),
    site,
    rules,
    catalog: designs?.search,
    errors,
  };
  return (
    <section
      className="study-section"
      id="results-panel"
      aria-labelledby="results-title"
    >
      <h2 id="results-title">Site results</h2>
      <div id="study-results">
        {site ? (
          <SiteFacts {...{ input, site, road, rules }} />
        ) : (
          <p className="section-note">
            Site results appear when city data is available.
          </p>
        )}
        {site?.roadCandidates.length > 1 && (
          <RoadSelector {...{ site, study }} version={resultsVersion} />
        )}
        {details && (
          <details className="panel-disclosure" key={resultsVersion}>
            <summary>Technical run details</summary>
            <pre>{JSON.stringify(details, null, 2)}</pre>
          </details>
        )}
      </div>
      <details className="panel-disclosure" id="siteview" hidden={!in3D}>
        <summary>3D model and map sources</summary>
        <p id="scene-stage" />
        <p className="scene-key">
          Green marks the plot and design. Blue shows the base setbacks and
          height plane. Orange marks frontage.
        </p>
        <p id="scene-readout" aria-live="polite" />
        <small id="scene-source" />
      </details>
    </section>
  );
}
