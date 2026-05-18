import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { embedAppFonts } from "./fonts";
import { loadOldaLogoPngBytes } from "./rasterizeSvg";

export interface BatPdfView {
  label: string;        // "AVANT" | "ARRIÈRE"
  composedPng: Blob;    // mockup + logo déjà composés (cf compose.ts)
}

export interface BatPdfInput {
  clientName: string;
  date: Date;
  refLabel: string;     // ex. "H-001 NS300"
  colorLabel: string;   // ex. "Marine"
  views: BatPdfView[];  // [avant, arrière]
}

// ─── A4 portrait ──────────────────────────────────────────────────────
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 28;

const HEADER_H = 60;
const CLIENT_H = 48;
const VISUALS_H = 240;
const VALIDATION_H = 130;
const TERMS_H = 90;
const COMPANY_H = 100;
const GAP = 8;

// ─── Palette ────────────────────────────────────────────────────────────
const TEXT       = rgb(0.102, 0.102, 0.102);
const ACCENT     = rgb(0.910, 0.000, 0.110);
const WHITE      = rgb(1, 1, 1);
const GRAY_LIGHT = rgb(0.957, 0.957, 0.957);
const FRAME_BG   = rgb(0.980, 0.980, 0.980);
const BORDER     = rgb(0.878, 0.878, 0.878);
const MUTED      = rgb(0.541, 0.541, 0.541);
const SUB_TEXT   = rgb(0.333, 0.333, 0.333);
const VALID_BG   = rgb(1.000, 0.969, 0.973);

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

/**
 * Optimise un PNG composé en JPEG (≤1400 px, q=0.82) pour rester sous ~600 Ko
 * par vue — adapté à un envoi WhatsApp.
 */
async function optimizeMockupImage(png: Blob, maxDim = 1400, quality = 0.82): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(png);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D indisponible");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("Échec conversion JPEG");
  return new Uint8Array(await blob.arrayBuffer());
}

// ─── HEADER : logo OLDA + brand + BAT + date ────────────────────────────
function drawHeader(ctx: Ctx, input: BatPdfInput, logoImg: PDFImage): void {
  const top = PAGE_H - MARGIN;
  const bottom = top - HEADER_H;

  // Logo OLDA carré à gauche
  const logoSize = 48;
  ctx.page.drawImage(logoImg, {
    x: MARGIN,
    y: top - logoSize,
    width: logoSize,
    height: logoSize,
  });

  // Brand text
  drawText(ctx, "Atelier OLDA", {
    x: MARGIN + logoSize + 12,
    y: top - 18,
    size: 14,
    bold: true,
    color: TEXT,
    tracking: 1.2,
  });
  drawText(ctx, "IMPRESSION TEXTILE PROFESSIONNELLE", {
    x: MARGIN + logoSize + 12,
    y: top - 32,
    size: 7,
    bold: true,
    color: MUTED,
    tracking: 1.6,
  });

  // Côté droit : BON À TIRER + date
  const rightX = PAGE_W - MARGIN;
  const lab = "BON À TIRER";
  const labW = widthOf(ctx.fontBold, lab, 7);
  drawText(ctx, lab, {
    x: rightX - labW,
    y: top - 12,
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
    y: top - 30,
    size: dateSize,
    bold: true,
    color: TEXT,
  });

  // Filet noir
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

  const padX = 16;
  const colW = fullW / 3;

  // 3 colonnes : CLIENT, RÉFÉRENCE, COLORIS
  const cols = [
    { label: "CLIENT", value: input.clientName },
    { label: "RÉFÉRENCE", value: input.refLabel },
    { label: "COLORIS", value: input.colorLabel },
  ];

  cols.forEach((c, i) => {
    const x = MARGIN + i * colW + padX;
    drawText(ctx, c.label, {
      x,
      y: topY - 14,
      size: 6.5,
      bold: true,
      color: MUTED,
      tracking: 1.6,
    });
    drawText(ctx, dashOr(c.value), {
      x,
      y: topY - 33,
      size: 13,
      bold: true,
      color: TEXT,
      maxWidth: colW - padX * 2,
    });
  });
}

