// ─── Tailles & quantités de la commande client ──────────────────────────
// Le client commande X pièces par taille (ex. « 15 S · 2 M »). On stocke une
// liste éditable de { libellé, quantité } ; seules les tailles avec une
// quantité > 0 apparaissent sur le BAT.

export interface OrderSize {
  id: string;
  label: string;
  qty: number;
  /** Taille ajoutée à la main par l'utilisateur (libellé éditable + supprimable). */
  custom: boolean;
}

/** Tailles standard adulte proposées d'office (quantité 0 au départ). */
export const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `os-${idCounter}`;
}

export function makeOrderSize(label: string, custom = false): OrderSize {
  return { id: nextId(), label, qty: 0, custom };
}

export function defaultOrderSizes(): OrderSize[] {
  return STANDARD_SIZES.map((s) => makeOrderSize(s, false));
}

/** Total de pièces (somme des quantités positives). */
export function orderSizesTotal(sizes: OrderSize[]): number {
  return sizes.reduce((sum, s) => sum + (s.qty > 0 ? s.qty : 0), 0);
}

/** Tailles effectivement commandées (qty > 0 et libellé non vide), normalisées
 *  et AGRÉGÉES par libellé : deux entrées « S » et « s » fusionnent en une seule
 *  (sommée), pour éviter un détail trompeur « 3 S · 2 S » sur le BAT. */
export function activeOrderSizes(sizes: OrderSize[]): { label: string; qty: number }[] {
  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const s of sizes) {
    const label = s.label.trim().toUpperCase();
    if (s.qty <= 0 || label.length === 0) continue;
    if (!totals.has(label)) order.push(label);
    totals.set(label, (totals.get(label) ?? 0) + s.qty);
  }
  return order.map((label) => ({ label, qty: totals.get(label) ?? 0 }));
}

/** Vrai si au moins une taille a une quantité mais un libellé vide → la quantité
 *  serait silencieusement perdue à la génération (signalé dans l'éditeur). */
export function hasMissingLabel(sizes: OrderSize[]): boolean {
  return sizes.some((s) => s.qty > 0 && s.label.trim().length === 0);
}

/** Rend « 15 S  ·  2 M  ·  1 L » à partir des tailles actives. */
export function formatOrderSizes(sizes: { label: string; qty: number }[]): string {
  return sizes.map((s) => `${s.qty} ${s.label}`).join("  ·  ");
}
