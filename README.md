# Silicon Bricks

Bangkok plot feasibility is a React app for drawing a study plot, matching its street frontage against Bangkok city records, and comparing building designs in a 3D model.

## Run locally

Use Node.js 22.13 or later within the 22.x line, or Node.js 24 and later.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. The same app is available at `/` and `/bangkok-data-spike/bangkok-plot-walkthrough.html`.

```sh
npm run lint
npm test
npm run build
npm run preview
```

Serve the contents of `dist/` from a static host for deployment. The app queries Bangkok Metropolitan Administration services directly from the browser. If an analysis request fails, use **Retry loading site data** and check **Technical run details** for the affected layers. The map has bundled artwork for use when the live basemap is unavailable and an SVG view for browsers without WebGL.

## Project layout

- [src/components](src/components) contains the React workflow panels, map controls, and design checks dialog.
- [src/study](src/study) handles study state, request cancellation, road matching, and design updates.
- [src/domain](src/domain) contains geometry, plot validation, and feasibility calculations.
- [src/map](src/map) contains the Three.js renderer and camera interaction.
- [test](test) covers the feasibility workflow with synthetic city responses.

The browser console reports service failures and unexpected errors under the `[Silicon Bricks]` prefix.
