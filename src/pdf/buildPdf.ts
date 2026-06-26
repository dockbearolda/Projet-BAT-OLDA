import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { embedAppFonts } from "./fonts";
import { loadOldaLogo } from "./rasterizeSvg";
import { formatMm, type ActiveOrderSize } from "../orderSizes";

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
  category: string;     // "HOMME" | "FEMME" | "ENFANT" | "BEBE"
  refInternal: string;  // ex. "H-001"
  refSupplier: string;  // ex. "NS300"
  refLabel: string;     // ex. "H-001 NS300" (titre / nom de fichier)
  technique: string;    // technique de marquage, ex. "DTF"
  colorLabel: string;   // ex. "Marine"
  colorHex: string;     // ex. "#14213D"
  views: BatPdfView[];  // [avant, arrière, côté gauche, côté droit]
  /** Tailles commandées (qty + dimension du logo par taille). Vide = pas de bandeau. */
  orderSizes?: ActiveOrderSize[];
}

// ─── Coordonnées de l'atelier (pied de page officiel) ───────────────────
const ATELIER = {
  name: "OLDA · Atelier",
  legalName: "Atelier OLDA SARL",
  tagline: "IMPRESSION TEXTILE DTF",
  address: "1 rue Opale, Route de l'Espérance, 97150 Grand-Case, Saint-Martin",
  phone: "+590 690 47 97 88",
  phoneFixed: "05 90 77 13 04",
  email: "atelierolda@gmail.com",
  hours: "Lun–Ven · 9h–18h",
  siret: "978 296 952 00028",
  tva: "FR86978296952",
  ape: "1813Z",
  rcs: "RCS Saint-Martin",
};

// ─── A4 paysage : 2 visuels côte à côte, grands ─────────────────────────
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 32;

const HEADER_H = 54;
const SPECS_H = 50;
// Bandeau « commande » (optionnel) : en-tête + N lignes de tailles en grille.
const ORDER_HEADER_H = 22;
const ORDER_ROW_H = 13;
const ORDER_PAD_V = 6;
const GAP = 12;

// Bande basse : mentions légales, posée au-dessus du pied.
const FOOTER_H = 30;       // pied de page (coordonnées + infos légales, 2 lignes)
const BAND_H = 46;         // mentions légales (pleine largeur)
const BAND_BOTTOM = MARGIN + FOOTER_H;

// ─── Palette Atelier OLDA (design system : encre froide + canard) ───────
const TEXT       = rgb(0.125, 0.161, 0.188); // #202930 encre froide
const DUCK       = rgb(0.290, 0.384, 0.455); // #4A6274 accent canard
const WHITE      = rgb(1, 1, 1);
const GRAY_LIGHT = rgb(0.945, 0.957, 0.961); // bandeau specs
const FRAME_BG   = rgb(0.980, 0.980, 0.980);
const BORDER     = rgb(0.855, 0.878, 0.890);
const MUTED      = rgb(0.357, 0.420, 0.471); // #5B6B78

const CATEGORY_LABEL: Record<string, string> = {
  HOMME: "Homme",
  FEMME: "Femme",
  ENFANT: "Enfant",
  BEBE: "Bébé",
  POCHETTE: "Pochette",
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
    color: DUCK,
  });
}

// ─── SPECS : client + famille + référence + manche + technique + coloris ─
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

  // Réf interne + fournisseur séparés par « · », en ignorant les champs vides
  // (une réf sans code interne n'affiche que le code fournisseur).
  const refValue = [input.refInternal, input.refSupplier]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" · ");

  const cols = [
    { label: "CLIENT", value: input.clientName, swatch: undefined as string | undefined },
    { label: "FAMILLE", value: categoryLabel(input.category) },
    { label: "RÉFÉRENCE", value: refValue },
    { label: "TECHNIQUE", value: input.technique },
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
      y: topY - 34,
      size: 12,
      bold: true,
      color: TEXT,
      maxWidth: valueMax,
    });
  });
}

// ─── COMMANDE : bandeau quantités + dimension du logo par taille ─────────
// Chaque taille commandée est rendue en « 15 S · 200 × 240 mm », disposée en
// grille à colonnes égales qui s'enroule sur plusieurs lignes au besoin. La
// hauteur du bandeau est calculée d'abord (planOrderBand) pour positionner les
// visuels, puis dessinée (drawOrderBand).
const ORDER_PAD_X = 16;
const ORDER_COL_GAP = 18;

