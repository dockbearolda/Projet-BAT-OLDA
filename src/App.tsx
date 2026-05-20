import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, Loader2 } from "lucide-react";
import { CanvasStage } from "./canvas/CanvasStage";
import { composeFacePng } from "./compose";
import { buildBatPdf, formatBatFilename } from "./pdf/buildPdf";
import {
  defaultFaceState,
  type ColorVariant,
  type FaceState,
  type Manifest,
  type RefEntry,
} from "./types";

type ToastKind = "info" | "error" | "success";
type Toast = { id: number; msg: string; kind: ToastKind } | null;

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [selectedRefId, setSelectedRefId] = useState<string>("");
  const [selectedColorSlug, setSelectedColorSlug] = useState<string>("");
  const [front, setFront] = useState<FaceState>(() => defaultFaceState("front"));
  const [back, setBack] = useState<FaceState>(() => defaultFaceState("back"));
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<number | null>(null);

  // ─── Charge le manifest au montage ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/manifest.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((m: Manifest) => {
        if (cancelled) return;
        setManifest(m);
        if (m.refs.length > 0) {
          const firstRef = m.refs[0];
          setSelectedRefId(firstRef.id);
          if (firstRef.colors.length > 0) setSelectedColorSlug(firstRef.colors[0].slug);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Refs/couleurs dérivés ────────────────────────────────────────────
  const selectedRef: RefEntry | null = useMemo(
    () => manifest?.refs.find((r) => r.id === selectedRefId) ?? null,
    [manifest, selectedRefId],
  );

  const selectedColor: ColorVariant | null = useMemo(
    () => selectedRef?.colors.find((c) => c.slug === selectedColorSlug) ?? null,
    [selectedRef, selectedColorSlug],
  );

  // Quand on change de référence, si la couleur courante n'existe pas
  // dans la nouvelle ref, on retombe sur sa 1ère couleur disponible.
  useEffect(() => {
    if (!selectedRef) return;
    const stillValid = selectedRef.colors.some((c) => c.slug === selectedColorSlug);
    if (!stillValid && selectedRef.colors.length > 0) {
      setSelectedColorSlug(selectedRef.colors[0].slug);
    }
  }, [selectedRef, selectedColorSlug]);

  const frontUrl = selectedColor?.front ?? null;
  const backUrl = selectedColor?.back ?? null;

  // ─── Toast helper ─────────────────────────────────────────────────────
  function showToast(msg: string, kind: ToastKind = "info") {
    setToast({ id: Date.now(), msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  // ─── Génération PDF ───────────────────────────────────────────────────
  const canGenerate =
    clientName.trim().length > 0 &&
    selectedRef !== null &&
    selectedColor !== null &&
    (front.logo !== null || back.logo !== null);

  async function handleGenerate() {
    if (!canGenerate || !selectedRef || !selectedColor) return;
    setGenerating(true);
    try {
      const views: Array<{ label: string; composedPng: Blob }> = [];
      if (frontUrl) {
        const png = await composeFacePng(frontUrl, front);
        views.push({ label: "Avant", composedPng: png });
      }
      if (backUrl) {
        const png = await composeFacePng(backUrl, back);
        views.push({ label: "Arrière", composedPng: png });
      }

      const input = {
        clientName: clientName.trim(),
        date: new Date(),
        refLabel: selectedRef.label,
        colorLabel: selectedColor.label,
        views,
      };
      const blob = await buildBatPdf(input);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = formatBatFilename(input);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("PDF généré et téléchargé", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Échec génération PDF", "error");
    } finally {
      setGenerating(false);
    }
  }

  // ─── Rendu ────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <div className="font-semibold">Impossible de charger le catalogue.</div>
          <div className="mt-1 text-xs">{loadError}</div>
          <div className="mt-3 text-xs text-red-600">
            Vérifie que <code className="rounded bg-red-100 px-1">public/manifest.json</code> existe (lance <code className="rounded bg-red-100 px-1">npm run manifest</code>).
          </div>
        </div>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* ─── Header app ─────────────────────────────────────────────── */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-10 rounded-md bg-ink">
              <div className="absolute bottom-0 right-0 h-2 w-2 translate-x-1 translate-y-1 bg-accent" />
              <div className="flex h-full items-center justify-center text-base font-bold text-white">D</div>
            </div>
            <div>
              <div className="text-sm font-bold uppercase tracking-wider text-ink">Atelier OLDA</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Générateur de BAT
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-slate-300 hover:enabled:bg-black"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {generating ? "Génération…" : "Générer le PDF"}
          </button>
        </div>
      </header>

      {/* ─── Form fields ────────────────────────────────────────────── */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-[1400px] gap-4 px-6 py-5 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Nom du client
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="ex. Dupont SARL"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Référence
            </label>
            <select
              value={selectedRefId}
              onChange={(e) => setSelectedRefId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            >
              {manifest.refs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.category} · {r.label} ({r.colors.length} couleurs)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Couleur
            </label>
            <ColorSelector
              colors={selectedRef?.colors ?? []}
              selected={selectedColorSlug}
              onSelect={setSelectedColorSlug}
            />
          </div>
        </div>
      </section>

      {/* ─── Canvas avant / arrière ─────────────────────────────────── */}
      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-6 py-6 lg:grid lg:grid-cols-2 lg:items-start">
        <CanvasStage
          face="front"
          label="Avant"
          mockupUrl={frontUrl}
          state={front}
          onChange={setFront}
          onError={(m) => showToast(m, "error")}
        />
        <CanvasStage
          face="back"
          label="Arrière"
          mockupUrl={backUrl}
          state={back}
          onChange={setBack}
          onError={(m) => showToast(m, "error")}
        />
      </main>

      {/* ─── Footer aide ─────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-white px-6 py-3">
        <p className="mx-auto max-w-[1400px] text-center text-xs text-slate-500">
          Clique sur un t-shirt pour ajouter le logo. Glisse et redimensionne directement dessus (lignes rouges = centre).
          Génère le PDF, envoie-le au client — il valide d'un simple <span className="font-semibold text-ink">OK</span> sur WhatsApp.
        </p>
      </footer>

      {/* ─── Toast ───────────────────────────────────────────────────── */}
      {toast && (
        <div
          key={toast.id}
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            toast.kind === "error"
              ? "bg-red-600 text-white"
              : toast.kind === "success"
                ? "bg-emerald-600 text-white"
                : "bg-ink text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── ColorSwatch : petit rond couleur (utilisé dans le selector) ────────
function ColorSwatch({ hex, size = 14 }: { hex: string; size?: number }) {
  const isWhite = hex.toUpperCase() === "#FFFFFF";
  return (
    <span
      className={`inline-block flex-shrink-0 rounded-full ${isWhite ? "border border-slate-300" : ""}`}
      style={{ backgroundColor: hex, width: size, height: size }}
      aria-hidden
    />
  );
}

// ─── ColorSelector : dropdown custom avec dot + nom ─────────────────────
function ColorSelector({
  colors,
  selected,
  onSelect,
}: {
  colors: ColorVariant[];
  selected: string;
  onSelect: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Click-outside ferme
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

  // Scroll auto vers la couleur sélectionnée à l'ouverture
  useLayoutEffect(() => {
    if (!open || !popupRef.current) return;
    const sel = popupRef.current.querySelector<HTMLElement>("[data-selected='true']");
    sel?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const current = colors.find((c) => c.slug === selected) ?? null;

  if (colors.length === 0) {
    return <div className="text-sm italic text-slate-400">Aucune couleur</div>;
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm transition hover:border-slate-400 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {current ? (
            <>
              <ColorSwatch hex={current.hex} />
              <span className="truncate font-medium text-ink">{current.label}</span>
            </>
          ) : (
            <span className="text-slate-400">Choisir une couleur</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          ref={popupRef}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {colors.map((c) => {
            const isSel = c.slug === selected;
            return (
              <button
                key={c.slug}
                type="button"
                role="option"
                aria-selected={isSel}
                data-selected={isSel}
                onClick={() => {
                  onSelect(c.slug);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${
                  isSel ? "bg-slate-100" : "hover:bg-slate-50"
                }`}
              >
                <ColorSwatch hex={c.hex} />
                <span className="flex-1 truncate text-ink">{c.label}</span>
                {isSel && <Check className="h-4 w-4 flex-shrink-0 text-ink" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
