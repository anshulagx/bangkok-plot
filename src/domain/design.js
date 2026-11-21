import { StudyValidationError } from "./StudyValidationError.js";
import polygonClipping from "polygon-clipping";
import { area, inspect, next, setbackFootprint } from "./geometry.js";
import { fmt } from "./format.js";

export function limits(site, brief) {
  if (
    site.zone !== "พ.๕" ||
    site.far !== 10 ||
    site.osrPercent !== 3 ||
    site.otherPlanningHits ||
    site.overlays.some(
      (name) => typeof name !== "string" || !/ค้าปลีกค้าส่ง|ป้าย/.test(name),
    )
  )
    throw new StudyValidationError(
      "This site has a zone, overlay or ratio outside the reviewed P.5 scenarios. Review the clauses before continuing.",
    );
  if (!site.roadRecords || !site.buildingCount)
    throw new StudyValidationError("The required mapped context is missing.");
  if (!site.roadWidthAssumedM)
    throw new StudyValidationError(
      "Road width and legal reference lines are unresolved. Enter a fallback road width in Brief.",
    );
  const residential = brief.use === "Apartments",
    openRatio = residential ? 0.3 : 0.1;
  const width = site.roadWidthAssumedM;
  const front =
    width < 10
      ? { distance: 6 - width / 2, formula: "6 − " + fmt(width) + " ÷ 2" }
      : width <= 20
        ? { distance: width / 10, formula: fmt(width) + " ÷ 10" }
        : { distance: 2, formula: "2 m for roads wider than 20 m" };
  const reviews = [];
  if (!residential)
    reviews.push({
      rule: brief.use + " occupancy, parking and access requirements",
      explanation:
        "Confirm the occupancy classification and applicable parking and access rules for the selected use. The study uses a provisional parking target.",
    });
  if (
    brief.use === "Retail shops" &&
    site.overlays.some((n) => n.includes("ค้าปลีกค้าส่ง"))
  )
    reviews.push({
      rule: "Mapped retail/wholesale restriction: confirm use and size eligibility",
      explanation:
        "Bangkok’s planning data returned a retail and wholesale building-control overlay for this plot. Confirm whether the proposed use and floor area are permitted under it.",
    });
  return {
    use: brief.use,
    reviews,
    source: site.source,
    subzone: site.subzone,
    plotAreaM2: brief.areaM2,
    far: site.far,
    maxFloorAreaM2: brief.areaM2 * site.far,
    openRatio,
    osrPercent: site.osrPercent,
    frontSetbackM: front.distance,
    frontSetbackFormula: front.formula,
    otherSetbackM: 3,
    roadWidthM: width,
    roadWidthSource: site.widthSource,
    requiredParkingBays: brief.homes,
  };
}
const catalogFloorHeightM = 3.5;
function massing(name, plates) {
  let heightM = 0,
    floors = 0,
    grossM2 = 0;
  const bands = plates.map(({ outline, count }) => {
    const plateM2 = Math.abs(area(outline)),
      bottomM = heightM;
    floors += count;
    grossM2 += plateM2 * count;
    heightM += count * catalogFloorHeightM;
    return { outline, count, plateM2, bottomM, topM: heightM };
  });
  return { name, bands, floors, grossM2, heightM };
}
function plotShapedDesign(ring, edge, r, brief) {
  const largestPlate = (inset) => {
    const pieces = setbackFootprint(ring, edge, r, inset);
    let largest = null;
    for (const [outer, ...holes] of pieces) {
      if (holes.length) continue;
      const size = Math.abs(area(outer));
      if (!largest || size > largest.size)
        largest = { outline: outer.slice(0, -1), size };
    }
    return largest;
  };
  const base = largestPlate(0.01);
  if (!base) return null;
  let best = base;
  const targetPlateM2 = brief.grossM2 / brief.floors;
  if (base.size > targetPlateM2) {
    const a = ring[0];
    let low = 0.01,
      high =
        1 + Math.max(...ring.map((p) => Math.hypot(p[0] - a[0], p[1] - a[1])));
    for (let i = 0; i < 32; i++) {
      const inset = (low + high) / 2;
      const plate = largestPlate(inset);
      if (!plate || plate.size < targetPlateM2) {
        high = inset;
        continue;
      }
      low = inset;
      best = plate;
      if (plate.size - targetPlateM2 < 0.0001) break;
    }
  }
  const measured = inspect(best.outline, ring, edge);
  if (
    !measured ||
    measured.front < r.frontSetbackM ||
    measured.other < r.otherSetbackM ||
    measured.fromRoad < -0.000001
  )
    return null;
  return massing("Plot-shaped block", [
    { outline: best.outline, count: brief.floors },
  ]);
}