interface OrderBandPlan {
  chips: { head: string; dim: string }[];
  fontSize: number;
  cols: number;
  colW: number;
  height: number;
  totalText: string;
}

function planOrderBand(ctx: Ctx, sizes: ActiveOrderSize[]): OrderBandPlan {
  const availW = PAGE_W - MARGIN * 2 - ORDER_PAD_X * 2;
  const total = sizes.reduce((s, x) => s + x.qty, 0);
  const totalText = `Total : ${total} ${total > 1 ? "pièces" : "pièce"}`;

  const chips = sizes.map((s) => ({
    head: `${s.qty} ${s.label}`,
    dim: formatMm(s.widthMm, s.heightMm),
  }));
  const full = (c: { head: string; dim: string }) => (c.dim ? `${c.head} · ${c.dim}` : c.head);

  // Plus grande police (9 → 7) qui tient en ≤ 3 lignes ; sinon 7 et on enroule.
  let fontSize = 9;
  let cols = 1;
  let colW = availW;
  let rows = chips.length;
  for (; fontSize >= 7; fontSize -= 0.5) {
    const maxChipW = chips.reduce((m, c) => Math.max(m, widthOf(ctx.fontBold, full(c), fontSize)), 1);
    colW = Math.min(availW, maxChipW + ORDER_COL_GAP);
    cols = Math.max(1, Math.floor(availW / colW));
    rows = Math.ceil(chips.length / cols);
    if (rows <= 3) break;
  }
  const height = ORDER_HEADER_H + rows * ORDER_ROW_H + ORDER_PAD_V;
  return { chips, fontSize, cols, colW, height, totalText };
}

