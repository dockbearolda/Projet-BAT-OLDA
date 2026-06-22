import oldaLogoUrl from "../assets/olda-logo.svg?url";

export interface RasterizedLogo {
  bytes: Uint8Array;
  width: number;
  height: number;
}

let cache: RasterizedLogo | null = null;

/** Lit le ratio largeur/hauteur du viewBox du SVG (fallback 1 si absent). */
function aspectFromViewBox(svgText: string): number {
  const m = svgText.match(/viewBox\s*=\s*["']\s*[\d.+-]+\s+[\d.+-]+\s+([\d.+-]+)\s+([\d.+-]+)/);
  if (!m) return 1;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return w > 0 && h > 0 ? w / h : 1;
}

/**
 * Charge le logo OLDA SVG et le rasterise en PNG bytes (fond transparent)
 * pour embed dans pdf-lib. Préserve le ratio natif du viewBox — le grand
 * côté fait `maxPx`, l'autre est calculé d'après l'aspect.
 */
export async function loadOldaLogo(maxPx = 256): Promise<RasterizedLogo> {
  if (cache) return cache;

  const svgText = await fetch(oldaLogoUrl).then((r) => r.text());
  // Le SVG est en `currentColor` → on force l'encre OLDA pour le rendu PDF.
  const svgWithFill = svgText.replace(
    /<svg([^>]*)>/,
    '<svg$1><style>path { fill: #1A1A1A; }</style>',
  );
  const blob = new Blob([svgWithFill], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("svg → image failed"));
      i.src = url;
    });

    const aspect = aspectFromViewBox(svgText);
    const w = aspect >= 1 ? maxPx : Math.round(maxPx * aspect);
    const h = aspect >= 1 ? Math.round(maxPx / aspect) : maxPx;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2D indisponible");
    ctx.drawImage(img, 0, 0, w, h);

    const pngBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!pngBlob) throw new Error("toBlob PNG failed");
    cache = { bytes: new Uint8Array(await pngBlob.arrayBuffer()), width: w, height: h };
    return cache;
  } finally {
    URL.revokeObjectURL(url);
  }
}
