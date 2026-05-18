import oldaLogoUrl from "../assets/olda-logo.svg?url";

let cache: Uint8Array | null = null;

/**
 * Charge le logo OLDA SVG et le rasterise en PNG bytes (carré, fond transparent)
 * pour embed dans pdf-lib. Utilise le ratio natif du viewBox (carré 185×185).
 */
export async function loadOldaLogoPngBytes(sizePx = 256): Promise<Uint8Array> {
  if (cache) return cache;

  const svgText = await fetch(oldaLogoUrl).then((r) => r.text());
  // Le SVG fourni n'a pas de `fill` explicite sur les paths → on force noir.
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

    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2D indisponible");
    ctx.drawImage(img, 0, 0, sizePx, sizePx);

    const pngBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!pngBlob) throw new Error("toBlob PNG failed");
    cache = new Uint8Array(await pngBlob.arrayBuffer());
    return cache;
  } finally {
    URL.revokeObjectURL(url);
  }
}