function drawOrderBand(ctx: Ctx, plan: OrderBandPlan, topY: number): void {
  const fullW = PAGE_W - MARGIN * 2;
  const bottom = topY - plan.height;

  ctx.page.drawRectangle({ x: MARGIN, y: bottom, width: fullW, height: plan.height, color: GRAY_LIGHT });
  // Filet canard à gauche (rappel d'accent).
  ctx.page.drawRectangle({ x: MARGIN, y: bottom, width: 3, height: plan.height, color: DUCK });

  drawText(ctx, "COMMANDE — QUANTITÉS & DIMENSION DU LOGO", {
    x: MARGIN + ORDER_PAD_X,
    y: topY - 13,
    size: 7,
    bold: true,
    color: MUTED,
    tracking: 1.3,
  });
  const totalSize = 9;
  const totalW = widthOf(ctx.fontBold, plan.totalText, totalSize);
  drawText(ctx, plan.totalText, {
    x: PAGE_W - MARGIN - ORDER_PAD_X - totalW,
    y: topY - 13,
    size: totalSize,
    bold: true,
    color: DUCK,
  });

  // Grille de tailles : qté + libellé (encre) puis dimension (mutée).
  const rowBaseTop = topY - ORDER_HEADER_H;
  plan.chips.forEach((c, i) => {
    const col = i % plan.cols;
    const row = Math.floor(i / plan.cols);
    const x = MARGIN + ORDER_PAD_X + col * plan.colW;
    const y = rowBaseTop - row * ORDER_ROW_H;
    drawText(ctx, c.head, { x, y, size: plan.fontSize, bold: true, color: TEXT });
    if (c.dim) {
      const headW = widthOf(ctx.fontBold, c.head, plan.fontSize);
      drawText(ctx, ` · ${c.dim}`, {
        x: x + headW,
        y,
        size: plan.fontSize,
        color: MUTED,
        maxWidth: Math.max(10, plan.colW - headW - 6),
      });
    }
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

    // Tag haut-gauche (canard)
    const tagText = view.label.toUpperCase();
    const tagSize = 7;
    const tagW = widthOf(ctx.fontBold, tagText, tagSize) + 16;
    const tagH = 16;
    const tagX = slotX + 10;
    const tagY = blockTop - tagH - 10;
    ctx.page.drawRectangle({ x: tagX, y: tagY, width: tagW, height: tagH, color: DUCK });
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

// ─── BANDE BASSE : mentions légales (pleine largeur) ────────────────────
const LEGAL_TEXT =
  "En validant ce Bon à Tirer, vous validez l'intégralité du présent document : " +
  "visuel, textes et orthographe, emplacement et dimensions du marquage, référence et coloris du support. " +
  "Les couleurs reproduites à l'écran et sur ce document sont indicatives et peuvent différer du rendu " +
  "final sur textile. Toute erreur non signalée avant accord engage la seule responsabilité du client. " +
  "Aucune production n'est lancée sans ce bon à tirer approuvé.";

function drawMentions(ctx: Ctx): void {
  const top = BAND_BOTTOM + BAND_H;
  const fullW = PAGE_W - MARGIN * 2;

  drawText(ctx, "MENTIONS — BON À TIRER", {
    x: MARGIN,
    y: top - 9,
    size: 7.5,
    bold: true,
    color: TEXT,
    tracking: 1.4,
  });
  const legalSize = 7;
  const lines = wrapText(ctx.font, LEGAL_TEXT, legalSize, fullW);
  let ly = top - 24;
  for (const line of lines) {
    drawText(ctx, line, { x: MARGIN, y: ly, size: legalSize, color: MUTED });
    ly -= 9.5;
  }
}

// ─── PIED DE PAGE : coordonnées + infos légales + n° BAT (2 lignes) ─────
function drawFooter(ctx: Ctx, input: BatPdfInput, bat: string): void {
  ctx.page.drawRectangle({
    x: MARGIN,
    y: MARGIN + FOOTER_H,
    width: PAGE_W - MARGIN * 2,
    height: 0.6,
    color: BORDER,
  });

  const y1 = MARGIN + 18;
  const y2 = MARGIN + 8;
  const size = 6.5;

  // Ligne 1 : raison sociale · adresse · horaires
  const line1 = [ATELIER.legalName, ATELIER.address, ATELIER.hours]
    .filter((s) => s && s.trim())
    .join("  ·  ");
  drawText(ctx, line1, { x: MARGIN, y: y1, size, color: MUTED, maxWidth: PAGE_W - MARGIN * 2 });

  // Ligne 2 : contact + identifiants légaux
  const line2 = [
    `Tél ${ATELIER.phone}`,
    ATELIER.email,
    `SIRET ${ATELIER.siret}`,
    `TVA ${ATELIER.tva}`,
    `APE ${ATELIER.ape}`,
    ATELIER.rcs,
  ]
    .filter((s) => s && s.trim())
    .join("  ·  ");
  drawText(ctx, line2, { x: MARGIN, y: y2, size, color: MUTED, maxWidth: PAGE_W - MARGIN * 2 });

  // n° BAT + génération (aligné à droite, ligne haute)
  const right = `BAT N° ${bat}  ·  Généré le ${formatDateFr(input.date)}  ·  Page 1/1`;
  drawText(ctx, right, {
    x: PAGE_W - MARGIN - widthOf(ctx.fontBold, right, size),
    y: y1,
    size,
    bold: true,
    color: TEXT,
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

  // Bandeau commande optionnel : ne s'affiche (et ne mange de la hauteur des
  // visuels) que si des tailles sont commandées. Sa hauteur est dynamique (1+
  // lignes selon le nombre de tailles), calculée avant de placer les visuels.
  const orderSizes = input.orderSizes ?? [];
  const hasOrder = orderSizes.length > 0;
  const orderPlan = hasOrder ? planOrderBand(ctx, orderSizes) : null;
  const orderTop = specsBottom - GAP;
  const visualsTop = (orderPlan ? orderTop - orderPlan.height : specsBottom) - GAP;
  const visualsBottom = BAND_BOTTOM + BAND_H + GAP;

  drawHeader(ctx, input, logoImg, bat);
  drawSpecs(ctx, input, specsTop);
  if (orderPlan) drawOrderBand(ctx, orderPlan, orderTop);
  drawVisuals(ctx, optimized, visualsTop, visualsBottom);
  drawMentions(ctx);
  drawFooter(ctx, input, bat);

  const bytes = await pdf.save({ useObjectStreams: true });
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
