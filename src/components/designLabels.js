import { display, fmt } from "../domain/format.js";

export const modeledLabel = ({ rank }) =>
  ["Passes modeled checks", "Needs verification", "Fails modeled checks"][rank];

export const checkCounts = ({ passed, failed, review }) =>
  `${passed} passed · ${failed} failed · ${review} to verify`;

export const designMeasures = ({ heightM, floors, grossM2 }) =>
  `${fmt(heightM)} m · ${floors} ${floors === 1 ? "floor" : "floors"} · ${display(grossM2)} m²`;
