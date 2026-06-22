import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, Loader2 } from "lucide-react";
import { CanvasStage } from "./canvas/CanvasStage";
import { composeFacePng } from "./compose";
import { buildBatPdf, formatBatFilename } from "./pdf/buildPdf";
import { resolveSide } from "./sideView";
import { recolorSide } from "./sideRecolor";
import {
  defaultFaceState,
  SIDE_VISIBLE_FRACTION,
  type ColorVariant,
  type FaceState,
  type Manifest,
  type RefEntry,
} from "./types";

type ToastKind = "info" | "error" | "success";
type Toast = { id: number; msg: string; kind: ToastKind } | null;

// Libellés de famille affichés dans les en-têtes du dropdown référence.
const CATEGORY_LABELS: Record<string, string> = {
  HOMME: "Homme",
  FEMME: "Femme",
  ENFANT: "Enfant",
  BEBE: "Bébé",
};

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [selectedRefId, setSelectedRefId] = useState<string>("");
  const [selectedColorSlug, setSelectedColorSlug] = useState<string>("");
  const [front, setFront] = useState<FaceState>(() => defaultFaceState("front"));
  const [back, setBack] = useState<FaceState>(() => defaultFaceState("back"));
  // Vues de côté optionnelles : gauche (image d'origine) + droite (miroir).
  const [sideLeft, setSideLeft] = useState<FaceState>(() => defaultFaceState("sideLeft"));
  const [sideRight, setSideRight] = useState<FaceState>(() => defaultFaceState("sideRight"));
  const [sidesEnabled, setSidesEnabled] = useState(false);
  const [sideMockupUrl, setSideMockupUrl] = useState<string | null>(null);
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

  // Regroupe les références par famille (refs déjà triées par catégorie).
  const groupedRefs = useMemo(() => {
    const groups: { category: string; label: string; refs: RefEntry[] }[] = [];
    for (const r of manifest?.refs ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.category === r.category) last.refs.push(r);
      else
        groups.push({
          category: r.category,
          label: CATEGORY_LABELS[r.category] ?? r.category,
          refs: [r],
        });
    }
    return groups;
  }, [manifest]);

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

  // ─── Vue de côté : résolution image (propre / empruntée / recolorée) ────
  const sideResolution = useMemo(() => {
    if (!manifest || !selectedRef || !selectedColor) return null;
    return resolveSide(
      selectedRef,
      selectedColor,
      manifest.sideLibrary,
      manifest.sideTemplates,
    );
  }, [manifest, selectedRef, selectedColor]);

  const sideAvailable = sideResolution !== null && sideResolution.kind !== "unavailable";

  // Résout l'URL d'image du côté : directe (own/borrowed) ou recolorée à la
  // volée (recolor). Annulable pour ne pas appliquer un résultat périmé.
  useEffect(() => {
    let cancelled = false;
    if (!sideResolution || sideResolution.kind === "unavailable") {
      setSideMockupUrl(null);
      return;
    }
    if (sideResolution.kind === "recolor") {
      // On efface l'image AVANT le calcul async : pendant la recoloration,
      // sideMockupUrl=null → showSides devient faux (les côtés disparaissent et
      // sont exclus du PDF), donc jamais de couleur périmée affichée/exportée.
      setSideMockupUrl(null);
      recolorSide(sideResolution.templateUrl, sideResolution.hex)
        .then((url) => {
          if (!cancelled) setSideMockupUrl(url);
        })
        .catch(() => {
          if (!cancelled) setSideMockupUrl(null);
        });
    } else {
      setSideMockupUrl(sideResolution.url);
    }
    return () => {
      cancelled = true;
    };
  }, [sideResolution]);

  // Si les vues côté deviennent indisponibles (réf manche longue), on désactive.
  useEffect(() => {
    if (!sideAvailable && sidesEnabled) setSidesEnabled(false);
  }, [sideAvailable, sidesEnabled]);

  const showSides = sidesEnabled && sideAvailable && sideMockupUrl !== null;

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
    (front.logo !== null ||
      back.logo !== null ||
      (showSides && (sideLeft.logo !== null || sideRight.logo !== null)));

  async function handleGenerate() {
    if (!canGenerate || !selectedRef || !selectedColor) return;
    setGenerating(true);
    try {
      const views: Array<{
        label: string;
        composedPng: Blob;
        cropXFraction?: number;
      }> = [];
      if (frontUrl) {
        const png = await composeFacePng(frontUrl, front);
        views.push({ label: "Avant", composedPng: png });
      }
      if (backUrl) {
        const png = await composeFacePng(backUrl, back);
        views.push({ label: "Arrière", composedPng: png });
      }
      if (showSides && sideMockupUrl) {
        // Gauche = miroir, droite = image d'origine. Slots étroits + rognés.
        const leftPng = await composeFacePng(sideMockupUrl, sideLeft, 2000, true);
        const rightPng = await composeFacePng(sideMockupUrl, sideRight, 2000, false);
        views.push({
          label: "Côté gauche",
          composedPng: leftPng,
          cropXFraction: SIDE_VISIBLE_FRACTION,
        });
        views.push({
          label: "Côté droit",
          composedPng: rightPng,
          cropXFraction: SIDE_VISIBLE_FRACTION,
        });
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
          <OldaLogo className="h-10 w-auto text-ink" />
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
            <RefSelector
              groups={groupedRefs}
              selected={selectedRef}
              onSelect={setSelectedRefId}
            />
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

        {/* Case discrète : ajoute les deux vues de côté (gauche + droite). */}
        <div className="mx-auto max-w-[1400px] px-6 pb-4">
          <label
            className={`inline-flex items-center gap-2.5 text-sm ${
              sideAvailable ? "cursor-pointer text-slate-600" : "cursor-not-allowed text-slate-400"
            }`}
          >
            <input
              type="checkbox"
              checked={sidesEnabled && sideAvailable}
              disabled={!sideAvailable}
              onChange={(e) => setSidesEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-ink focus:ring-1 focus:ring-ink disabled:opacity-50"
            />
            <span>Ajouter les vues de côté (manches gauche + droite)</span>
            {!sideAvailable && selectedRef && (
              <span className="text-xs text-slate-400">— indisponible (manche longue)</span>
            )}
          </label>
        </div>
      </section>

      {/* ─── Canvas avant / arrière / côtés ─────────────────────────────
          Avant/Arrière = bulles larges. Côté gauche/droit = bulles ÉTROITES
          (profil rogné), t-shirts à la MÊME hauteur. La droite est le miroir
          de la gauche (un t-shirt est symétrique) ; le logo n'est jamais
          miroité. */}
      <main
        className={`mx-auto flex w-full flex-1 flex-col gap-6 px-6 py-6 lg:grid ${
          showSides
            ? "max-w-[1700px] lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-start"
            : "max-w-[1400px] lg:grid-cols-2 lg:items-start"
        }`}
      >
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
        {showSides && (
          <>
            <CanvasStage
              face="sideLeft"
              label="Côté gauche"
              mockupUrl={sideMockupUrl}
              state={sideLeft}
              onChange={setSideLeft}
              onError={(m) => showToast(m, "error")}
              cover
              mirror
            />
            <CanvasStage
              face="sideRight"
              label="Côté droit"
              mockupUrl={sideMockupUrl}
              state={sideRight}
              onChange={setSideRight}
              onError={(m) => showToast(m, "error")}
              cover
            />
          </>
        )}
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

// ─── OldaLogo : logo officiel OLDA (inline SVG, hérite de currentColor) ──
function OldaLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="55 68 174 176" aria-label="OLDA" fill="currentColor" className={className}>
      <path d="M187.85,114.63h33.12c.82,0,1.48.66,1.48,1.48v34.05c0,.82-.66,1.48-1.48,1.48h-73.22c-.82,0-1.48-.66-1.48-1.48v-76.52c0-.82.66-1.48,1.48-1.48h37.15c.82,0,1.48.66,1.48,1.48v39.51c0,.82.66,1.48,1.48,1.48Z" />
      <path d="M141.24,238.96l41.28-77.18c.58-1.05,2.09-1.05,2.67,0l41.39,77.18c.56,1.02-.18,2.26-1.34,2.26h-82.67c-1.16,0-1.89-1.24-1.34-2.26Z" />
      <path d="M101.44,161.74h-2.56l.48,79.48h1.16c20.68,0,38.61-15.44,40.49-36.03,2.14-23.57-16.43-43.44-39.57-43.44Z" />
      <path d="M95.36,161.74h-32.71c-.82,0-1.48.66-1.48,1.48v76.52c0,.82.66,1.48,1.48,1.48h32.26l.45-79.48Z" />
      <path d="M140.12,108.5c-1.61-20.24-18-36.63-38.24-38.24-25.72-2.04-47.09,19.32-45.05,45.04,1.6,20.24,18,36.64,38.24,38.25.12,0,.23,0,.34.02l.23-39.79v-.05l-11.32,11.07s-1.19-11.25,6.13-12.84h-13s4.12-7.32,14.54-4.85l-7.67-7.67s11.86-1.72,12.82,6.62c1.07-8.9,12.54-6.48,12.54-6.48l-7.92,8.04c8.81-3.63,14.91,4.33,14.91,4.33h-13.05c4.85,1.4,6.01,6.08,6.2,9.41.14,2.05-.12,3.59-.12,3.59l-3.54-3.59-7.55-7.62.24,39.91c24-.2,43.23-20.71,41.29-45.17Z" />
    </svg>
  );
}

// ─── RefSelector : dropdown référence premium, groupé par famille ────────
function RefSelector({
  groups,
  selected,
  onSelect,
}: {
  groups: { category: string; label: string; refs: RefEntry[] }[];
  selected: RefEntry | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    if (!open || !popupRef.current) return;
    const sel = popupRef.current.querySelector<HTMLElement>("[data-selected='true']");
    sel?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const familyLabel = selected
    ? CATEGORY_LABELS[selected.category] ?? selected.category
    : "";

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm transition hover:border-slate-400 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex-shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {familyLabel}
            </span>
            <span className="flex-shrink-0 font-semibold text-ink">{selected.refInternal}</span>
            <span className="truncate text-slate-400">{selected.refSupplier}</span>
          </span>
        ) : (
          <span className="text-slate-400">Choisir une référence</span>
        )}
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          ref={popupRef}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl ring-1 ring-black/5"
        >
          {groups.map((g) => (
            <div key={g.category}>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/95 px-3 pb-1.5 pt-2.5 backdrop-blur">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {g.label}
                </span>
                <span className="h-px flex-1 bg-slate-100" />
                <span className="text-[10px] font-medium text-slate-300">
                  {g.refs.length}
                </span>
              </div>
              {g.refs.map((r) => {
                const isSel = selected?.id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    data-selected={isSel}
                    onClick={() => {
                      onSelect(r.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
                      isSel ? "bg-slate-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline gap-2">
                        <span className="font-semibold text-ink">{r.refInternal}</span>
                        <span className="truncate text-xs text-slate-400">{r.refSupplier}</span>
                      </span>
                      <span className="mt-0.5 text-[11px] text-slate-400">
                        {r.colors.length} coloris
                      </span>
                    </span>
                    {isSel ? (
                      <Check className="h-4 w-4 flex-shrink-0 text-ink" />
                    ) : (
                      <span className="h-4 w-4 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ColorSwatch : petit rond couleur (utilisé dans le selector) ────────
// Bordure ajoutée pour les couleurs claires (blanc, crème, ivoire…) afin
// qu'elles restent visibles sur le fond blanc du dropdown.
function isLightHex(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.82;
}

function ColorSwatch({ hex, size = 14 }: { hex: string; size?: number }) {
  return (
    <span
      className={`inline-block flex-shrink-0 rounded-full ${isLightHex(hex) ? "border border-slate-300" : ""}`}
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
