export type Face = "front" | "back";

export const FACE_LABEL: Record<Face, string> = {
  front: "Avant",
  back: "Arrière",
};

export interface ColorVariant {
  slug: string;
  label: string;
  hex: string;
  front: string | null;
  back: string | null;
}

export interface RefEntry {
  id: string;
  refInternal: string;
  refSupplier: string;
  category: string;
  label: string;
  colors: ColorVariant[];
}

export interface Manifest {
  generatedAt: string;
  refs: RefEntry[];
  colorMeta: Record<string, { label: string; hex: string }>;
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

export function defaultFaceState(face: Face): FaceState {
  return {
    logo: null,
    posXPct: 50,
    posYPct: face === "front" ? 30 : 28,
    sizePct: face === "front" ? 22 : 45,
    logoTint: null,
    logoTintedUrl: null,
  };
}
