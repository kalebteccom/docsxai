// Annotation sets whose burned tree must stay exactly what it was before the adaptive width,
// `placement` and report features. `fixtures/legacy-burn-trees.json` holds the trees the renderer
// produced for them at that point; burn-legacy.test.ts compares the current output to it.
// Provenance and the rule for touching either file: fixtures/README.md.

import type { AnnotationRecord } from "../../src/annotations.js";

export interface LegacyScenario {
  name: string;
  image: { width: number; height: number };
  annotations: AnnotationRecord[];
}

const COLUMNS = [
  { x: 60, y: 200, width: 330, height: 200 },
  { x: 440, y: 200, width: 300, height: 200 },
];
const TITLE_NEIGHBOURS = [
  { x: 40, y: 96, width: 56, height: 32 },
  { x: 100, y: 70, width: 200, height: 24 },
];

const a = (overrides: Partial<AnnotationRecord>): AnnotationRecord => ({
  step: "s",
  selector: "#x",
  copy: "Click Play to open the recap sidebar",
  bounding_box: { x: 360, y: 280, width: 80, height: 40 },
  ...overrides,
});

export const LEGACY_SCENARIOS: LegacyScenario[] = [
  { name: "single, no obstacles", image: { width: 800, height: 600 }, annotations: [a({})] },
  {
    name: "arrow styles and nudge, no obstacles",
    image: { width: 800, height: 600 },
    annotations: [
      a({ arrow_style: "bottom-left", nudge: { x: 12, y: -6 } }),
      a({
        bounding_box: { x: 20, y: 20, width: 100, height: 30 },
        arrow_style: "right",
        copy: "Second",
        index: 2,
      }),
    ],
  },
  {
    name: "narrow image, no obstacles, stays 280 wide",
    image: { width: 390, height: 844 },
    annotations: [
      a({
        bounding_box: { x: 16, y: 93, width: 46, height: 26 },
        copy: "The board shows every task as a card, grouped by status, so you see what is moving.",
        index: 1,
      }),
      a({
        bounding_box: { x: 16, y: 134, width: 358, height: 33 },
        copy: "Switch between the board, the backlog and the full list.",
        index: 2,
      }),
    ],
  },
  {
    name: "obstacles on a wide image",
    image: { width: 800, height: 600 },
    annotations: [
      a({ bounding_box: { x: 400, y: 300, width: 30, height: 20 }, obstacles: COLUMNS, index: 1 }),
      a({
        bounding_box: { x: 470, y: 120, width: 30, height: 20 },
        copy: "Second",
        index: 2,
        obstacles: [{ x: 0, y: 0, width: 5, height: 5 }],
      }),
    ],
  },
  {
    name: "empty obstacles and capture-only placement keys",
    image: { width: 800, height: 600 },
    annotations: [
      a({ obstacles: [], placement: { obstacle_radius: 100, obstacle_limit: 5 } }),
      a({ bounding_box: { x: 100, y: 100, width: 120, height: 24 }, placement: {}, index: 1 }),
    ],
  },
  {
    name: "badge placement with obstacles",
    image: { width: 800, height: 600 },
    annotations: [
      a({
        bounding_box: { x: 100, y: 100, width: 120, height: 24 },
        copy: "Board title",
        index: 1,
        obstacles: TITLE_NEIGHBOURS,
      }),
    ],
  },
];