// ─── VISUELS : 1 ou 2 vues côte à côte ──────────────────────────────────
interface OptimizedView {
  view: BatPdfView;
  img: PDFImage;
}

function drawVisuals(ctx: Ctx, views: OptimizedView[], topY: number): void {
  if (views.length === 0) return;
  const fullW = PAGE_W - MARGIN * 2;
  const frameTop = topY;
  const frameBottom = topY - VISUALS_H;
  const frameH = frameTop - frameBottom;
  const colGap = 14;
  const slotW = (fullW - colGap * (views.length - 1)) / views.length;

  views.forEach(({ view, img }, idx) => {
    const slotX = MARGIN + idx * (slotW + colGap);

    // Cadre
    ctx.page.drawRectangle({
      x: slotX,
      y: frameBottom,
      width: slotW,
      height: frameH,
      color: FRAME_BG,
      borderColor: BORDER,
      borderWidth: 0.5,
    });

    // Image fittée
    const innerPad = 10;
    const imgArea = {
      x: slotX + innerPad,
      y: frameBottom + innerPad,
      w: slotW - innerPad * 2,
      h: frameH - innerPad * 2,
    };
    const aspect = img.width / img.height;
    let w = imgArea.w;
    let h = w / aspect;
    if (h > imgArea.h) {
      h = imgArea.h;
      w = h * aspect;
    }
    const imgX = imgArea.x + (imgArea.w - w) / 2;
    const imgY = imgArea.y + (imgArea.h - h) / 2;
    ctx.page.drawImage(img, { x: imgX, y: imgY, width: w, height: h });

    // Tag noir top-left
    const tagText = view.label.toUpperCase();
    const tagSize = 6.5;
    const tagTextW = widthOf(ctx.fontBold, tagText, tagSize);
    const tagW = tagTextW + 14;
    const tagH = 14;
    const tagX = slotX + 8;
    const tagY = frameTop - tagH - 6;
    ctx.page.drawRectangle({ x: tagX, y: tagY, width: tagW, height: tagH, color: TEXT });
    drawText(ctx, tagText, {
      x: tagX + 7,
      y: tagY + 4,
      size: tagSize,
      bold: true,
      color: WHITE,
      tracking: 1.5,
    });

    // (Pas de label sous le cadre : le tag noir top-left suffit)
  });
}

