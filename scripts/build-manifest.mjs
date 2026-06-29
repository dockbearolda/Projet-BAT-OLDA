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
import sharp from "sharp";

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
  ivory:               { label: "Ivoire",             hex: "#F5F0E6" },
  petal_rose:          { label: "Rose Pétale",        hex: "#E8C4C9" },
  // ─── Pochette KI3210 — gamme "Washed" (hex affinés par échantillonnage) ──
  washed_natural:      { label: "Naturel Délavé",     hex: "#E5DCC5" },
  washed_pearl_blue:   { label: "Bleu Perle Délavé",  hex: "#B8C9CE" },
  washed_dream_blue:   { label: "Bleu Rêve Délavé",   hex: "#A9C0D0" },
  washed_lichen_green: { label: "Vert Lichen Délavé", hex: "#9CA98C" },
  washed_misty_green:  { label: "Vert Brume Délavé",  hex: "#AEC0B2" },
  washed_sierra:       { label: "Sierra Délavé",      hex: "#B98C76" },
  washed_tawny_orange: { label: "Orange Fauve Délavé",hex: "#C98B5E" },
  washed_lit_peach:    { label: "Pêche Délavé",       hex: "#E8C3A8" },
  washed_parma_pink:   { label: "Rose Parme Délavé",  hex: "#D8B8C4" },
  washed_lit_purple:   { label: "Violet Délavé",      hex: "#9E8FB0" },
};

// ─── Type de manche par référence ───────────────────────────────────────
// Déterminé visuellement (cf. planche-contact des faces). Toute réf absente
// de cette table est traitée comme manche courte ("short"), le cas dominant.
// Sert à n'emprunter/recolorer un côté qu'entre vêtements du même type.
const SLEEVE_TYPE = {
  "H-008_NS336": "long",
  "H-009_CGTU05TC": "long",
  "L-001_LYCRA-PARAGON": "long",
  "B-002_K837": "long",
  "H-010_CGTM072": "sleeveless",
  "H-011_K3022IC": "sleeveless",
  "F-001_NS342": "sleeveless",
  // Pochette : pas de manche ni de côté → "none" (aucun gabarit) → vue côté
  // indisponible, on n'emprunte jamais un côté de t-shirt.
  "P-001_KI3210": "none",
};
function sleeveTypeOf(refId) {
  return SLEEVE_TYPE[refId] ?? "short";
}

function lumOfHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

// ─── Échantillonnage couleur réelle ─────────────────────────────────────
// On lit la médiane d'une petite zone centrale (poitrine) du mockup → la
// couleur exacte du vêtement, robuste aux ombres/plis. Mockups 1500×1500,
// vêtement centré, fond blanc → la zone centrale est toujours du tissu.
async function sampleHex(publicUrl) {
  try {
    const fsPath = path.join(ROOT, "public", publicUrl); // publicUrl = "/mockups/…"
    const meta = await sharp(fsPath).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) return null;
    const bw = Math.max(1, Math.round(W * 0.2));
    const bh = Math.max(1, Math.round(H * 0.16));
    const left = Math.round(W * 0.5 - bw / 2);
    const top = Math.round(H * 0.5 - bh / 2);
    const { data, info } = await sharp(fsPath)
      .extract({ left, top, width: bw, height: bh })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const n = info.width * info.height;
    const rs = new Array(n);
    const gs = new Array(n);
    const bs = new Array(n);
    for (let i = 0; i < n; i++) {
      rs[i] = data[i * ch];
      gs[i] = data[i * ch + 1];
      bs[i] = data[i * ch + 2];
    }
    const med = (a) => {
      a.sort((x, y) => x - y);
      return a[Math.floor(a.length / 2)];
    };
    const hx = (v) => v.toString(16).padStart(2, "0");
    return `#${hx(med(rs))}${hx(med(gs))}${hx(med(bs))}`.toUpperCase();
  } catch {
    return null;
  }
}

/** map asynchrone avec concurrence bornée (évite d'ouvrir 400 décodeurs d'un coup). */
async function mapLimit(items, limit, fn) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

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

