/**
 * Résolution de la vue de côté (manche) d'un t-shirt.
 *
 * Les t-shirts sont des mockups image fixes : on ne peut afficher un côté que
 * s'il existe. Mais les côtés sont génériques par type de manche (tous les
 * côtés manche courte se ressemblent, idem manche longue). On réutilise donc,
 * par ordre de fidélité décroissante :
 *
 *   1. "own"        — le côté propre à la réf+couleur (fidélité parfaite) ;
 *   2. "borrowed"   — un côté existant du MÊME type de manche et de couleur
 *                     identique (même slug, ou hex quasi identique) → photo
 *                     réelle, couleur juste ;
 *   3. "recolor"    — un gabarit neutre du bon type, recoloré à la couleur
 *                     EXACTE du t-shirt → couleur toujours juste ;
 *   4. "unavailable"— aucun gabarit pour ce type (ex. manche longue sans
 *                     aucune image) → vue de côté impossible.
 *
 * Fonction pure (aucune dépendance DOM) → testable directement.
 */
import type { ColorVariant, RefEntry, SideLibraryEntry, SleeveType } from "./types";

export type SideResolution =
  | { kind: "own"; url: string }
  | { kind: "borrowed"; url: string; slug: string }
  | { kind: "recolor"; templateUrl: string; hex: string }
  | { kind: "unavailable" };

/** Δhex max (distance RGB euclidienne) pour réutiliser une photo réelle plutôt
 *  que recolorer. Très serré : on n'emprunte que des couleurs visuellement
 *  identiques ; tout le reste est recoloré à la couleur exacte. */
const BORROW_MAX_DELTA = 6;

/** Δhex max pour faire confiance à un match par SLUG (même nom de couleur de
 *  marque, mais hex échantillonné légèrement différent selon la réf/lumière).
 *  Garde-fou contre une éventuelle collision de slug entre gammes fournisseur
 *  (ex. un « blue » réellement différent) : au-delà, on retombe sur le hex. */
const SLUG_MAX_DELTA = 45;

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexDistance(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return Infinity;
  return Math.sqrt(
    (ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2,
  );
}

export function resolveSide(
  ref: Pick<RefEntry, "sleeveType">,
  color: Pick<ColorVariant, "slug" | "hex" | "sleeve">,
  sideLibrary: SideLibraryEntry[],
  sideTemplates: Partial<Record<SleeveType, string>>,
): SideResolution {
  // 1. Côté propre.
  if (color.sleeve) return { kind: "own", url: color.sleeve };

  // Candidats du même type de manche uniquement.
  const sameType = sideLibrary.filter((e) => e.sleeveType === ref.sleeveType);

  // 2a. Même slug couleur → même teinte de marque, photo réelle. On exige
  // tout de même un hex pas aberrant (garde-fou collision de slug).
  const sameSlug = sameType.find((e) => e.slug === color.slug);
  if (sameSlug && hexDistance(color.hex, sameSlug.hex) <= SLUG_MAX_DELTA) {
    return { kind: "borrowed", url: sameSlug.url, slug: sameSlug.slug };
  }

  // 2b. Hex quasi identique (bruit d'échantillonnage / slugs différents).
  let best: { entry: SideLibraryEntry; d: number } | null = null;
  for (const e of sameType) {
    const d = hexDistance(color.hex, e.hex);
    if (!best || d < best.d) best = { entry: e, d };
  }
  if (best && best.d <= BORROW_MAX_DELTA) {
    return { kind: "borrowed", url: best.entry.url, slug: best.entry.slug };
  }

  // 3. Recoloration d'un gabarit du bon type à la couleur exacte.
  const template = sideTemplates[ref.sleeveType];
  if (template) return { kind: "recolor", templateUrl: template, hex: color.hex };

  // 4. Aucun gabarit pour ce type → indisponible.
  return { kind: "unavailable" };
}
