/**
 * Copies subset woff2 files from frontend/node_modules/@fontsource-variable/*
 * into apps/vizitka/fonts and apps/work-dashboard/fonts.
 * Run from repo root: node scripts/copy-static-app-fonts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const nm = path.join(root, "frontend", "node_modules");

function copy(srcRel, destRel) {
  const from = path.join(nm, srcRel);
  const to = path.join(root, destRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

const inter = "@fontsource-variable/inter/files";
const jb = "@fontsource-variable/jetbrains-mono/files";
const outfit = "@fontsource-variable/outfit/files";
const lora = "@fontsource-variable/lora/files";

// vizitka: Latin + Latin-ext
for (const f of [
  "outfit-latin-wght-normal.woff2",
  "outfit-latin-ext-wght-normal.woff2",
  "jetbrains-mono-latin-wght-normal.woff2",
  "jetbrains-mono-latin-ext-wght-normal.woff2",
]) {
  const pkg = f.startsWith("outfit") ? outfit : jb;
  copy(`${pkg}/${f}`, `apps/vizitka/fonts/${f}`);
}

// work-dashboard: RU + EN coverage
for (const f of [
  "inter-cyrillic-ext-wght-normal.woff2",
  "inter-cyrillic-wght-normal.woff2",
  "inter-latin-ext-wght-normal.woff2",
  "inter-latin-wght-normal.woff2",
]) {
  copy(`${inter}/${f}`, `apps/work-dashboard/fonts/${f}`);
}
for (const f of [
  "jetbrains-mono-cyrillic-ext-wght-normal.woff2",
  "jetbrains-mono-cyrillic-wght-normal.woff2",
  "jetbrains-mono-latin-ext-wght-normal.woff2",
  "jetbrains-mono-latin-wght-normal.woff2",
]) {
  copy(`${jb}/${f}`, `apps/work-dashboard/fonts/${f}`);
}
for (const f of [
  "lora-cyrillic-ext-wght-normal.woff2",
  "lora-cyrillic-wght-normal.woff2",
  "lora-latin-ext-wght-normal.woff2",
  "lora-latin-wght-normal.woff2",
  "lora-cyrillic-ext-wght-italic.woff2",
  "lora-cyrillic-wght-italic.woff2",
  "lora-latin-ext-wght-italic.woff2",
  "lora-latin-wght-italic.woff2",
]) {
  copy(`${lora}/${f}`, `apps/work-dashboard/fonts/${f}`);
}

console.log("Static app fonts copied OK.");
