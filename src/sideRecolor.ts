/**
 * Recoloration d'un gabarit de côté à une couleur EXACTE.
 *
 * On part d'un côté neutre (photo studio, fond blanc) et on applique un
 * « gradient map » basé sur la luminance : ombres → couleur foncée, teinte
 * médiane du vêtement → couleur cible EXACTE, hautes lumières → blanc. Le
 * fond blanc (luminance ≈ 1) reste blanc. La teinte dominante du vêtement
 * tombe pile sur le hex demandé → la couleur est juste, les plis/ombres sont
 * préservés. Sert uniquement aux couleurs rares sans côté réel disponible.
 */

// Cache borné (LRU simple) : les dataURL recolorés sont lourds, on plafonne.
const CACHE_MAX = 24;
const cache = new Map<string, string>();

function cacheSet(key: string, url: string): void {
  cache.set(key, url);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("side template decode failed"));
    img.src = src;
  });
}

function lum(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export async function recolorSide(templateUrl: string, hex: string): Promise<string> {
  const key = `${templateUrl}|${hex.toUpperCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`hex invalide: ${hex}`);
  const n = parseInt(m[1], 16);
  const tr = (n >> 16) & 255;
  const tg = (n >> 8) & 255;
  const tb = n & 255;

  const img = await loadImg(templateUrl);
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2D indisponible");
  ctx.drawImage(img, 0, 0, w, h);

  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;

  // 1) Luminance médiane du VÊTEMENT (on ignore le fond quasi blanc).
  const garment: number[] = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const L = lum(d[i], d[i + 1], d[i + 2]);
    if (L < 0.92) garment.push(L);
  }
  garment.sort((a, b) => a - b);
  const lmed = garment.length
    ? clamp01Range(garment[Math.floor(garment.length / 2)], 0.12, 0.88)
    : 0.5;

  // 2) Gradient map : [0..lmed] → [ombre, cible], [lmed..1] → [cible, blanc].
  const sr = tr * 0.22;
  const sg = tg * 0.22;
  const sb = tb * 0.22;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const L = lum(d[i], d[i + 1], d[i + 2]);
    if (L <= lmed) {
      const t = clamp01(L / lmed);
      d[i] = sr + (tr - sr) * t;
      d[i + 1] = sg + (tg - sg) * t;
      d[i + 2] = sb + (tb - sb) * t;
    } else {
      const t = clamp01((L - lmed) / (1 - lmed));
      d[i] = tr + (255 - tr) * t;
      d[i + 1] = tg + (255 - tg) * t;
      d[i + 2] = tb + (255 - tb) * t;
    }
  }
  ctx.putImageData(id, 0, 0);
  const url = c.toDataURL("image/png");
  cacheSet(key, url);
  return url;
}

function clamp01Range(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
