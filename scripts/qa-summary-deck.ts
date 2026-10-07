// Local-only rendering from an existing export input. No writes or generation.
import fs from "node:fs";
import path from "node:path";
import { createContentPlanDeck } from "../server/pptx-export";
import { compatiblePptx } from "../server/pptx-package";
const [input, folder] = process.argv.slice(2);
if (!input || !folder) throw new Error("Usage: qa-summary-deck.ts input.json output-directory");
const args = JSON.parse(fs.readFileSync(input, "utf8"));
const before = JSON.stringify(args);
const savedFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
try {
  const deck = await createContentPlanDeck({ ...args, scope: "summary" });
  const collisions = deck.regions.flatMap((a, i) => deck.regions.slice(i + 1).filter(b =>
    a.slide === b.slide && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > .01 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > .01).map(b => ({ slide: a.slide + 1, a: a.text, b: b.text })));
  if (collisions.length) throw new Error(JSON.stringify(collisions));
  if (JSON.stringify(args) !== before) throw new Error("Input was changed");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "executive-summary-deck.pptx"),
    await compatiblePptx(await deck.pptx.write({ outputType: "nodebuffer" }) as Buffer));
  fs.writeFileSync(path.join(folder, "geometry.json"), JSON.stringify(deck.regions));
  console.log(JSON.stringify({ slides: deck.slides.length, collisions: 0,
    headings: deck.regions.filter(r => r.y === .43).map(r => r.text) }));
} finally { globalThis.fetch = savedFetch; }