// ─── VALIDATION : checkboxes OUI/NON + champ raison (interactif PDF) ────
function drawValidationForm(ctx: Ctx, topY: number): void {
  const bottom = topY - VALIDATION_H;
  const fullW = PAGE_W - MARGIN * 2;

  // Cadre accent rouge
  ctx.page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: fullW,
    height: VALIDATION_H,
    color: VALID_BG,
    borderColor: ACCENT,
    borderWidth: 1.2,
  });

  // Tag chevauchant la bordure haute
  const tagText = "VALIDATION CLIENT";
  const tagSize = 6.5;
  const tagTextW = widthOf(ctx.fontBold, tagText, tagSize);
  const tagW = tagTextW + 16;
  const tagH = 14;
  const tagX = MARGIN + 12;
  const tagY = topY - tagH / 2;
  ctx.page.drawRectangle({ x: tagX, y: tagY, width: tagW, height: tagH, color: ACCENT });
  drawText(ctx, tagText, {
    x: tagX + 8,
    y: tagY + 4,
    size: tagSize,
    bold: true,
    color: WHITE,
    tracking: 1.6,
  });

  const padX = 16;
  const innerLeft = MARGIN + padX;

  // ─ OUI ─
  const ouiCbX = innerLeft;
  const ouiCbY = topY - 32;
  const cbSize = 14;
  const form = ctx.pdf.getForm();

  const ouiCb = form.createCheckBox("validation.oui");
  ouiCb.addToPage(ctx.page, {
    x: ouiCbX,
    y: ouiCbY,
    width: cbSize,
    height: cbSize,
    borderColor: TEXT,
    borderWidth: 1,
  });
  drawText(ctx, "J'ACCEPTE le BAT — lancer la production", {
    x: ouiCbX + cbSize + 8,
    y: ouiCbY + 4,
    size: 9.5,
    bold: true,
    color: TEXT,
  });

  // ─ NON ─
  const nonCbY = ouiCbY - 24;
  const nonCb = form.createCheckBox("validation.non");
  nonCb.addToPage(ctx.page, {
    x: ouiCbX,
    y: nonCbY,
    width: cbSize,
    height: cbSize,
    borderColor: ACCENT,
    borderWidth: 1,
  });
  drawText(ctx, "JE REFUSE le BAT — motif obligatoire ci-dessous", {
    x: ouiCbX + cbSize + 8,
    y: nonCbY + 4,
    size: 9.5,
    bold: true,
    color: ACCENT,
  });

  // ─ Label motif du refus AU-DESSUS du champ (sinon masqué par le widget) ─
  const labelY = nonCbY - 14;
  drawText(ctx, "Motif du refus (à compléter si vous refusez) :", {
    x: innerLeft,
    y: labelY,
    size: 7,
    bold: true,
    color: MUTED,
    tracking: 1.0,
  });

  // ─ Champ texte raison ─
  const reasonField = form.createTextField("validation.motif");
  reasonField.enableMultiline();
  const reasonY = bottom + 6;
  const reasonW = fullW - padX * 2;
  const reasonH = labelY - reasonY - 4;
  reasonField.addToPage(ctx.page, {
    x: innerLeft,
    y: reasonY,
    width: reasonW,
    height: reasonH,
    borderColor: BORDER,
    borderWidth: 0.5,
    backgroundColor: WHITE,
  });
}

// ─── CONDITIONS GÉNÉRALES ───────────────────────────────────────────────
function drawTerms(ctx: Ctx, topY: number): void {
  const bottom = topY - TERMS_H;
  const fullW = PAGE_W - MARGIN * 2;

  ctx.page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: fullW,
    height: TERMS_H,
    borderColor: BORDER,
    borderWidth: 0.5,
  });

  const padX = 14;
  drawText(ctx, "CONDITIONS GÉNÉRALES — BON À TIRER", {
    x: MARGIN + padX,
    y: topY - 14,
    size: 7,
    bold: true,
    color: TEXT,
    tracking: 1.6,
  });

  const bullets = [
    "La validation engage définitivement le client : aucune modification ne sera acceptée après réception du « J'ACCEPTE ».",
    "Le client confirme avoir vérifié l'orthographe, les couleurs, les dimensions et l'emplacement du visuel sur chaque face.",
    "Les couleurs à l'écran peuvent légèrement différer du rendu final imprimé selon l'étalonnage et le support textile.",
    "En cas de refus, indiquer le motif. Tout BAT non retourné sous 5 jours ouvrés est réputé accepté tacitement.",
    "Toute erreur non signalée avant validation engage la responsabilité du client (pas d'avoir ni de réimpression à nos frais).",
  ];

  let y = topY - 28;
  const lineSize = 7;
  const lineH = 11;
  bullets.forEach((b) => {
    drawText(ctx, "•", { x: MARGIN + padX, y, size: lineSize, bold: true, color: ACCENT });
    drawText(ctx, b, {
      x: MARGIN + padX + 10,
      y,
      size: lineSize,
      color: SUB_TEXT,
      maxWidth: fullW - padX * 2 - 10,
    });
    y -= lineH;
  });
}

