import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { embedAppFonts } from "./fonts";
import { loadOldaLogo } from "./rasterizeSvg";

export interface BatPdfView {
  label: string;        // "AVANT" | "ARRIÈRE" | "CÔTÉ GAUCHE"…
  composedPng: Blob;    // mockup + logo déjà composés (cf compose.ts)
  /** Si défini, rogne l'image au centre à cette fraction de largeur (profils
   *  étroits) → cadre plus fin, t-shirt à la même hauteur que l'avant/arrière. */
  cropXFraction?: number;
}

export interface BatPdfInput {
  clientName: string;
  date: Date;
  refLabel: string;     // ex. "H-001 NS300"
  colorLabel: string;   // ex. "Marine"
  views: BatPdfView[];  // [avant, arrière, côté gauche, côté droit]
}

// ─── A4 paysage : 2 visuels côte à côte, grands ─────────────────────────
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 32;

const HEADER_H = 56;
const CLIENT_H = 50;
const GAP = 14;
const VISUALS_BOTTOM = MARGIN; // les visuels descendent jusqu'à la marge basse

// ─── Palette Atelier OLDA ───────────────────────────────────────────────
const TEXT       = rgb(0.102, 0.102, 0.102);
const WHITE      = rgb(1, 1, 1);
const GRAY_LIGHT = rgb(0.957, 0.957, 0.957);
const FRAME_BG   = rgb(0.980, 0.980, 0.980);
const BORDER     = rgb(0.878, 0.878, 0.878);
const MUTED      = rgb(0.541, 0.541, 0.541);

interface Ctx {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
}

interface DrawTextOpts {
  x: number;
  y: number;
  size: number;
  bold?: boolean;
  color?: ReturnType<typeof rgb>;
  maxWidth?: number;
  tracking?: number;
}

function drawText(ctx: Ctx, text: string, opts: DrawTextOpts): void {
  const f = opts.bold ? ctx.fontBold : ctx.font;
  let str = text;
  if (opts.maxWidth) {
    while (str.length > 0 && f.widthOfTextAtSize(str, opts.size) > opts.maxWidth) {
      str = str.slice(0, -1);
    }
    if (str.length < text.length) str = `${str.slice(0, -1)}…`;
  }
  ctx.page.drawText(str, {
    x: opts.x,
    y: opts.y,
    size: opts.size,
    font: f,
    color: opts.color ?? TEXT,
    ...(opts.tracking ? { characterSpacing: opts.tracking } : {}),
  });
}