export function generate(r, s, local) {
  const ring = s.polygon.slice(0, -1).map(local),
    edge = s.frontageEdge - 1;
  const xs = ring.map((p) => p[0]),
    ys = ring.map((p) => p[1]),
    xmin = Math.min(...xs),
    ymin = Math.min(...ys),
    w = Math.max(...xs) - xmin,
    h = Math.max(...ys) - ymin;
  const plotDesign = plotShapedDesign(ring, edge, r, s);
  const options = plotDesign ? [plotDesign] : [];
  const compact = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const templates = [
    ["Compact block", compact],
    [
      "L-shaped block",
      [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0],
        [0, 0],
        [0, 0.5],
        [-0.5, 0.5],
      ],
    ],
    [
      "Slender bar",
      [
        [-1, -0.25],
        [1, -0.25],
        [1, 0.25],
        [-1, 0.25],
      ],
    ],
    [
      "U-shaped court",
      [
        [-0.6, -0.5],
        [0.6, -0.5],
        [0.6, 0.5],
        [0.25, 0.5],
        [0.25, -0.1],
        [-0.25, -0.1],
        [-0.25, 0.5],
        [-0.6, 0.5],
      ],
    ],
    [
      "T-shaped block",
      [
        [-0.65, -0.5],
        [0.65, -0.5],
        [0.65, -0.15],
        [0.2, -0.15],
        [0.2, 0.55],
        [-0.2, 0.55],
        [-0.2, -0.15],
        [-0.65, -0.15],
      ],
    ],
  ];
  const proportion = Math.sqrt(s.plateProportion);
  const positions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
  function place(template, plateM2) {
    const scale = Math.sqrt(plateM2 / Math.abs(area(template)));
    for (const angle of [0, Math.PI / 6, Math.PI / 3, Math.PI / 2]) {
      const cos = Math.cos(angle),
        sin = Math.sin(angle);
      const shape = template.map(([x, y]) => [
        scale * (x * proportion * cos - (y / proportion) * sin),
        scale * (x * proportion * sin + (y / proportion) * cos),
      ]);
      for (const y of positions)
        for (const x of positions) {
          const center = [xmin + w * x, ymin + h * y];
          const outline = shape.map(([a, b]) => [center[0] + a, center[1] + b]);
          const measured = inspect(outline, ring, edge);
          if (
            measured &&
            measured.front >= r.frontSetbackM &&
            measured.other >= r.otherSetbackM &&
            measured.fromRoad >= 0
          )
            return { outline, center };
        }
    }
    return null;
  }
  function fitPlate(template, plateM2) {
    for (const factor of [1, 0.9, 0.8]) {
      const fit = place(template, plateM2 * factor);
      if (fit) return fit;
    }
    return null;
  }
  for (const [name, template] of templates) {
    const fit = fitPlate(template, s.grossM2 / s.floors);
    if (fit)
      options.push(massing(name, [{ outline: fit.outline, count: s.floors }]));
  }
  if (s.podiumFloors > 0) {
    const upperFloors = s.floors - s.podiumFloors;
    const podiumM2 =
      s.grossM2 / (s.podiumFloors + upperFloors * s.upperPlateRatio);
    const fit = fitPlate(compact, podiumM2);
    if (fit) {
      const scale = Math.sqrt(s.upperPlateRatio),
        [cx, cy] = fit.center;
      const upper = fit.outline.map(([x, y]) => [
        cx + (x - cx) * scale,
        cy + (y - cy) * scale,
      ]);
      options.push(
        massing("Stepped podium", [
          { outline: fit.outline, count: s.podiumFloors },
          { outline: upper, count: upperFloors },
        ]),
      );
    }
  }
  return {
    options,
    search:
      "The plot-shaped design uses the largest connected inset. Other forms sample four orientations and 49 positions, at 100%, 90% and 80% of target plate area.",
    coordinateFrame:
      "Local metres, x east and y south from the mapped site centre.",
  };
}
function polygonArea(rings) {
  const [outer, ...holes] = rings;
  return (
    Math.abs(area(outer)) -
    holes.reduce((sum, hole) => sum + Math.abs(area(hole)), 0)
  );
}
export function groundLayout(candidate, input, rules, local) {
  const plot = input.polygon.slice(0, -1).map(local);
  const a = plot[input.frontageEdge - 1],
    b = next(plot, input.frontageEdge - 1);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]),
    winding = Math.sign(area(plot));
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
    v = [-u[1] * winding, u[0] * winding];
  const project = ([x, y]) => [
    (x - a[0]) * u[0] + (y - a[1]) * u[1],
    (x - a[0]) * v[0] + (y - a[1]) * v[1],
  ];
  const unproject = ([x, y]) => [
    a[0] + x * u[0] + y * v[0],
    a[1] + x * u[1] + y * v[1],
  ];
  const floor = candidate.bands[0].outline.map(project);
  const projectedPlates = candidate.bands.map((band) => [
    band.outline.map(project),
  ]);
  const open = polygonClipping.difference(
    [plot.map(project)],
    ...projectedPlates,
  );
  const rectangle = (x, y, w, h) => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const polygonSetArea = (pieces) =>
    pieces.reduce((sum, rings) => sum + polygonArea(rings), 0);
  const fits = (shape, space) =>
    polygonSetArea(polygonClipping.difference([shape], space)) < 0.0001;
  const clearSpace = polygonSetArea(open);
  const parkingAreaPerBayM2 = input.use === "Offices" ? 60 : 20;
  const requiredBays =
    rules.requiredParkingBays ??
    Math.ceil(candidate.grossM2 / parkingAreaPerBayM2 - 1e-9);
  const depth = Math.max(...plot.map((p) => project(p)[1]));
  const bayWidth = 2.4,
    bayDepth = 5,
    aisleWidth = 6,
    headLength = 6;
  const aislePositions =
    length > aisleWidth
      ? Array.from({ length: Math.min(21, Math.ceil(length / 2)) }, (_, i) => i)
      : [];
  // Sample driveway positions across the frontage. Every chosen bay touches the same aisle.
  let parking = { bays: [], paving: [], area: 0 };
  for (const i of aislePositions) {
    const x =
      0.01 +
      ((length - aisleWidth - 0.02) * i) /
        Math.max(1, aislePositions.length - 1);
    const bays = [];
    for (
      let y = 0.05;
      y + bayWidth + headLength <= depth && bays.length < requiredBays;
      y += bayWidth
    ) {
      if (!fits(rectangle(x, 0, aisleWidth, y + bayWidth + headLength), open))
        break;
      for (const bx of [x - bayDepth, x + aisleWidth]) {
        const bay = rectangle(bx, y, bayDepth, bayWidth);
        if (fits(bay, open)) bays.push({ shape: bay, end: y + bayWidth });
        if (bays.length === requiredBays) break;
      }
    }
    if (!bays.length) continue;
    const end = bays[bays.length - 1].end + headLength;
    const pavedArea = aisleWidth * end + bays.length * bayWidth * bayDepth;
    if (
      bays.length > parking.bays.length ||
      (bays.length === parking.bays.length && pavedArea < parking.area)
    ) {
      parking = {
        bays: bays.map((bay) => bay.shape),
        paving: [rectangle(x, 0, aisleWidth, end)],
        area: pavedArea,
      };
    }
  }
  const parkingFootprints = [...parking.paving, ...parking.bays].map((r) => [
    r,
  ]);
  const remaining = polygonClipping.difference(open, ...parkingFootprints);
  // Find a direct pedestrian strip from the frontage to the first point on a façade.
  let pedestrian = [];
  const [minX, maxX] = [
    Math.min(...floor.map((p) => p[0])),
    Math.max(...floor.map((p) => p[0])),
  ];
  const width = 1.5;
  for (let i = 0; i <= 20 && !pedestrian.length; i++) {
    const x =
      Math.max(width / 2, minX) +
      ((Math.min(length - width / 2, maxX) - Math.max(width / 2, minX)) * i) /
        20;
    if (x < width / 2 || x > length - width / 2) continue;
    const crossings = floor
      .flatMap((p, j) => {
        const q = next(floor, j);
        if (p[0] > x === q[0] > x) return [];
        return [p[1] + ((x - p[0]) * (q[1] - p[1])) / (q[0] - p[0])];
      })
      .filter((y) => y > 0);
    if (!crossings.length) continue;
    const strip = rectangle(
      x - width / 2,
      0,
      width,
      Math.min(...crossings) + width,
    );
    const usable = polygonClipping.intersection([strip], remaining);
    const ends = usable.filter(
      ([ring]) =>
        Math.min(...ring.map((p) => p[1])) <= 0.001 &&
        Math.max(...ring.map((p) => p[1])) >= Math.min(...crossings) - 0.001 &&
        Math.abs(area(ring)) >= width * Math.min(...crossings) - 0.05,
    );
    if (ends.length) pedestrian = ends;
  }
  const planted = polygonClipping.difference(remaining, ...pedestrian);
  const toLocal = (polygons) =>
    polygons.map((rings) => rings.map((ring) => ring.map(unproject)));
  return {
    parkingBays: parking.bays.length,
    requiredBays,
    provisionalParking: rules.requiredParkingBays === null,
    parkingAreaPerBayM2,
    pedestrianWidthM: width,
    aisleWidthM: aisleWidth,
    turningEndM: headLength,
    clearSpaceM2: clearSpace,
    plantingM2: polygonSetArea(planted),
    pavingM2: parking.area + polygonSetArea(pedestrian),
    planting: toLocal(planted),
    paving: toLocal([...parking.paving.map((r) => [r]), ...pedestrian]),
    bays: toLocal(parking.bays.map((r) => [r])),
    pedestrian: pedestrian.length > 0,
  };
}