// ─── INFOS SOCIÉTÉ ──────────────────────────────────────────────────────
function drawCompanyInfo(ctx: Ctx, topY: number): void {
  const bottom = topY - COMPANY_H;
  const fullW = PAGE_W - MARGIN * 2;

  ctx.page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: fullW,
    height: COMPANY_H,
    color: GRAY_LIGHT,
  });

  const padX = 14;
  drawText(ctx, "ATELIER OLDA SARL", {
    x: MARGIN + padX,
    y: topY - 14,
    size: 8,
    bold: true,
    color: TEXT,
    tracking: 1.4,
  });

  // 3 colonnes d'infos
  const colW = (fullW - padX * 2) / 3;
  const startY = topY - 30;
  const lineH = 9;
  const labSize = 5.5;
  const valSize = 7;

  type Entry = [label: string, value: string];
  const col1: Entry[] = [
    ["FORME JURIDIQUE", "SARL"],
    ["CAPITAL SOCIAL", "500,00 €"],
    ["SIRET", "978 296 952 00028"],
    ["SIREN / RCS", "978 296 952 — RCS Saint-Martin"],
    ["CODE APE", "1813Z"],
  ];
  const col2: Entry[] = [
    ["N° TVA INTRACOMMUNAUTAIRE", "FR86 978 296 952"],
    ["SIÈGE SOCIAL", "1 Rue Opale"],
    ["", "Grand-Case, 97150 Saint-Martin"],
  ];
  const col3: Entry[] = [
    ["TÉLÉPHONE FIXE", "05 90 77 13 04"],
    ["TÉLÉPHONE PORTABLE", "06 90 47 97 88"],
    ["EMAIL", "atelierolda@gmail.com"],
  ];

  function drawCol(entries: Entry[], colIdx: number) {
    let y = startY;
    const x = MARGIN + padX + colIdx * colW;
    entries.forEach(([label, value]) => {
      if (label) {
        drawText(ctx, label, {
          x,
          y,
          size: labSize,
          bold: true,
          color: MUTED,
          tracking: 1.2,
        });
        y -= lineH;
        drawText(ctx, value, {
          x,
          y,
          size: valSize,
          color: TEXT,
          maxWidth: colW - 6,
        });
        y -= lineH + 2;
      } else {
        // Ligne de continuation (ex. SIÈGE SOCIAL sur 2 lignes)
        drawText(ctx, value, {
          x,
          y: y + 2,
          size: valSize,
          color: TEXT,
          maxWidth: colW - 6,
        });
        y -= lineH;
      }
    });
  }

  drawCol(col1, 0);
  drawCol(col2, 1);
  drawCol(col3, 2);
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

  // Logo OLDA + vues optimisées en parallèle
  const [logoBytes, optimized] = await Promise.all([
    loadOldaLogoPngBytes(),
    Promise.all(
      input.views.map(async (v) => {
        const bytes = await optimizeMockupImage(v.composedPng);
        return { view: v, img: await pdf.embedJpg(bytes) } satisfies OptimizedView;
      }),
    ),
  ]);
  const logoImg = await pdf.embedPng(logoBytes);

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { pdf, page, font, fontBold };

  // Sections empilées du haut vers le bas
  const headerBottom = PAGE_H - MARGIN - HEADER_H;
  const clientTop = headerBottom - GAP;
  const clientBottom = clientTop - CLIENT_H;
  const visualsTop = clientBottom - GAP;
  const visualsBottom = visualsTop - VISUALS_H;
  const validationTop = visualsBottom - GAP;
  const validationBottom = validationTop - VALIDATION_H;
  const termsTop = validationBottom - GAP;
  const termsBottom = termsTop - TERMS_H;
  const companyTop = termsBottom - GAP;

  drawHeader(ctx, input, logoImg);
  drawClientBlock(ctx, input, clientTop);
  drawVisuals(ctx, optimized, visualsTop);
  drawValidationForm(ctx, validationTop);
  drawTerms(ctx, termsTop);
  drawCompanyInfo(ctx, companyTop);

  const bytes = await pdf.save({ useObjectStreams: true });
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
