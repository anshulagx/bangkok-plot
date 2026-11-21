import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { DesignDialog } from "./components/DesignDialog.jsx";
import { DesignPanel } from "./components/DesignPanel.jsx";
import { MapPane } from "./components/MapPane.jsx";
import { SiteResults } from "./components/SiteResults.jsx";
import { BriefPanel, PlotControls } from "./components/StudyInputs.jsx";
import sites from "./data/sites.json" with { type: "json" };
import { logger } from "./logger.js";
import { createSiteViewer } from "./map/createSiteViewer.js";
import { createStudy } from "./study/createStudy.js";

const initialLayers = {
  nearby: true,
  asbuilt: false,
  shell3: true,
  mass3: true,
  measure3: true,
  ground3: true,
};

export function App() {
  const [study] = useState(createStudy);
  const state = useSyncExternalStore(study.subscribe, study.getSnapshot);
  const [fallback, setFallback] = useState(false);
  const [orbit, setOrbit] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [design, setDesign] = useState(null);
  const [layerSettings, setLayerSettings] = useState({
    ...initialLayers,
    massReset: 0,
  });
  const studio = useRef(null);
  const viewer = useRef(null);
  const mapUi = useRef({ panelOpen: false, in3D: false });
  const sceneState = useRef(null);
  const frameRequest = useRef(null);
  const find = (selector) => studio.current?.querySelector(selector);

  const in3D = !fallback && state.view === "3d";
  const { massReset, ...layers } = layerSettings;
  if (massReset !== state.massReset) layers.mass3 = true;

  useLayoutEffect(() => {
    const root = studio.current;
    const onPoint = (point) => {
      if (!mapUi.current.panelOpen && !mapUi.current.in3D)
        study.addPoint(point);
    };
    viewer.current = createSiteViewer(root, {
      onPoint,
      isPanelOpen: () => mapUi.current.panelOpen,
    });
    if (!viewer.current) setFallback(true);
    study.execute();

    const dismissOutside = (event) => {
      if (
        mapUi.current.panelOpen &&
        !event.composedPath().includes(root.querySelector(".map-controls"))
      ) {
        setPanelOpen(false);
      }
    };
    const dismissOnEscape = (event) => {
      if (
        mapUi.current.panelOpen &&
        event.key === "Escape" &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        setPanelOpen(false);
        root.querySelector("#layer-controls").focus();
      }
    };
    document.addEventListener("click", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      study.stop();
      cancelAnimationFrame(frameRequest.current);
      frameRequest.current = null;
      viewer.current?.dispose();
      viewer.current = null;
      document.removeEventListener("click", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [study]);

  useLayoutEffect(() => {
    mapUi.current = { panelOpen, in3D };
    if (!in3D && panelOpen) {
      const panel = find("#layer-panel");
      const focus = document.activeElement;
      if (focus?.id === "layer-controls" || panel.contains(focus))
        find("#show-3d").focus();
      setPanelOpen(false);
    }

    if (!viewer.current) return;
    sceneState.current = { ...state, layers, orbit, view: in3D ? "3d" : "map" };
    if (frameRequest.current !== null) return;
    frameRequest.current = requestAnimationFrame(() => {
      frameRequest.current = null;
      try {
        viewer.current?.update(sceneState.current);
      } catch (error) {
        logger.error("Scene could not be drawn", {
          site: sceneState.current.key,
          error,
        });
        find("#scene-readout").textContent =
          "Scene could not be drawn: " + error.message;
      }
    });
  });

  useLayoutEffect(() => {
    if (!panelOpen) return;
    const panel = studio.current.querySelector("#layer-panel");
    (
      panel.querySelector("input:not(:disabled)") ||
      panel.querySelector("button")
    ).focus();
  }, [panelOpen]);

  function draw() {
    study.draw();
    setPanelOpen(false);
    const frame = find("#scene-frame");
    (fallback ? find("#draw") : frame).focus({ preventScroll: true });
    frame.scrollIntoView({ block: "nearest" });
  }

  return (
    <main className="shell">
      <section ref={studio} id="studio" aria-labelledby="studio-title">
        <div className="live-layout">
          <MapPane
            state={state}
            {...{ fallback, in3D, layers, orbit, panelOpen }}
            onPanel={(open) => {
              setPanelOpen(open);
              if (!open) find("#layer-controls").focus();
            }}
            onView={() => study.setView(in3D ? "map" : "3d")}
            onOrbit={() => setOrbit(!orbit)}
            onReset={() => viewer.current?.reset()}
            onLayer={(id, checked) =>
              setLayerSettings({
                ...layers,
                [id]: checked,
                massReset: state.massReset,
              })
            }
            onPoint={(point) => {
              if (!panelOpen && !in3D) study.addPoint(point);
            }}
          />
          <aside id="workflow-pane" aria-labelledby="studio-title">
            <div className="workspace-header">
              <header className="studio-head">
                <h1 id="studio-title">Plot feasibility</h1>
                <p className="workspace-site" id="workspace-site">
                  {sites[state.key].title}
                </p>
              </header>
            </div>
            <div id="study-panel">
              <PlotControls
                state={state}
                study={study}
                onDraw={draw}
                onRetry={() => {
                  setPanelOpen(false);
                  study.execute();
                }}
              />
              <BriefPanel
                brief={state.brief}
                status={state.designStatus}
                study={study}
              />
              <DesignPanel state={state} study={study} onChecks={setDesign} />
              <SiteResults state={state} study={study} in3D={in3D} />
            </div>
          </aside>
        </div>
        <DesignDialog design={design} onClose={() => setDesign(null)} />
      </section>
    </main>
  );
}
