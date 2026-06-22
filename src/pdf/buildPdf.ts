import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { embedAppFonts } from "./fonts";
import { loadOldaLogo } from "./rasterizeSvg";
import type { SleeveType } from "../types";

export interface BatPdfView {
  label: string;        // "AVANT" | "ARRIÈRE" | "CÔTÉ GAUCHE"…
  composedPng: Blob;    // mockup + logo déjà composés (cf compose.ts)
  /** Si défini, rogne l'image au centre à cette fraction de largeur (profils
   *  étroits) → cadre plus fin, t-shirt à la même hauteur que l'avant/arrière. */
  cropXFraction?: number;
  /** Un logo est-il présent sur cette vue ? (caption « Sans marquage » sinon) */
  marked?: boolean;
  /** Nom du fichier logo déposé (info atelier). */
  logoName?: string | null;
  /** Couleur du marquage : nom de la palette, hex, ou « Couleur d'origine ». */
  markColorLabel?: string | null;
}

export interface BatPdfInput {
  clientName: string;
  date: Date;
  category: string;     // "HOMME" | "FEMME" | "ENFANT" | "BEBE"
  refInternal: string;  // ex. "H-001"
  refSupplier: string;  // ex. "NS300"
  refLabel: string;     // ex. "H-001 NS300" (titre / nom de fichier)
  sleeveType: SleeveType;
  colorLabel: string;   // ex. "Marine"
  colorHex: string;     // ex. "#14213D"
  views: BatPdfView[];  // [avant, arrière, côté gauche, côté droit]
}

// ─── Coordonnées de l'atelier (pied de page officiel) ───────────────────
// À COMPLÉTER avec les vraies coordonnées. Tout champ laissé vide n'est PAS
// imprimé (aucune donnée inventée sur un document officiel).
const ATELIER = {
  name: "Atelier OLDA",
  tagline: "IMPRESSION TEXTILE PROFESSIONNELLE",
  address: "",
  phone: "",
  email: "",
  web: "",
  siret: "",
};

// ─── A4 paysage : 2 visuels côte à côte, grands ─────────────────────────
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 32;

const HEADER_H = 54;
const SPECS_H = 50;
const GAP = 12;

// Bande basse : mentions légales + bon pour accord, posée au-dessus du pied.
const FOOTER_H = 22;       // hauteur du pied de page (coordonnées atelier)
const BAND_H = 116;        // mentions + signature
const BAND_BOTTOM = MARGIN + FOOTER_H;

// ─── Palette Atelier OLDA ───────────────────────────────────────────────
const TEXT       = rgb(0.102, 0.102, 0.102);
const WHITE      = rgb(1, 1, 1);
const GRAY_LIGHT = rgb(0.957, 0.957, 0.957);
const FRAME_BG   = rgb(0.980, 0.980, 0.980);
const BORDER     = rgb(0.878, 0.878, 0.878);
const MUTED      = rgb(0.541, 0.541, 0.541);

const SLEEVE_LABEL: Record<SleeveType, string> = {
  short: "Manche courte",
  long: "Manche longue",
  sleeveless: "Sans manche",
};

const CATEGORY_LABEL: Record<string, string> = {
  HOMME: "Homme",
  FEMME: "Femme",
  ENFANT: "Enfant",
  BEBE: "Bébé",
};

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

/** Découpe un texte en lignes qui tiennent dans maxWidth (retour à la ligne). */
function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function formatDateFr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function dashOr(value: string | undefined | null): string {
  if (!value || !String(value).trim()) return "—";
  return String(value).trim();
}

function categoryLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c;
}

