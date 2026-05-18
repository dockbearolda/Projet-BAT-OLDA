import type { FaceState } from "./types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${src}`));
    img.src = src;
  });
}

/**
 * Compose le mockup + le logo (position/taille en %) en un PNG haute déf
 * destiné à être embarqué dans le PDF final.
 */
export async function composeFacePng(
  mockupUrl: string,
  face: FaceState,
  targetWidth = 2000,
): Promise<Blob> {
  const mock = await loadImage(mockupUrl);
  const c = document.createElement("canvas");
  c.width = targetWidth;
  c.height = Math.round(targetWidth * (mock.naturalHeight / mock.naturalWidth));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas 2D indisponible");
  ctx.drawImage(mock, 0, 0, c.width, c.height);

  if (face.logo) {
    const logo = await loadImage(face.logo.dataUrl);
    const lw = (face.sizePct / 100) * c.width;
    const lh = lw * (logo.naturalHeight / logo.naturalWidth);
    const cx = (face.posXPct / 100) * c.width;
    const cy = (face.posYPct / 100) * c.height;
    ctx.drawImage(logo, cx - lw / 2, cy - lh / 2, lw, lh);
  }

  return new Promise<Blob>((resolve, reject) => {
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
      0.95,
    );
  });
}
