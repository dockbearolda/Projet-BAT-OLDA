export type Face = "front" | "back" | "sideLeft" | "sideRight";

export const FACE_LABEL: Record<Face, string> = {
  front: "Avant",
  back: "Arrière",
  sideLeft: "Côté gauche",
  sideRight: "Côté droit",
};

/** Type de manche d'un vêtement — conditionne quel côté générique réutiliser. */
export type SleeveType = "short" | "long" | "sleeveless";

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

export function defaultFaceState(face: Face): FaceState {
  // Les côtés reçoivent un marquage manche : petit logo placé sur la manche
  // (zone haute du profil). La vue droite étant le miroir de la gauche, son
  // logo par défaut est positionné symétriquement.
  if (face === "sideLeft") {
    return { logo: null, posXPct: 46, posYPct: 32, sizePct: 12, logoTint: null, logoTintedUrl: null };
  }
  if (face === "sideRight") {
    return { logo: null, posXPct: 54, posYPct: 32, sizePct: 12, logoTint: null, logoTintedUrl: null };
  }
  return {
    logo: null,
    posXPct: 50,
    posYPct: face === "front" ? 30 : 28,
    sizePct: face === "front" ? 22 : 45,
    logoTint: null,
    logoTintedUrl: null,
  };
}
