// ─── Tailles & quantités de la commande client ──────────────────────────
// Le client commande X pièces par taille (ex. « 15 S · 2 M »). Chaque taille
// porte aussi sa propre dimension de logo en mm (largeur × hauteur) : le
// marquage peut être plus petit sur un S que sur un XXL. Seules les tailles
// avec une quantité > 0 et un libellé apparaissent sur le BAT.

export interface OrderSize {
  id: string;
  label: string;
  qty: number;
  /** Taille ajoutée à la main par l'utilisateur (libellé éditable + supprimable). */
  custom: boolean;
  /** Dimensions du logo POUR CETTE TAILLE, en mm (largeur × hauteur), ou null. */
  widthMm: number | null;
  heightMm: number | null;
}

/** Tailles standard adulte proposées d'office (quantité 0 au départ). */
export const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `os-${idCounter}`;
}

export function makeOrderSize(label: string, custom = false): OrderSize {
  return { id: nextId(), label, qty: 0, custom, widthMm: null, heightMm: null };
}

export function defaultOrderSizes(): OrderSize[] {
  return STANDARD_SIZES.map((s) => makeOrderSize(s, false));
}

/** Total de pièces (somme des quantités positives). */
export function orderSizesTotal(sizes: OrderSize[]): number {
  return sizes.reduce((sum, s) => sum + (s.qty > 0 ? s.qty : 0), 0);
}

export interface ActiveOrderSize {
  label: string;
  qty: number;
  widthMm: number | null;
  heightMm: number | null;
}

/** Tailles effectivement commandées (qty > 0 et libellé non vide), normalisées
 *  et agrégées par (libellé + dimensions) : deux entrées « S » et « s » de même
 *  dimension fusionnent (sommées) ; si les dimensions diffèrent, elles restent
 *  séparées (ce sont deux marquages distincts). */
export function activeOrderSizes(sizes: OrderSize[]): ActiveOrderSize[] {
  const byKey = new Map<string, ActiveOrderSize>();
  const order: string[] = [];
  for (const s of sizes) {
    const label = s.label.trim().toUpperCase();
    if (s.qty <= 0 || label.length === 0) continue;
    const key = `${label}|${s.widthMm ?? ""}|${s.heightMm ?? ""}`;
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, { label, qty: 0, widthMm: s.widthMm, heightMm: s.heightMm });
    }
    byKey.get(key)!.qty += s.qty;
  }
  return order.map((k) => byKey.get(k)!);
}

/** Vrai si au moins une taille a une quantité mais un libellé vide → la quantité
 *  serait silencieusement perdue à la génération (signalé dans l'éditeur). */
export function hasMissingLabel(sizes: OrderSize[]): boolean {
  return sizes.some((s) => s.qty > 0 && s.label.trim().length === 0);
}

/** Récap court « 15 S · 2 M · 1 L » (sans dimensions, pour l'en-tête de l'éditeur). */
export function formatOrderSizes(sizes: { label: string; qty: number }[]): string {
  return sizes.map((s) => `${s.qty} ${s.label}`).join("  ·  ");
}

/** Dimensions mm → « 200 × 240 mm », « 200 mm », ou "" si rien n'est renseigné. */
export function formatMm(width: number | null, height: number | null): string {
  if (width != null && height != null) return `${width} × ${height} mm`;
  if (width != null) return `${width} mm`;
  if (height != null) return `${height} mm`;
  return "";
}