function widthOf(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

function formatDateFr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function dashOr(value: string | undefined | null): string {
  if (!value || !String(value).trim()) return "—";
  return String(value).trim();
}

/** Optimise un PNG composé en JPEG (≤1600 px, q=0.85) — léger pour WhatsApp.
 *  `cropXFraction` rogne au centre à cette fraction de largeur (vues de côté :
 *  on retire le blanc latéral pour une image étroite). */
async function optimizeMockupImage(
  png: Blob,
  maxDim = 1600,
  quality = 0.85,
  cropXFraction?: number,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(png);
  const cropW =
    cropXFraction && cropXFraction > 0 && cropXFraction < 1
      ? Math.round(bitmap.width * cropXFraction)
      : bitmap.width;
  const cropX = Math.round((bitmap.width - cropW) / 2);
  const cropH = bitmap.height;
  const scale = Math.min(1, maxDim / Math.max(cropW, cropH));
  const w = Math.round(cropW * scale);
  const h = Math.round(cropH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D indisponible");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, cropX, 0, cropW, cropH, 0, 0, w, h);
  bitmap.close?.();
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("Échec conversion JPEG");
  return new Uint8Array(await blob.arrayBuffer());
}

// ─── HEADER : logo OLDA + brand + BON À TIRER + date ────────────────────
function drawHeader(ctx: Ctx, input: BatPdfInput, logoImg: PDFImage): void {
  const top = PAGE_H - MARGIN;
  const bottom = top - HEADER_H;

  const logoBox = 46;
  const logoScale = logoBox / Math.max(logoImg.width, logoImg.height);
  const lw = logoImg.width * logoScale;
  const lh = logoImg.height * logoScale;
  ctx.page.drawImage(logoImg, {
    x: MARGIN + (logoBox - lw) / 2,
    y: top - logoBox + (logoBox - lh) / 2,
    width: lw,
    height: lh,
  });

  drawText(ctx, "Atelier OLDA", {
    x: MARGIN + logoBox + 12,
    y: top - 16,
    size: 14,
    bold: true,
    color: TEXT,
    tracking: 1.2,
  });
  drawText(ctx, "IMPRESSION TEXTILE PROFESSIONNELLE", {
    x: MARGIN + logoBox + 12,
    y: top - 30,
    size: 7,
    bold: true,
    color: MUTED,
    tracking: 1.6,
  });

  const rightX = PAGE_W - MARGIN;
  const lab = "BON À TIRER";
  const labW = widthOf(ctx.fontBold, lab, 7);
  drawText(ctx, lab, {
    x: rightX - labW,
    y: top - 11,
    size: 7,
    bold: true,
    color: MUTED,
    tracking: 1.6,
  });
  const dateStr = formatDateFr(input.date);
  const dateSize = 14;
  const dateW = widthOf(ctx.fontBold, dateStr, dateSize);
  drawText(ctx, dateStr, {
    x: rightX - dateW,
    y: top - 29,
    size: dateSize,
    bold: true,
    color: TEXT,
  });

  ctx.page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: PAGE_W - MARGIN * 2,
    height: 1.2,
    color: TEXT,
  });
}

// ─── CLIENT : nom + référence + couleur ─────────────────────────────────
function drawClientBlock(ctx: Ctx, input: BatPdfInput, topY: number): void {
  const bottom = topY - CLIENT_H;
  const fullW = PAGE_W - MARGIN * 2;

  ctx.page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: fullW,
    height: CLIENT_H,
    color: GRAY_LIGHT,
  });

  const padX = 18;
  const colW = fullW / 3;
  const cols = [
    { label: "CLIENT", value: input.clientName },
    { label: "RÉFÉRENCE", value: input.refLabel },
    { label: "COLORIS", value: input.colorLabel },
  ];

  cols.forEach((c, i) => {
    const x = MARGIN + i * colW + padX;
    drawText(ctx, c.label, {
      x,
      y: topY - 15,
      size: 7,
      bold: true,
      color: MUTED,
      tracking: 1.6,
    });
    drawText(ctx, dashOr(c.value), {
      x,
      y: topY - 35,
      size: 15,
      bold: true,
      color: TEXT,
      maxWidth: colW - padX * 2,
    });
  });
}

// ─── VISUELS : N vues côte à côte, t-shirts à la MÊME hauteur ────────────
interface OptimizedView {
  view: BatPdfView;
  img: PDFImage;
}