function highRiseAccessChecks(design, rules, frontageLengthM) {
  const highRise = design.heightM >= 23;
  // Ignore arithmetic noise when a generated plate lands on a statutory area boundary.
  const extraLarge = design.grossM2 >= 10000 - 1e-6;
  if (!highRise && !extraLarge) return [];
  const above30000 = design.grossM2 > 30000 + 1e-6;
  const minWidthM = above30000 ? 18 : 10;
  const adequateWidth = rules.roadWidthM >= minWidthM;
  const widthSource =
    rules.roadWidthSource === "City right-of-way width"
      ? "city road record"
      : "fallback assumption";
  const classification = [
    highRise ? "23 m or taller" : "",
    extraLarge ? "10,000 m² or more" : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const continuity =
    "Verify that the public right-of-way stays at least " +
    minWidthM +
    " m wide from the site to its connection with another public road at least " +
    minWidthM +
    " m wide.";
  return [
    {
      rule: "High-rise or extra-large building road width",
      measured: fmt(rules.roadWidthM) + " m (" + widthSource + ")",
      threshold: "≥ " + minWidthM + " m public right-of-way",
      status: adequateWidth ? "Needs road verification" : "Fail",
      explanation:
        "Ministerial Regulation 33, clauses 1–2, applies because the modeled building is " +
        classification +
        ". " +
        (adequateWidth
          ? "Confirm the legal right-of-way width at the site."
          : "The selected road width fails in this study scenario. Verify the legal width or identify another qualifying frontage."),
    },
    {
      rule: "Legal frontage and road continuity",
      measured: fmt(frontageLengthM) + " m drawn edge",
      threshold:
        "≥ 12 m of adjoining legal frontage and a qualifying road connection",
      status: "Needs frontage verification",
      explanation:
        "Ministerial Regulation 33, clause 2. Confirm that at least 12 m of a legal parcel boundary directly adjoins the qualifying public road. " +
        continuity,
    },
    {
      rule: "Fire vehicle access from the public road",
      measured: "Unverified",
      threshold: "≥ 12 m wide unobstructed access to the building site",
      status: "Needs fire access review",
      explanation:
        "Ministerial Regulation 33, clause 2, requires the parcel’s access from the qualifying public road to the building site to remain at least 12 m wide and unobstructed for fire vehicles.",
    },
    {
      rule: "Perimeter fire vehicle access",
      measured: "Unverified",
      threshold: "Unobstructed perimeter road with ≥ 6 m traffic surface",
      status: "Needs fire access review",
      explanation:
        "Ministerial Regulation 33, clause 3, requires an unobstructed road around the building with a traffic surface at least 6 m wide for fire vehicles. Confirm the route and obstructions with a site plan.",
    },
    {
      rule: "High-rise or extra-large building setbacks",
      measured: "Legal boundaries and below-grade extents unverified",
      threshold: "≥ 6 m from adjoining land and public road boundaries",
      status: "Needs setback verification",
      explanation:
        "Ministerial Regulation 33, clause 4, measures from the outermost building extent above and below ground, excluding foundations. Confirm the legal boundaries and below-grade plan.",
    },
  ];
}

export function check(c, s, r, local) {
  const ring = s.polygon.slice(0, -1).map(local);
  const edge = s.frontageEdge - 1;
  const measured = c.bands.map((band) => inspect(band.outline, ring, edge));
  const fits = measured.every(Boolean);
  const front = fits ? Math.min(...measured.map((m) => m.front)) : 0,
    other = fits ? Math.min(...measured.map((m) => m.other)) : 0;
  const bandClearances = fits
    ? c.bands.map(
        (band, i) => 2 * (r.roadWidthM + measured[i].fromRoad) - band.topM,
      )
    : [];
  const clearance = fits ? Math.min(...bandClearances) : -c.heightM;
  const tightest = bandClearances.indexOf(clearance);
  const plotOpenM2 = r.plotAreaM2 * r.openRatio,
    osrOpenM2 = (c.grossM2 * r.osrPercent) / 100,
    plateOpenM2 = (r.openRatio * c.grossM2) / c.floors;
  const minOpenM2 = Math.max(plotOpenM2, osrOpenM2, plateOpenM2);
  const minPlantingM2 = 0.5 * Math.max(minOpenM2, c.ground.clearSpaceM2);
  const row = (rule, value, limit, pass, explanation) => ({
    rule,
    measured: fmt(value),
    threshold: limit,
    status: pass ? "Pass" : "Fail",
    explanation,
  });
  const squareMetres = (value) => fmt(value) + " m²";
  const roadWidth = fmt(r.roadWidthM);
  const roadBasis =
    roadWidth +
    " m " +
    (r.roadWidthSource === "City right-of-way width"
      ? "from the selected city road record"
      : "from Brief because the city record did not supply a positive width");
  const openPercent = fmt(r.openRatio * 100) + "%";
  const parkingBasis = c.ground.provisionalParking
    ? "The provisional " +
      s.use.toLowerCase() +
      " target is " +
      squareMetres(c.grossM2) +
      " ÷ " +
      squareMetres(c.ground.parkingAreaPerBayM2) +
      " per bay, rounded up to " +
      c.ground.requiredBays +
      " bays. Confirm the applicable rate."
    : "The study targets one surface parking bay per home. The Brief has " +
      s.homes +
      " homes, so the target is " +
      c.ground.requiredBays +
      " bays.";
  const reviews = [...r.reviews];
  const [frontStart, frontEnd] = [ring[edge], next(ring, edge)];
  const frontageLengthM = Math.hypot(
    frontEnd[0] - frontStart[0],
    frontEnd[1] - frontStart[1],
  );
  if (c.floors > 4 || c.grossM2 >= 2000 - 0.001)
    reviews.push({
      rule: "Height and size classification, perimeter access, fire protection and additional setbacks",
      explanation:
        "The study flags designs above four floors or at least 2,000 m² gross, with a small area rounding tolerance. This option has " +
        c.floors +
        " floors and " +
        squareMetres(c.grossM2) +
        ". Confirm the classification and applicable rules.",
    });
  return [
    ...highRiseAccessChecks(c, r, frontageLengthM),
    row(
      "Requested floor area (m²)",
      c.grossM2,
      "≈ " + fmt(s.grossM2),
      Math.abs(c.grossM2 - s.grossM2) < 0.05,
      "Brief requests " +
        squareMetres(s.grossM2) +
        ". The study adds the plate areas of every floor and passes when the difference is under 0.05 m².",
    ),
    row(
      "Total floor area (m²)",
      c.grossM2,
      "≤ " + fmt(r.maxFloorAreaM2),
      c.grossM2 <= r.maxFloorAreaM2 + 0.001,
      "The city’s zoning data gives a floor area ratio (FAR) of " +
        r.far +
        " for " +
        r.subzone +
        ". The cap is plot area (" +
        squareMetres(r.plotAreaM2) +
        " shown) × " +
        r.far +
        ", or " +
        squareMetres(r.maxFloorAreaM2) +
        " using the unrounded area.",
    ),
    ...(s.homes
      ? [
          row(
            "Requested home area (m²)",
            s.homes * s.unitM2,
            "≤ " + fmt(c.grossM2),
            s.homes * s.unitM2 <= c.grossM2 + 0.001,
            "The Brief calls for " +
              s.homes +
              " homes × " +
              squareMetres(s.unitM2) +
              " each = " +
              squareMetres(s.homes * s.unitM2) +
              ". That must fit within the model’s " +
              squareMetres(c.grossM2) +
              " gross area. Detailed unit layouts still need review.",
          ),
        ]
      : []),
    row(
      "Street setback (m)",
      front,
      "≥ " + r.frontSetbackM,
      fits && front >= r.frontSetbackM,
      "The study uses a road width of " +
        roadBasis +
        ". Its frontage formula is " +
        r.frontSetbackFormula +
        ", giving a minimum setback of " +
        fmt(r.frontSetbackM) +
        " m.",
    ),
    row(
      "Other setbacks (m)",
      other,
      "≥ " + r.otherSetbackM,
      fits && other >= r.otherSetbackM,
      "The study keeps every floor plate at least " +
        r.otherSetbackM +
        " m from the other plot edges. The measured result is the smallest gap across all plates.",
    ),
    row(
      "Height plane clearance (m)",
      clearance,
      "≥ 0 at every level",
      fits && clearance >= 0,
      "At each band’s closest offset from the road-facing edge, the modeled height limit is 2 × (road width + offset). The width is " +
        roadBasis +
        ". " +
        (fits
          ? "At the tightest band, 2 × (" +
            roadWidth +
            " + " +
            fmt(measured[tightest].fromRoad) +
            ") − " +
            fmt(c.bands[tightest].topM) +
            " m leaves " +
            fmt(clearance) +
            " m of clearance using unrounded measurements."
          : "Every plate must lie inside the plot before clearance can be checked."),
    ),
    row(
      "Qualifying uncovered space (m²)",
      c.ground.clearSpaceM2,
      "≥ " + fmt(minOpenM2),
      c.ground.clearSpaceM2 >= minOpenM2,
      "The study takes the largest of three values. For " +
        s.use.toLowerCase() +
        ", " +
        openPercent +
        " of plot area gives " +
        squareMetres(plotOpenM2) +
        ". The city’s " +
        r.osrPercent +
        "% open space ratio (OSR) on the design’s gross area gives " +
        squareMetres(osrOpenM2) +
        ". " +
        openPercent +
        " of average floor area (" +
        squareMetres(c.grossM2) +
        " ÷ " +
        c.floors +
        ") gives " +
        squareMetres(plateOpenM2) +
        ".",
    ),
    row(
      "Permeable planting (m²)",
      c.ground.plantingM2,
      "≥ " + fmt(minPlantingM2),
      c.ground.plantingM2 >= minPlantingM2,
      "The study takes 50% of the larger of the " +
        squareMetres(minOpenM2) +
        " uncovered-space minimum and " +
        squareMetres(c.ground.clearSpaceM2) +
        " uncovered in this design. The planting target is " +
        squareMetres(minPlantingM2) +
        ".",
    ),
    {
      rule: "Pedestrian paving",
      measured: c.ground.pedestrian
        ? "Direct path drawn"
        : "No direct path found",
      threshold: "Connect frontage to the building",
      status: c.ground.pedestrian ? "Pass" : "Needs path design",
      explanation:
        "The study searches for a direct " +
        c.ground.pedestrianWidthM +
        " m strip from the selected road-facing edge to the building, outside the modeled parking and driveway.",
    },
    {
      rule: "Surface parking bays",
      measured: c.ground.parkingBays,
      threshold:
        "≥ " +
        c.ground.requiredBays +
        (c.ground.provisionalParking ? " (study target)" : ""),
      status:
        c.ground.parkingBays < c.ground.requiredBays
          ? "Fail"
          : c.ground.provisionalParking
            ? "Needs use and area verification"
            : "Pass",
      explanation: parkingBasis,
    },
    {
      rule: "Vehicle access and turning",
      measured: c.ground.parkingBays
        ? "6 m aisle with end space"
        : "No aisle placed",
      threshold:
        "Verify turning path and driveway location" +
        (c.ground.requiredBays >= 15 ? " and public-road connection" : ""),
      status: "Needs access review",
      explanation:
        "The model looks for a " +
        c.ground.aisleWidthM +
        " m aisle with " +
        c.ground.turningEndM +
        " m at the end. Confirm actual vehicle paths and the driveway location." +
        (c.ground.requiredBays >= 15
          ? " The study also flags the public-road connection at 15 or more target bays."
          : ""),
    },
    ...reviews.map(({ rule, explanation }) => ({
      rule,
      measured: "Unverified",
      threshold: "Confirm applicable clauses",
      status: "Needs rule review",
      explanation,
    })),
    ...(c.floors >= 4
      ? [
          {
            rule: "Fire stair",
            measured: "Unmeasured",
            threshold: "Check escape provisions for this height",
            status: "Needs stair plan",
            explanation:
              "The study flags designs with four or more floors. This option has " +
              c.floors +
              " floors. Stair layout and escape routes need a plan review.",
          },
        ]
      : []),
  ];
}
export function summarizeChecks(checks) {
  const passed = checks.filter((check) => check.status === "Pass").length;
  const failed = checks.filter((check) => check.status === "Fail").length;
  const review = checks.length - passed - failed;
  if (failed) return { label: "Fails checks", rank: 2, passed, failed, review };
  if (review) return { label: "Needs review", rank: 1, passed, failed, review };
  return { label: "Passes checks", rank: 0, passed, failed, review };
}
