/**
 * Recoloration d'un logo monochrome : on remplace le RGB de chaque pixel par
 * la couleur cible en préservant l'alpha (bords lisses conservés). Le résultat
 * est un PNG dataUrl utilisé tel quel sur le canvas et dans le PDF.
 */

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("logo decode failed"));
    img.src = src;
  });
}

export async function tintLogo(srcDataUrl: string, hex: string): Promise<string> {
  const img = await loadImg(srcDataUrl);
  const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1000;
  const isSvg = srcDataUrl.startsWith("data:image/svg+xml");
  // SVG = vectoriel → on peut rasteriser net à 1000px ; raster = on n'upscale pas.
  const scale = isSvg ? 1000 / longest : Math.min(1, 1000 / longest);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2D indisponible");
  ctx.drawImage(img, 0, 0, w, h);

  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue; // pixel totalement transparent : inchangé
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL("image/png");
}

// Palette de recoloration : sélection nommée d'Atelier OLDA.
export const LOGO_PALETTE: { name: string; hex: string }[] = [
  { name: "Kaki", hex: "#7C7A4E" },
  { name: "Noir", hex: "#1A1A1A" },
  { name: "Jaune", hex: "#FFC400" },
  { name: "Bleu", hex: "#2563EB" },
  { name: "Bleu royal", hex: "#1E3FCF" },
  { name: "Navy", hex: "#1E2A55" },
  { name: "Bleu marine", hex: "#14213D" },
  { name: "Vert pastel", hex: "#A7D8A0" },
  { name: "Vert", hex: "#2E9E4F" },
  { name: "Rouge", hex: "#D32F2F" },
  { name: "Marron", hex: "#5C3A21" },
  { name: "Blanc", hex: "#FFFFFF" },
  { name: "Rose bébé", hex: "#F8C8DC" },
  { name: "Lavande", hex: "#C3B1E1" },
];