function drawVisuals(ctx: Ctx, views: OptimizedView[], topY: number, bottomY: number): void {
  if (views.length === 0) return;
  const fullW = PAGE_W - MARGIN * 2;
  const frameTop = topY;
  const frameBottom = bottomY;
  const frameH = frameTop - frameBottom;
  const colGap = 16;
  const innerPad = 14;

  // Chaque image (déjà rognée à l'embarquement pour les profils) est rendue à
  // la MÊME hauteur → t-shirts à hauteur identique. La largeur d'un cadre suit
  // l'aspect de son image : les vues de côté (rognées étroites) sont plus
  // fines. On dimensionne la hauteur commune pour que l'ensemble tienne en
  // largeur, puis on centre le groupe.
  const aspects = views.map(({ img }) => img.width / img.height);
  const sumAspect = aspects.reduce((a, b) => a + b, 0);
  const gaps = colGap * (views.length - 1);
  const padW = views.length * innerPad * 2;
  const imgHByWidth = (fullW - gaps - padW) / sumAspect;
  const imgH = Math.min(frameH - innerPad * 2, imgHByWidth);

  const frameWidths = aspects.map((a) => imgH * a + innerPad * 2);
  const totalW = frameWidths.reduce((a, b) => a + b, 0) + gaps;
  let cursorX = MARGIN + (fullW - totalW) / 2; // centré horizontalement

  // Bloc centré verticalement dans la zone disponible.
  const frameInnerH = imgH + innerPad * 2;
  const blockTop = frameTop - Math.max(0, (frameH - frameInnerH) / 2);

  views.forEach(({ view, img }, idx) => {
    const fw = frameWidths[idx];
    const slotX = cursorX;
    const slotBottom = blockTop - frameInnerH;

    // Cadre (hauteur identique pour tous)
    ctx.page.drawRectangle({
      x: slotX,
      y: slotBottom,
      width: fw,
      height: frameInnerH,
      color: FRAME_BG,
      borderColor: BORDER,
      borderWidth: 0.5,
    });

    // Image centrée, hauteur = imgH pour toutes les vues
    const w = imgH * (img.width / img.height);
    const imgX = slotX + (fw - w) / 2;
    const imgY = slotBottom + innerPad;
    ctx.page.drawImage(img, { x: imgX, y: imgY, width: w, height: imgH });

    // Tag noir en haut-gauche
    const tagText = view.label.toUpperCase();
    const tagSize = 7;
    const tagTextW = widthOf(ctx.fontBold, tagText, tagSize);
    const tagW = tagTextW + 16;
    const tagH = 16;
    const tagX = slotX + 10;
    const tagY = blockTop - tagH - 10;
    ctx.page.drawRectangle({ x: tagX, y: tagY, width: tagW, height: tagH, color: TEXT });
    drawText(ctx, tagText, {
      x: tagX + 8,
      y: tagY + 5,
      size: tagSize,
      bold: true,
      color: WHITE,
      tracking: 1.5,
    });

    cursorX += fw + colGap;
  });
}

// ─── Filename ───────────────────────────────────────────────────────────
export function formatBatFilename(input: BatPdfInput): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = input.date;
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const safe = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const parts = [
    "BAT",
    safe(input.clientName) || "client",
    safe(input.refLabel) || "ref",
    safe(input.colorLabel) || "color",
    stamp,
  ];
  return `${parts.join("_")}.pdf`;
}

// ─── Entrée publique ────────────────────────────────────────────────────
export async function buildBatPdf(input: BatPdfInput): Promise<Blob> {
  if (input.views.length === 0) {
    throw new Error("Aucune vue à exporter");
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(`BAT ${input.refLabel} · ${input.clientName}`);
  pdf.setAuthor("Atelier OLDA");
  pdf.setSubject(`Bon À Tirer — ${input.refLabel} · ${input.colorLabel}`);
  pdf.setCreationDate(input.date);

  const { font, fontBold } = await embedAppFonts(pdf);

  const [logo, optimized] = await Promise.all([
    loadOldaLogo(),
    Promise.all(
      input.views.map(async (v) => {
        const bytes = await optimizeMockupImage(v.composedPng, 1600, 0.85, v.cropXFraction);
        return { view: v, img: await pdf.embedJpg(bytes) } satisfies OptimizedView;
      }),
    ),
  ]);
  const logoImg = await pdf.embedPng(logo.bytes);

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { pdf, page, font, fontBold };

  const headerBottom = PAGE_H - MARGIN - HEADER_H;
  const clientTop = headerBottom - GAP;
  const clientBottom = clientTop - CLIENT_H;
  const visualsTop = clientBottom - GAP;

  drawHeader(ctx, input, logoImg);
  drawClientBlock(ctx, input, clientTop);
  drawVisuals(ctx, optimized, visualsTop, VISUALS_BOTTOM);

  const bytes = await pdf.save({ useObjectStreams: true });
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
