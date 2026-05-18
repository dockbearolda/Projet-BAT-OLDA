import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Rasterise la 1ère page d'un PDF en data-URL PNG (alpha préservé).
 * Utile pour les logos clients livrés en PDF vectoriel.
 */
export async function pdfFirstPageToDataURL(
  file: File | Blob,
  targetWidth = 2000,
): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(1, targetWidth / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2D indisponible");
    await page.render({ canvasContext: ctx, viewport, background: "transparent" }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    await pdf.destroy();
  }
}