function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return rgb(0.85, 0.85, 0.85);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** N° de BAT : date + suffixe déterministe du contenu (unique par génération). */
function batNumber(input: BatPdfInput): string {
  const d = input.date;
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const seed = `${input.clientName}|${input.refLabel}|${input.colorLabel}|${d.getTime()}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const suffix = h.toString(36).toUpperCase().padStart(4, "0").slice(-4);
  return `${stamp}-${suffix}`;
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

// ─── HEADER : logo OLDA + brand + BON À TIRER + N° + date ───────────────
function drawHeader(ctx: Ctx, input: BatPdfInput, logoImg: PDFImage, bat: string): void {
  const top = PAGE_H - MARGIN;
  const bottom = top - HEADER_H;

  const logoBox = 44;
  const logoScale = logoBox / Math.max(logoImg.width, logoImg.height);
  const lw = logoImg.width * logoScale;
  const lh = logoImg.height * logoScale;
  ctx.page.drawImage(logoImg, {
    x: MARGIN + (logoBox - lw) / 2,
    y: top - logoBox + (logoBox - lh) / 2,
    width: lw,
    height: lh,
  });

  drawText(ctx, ATELIER.name, {
    x: MARGIN + logoBox + 12,
    y: top - 16,
    size: 14,
    bold: true,
    color: TEXT,
    tracking: 1.2,
  });
  drawText(ctx, ATELIER.tagline, {
    x: MARGIN + logoBox + 12,
    y: top - 30,
    size: 7,
    bold: true,
    color: MUTED,
    tracking: 1.6,
  });

  // Bloc droit : « BON À TIRER » + n° + date d'émission, aligné à droite.
  const rightX = PAGE_W - MARGIN;
  const lab = "BON À TIRER";
  drawText(ctx, lab, {
    x: rightX - widthOf(ctx.fontBold, lab, 11),
    y: top - 13,
    size: 11,
    bold: true,
    color: TEXT,
    tracking: 2.2,
  });
  const meta = `N° ${bat}    ·    Émis le ${formatDateFr(input.date)}`;
  drawText(ctx, meta, {
    x: rightX - widthOf(ctx.fontBold, meta, 9),
    y: top - 30,
    size: 9,
    bold: true,
    color: MUTED,
  });

  ctx.page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: PAGE_W - MARGIN * 2,
    height: 1.2,
    color: TEXT,
  });
}

// ─── SPECS : client + famille + référence + manche + coloris ────────────
function drawSpecs(ctx: Ctx, input: BatPdfInput, topY: number): void {
  const bottom = topY - SPECS_H;
  const fullW = PAGE_W - MARGIN * 2;

  ctx.page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: fullW,
    height: SPECS_H,
    color: GRAY_LIGHT,
  });

  const refValue =
    input.refSupplier && input.refSupplier.trim()
      ? `${input.refInternal} · ${input.refSupplier}`
      : input.refInternal;

  const cols = [
    { label: "CLIENT", value: input.clientName, swatch: undefined as string | undefined },
    { label: "FAMILLE", value: categoryLabel(input.category) },
    { label: "RÉFÉRENCE", value: refValue },
    { label: "MANCHE", value: SLEEVE_LABEL[input.sleeveType] ?? "—" },
    { label: "COLORIS", value: input.colorLabel, swatch: input.colorHex },
  ];

  const padX = 16;
  const colW = fullW / cols.length;
  cols.forEach((c, i) => {
    const x = MARGIN + i * colW + padX;
    // séparateur fin entre colonnes
    if (i > 0) {
      ctx.page.drawRectangle({
        x: MARGIN + i * colW,
        y: bottom + 8,
        width: 0.5,
        height: SPECS_H - 16,
        color: BORDER,
      });
    }
    drawText(ctx, c.label, {
      x,
      y: topY - 15,
      size: 7,
      bold: true,
      color: MUTED,
      tracking: 1.5,
    });
    let valueX = x;
    let valueMax = colW - padX * 2;
    if (c.swatch) {
      const r = 5;
      const cy = topY - 31;
      ctx.page.drawCircle({
        x: x + r,
        y: cy,
        size: r,
        color: hexToRgb(c.swatch),
        borderColor: BORDER,
        borderWidth: 0.5,
      });
      valueX = x + r * 2 + 7;
      valueMax = colW - padX * 2 - (r * 2 + 7);
    }
    drawText(ctx, dashOr(c.value), {
      x: valueX,
      y: topY - 35,
      size: 13,
      bold: true,
      color: TEXT,
      maxWidth: valueMax,
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
  const frameH = frameTop - bottomY;
  const colGap = 16;
  const innerPad = 14;
  const captionH = 16; // bande basse de chaque cadre : info marquage

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
  const imgH = Math.min(frameH - innerPad * 2 - captionH, imgHByWidth);

  const frameWidths = aspects.map((a) => imgH * a + innerPad * 2);
  const totalW = frameWidths.reduce((a, b) => a + b, 0) + gaps;
  let cursorX = MARGIN + (fullW - totalW) / 2; // centré horizontalement

  // Bloc centré verticalement dans la zone disponible.
  const frameInnerH = imgH + innerPad * 2 + captionH;
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

    // Image centrée, hauteur = imgH pour toutes les vues (au-dessus du caption)
    const w = imgH * (img.width / img.height);
    const imgX = slotX + (fw - w) / 2;
    const imgY = slotBottom + innerPad + captionH;
    ctx.page.drawImage(img, { x: imgX, y: imgY, width: w, height: imgH });

    // Caption marquage en bas du cadre
    const caption =
      view.marked === false
        ? "Sans marquage"
        : [view.markColorLabel, view.logoName].filter(Boolean).join(" · ") || "Marquage";
    const capSize = 7;
    const capW = Math.min(widthOf(ctx.font, caption, capSize), fw - 16);
    drawText(ctx, caption, {
      x: slotX + (fw - capW) / 2,
      y: slotBottom + 6,
      size: capSize,
      color: MUTED,
      maxWidth: fw - 16,
    });

    // Tag noir en haut-gauche
    const tagText = view.label.toUpperCase();
    const tagSize = 7;
    const tagW = widthOf(ctx.fontBold, tagText, tagSize) + 16;
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

// ─── BANDE BASSE : mentions légales (gauche) + bon pour accord (droite) ──
const LEGAL_TEXT =
  "En apposant votre accord ci-contre, vous validez l'intégralité du présent Bon à Tirer : " +
  "visuel, textes et orthographe, emplacement et dimensions du marquage, référence et coloris du support. " +
  "Les couleurs reproduites à l'écran et sur ce document sont indicatives et peuvent différer du rendu " +
  "final sur textile. Toute erreur non signalée avant accord engage la seule responsabilité du client. " +
  "Aucune production n'est lancée sans ce bon à tirer approuvé.";

function drawApprovalBand(ctx: Ctx): void {
  const top = BAND_BOTTOM + BAND_H;
  const fullW = PAGE_W - MARGIN * 2;
  const colGap = 24;
  const leftW = Math.round(fullW * 0.56);
  const rightX = MARGIN + leftW + colGap;
  const rightW = PAGE_W - MARGIN - rightX;

  // ── Gauche : mentions légales ──
  drawText(ctx, "MENTIONS — BON À TIRER", {
    x: MARGIN,
    y: top - 9,
    size: 7.5,
    bold: true,
    color: TEXT,
    tracking: 1.4,
  });
  const legalSize = 7;
  const lines = wrapText(ctx.font, LEGAL_TEXT, legalSize, leftW);
  let ly = top - 24;
  for (const line of lines) {
    drawText(ctx, line, { x: MARGIN, y: ly, size: legalSize, color: MUTED });
    ly -= 9.5;
  }

  // ── Droite : bon pour accord (encadré) ──
  ctx.page.drawRectangle({
    x: rightX,
    y: BAND_BOTTOM,
    width: rightW,
    height: BAND_H,
    borderColor: BORDER,
    borderWidth: 0.8,
  });
  // Bandeau titre
  const barH = 18;
  ctx.page.drawRectangle({
    x: rightX,
    y: top - barH,
    width: rightW,
    height: barH,
    color: TEXT,
  });
  drawText(ctx, "BON POUR ACCORD", {
    x: rightX + 10,
    y: top - barH + 6,
    size: 8.5,
    bold: true,
    color: WHITE,
    tracking: 1.5,
  });

  const padX = 12;
  const ix = rightX + padX;
  const innerW = rightW - padX * 2;

  // Cases à cocher (2 lignes)
  const checks1 = ["Bon pour accord", "Bon pour accord avec réserves"];
  let cx = ix;
  const cy1 = top - barH - 16;
  const box = 8;
  for (const c of checks1) {
    ctx.page.drawRectangle({
      x: cx,
      y: cy1 - 1,
      width: box,
      height: box,
      borderColor: TEXT,
      borderWidth: 0.8,
    });
    drawText(ctx, c, { x: cx + box + 5, y: cy1, size: 7.5, color: TEXT });
    cx += box + 5 + widthOf(ctx.font, c, 7.5) + 16;
  }
  const cy2 = cy1 - 15;
  ctx.page.drawRectangle({
    x: ix,
    y: cy2 - 1,
    width: box,
    height: box,
    borderColor: TEXT,
    borderWidth: 0.8,
  });
  drawText(ctx, "Modifications demandées (voir remarques)", {
    x: ix + box + 5,
    y: cy2,
    size: 7.5,
    color: TEXT,
  });

  // Champs date / nom + zone signature
  const fieldY = cy2 - 20;
  drawText(ctx, "Date :", { x: ix, y: fieldY, size: 8, bold: true, color: TEXT });
  ctx.page.drawLine({
    start: { x: ix + 30, y: fieldY - 2 },
    end: { x: ix + innerW * 0.42, y: fieldY - 2 },
    thickness: 0.6,
    color: BORDER,
  });
  drawText(ctx, "Nom :", { x: ix + innerW * 0.5, y: fieldY, size: 8, bold: true, color: TEXT });
  ctx.page.drawLine({
    start: { x: ix + innerW * 0.5 + 30, y: fieldY - 2 },
    end: { x: ix + innerW, y: fieldY - 2 },
    thickness: 0.6,
    color: BORDER,
  });
  drawText(ctx, "Signature :", { x: ix, y: fieldY - 18, size: 8, bold: true, color: TEXT });

  // Note validation rapide (workflow WhatsApp)
  drawText(ctx, "Validation rapide : un « OK » par retour de message vaut accord.", {
    x: ix,
    y: BAND_BOTTOM + 7,
    size: 6.5,
    color: MUTED,
  });
}

// ─── PIED DE PAGE : coordonnées atelier + n° BAT + génération ───────────
function drawFooter(ctx: Ctx, input: BatPdfInput, bat: string): void {
  const y = MARGIN + 6;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: MARGIN + FOOTER_H,
    width: PAGE_W - MARGIN * 2,
    height: 0.6,
    color: BORDER,
  });

  const coords = [
    ATELIER.address,
    ATELIER.phone,
    ATELIER.email,
    ATELIER.web,
    ATELIER.siret ? `SIRET ${ATELIER.siret}` : "",
  ].filter((s) => s && s.trim());
  const left = [ATELIER.name, ...coords].join("  ·  ");
  drawText(ctx, left, { x: MARGIN, y, size: 6.5, color: MUTED, maxWidth: PAGE_W * 0.6 });

  const right = `BAT N° ${bat}  ·  Généré le ${formatDateFr(input.date)}  ·  Page 1/1`;
  drawText(ctx, right, {
    x: PAGE_W - MARGIN - widthOf(ctx.font, right, 6.5),
    y,
    size: 6.5,
    color: MUTED,
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

  const bat = batNumber(input);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`BAT ${input.refLabel} · ${input.clientName}`);
  pdf.setAuthor(ATELIER.name);
  pdf.setSubject(`Bon À Tirer N° ${bat} — ${input.refLabel} · ${input.colorLabel}`);
  pdf.setKeywords(["bon à tirer", "BAT", input.clientName, input.refLabel, input.colorLabel]);
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
  const specsTop = headerBottom - GAP;
  const specsBottom = specsTop - SPECS_H;
  const visualsTop = specsBottom - GAP;
  const visualsBottom = BAND_BOTTOM + BAND_H + GAP;

  drawHeader(ctx, input, logoImg, bat);
  drawSpecs(ctx, input, specsTop);
  drawVisuals(ctx, optimized, visualsTop, visualsBottom);
  drawApprovalBand(ctx);
  drawFooter(ctx, input, bat);

  const bytes = await pdf.save({ useObjectStreams: true });
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
