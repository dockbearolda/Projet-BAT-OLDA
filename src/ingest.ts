import { pdfFirstPageToDataURL } from "./pdfWorker";
import type { LogoAsset } from "./types";

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}

function fileToDataURL(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function fileToText(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsText(file);
  });
}

function loadImageDims(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/**
 * Détecte si un logo est une silhouette monochrome : fond transparent + une
 * seule couleur dominante sur les pixels opaques. Seuls ces logos peuvent être
 * recolorés proprement (tint en préservant l'alpha).
 */
async function analyzeMonochrome(dataUrl: string): Promise<boolean> {
  try {
    const img = await loadImageEl(dataUrl);
    const max = 256;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const total = w * h;
    let transparent = 0;
    let opaque = 0;
    const buckets = new Map<number, number>(); // couleur quantifiée → count
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 32) {
        transparent++;
        continue;
      }
      if (a < 200) continue; // bords anti-aliasés : ignorés pour la couleur
      opaque++;
      const key =
        ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    // Pas de fond transparent → ce n'est pas une silhouette (photo / aplat plein).
    if (transparent / total < 0.02) return false;
    if (opaque < 50) return false;

    let top = 0;
    for (const v of buckets.values()) if (v > top) top = v;
    return top / opaque >= 0.7;
  } catch {
    return false;
  }
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isSvg(file: File): boolean {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
}

/**
 * Normalise un SVG : injecte viewBox si manquant pour que <img> puisse
 * décoder ses dimensions intrinsèques.
 */
function normalizeSvgMarkup(svgText: string): { text: string; width: number; height: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== "svg" || svg.getElementsByTagName("parsererror").length) {
    throw new IngestError("SVG invalide");
  }

  const parseLen = (v: string | null): number | null => {
    if (!v) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const viewBox = svg.getAttribute("viewBox");
  const wAttr = parseLen(svg.getAttribute("width"));
  const hAttr = parseLen(svg.getAttribute("height"));

  let width: number;
  let height: number;

  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      width = wAttr ?? parts[2];
      height = hAttr ?? parts[3];
    } else {
      width = wAttr ?? 1024;
      height = hAttr ?? 1024;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
  } else if (wAttr && hAttr) {
    width = wAttr;
    height = hAttr;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  } else {
    width = 1024;
    height = 1024;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  return { text: new XMLSerializer().serializeToString(svg), width, height };
}

async function svgToDataUrl(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const raw = await fileToText(file);
  const { text, width, height } = normalizeSvgMarkup(raw);
  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  return { dataUrl, width, height };
}

/** Ingère un logo client (PDF / SVG / PNG / JPG) → LogoAsset avec dims décodées. */
export async function ingestLogo(file: File): Promise<LogoAsset> {
  if (file.size > MAX_FILE_SIZE) {
    throw new IngestError("Fichier trop lourd (max 20 Mo)");
  }

  if (isPdf(file)) {
    const dataUrl = await pdfFirstPageToDataURL(file, 2000);
    const dims = await loadImageDims(dataUrl);
    return {
      dataUrl,
      mime: "image/png",
      name: file.name,
      naturalWidth: dims.width,
      naturalHeight: dims.height,
      isMonochrome: await analyzeMonochrome(dataUrl),
    };
  }

  if (isSvg(file)) {
    const { dataUrl, width, height } = await svgToDataUrl(file);
    return {
      dataUrl,
      mime: "image/svg+xml",
      name: file.name,
      naturalWidth: width,
      naturalHeight: height,
      isMonochrome: await analyzeMonochrome(dataUrl),
    };
  }

  if (file.type.startsWith("image/")) {
    const dataUrl = await fileToDataURL(file);
    const dims = await loadImageDims(dataUrl);
    return {
      dataUrl,
      mime: file.type,
      name: file.name,
      naturalWidth: dims.width,
      naturalHeight: dims.height,
      isMonochrome: await analyzeMonochrome(dataUrl),
    };
  }

  throw new IngestError("Format non supporté (PDF, SVG, PNG ou JPG)");
}
