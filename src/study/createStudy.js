import sites from "../data/sites.json" with { type: "json" };
import { coordinatesFor } from "../domain/coordinates.js";
import {
  check,
  generate,
  groundLayout,
  limits,
  summarizeChecks,
} from "../domain/design.js";
import { fmt } from "../domain/format.js";
import { captureDesign, capturePlot } from "../domain/plot.js";
import { StudyValidationError } from "../domain/StudyValidationError.js";
import { logger } from "../logger.js";
import { normalize, requests, roadCandidates } from "./cityData.js";

const initialBrief = {
  edge: 1,
  floors: 3,
  gross: 1800,
  homes: 20,
  use: "Apartments",
  fallbackWidth: 24,
  plateProportion: 1,
  podiumFloors: 1,
  upperPlatePercent: 65,
};

const presetPoints = (key) => sites[key].coordinates.slice(0, -1);

export function createStudy() {
  const listeners = new Set();
  let state = {
    key: "bacc",
    points: presetPoints("bacc"),
    brief: { ...initialBrief },
    view: "map",
    drawing: false,
    cameraReset: 0,
    resultsVersion: 0,
    massReset: 0,
    selectedDesign: 0,
    plotIssue: "",
    status: "",
    designStatus: "",
    input: null,
    site: null,
    rules: null,
    designs: null,
    responses: {},
    errors: {},
    jobs: [],
    loading: false,
  };
  let controller;
  let designTimer;
  let roadOverride = null;
  let preferredDesign = null;

  function publish(changes) {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }

  function stop() {
    controller?.abort();
    controller = undefined;
    clearTimeout(designTimer);
  }

  function updateDesign(changes = {}) {
    clearTimeout(designTimer);
    const {
      input,
      site: previousSite,
      brief,
      responses,
      key,
    } = { ...state, ...changes };
    if (!previousSite) return;
    const site = { ...previousSite };
    const { local } = coordinatesFor(key);
    let rules = null;
    let designs = null;
    let designStatus = "";
    let selectedDesign = state.selectedDesign;
    try {
      const frontage = { ...input, frontageEdge: brief.edge + 1 };
      site.roadCandidates = roadCandidates(
        responses.roads.features,
        frontage,
        local,
      );
      const overrideIndex = site.roadCandidates.findIndex(
        (road) => road.id !== null && road.id === roadOverride,
      );
      site.roadIndex = Math.max(0, overrideIndex);
      const road = site.roadCandidates[site.roadIndex];
      if (!road)
        throw new StudyValidationError(
          "No mapped road matched this edge. Choose another frontage.",
        );
      site.roadWidthAssumedM = road.widthM ?? brief.fallbackWidth;
      site.widthSource = road.widthM
        ? "City right-of-way width"
        : "Fallback study width";
      if (
        !Number.isFinite(site.roadWidthAssumedM) ||
        site.roadWidthAssumedM <= 0
      ) {
        throw new StudyValidationError(
          "Enter a positive fallback road width for this road.",
        );
      }
      const designInput = captureDesign(input, brief);
      rules = limits(site, designInput);
      const generated = generate(rules, designInput, local);
      generated.options = generated.options
        .map((option) => {
          const design = {
            ...option,
            ground: groundLayout(option, designInput, rules, local),
          };
          const checks = check(design, designInput, rules, local);
          return { ...design, checks, summary: summarizeChecks(checks) };
        })
        .sort(
          (a, b) =>
            a.summary.rank - b.summary.rank ||
            a.summary.failed - b.summary.failed ||
            a.summary.review - b.summary.review ||
            fmt(Math.abs(a.grossM2 - designInput.grossM2)) -
              fmt(Math.abs(b.grossM2 - designInput.grossM2)) ||
            b.ground.parkingBays -
              b.ground.requiredBays -
              (a.ground.parkingBays - a.ground.requiredBays) ||
            b.ground.plantingM2 - a.ground.plantingM2,
        );
      selectedDesign = Math.max(
        0,
        generated.options.findIndex(
          (design) => design.name === preferredDesign,
        ),
      );
      designs = generated;
    } catch (error) {
      designStatus = error.message;
      if (!(error instanceof StudyValidationError)) {
        logger.error("Design calculation failed", { site: key, error });
      }
    }
    publish({
      ...changes,
      site,
      rules,
      designs,
      selectedDesign,
      designStatus,
      resultsVersion: state.resultsVersion + 1,
    });
  }

  async function execute(changes = {}) {
    stop();
    preferredDesign = null;
    const { key, points, brief } = { ...state, ...changes };
    const { local } = coordinatesFor(key);
    const reset = {
      ...changes,
      status: "",
      designStatus: "",
      site: null,
      rules: null,
      designs: null,
      selectedDesign: 0,
      responses: {},
      errors: {},
      resultsVersion: state.resultsVersion + 1,
    };
    let input;
    try {
      input = capturePlot(points, brief.edge, local);
    } catch (error) {
      publish({
        ...reset,
        input: null,
        jobs: [],
        loading: false,
        plotIssue:
          points.length < 3
            ? "Place at least three corners on the map."
            : error.message,
      });
      return;
    }

    const jobs = requests(input, key, local);
    const run = new AbortController();
    controller = run;
    const timeout = setTimeout(() => run.abort(), 25000);
    const responses = {};
    const errors = {};
    publish({
      ...reset,
      input,
      jobs,
      plotIssue: "",
      loading: true,
      drawing: false,
      status: "Querying Bangkok city services…",
    });
    try {
      await Promise.all(
        jobs.map(async ({ id, url }) => {
          try {
            const response = await fetch(url, { signal: run.signal });
            if (!response.ok) throw Error("HTTP " + response.status);
            const body = await response.json();
            if (body.error) throw Error(body.error.message);
            responses[id] = body;
          } catch (error) {
            errors[id] = error.message;
          }
        }),
      );
      if (controller !== run) return;
      if (Object.keys(errors).length) {
        throw Error(
          "Some city requests failed. Check the run details and try again.",
        );
      }
      const site = normalize(responses, "Live Bangkok city responses", input);
      updateDesign({
        site,
        responses,
        view: "3d",
        status: "",
        loading: false,
        massReset: state.massReset + 1,
      });
    } catch (error) {
      if (controller !== run) return;
      logger.warn("City study could not be loaded", {
        site: key,
        layers: Object.keys(errors),
        message: error.message,
      });
      publish({
        errors,
        status: error.message,
        loading: false,
        resultsVersion: state.resultsVersion + 1,
      });
    } finally {
      clearTimeout(timeout);
      if (controller === run) controller = undefined;
    }
  }

  function selectSite(key) {
    roadOverride = null;
    execute({
      key,
      points: presetPoints(key),
      brief: { ...state.brief, edge: 1 },
      drawing: false,
      view: "map",
      cameraReset: state.cameraReset + 1,
    });
  }

  function setPlot(points) {
    roadOverride = null;
    execute({
      points,
      brief: { ...state.brief, edge: -1 },
      drawing: true,
      view: "map",
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    execute,
    stop,
    selectSite,
    setView: (view) => publish({ view }),
    draw: () => setPlot([]),
    undo: () => setPlot(state.points.slice(0, -1)),
    addPoint(point) {
      if (!state.drawing) return;
      const { geographic } = coordinatesFor(state.key);
      const corner = geographic(point).map((value) => +value.toFixed(7));
      roadOverride = null;
      execute({ points: [...state.points, corner] });
    },
    setEdge(edge) {
      roadOverride = null;
      execute({ brief: { ...state.brief, edge } });
    },
    setBrief(field, value) {
      const brief = { ...state.brief, [field]: value };
      if (Number.isSafeInteger(brief.floors) && brief.floors > 1) {
        brief.podiumFloors = Math.min(brief.podiumFloors, brief.floors - 1);
      }
      publish({
        brief,
        designStatus: state.site ? "Updating catalog…" : state.designStatus,
      });
      clearTimeout(designTimer);
      if (state.site) designTimer = setTimeout(updateDesign, 180);
    },
    selectDesign(index) {
      preferredDesign = state.designs.options[index].name;
      publish({
        selectedDesign: index,
        view: "3d",
        massReset: state.massReset + 1,
      });
    },
    overrideRoad(id) {
      roadOverride = id;
      updateDesign();
    },
  };
}
