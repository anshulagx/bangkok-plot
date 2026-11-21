import { StudyValidationError } from "./StudyValidationError.js";
import { area, hit, next } from "./geometry.js";

function captureSite(points, local) {
  const p = points.map(local);
  if (p.length < 3 || new Set(points.map(String)).size !== p.length)
    throw new StudyValidationError(
      "Choose at least three distinct corners. Undo duplicate points.",
    );
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++)
      if (
        j !== i + 1 &&
        !(i === 0 && j === p.length - 1) &&
        hit(p[i], next(p, i), p[j], next(p, j))
      )
        throw new StudyValidationError(
          "The outline crosses itself. Undo a corner or redraw it.",
        );
  if (Math.abs(area(p)) < 1)
    throw new StudyValidationError("Draw a plot with measurable area.");
  return { polygon: [...points, points[0]], areaM2: Math.abs(area(p)) };
}
export function capturePlot(points, edge, local) {
  const siteInput = captureSite(points, local);
  if (edge < 0 || edge >= siteInput.polygon.length - 1)
    throw new StudyValidationError("Choose the road-facing edge.");
  return siteInput;
}
export function captureDesign(siteInput, brief) {
  if (brief.edge < 0 || brief.edge >= siteInput.polygon.length - 1)
    throw new StudyValidationError("Select the road-facing edge.");
  if (
    !Number.isSafeInteger(brief.floors) ||
    brief.floors < 1 ||
    !Number.isFinite(brief.gross) ||
    brief.gross <= 0
  )
    throw new StudyValidationError(
      "Enter a positive whole floor count and a positive total floor area.",
    );
  const apartments = brief.use === "Apartments";
  if (apartments && (!Number.isSafeInteger(brief.homes) || brief.homes < 1))
    throw new StudyValidationError("Enter a positive whole number of homes.");
  if (apartments && brief.homes * 65 > brief.gross)
    throw new StudyValidationError(
      "The 65 m² homes exceed the requested floor area. Increase the area or reduce the number of homes.",
    );
  const podiumFloors = brief.floors > 1 ? brief.podiumFloors : 0;
  if (brief.floors > 1) {
    if (
      !Number.isInteger(podiumFloors) ||
      podiumFloors < 1 ||
      podiumFloors >= brief.floors
    )
      throw new StudyValidationError(
        "Choose at least one podium floor and leave at least one upper floor.",
      );
    if (
      !Number.isFinite(brief.upperPlatePercent) ||
      brief.upperPlatePercent < 35 ||
      brief.upperPlatePercent > 85
    )
      throw new StudyValidationError(
        "Enter an upper plate between 35% and 85% of the podium.",
      );
  }
  return {
    ...siteInput,
    frontageEdge: brief.edge + 1,
    use: brief.use,
    floors: brief.floors,
    grossM2: brief.gross,
    homes: apartments ? brief.homes : null,
    unitM2: apartments ? 65 : null,
    plateProportion: brief.plateProportion,
    podiumFloors,
    upperPlateRatio: brief.upperPlatePercent / 100,
  };
}
