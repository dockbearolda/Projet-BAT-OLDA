/**
 * Lit `Mokeup fournisseur uniforme/_manifest.csv` (symliné dans public/mockups)
 * et génère `public/manifest.json`, structuré pour l'app :
 *
 *   {
 *     refs: [
 *       {
 *         id: "H-001_NS300",
 *         refInternal: "H-001",
 *         refSupplier: "NS300",
 *         category: "HOMME",
 *         label: "H-001 NS300",
 *         colors: [
 *           {
 *             slug: "white",
 *             label: "Blanc",
 *             front: "/mockups/HOMME/H-001_NS300/white/H-001_NS300_front.webp",
 *             back:  "/mockups/HOMME/H-001_NS300/white/H-001_NS300_back.webp"
 *           },
 *           ...
 *         ]
 *       }
 *     ],
 *     colorMeta: { white: { label: "Blanc", hex: "#FFFFFF" }, ... }
 *   }
 *
 * Garde uniquement les couleurs ayant **au minimum** une vue front OU back.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSV_PATH = path.join(ROOT, "public", "mockups", "_manifest.csv");
const OUT_PATH = path.join(ROOT, "public", "manifest.json");

// ─── Color slug → libellé FR + hex (palette OLDA usuelle) ────────────
const COLOR_META = {
  white:               { label: "Blanc",              hex: "#FFFFFF" },
  black:               { label: "Noir",               hex: "#1A1A1A" },
  navy:                { label: "Marine",             hex: "#1E2A4A" },
  red:                 { label: "Rouge",              hex: "#C8102E" },
  royal_blue:          { label: "Bleu Roi",           hex: "#1E50A0" },
  sky_blue:            { label: "Bleu Ciel",          hex: "#7EC8E3" },
  oxford_grey:         { label: "Gris Oxford",        hex: "#5A6066" },
  heather_grey:        { label: "Gris Chiné",         hex: "#B3B3B3" },
  light_grey:          { label: "Gris Clair",         hex: "#D6D6D6" },
  dark_grey:           { label: "Gris Foncé",         hex: "#4A4A4A" },
  bottle_green:        { label: "Vert Bouteille",     hex: "#0F5132" },
  kelly_green:         { label: "Vert Kelly",         hex: "#4CAF50" },
  forest_green:        { label: "Vert Forêt",         hex: "#228B22" },
  sage:                { label: "Sauge",              hex: "#9CAF88" },
  amazon_green:        { label: "Vert Amazone",       hex: "#3D7B49" },
  amazon_green_heather:{ label: "Vert Amazone Chiné", hex: "#5B8C6E" },
  almond_green:        { label: "Vert Amande",        hex: "#A4B584" },
  burgundy:            { label: "Bordeaux",           hex: "#6E0F2E" },
  fuchsia:             { label: "Fuchsia",            hex: "#C4377E" },
  pink:                { label: "Rose",               hex: "#F28BAA" },
  pale_pink:           { label: "Rose Pâle",          hex: "#F5C6CB" },
  orange:              { label: "Orange",             hex: "#E8581C" },
  yellow:              { label: "Jaune",              hex: "#FFCD00" },
  sand:                { label: "Sable",              hex: "#E0CDA9" },
  light_sand:          { label: "Sable Clair",        hex: "#EEDFC4" },
  beige_cream:         { label: "Crème",              hex: "#F2E6CE" },
  butternut:           { label: "Butternut",          hex: "#C68E3E" },
  terracotta_red:      { label: "Terracotta",         hex: "#B2533A" },
  brown:               { label: "Marron",             hex: "#5C3A21" },
  chocolate:           { label: "Chocolat",           hex: "#3E2723" },
  purple:              { label: "Violet",             hex: "#6A1B9A" },
  apricot:             { label: "Abricot",            hex: "#FBCEB1" },
  aquamarine:          { label: "Aigue-marine",       hex: "#7FCDCD" },
  adriatic_blue:       { label: "Bleu Adriatique",    hex: "#1F6FA0" },
  blue_sapphire:       { label: "Bleu Saphir",        hex: "#0F52BA" },
};

function humanizeSlug(slug) {
  return slug
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function parseCsvLine(line) {
  // Le manifest n'a pas de virgules dans les champs (slugs simples) → split direct.
  return line.split(",");
}

async function main() {
  const csv = await fs.readFile(CSV_PATH, "utf8");
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

  // refId → { meta, colors: Map<slug, { front?, back? }> }
  const refMap = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const category = cols[idx.category];
    const refInternal = cols[idx.ref_internal];
    const refSupplier = cols[idx.ref_supplier];
    const refLabel = cols[idx.ref_label];
    const color = cols[idx.color];
    const view = cols[idx.view];
    const dst = cols[idx.dst];
    if (!refLabel || !color || !view || !dst) continue;

    const refId = refLabel; // ex. "H-001_NS300"
    if (!refMap.has(refId)) {
      refMap.set(refId, {
        id: refId,
        refInternal,
        refSupplier,
        category,
        label: `${refInternal} ${refSupplier}`,
        colors: new Map(),
      });
    }
    const ref = refMap.get(refId);
    if (!ref.colors.has(color)) ref.colors.set(color, {});
    ref.colors.get(color)[view] = `/mockups/${dst}`;
  }

  // Sérialiser : on garde uniquement les couleurs avec ≥1 vue.
  const refs = [...refMap.values()]
    .map((r) => ({
      ...r,
      colors: [...r.colors.entries()]
        .map(([slug, views]) => ({
          slug,
          label: COLOR_META[slug]?.label ?? humanizeSlug(slug),
          hex: COLOR_META[slug]?.hex ?? "#999999",
          front: views.front ?? null,
          back: views.back ?? null,
        }))
        .filter((c) => c.front || c.back)
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    }))
    .filter((r) => r.colors.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  const colorMeta = Object.fromEntries(
    Object.entries(COLOR_META).map(([slug, meta]) => [slug, meta]),
  );

  const out = { generatedAt: new Date().toISOString(), refs, colorMeta };
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), "utf8");

  const colorCount = refs.reduce((acc, r) => acc + r.colors.length, 0);
  console.log(
    `✓ manifest.json — ${refs.length} référence(s), ${colorCount} variantes couleur, écrit dans ${path.relative(ROOT, OUT_PATH)}`,
  );
}

main().catch((err) => {
  console.error("manifest build failed:", err);
  process.exit(1);
});