// ─── Ordre d'affichage des catégories : Homme → Femme → Enfant → Bébé → Pochette ──
const CATEGORY_ORDER = ["HOMME", "FEMME", "ENFANT", "BEBE", "POCHETTE", "AUTRE"];
function categoryRank(category) {
  const i = CATEGORY_ORDER.indexOf((category ?? "").toUpperCase());
  return i === -1 ? CATEGORY_ORDER.length : i; // catégories inconnues en dernier
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
        // Réf sans code interne (ex. NS309 en attente d'attribution) → on
        // n'affiche que le code fournisseur, sans espace en tête.
        label: [refInternal, refSupplier].filter(Boolean).join(" "),
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
      sleeveType: sleeveTypeOf(r.id),
      colors: [...r.colors.entries()]
        .map(([slug, views]) => ({
          slug,
          label: COLOR_META[slug]?.label ?? humanizeSlug(slug),
          hex: null, // rempli par échantillonnage ci-dessous
          front: views.front ?? null,
          back: views.back ?? null,
          sleeve: views.sleeve ?? null,
        }))
        .filter((c) => c.front || c.back)
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    }))
    .filter((r) => r.colors.length > 0)
    .sort(
      (a, b) =>
        categoryRank(a.category) - categoryRank(b.category) ||
        a.id.localeCompare(b.id),
    );

  // Couleur EXACTE de chaque variante : échantillonnée sur son propre mockup.
  // Fallback sur la palette OLDA, puis gris neutre si l'image est illisible.
  const allColors = refs.flatMap((r) => r.colors);
  let sampled = 0;
  await mapLimit(allColors, 16, async (c) => {
    const hex = await sampleHex(c.front || c.back);
    if (hex) sampled++;
    c.hex = hex ?? COLOR_META[c.slug]?.hex ?? "#999999";
  });

  const colorMeta = Object.fromEntries(
    Object.entries(COLOR_META).map(([slug, meta]) => [slug, meta]),
  );

  // ─── Bibliothèque des vues de côté ────────────────────────────────────
  // Index de tous les côtés existants (un par couleur), pour réutiliser un
  // côté générique du bon type de manche + couleur la plus proche quand un
  // vêtement n'a pas son propre côté. La couleur du côté == celle de la
  // variante (même vêtement), donc on réutilise le hex déjà échantillonné.
  const sideLibrary = [];
  for (const r of refs) {
    for (const c of r.colors) {
      if (c.sleeve) {
        sideLibrary.push({
          sleeveType: r.sleeveType,
          slug: c.slug,
          hex: c.hex,
          url: c.sleeve,
        });
      }
    }
  }

  // Gabarit de recoloration par type de manche. La recolo réutilise la
  // SILHOUETTE du gabarit, donc on le prend dans la référence la plus
  // représentative du type (celle qui a le plus de côtés), puis on choisit la
  // couleur dont la luminance est la plus proche du gris moyen (~0.5) →
  // meilleure source pour un dégradé (noir → couleur → blanc) qui préserve les
  // ombres. Absent pour un type sans aucun côté (ex. manche longue) → la vue
  // côté sera indisponible pour ces modèles.
  const countByRefType = new Map(); // `${refId}|${type}` → nb côtés
  const refOfEntry = new Map();     // url → refId (pour regrouper)
  for (const r of refs) {
    for (const c of r.colors) {
      if (c.sleeve) {
        const k = `${r.id}|${r.sleeveType}`;
        countByRefType.set(k, (countByRefType.get(k) ?? 0) + 1);
        refOfEntry.set(c.sleeve, r.id);
      }
    }
  }
  const bestRefForType = {}; // type → refId le plus fourni
  for (const [k, n] of countByRefType) {
    const [refId, type] = k.split("|");
    const cur = bestRefForType[type];
    if (!cur || n > cur.n) bestRefForType[type] = { refId, n };
  }
  const sideTemplates = {};
  for (const entry of sideLibrary) {
    const lum = lumOfHex(entry.hex);
    if (lum == null) continue;
    const preferredRef = bestRefForType[entry.sleeveType]?.refId;
    const fromPreferred = refOfEntry.get(entry.url) === preferredRef;
    const score = Math.abs(lum - 0.5);
    const cur = sideTemplates[entry.sleeveType];
    // On privilégie un côté de la réf de référence ; à préférence égale, la
    // luminance la plus centrale.
    const better =
      !cur ||
      (fromPreferred && !cur.fromPreferred) ||
      (fromPreferred === cur.fromPreferred && score < cur.score);
    if (better) {
      sideTemplates[entry.sleeveType] = { url: entry.url, score, fromPreferred };
    }
  }
  const sideTemplatesOut = Object.fromEntries(
    Object.entries(sideTemplates).map(([t, v]) => [t, v.url]),
  );

  const out = {
    generatedAt: new Date().toISOString(),
    refs,
    colorMeta,
    sideLibrary,
    sideTemplates: sideTemplatesOut,
  };
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), "utf8");

  const colorCount = refs.reduce((acc, r) => acc + r.colors.length, 0);
  const sleeveCount = refs.reduce(
    (acc, r) => acc + r.colors.filter((c) => c.sleeve).length,
    0,
  );
  console.log(
    `✓ manifest.json — ${refs.length} référence(s), ${colorCount} variantes couleur ` +
      `(${sampled} couleurs échantillonnées sur mockup), ${sleeveCount} côté(s), ` +
      `gabarits côté: [${Object.keys(sideTemplatesOut).join(", ") || "aucun"}], ` +
      `écrit dans ${path.relative(ROOT, OUT_PATH)}`,
  );
}

main().catch((err) => {
  console.error("manifest build failed:", err);
  process.exit(1);
});
