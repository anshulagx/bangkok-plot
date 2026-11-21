import { useLayoutEffect, useRef } from "react";
import { display, fmt } from "../domain/format.js";
import { checkCounts, designMeasures, modeledLabel } from "./designLabels.js";

function CheckList({ rows }) {
  return (
    <ul className="check-list">
      {rows.map(({ rule, status, measured, threshold, explanation }) => {
        const rank = status === "Fail" ? 2 : status === "Pass" ? 0 : 1;
        const title = /^(Street|Other) setbacks? \(m\)$/.test(rule)
          ? "Base " + rule.toLowerCase()
          : rule;
        return (
          <li className="check-item" data-rank={rank} key={rule}>
            <div className="check-line">
              <h3>{title}</h3>
              <span className="check-state">{status}</span>
            </div>
            <dl className="check-measures">
              <div>
                <dt>Measured</dt>
                <dd>{measured}</dd>
              </div>
              <div>
                <dt>Required</dt>
                <dd>{threshold}</dd>
              </div>
            </dl>
            <details className="check-explanation">
              <summary>
                How this is checked <span className="sr-only">for {title}</span>
              </summary>
              <p>{explanation}</p>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function FloorSchedule({ design }) {
  let firstFloor = 1;
  return (
    <details className="dialog-disclosure">
      <summary>Floor schedule and ground plan</summary>
      <p className="dialog-meta">
        {display(design.ground.pavingM2)} m² paved, including parking and paths.
      </p>
      <table className="floor-plates">
        <thead>
          <tr>
            <th>Floors</th>
            <th>Plate area</th>
            <th>Band area</th>
          </tr>
        </thead>
        <tbody>
          {design.bands.map(({ count, plateM2 }) => {
            const lastFloor = firstFloor + count - 1;
            const range =
              count === 1 ? String(firstFloor) : `${firstFloor}–${lastFloor}`;
            firstFloor = lastFloor + 1;
            return (
              <tr key={lastFloor}>
                <td>{range}</td>
                <td>{fmt(plateM2)} m²</td>
                <td>{fmt(plateM2 * count)} m²</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="section-note">
        Values are rounded for display. The checks use the underlying values.
      </p>
    </details>
  );
}

function DesignChecks({ design }) {
  const failures = design.checks.filter((row) => row.status === "Fail");
  const reviews = design.checks.filter(
    (row) => !["Pass", "Fail"].includes(row.status),
  );
  const passes = design.checks.filter((row) => row.status === "Pass");
  return (
    <>
      <p className="dialog-meta">{designMeasures(design)}</p>
      <div className="scenario-outcome" data-rank={design.summary.rank}>
        <strong>{modeledLabel(design.summary)}</strong>
        <p className="scenario-count">{checkCounts(design.summary)}</p>
      </div>
      {failures.length > 0 && (
        <section className="dialog-disclosure" aria-label="Failed checks">
          <h3>Failed checks</h3>
          <CheckList rows={failures} />
        </section>
      )}
      {reviews.length > 0 && (
        <details className="dialog-disclosure" open>
          <summary>Needs verification ({reviews.length})</summary>
          <CheckList rows={reviews} />
        </details>
      )}
      {passes.length > 0 && (
        <details className="dialog-disclosure">
          <summary>Passed checks ({passes.length})</summary>
          <CheckList rows={passes} />
        </details>
      )}
      <FloorSchedule design={design} />
      <details className="dialog-disclosure">
        <summary>Rule sources</summary>
        <p className="dialog-sources section-note">
          <a href="https://webportal.bangkok.go.th/public/user_files_editor/76/law/y10.pdf">
            P.5 planting rule, clause 22
          </a>
          <a href="https://webportal.bangkok.go.th/public/user_files_editor/75/basic_info/Laws/03_Yota/Legis_Building_2544.pdf">
            Bangkok building ordinance, clauses 52 and 83–90
          </a>
          <a href="https://www.opsmoac.go.th/nongkhai-dwl-files-411391791882#page=3">
            Ministerial Regulation 33, clauses 1–4, as amended
          </a>
        </p>
      </details>
    </>
  );
}

export function DesignDialog({ design, onClose }) {
  const dialog = useRef(null);
  const content = useRef(null);
  const closeButton = useRef(null);

  useLayoutEffect(() => {
    if (!design) return;
    dialog.current.showModal();
    closeButton.current.focus();
    content.current.scrollTop = 0;
  }, [design]);

  return (
    <dialog
      id="design-info"
      ref={dialog}
      aria-labelledby="design-info-title"
      onClose={onClose}
    >
      <form method="dialog" className="design-dialog-heading">
        <h2 id="design-info-title">{design ? `${design.name} checks` : ""}</h2>
        <button ref={closeButton}>Close</button>
      </form>
      <div id="design-info-content" ref={content}>
        {design && <DesignChecks design={design} />}
      </div>
    </dialog>
  );
}
