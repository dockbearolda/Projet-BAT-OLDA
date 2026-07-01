/**
 * Rasterise la 1ère page d'un PDF en data-URL PNG (alpha préservé).
 * Utile pour les logos clients livrés en PDF vectoriel.
 *
 * pdfjs-dist (lourd) est importé DYNAMIQUEMENT ici : il n'est chargé que
 * lorsqu'un logo PDF est réellement ingéré, jamais au 1er rendu de l'app.
 */
export async function pdfFirstPageToDataURL(
  file: File | Blob,
  targetWidth = 2000,
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  const { default: pdfWorkerUrl } = await import(
    "pdfjs-dist/build/pdf.worker.min.mjs?url"
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
