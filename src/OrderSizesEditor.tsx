import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Plus, Ruler, X } from "lucide-react";
import {
  activeOrderSizes,
  formatOrderSizes,
  hasMissingLabel,
  makeOrderSize,
  type OrderSize,
} from "./orderSizes";

/** Champ mm → entier ≥ 0 borné, ou null si vide. */
function parseMm(raw: string): number | null {
  if (raw.trim() === "") return null;
  return Math.max(0, Math.min(99999, Math.floor(Number(raw) || 0)));
}

// ─── Éditeur « Tailles & quantités de la commande » ─────────────────────
// Barre repliable → popover (au-dessus des mockups, sans voler de hauteur).
// Deux blocs : (1) la grille taille → quantité ; (2) la dimension du logo en mm
// (largeur × hauteur) PAR taille commandée — le marquage peut différer selon la
// taille du vêtement. Seules les tailles avec qty > 0 et un libellé partent sur
// le BAT.
export function OrderSizesEditor({
  sizes,
  onChange,
}: {
  sizes: OrderSize[];
  onChange: (next: OrderSize[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = activeOrderSizes(sizes);
  const total = active.reduce((s, x) => s + x.qty, 0);
  const summary = total > 0 ? formatOrderSizes(active) : "Aucune taille renseignée";
  const missing = hasMissingLabel(sizes);

  // Tailles commandées (qty > 0 + libellé) → reçoivent un champ dimension logo.
  const ordered = sizes.filter((s) => s.qty > 0 && s.label.trim().length > 0);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function setQty(id: string, raw: string) {
    const n = Math.max(0, Math.min(99999, Math.floor(Number(raw) || 0)));
    onChange(sizes.map((s) => (s.id === id ? { ...s, qty: n } : s)));
  }
  function setLabel(id: string, label: string) {
    onChange(sizes.map((s) => (s.id === id ? { ...s, label } : s)));
  }
  function setDim(id: string, dim: "widthMm" | "heightMm", raw: string) {
    const v = parseMm(raw);
    onChange(sizes.map((s) => (s.id === id ? { ...s, [dim]: v } : s)));
  }
  function addCustom() {
    onChange([...sizes, makeOrderSize("", true)]);
  }
  function removeSize(id: string) {
    onChange(sizes.filter((s) => s.id !== id));
  }
  function clearAll() {
    onChange(sizes.map((s) => ({ ...s, qty: 0 })));
  }

  return (
    <div ref={rootRef} className="relative">
      {/* En-tête repliable : libellé + récap live (total + détail) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl border border-duck/15 bg-white/60 px-4 py-3 text-left transition hover:border-duck/30"
      >
        <Ruler className="h-4 w-4 flex-shrink-0 text-duck" />
        <span className="flex-shrink-0 text-xs font-semibold uppercase tracking-wider text-muted">
          Tailles &amp; quantités
        </span>
        {total > 0 ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex-shrink-0 rounded-full bg-duck/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-duck">
              {total} {total > 1 ? "pièces" : "pièce"}
            </span>
            <span className="truncate text-xs text-muted2">{summary}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs italic text-muted2">
            Renseigne les quantités par taille (ex. 15 S · 2 M)
          </span>
        )}
        {missing && (
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" aria-label="Une taille a une quantité sans libellé" />
        )}
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-muted2 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-xl border border-duck/15 bg-white shadow-olda ring-1 ring-black/5">
          <div className="max-h-[62vh] overflow-y-auto px-4 py-4">
            {/* ── Bloc 1 : quantités par taille ───────────────────────── */}
            <div className="flex flex-wrap items-end gap-2.5">
              {sizes.map((s) => {
                const labelMissing = s.qty > 0 && s.label.trim().length === 0;
                return (
                  <div key={s.id} className="relative flex w-[68px] flex-col items-stretch gap-1">
                    {s.custom ? (
                      <input
                        type="text"
                        value={s.label}
                        onChange={(e) => setLabel(s.id, e.target.value)}
                        placeholder="Taille"
                        maxLength={6}
                        aria-label="Libellé de la taille"
                        className={`w-full rounded-md border bg-white px-1 py-0.5 text-center text-[11px] font-bold uppercase text-ink placeholder:font-normal placeholder:normal-case placeholder:text-muted2/60 focus:outline-none focus:ring-1 focus:ring-duck-focus ${
                          labelMissing ? "border-amber-400 ring-1 ring-amber-300" : "border-duck/15 focus:border-duck-focus"
                        }`}
                      />
                    ) : (
                      <span className="text-center text-[11px] font-bold uppercase tracking-wider text-muted">
                        {s.label}
                      </span>
                    )}
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={s.qty === 0 ? "" : String(s.qty)}
                      onChange={(e) => setQty(s.id, e.target.value)}
                      placeholder="0"
                      aria-label={`Quantité ${s.label || "taille"}`}
                      className={`w-full rounded-lg border bg-white py-1.5 text-center text-base font-semibold tabular-nums sm:text-sm focus:outline-none focus:ring-1 focus:ring-duck-focus ${
                        s.qty > 0 ? "border-duck/40 text-ink" : "border-duck/15 text-muted2 placeholder:text-muted2/50"
                      }`}
                    />
                    {s.custom && (
                      <button
                        type="button"
                        onClick={() => removeSize(s.id)}
                        title="Supprimer cette taille"
                        aria-label="Supprimer cette taille"
                        className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-duck/15 bg-white text-muted2 shadow-sm transition before:absolute before:-inset-2 before:content-[''] hover:text-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Ajouter une taille personnalisée */}
              <button
                type="button"
                onClick={addCustom}
                className="flex h-[58px] w-[68px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-duck/30 text-[11px] font-medium text-duck transition hover:bg-duck/5 active:scale-[0.97]"
              >
                <Plus className="h-4 w-4" />
                Taille
              </button>
            </div>

            {/* ── Bloc 2 : dimension du logo par taille commandée ─────── */}
            {ordered.length > 0 && (
              <div className="mt-4 border-t border-duck/10 pt-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Dimension du logo par taille{" "}
                  <span className="font-normal normal-case text-muted2">— largeur × hauteur en mm</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {ordered.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <span className="w-12 flex-shrink-0 text-[11px] font-bold uppercase tracking-wider text-ink">
                        {s.label.trim().toUpperCase()}
                      </span>
                      <span className="w-12 flex-shrink-0 text-[11px] tabular-nums text-muted2">
                        {s.qty} pc{s.qty > 1 ? "s" : ""}
                      </span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={s.widthMm ?? ""}
                        onChange={(e) => setDim(s.id, "widthMm", e.target.value)}
                        placeholder="larg."
                        aria-label={`Largeur du logo pour la taille ${s.label} (mm)`}
                        className="w-16 rounded-lg border border-duck/15 bg-white px-2 py-1.5 text-center text-base tabular-nums sm:text-sm placeholder:text-muted2/60 focus:border-duck-focus focus:outline-none focus:ring-1 focus:ring-duck-focus"
                      />
                      <span className="text-muted2">×</span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={s.heightMm ?? ""}
                        onChange={(e) => setDim(s.id, "heightMm", e.target.value)}
                        placeholder="haut."
                        aria-label={`Hauteur du logo pour la taille ${s.label} (mm)`}
                        className="w-16 rounded-lg border border-duck/15 bg-white px-2 py-1.5 text-center text-base tabular-nums sm:text-sm placeholder:text-muted2/60 focus:border-duck-focus focus:outline-none focus:ring-1 focus:ring-duck-focus"
                      />
                      <span className="flex-shrink-0 text-xs font-semibold text-muted2">mm</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-duck/10 px-4 py-2.5">
            {missing ? (
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                Une taille a une quantité sans libellé — elle ne figurera pas sur le BAT.
              </p>
            ) : (
              <p className="text-[11px] text-muted2">
                Les dimensions du logo sont facultatives et propres à chaque taille.
              </p>
            )}
            {total > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="flex-shrink-0 rounded px-2 py-1 text-[11px] font-medium text-muted2 transition hover:text-ink"
              >
                Tout remettre à zéro
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
