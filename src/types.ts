export type Face = "front" | "back" | "sideLeft" | "sideRight";

export const FACE_LABEL: Record<Face, string> = {
  front: "Avant",
  back: "Arrière",
  sideLeft: "Côté gauche",
  sideRight: "Côté droit",
};

/** Type de manche d'un vêtement — conditionne quel côté générique réutiliser.
 *  "none" : article sans manche/sans côté (ex. pochette) → aucune vue de côté. */
export type SleeveType = "short" | "long" | "sleeveless" | "none";

export interface ColorVariant {
  slug: string;
  label: string;
  hex: string;
  front: string | null;
  back: string | null;
  /** Vue de côté (manche) propre à cette réf+couleur, ou null si absente. */
  sleeve: string | null;
}

export interface RefEntry {
  id: string;
  refInternal: string;
  refSupplier: string;
  category: string;
  label: string;
  /** Type de manche, défaut "short". */
  sleeveType: SleeveType;
  colors: ColorVariant[];
}

/** Une vue de côté existante, indexée pour réutilisation par couleur. */
export interface SideLibraryEntry {
  sleeveType: SleeveType;
  slug: string;
  hex: string;
  url: string;
}

export interface Manifest {
  generatedAt: string;
  refs: RefEntry[];
  colorMeta: Record<string, { label: string; hex: string }>;
  /** Index de tous les côtés existants (réutilisation par type + couleur). */
  sideLibrary: SideLibraryEntry[];
  /** Gabarit de recoloration par type de manche (URL d'un côté neutre). */
  sideTemplates: Partial<Record<SleeveType, string>>;
}

export interface LogoAsset {
  dataUrl: string;
  mime: string;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Vrai si le logo est une silhouette monochrome (fond transparent + 1 couleur)
   *  → recoloration possible directement dans l'app. */
  isMonochrome: boolean;
}

export interface FaceState {
  logo: LogoAsset | null;
  /** Position du centre du logo en % de la largeur/hauteur du mockup. */
  posXPct: number;
  posYPct: number;
  /** Largeur du logo en % de la largeur du mockup. */
  sizePct: number;
  /** Couleur de recoloration choisie (hex) pour un logo monochrome, ou null. */
  logoTint: string | null;
  /** Logo recoloré (dataUrl PNG) dérivé de logo.dataUrl + logoTint, ou null. */
  logoTintedUrl: string | null;
}

/** Les vues de côté affichent un t-shirt de profil (centré, étroit). La bulle
 *  est rognée à cette fraction centrale de la largeur du mockup → bulle étroite
 *  sans blanc latéral, t-shirt à la même hauteur que l'avant/arrière. */
export const SIDE_VISIBLE_FRACTION = 0.5;

/** Position + taille de départ d'un logo sur une face (en % du mockup). */
export interface PlacementDefault {
  posXPct: number;
  posYPct: number;
  sizePct: number;
}

// Position par défaut "usine" de chaque face. Les côtés reçoivent un marquage
// manche : petit logo en zone haute du profil. "Côté gauche" = MIROIR (manche à
// droite du cadre), "Côté droit" = image d'origine (manche à gauche) → positions
// symétriques pour tomber sur la manche visible.
function builtInPlacement(face: Face): PlacementDefault {
  if (face === "sideLeft") return { posXPct: 54, posYPct: 32, sizePct: 12 };
  if (face === "sideRight") return { posXPct: 46, posYPct: 32, sizePct: 12 };
  return {
    posXPct: 50,
    posYPct: face === "front" ? 30 : 28,
    sizePct: face === "front" ? 22 : 45,
  };
}

const DEFAULT_KEY = (face: Face) => `bat-olda:default:${face}`;

/** Position par défaut perso enregistrée par l'utilisateur (localStorage), ou null. */
export function loadDefaultOverride(face: Face): PlacementDefault | null {
  try {
    const raw = localStorage.getItem(DEFAULT_KEY(face));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (
      typeof o?.posXPct === "number" &&
      typeof o?.posYPct === "number" &&
      typeof o?.sizePct === "number"
    ) {
      return { posXPct: o.posXPct, posYPct: o.posYPct, sizePct: o.sizePct };
    }
  } catch {
    /* localStorage indisponible ou JSON corrompu → on ignore */
  }
  return null;
}

export function saveDefaultOverride(face: Face, d: PlacementDefault): void {
  try {
    localStorage.setItem(DEFAULT_KEY(face), JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

export function clearDefaultOverride(face: Face): void {
  try {
    localStorage.removeItem(DEFAULT_KEY(face));
  } catch {
    /* ignore */
  }
}

export function defaultFaceState(face: Face): FaceState {
  const p = loadDefaultOverride(face) ?? builtInPlacement(face);
  return {
    logo: null,
    posXPct: p.posXPct,
    posYPct: p.posYPct,
    sizePct: p.sizePct,
    logoTint: null,
    logoTintedUrl: null,
  };
}
