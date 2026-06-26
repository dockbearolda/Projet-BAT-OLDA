import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, Loader2 } from "lucide-react";
import { CanvasStage } from "./canvas/CanvasStage";
import oldaLogoGlass from "./assets/olda-logo-glass.svg";
import { composeFacePng } from "./compose";
import { buildBatPdf, formatBatFilename } from "./pdf/buildPdf";
import { resolveSide } from "./sideView";
import { recolorSide } from "./sideRecolor";
import { OrderSizesEditor } from "./OrderSizesEditor";
import { activeOrderSizes, defaultOrderSizes, type OrderSize } from "./orderSizes";
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
  POCHETTE: "Pochette",
};

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [selectedRefId, setSelectedRefId] = useState<string>("");
  const [selectedColorSlug, setSelectedColorSlug] = useState<string>("");
  const [front, setFront] = useState<FaceState>(() => defaultFaceState("front"));
  const [back, setBack] = useState<FaceState>(() => defaultFaceState("back"));
  // Inclusion de chaque face principale dans le BAT (permet de ne garder que
  // l'avant OU l'arrière). Les deux incluses par défaut.
  const [frontIncluded, setFrontIncluded] = useState(true);
  const [backIncluded, setBackIncluded] = useState(true);
  // Tailles & quantités de la commande client (ex. 15 S · 2 M).
  const [orderSizes, setOrderSizes] = useState<OrderSize[]>(() => defaultOrderSizes());
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

  // Nouvelle référence = nouveau vêtement/nouveau job : on réinclut les deux
  // faces et on efface la taille de marquage (les dimensions décrivaient le
  // marquage de l'article précédent). Le changement de couleur, lui, conserve
  // tout (même article). Les tailles de commande restent (souvent ré-utilisées).
  useEffect(() => {
    setFrontIncluded(true);
    setBackIncluded(true);
    setFront((p) => (p.markSize ? { ...p, markSize: "" } : p));
    setBack((p) => (p.markSize ? { ...p, markSize: "" } : p));
  }, [selectedRefId]);

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

  // Inclure/exclure une face, en garantissant qu'il reste TOUJOURS au moins une
  // face avec un visuel dans le BAT (sinon le bouton se grise « pour rien »).
  function toggleFaceIncluded(face: "front" | "back", next: boolean) {
    if (!next) {
      const otherIncluded = face === "front" ? backIncluded : frontIncluded;
      const otherHasMockup = face === "front" ? backUrl !== null : frontUrl !== null;
      if (!(otherIncluded && otherHasMockup)) {
        showToast("Garde au moins une face avec un visuel dans le BAT", "info");
        return;
      }
    }
    if (face === "front") setFrontIncluded(next);
    else setBackIncluded(next);
  }

  // ─── Génération PDF ───────────────────────────────────────────────────
  const canGenerate =
    clientName.trim().length > 0 &&
    selectedRef !== null &&
    selectedColor !== null &&
    ((frontIncluded && front.logo !== null) ||
      (backIncluded && back.logo !== null) ||
      (showSides && (sideLeft.logo !== null || sideRight.logo !== null)));

  async function handleGenerate() {
    if (!canGenerate || !selectedRef || !selectedColor) return;
    setGenerating(true);
    try {
      const views: Array<{
        label: string;
        composedPng: Blob;
        cropXFraction?: number;
        markSize?: string;
      }> = [];
      if (frontUrl && frontIncluded) {
        const png = await composeFacePng(frontUrl, front);
        // La taille du marquage ne décrit un marquage que s'il y a un logo :
        // pas de légende « Marquage · … » sous un t-shirt nu.
        views.push({ label: "Avant", composedPng: png, markSize: front.logo ? front.markSize : undefined });
      }
      if (backUrl && backIncluded) {
        const png = await composeFacePng(backUrl, back);
        views.push({ label: "Arrière", composedPng: png, markSize: back.logo ? back.markSize : undefined });
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
        category: selectedRef.category,
        refInternal: selectedRef.refInternal,
        refSupplier: selectedRef.refSupplier,
        refLabel: selectedRef.label,
        technique: "DTF",
        colorLabel: selectedColor.label,
        colorHex: selectedColor.hex,
        views,
        orderSizes: activeOrderSizes(orderSizes),
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
        <Loader2 className="h-6 w-6 animate-spin text-muted2" />
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-full flex-col ${
        // En mode 2 vues (par défaut), l'app remplit exactement la hauteur de
        // l'écran sur grand format (tablette paysage, desktop) → les t-shirts
        // tiennent sans scroll. En mode 4 vues, on laisse défiler (les profils
        // gardent leur ratio 1:2 WYSIWYG).
        showSides ? "" : "lg:h-full lg:overflow-hidden"
      }`}
    >
      {/* ─── Header app ─────────────────────────────────────────────── */}
      <header className="olda-bar border-b border-white/50">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-4">
          <img
            src={oldaLogoGlass}
            alt="OLDA"
            width={44}
            height={44}
            className="h-11 w-11 flex-shrink-0"
          />
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            className="inline-flex items-center gap-2 rounded-xl bg-duck px-5 py-2.5 text-sm font-semibold text-white shadow-olda transition active:enabled:scale-[0.97] disabled:cursor-not-allowed disabled:bg-sage/70 disabled:text-white/90 disabled:shadow-none hover:enabled:bg-duck-hover"
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

      {/* ─── Form fields ────────────────────────────────────────────────
          relative z-30 : le backdrop-filter de .olda-bar crée un stacking
          context ; sans z explicite, les menus déroulants resteraient sous
          le <main> (mockups) peint après. On hisse la section au-dessus. */}
      <section className="relative z-30 olda-bar border-b border-white/50">
        <div className="mx-auto grid max-w-[1400px] gap-4 px-6 py-5 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
              Nom du client
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="ex. Dupont SARL"
              className="w-full rounded-lg border border-duck/15 bg-white px-3 py-2 text-sm placeholder:text-muted2/70 focus:border-duck-focus focus:outline-none focus:ring-1 focus:ring-duck-focus"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
              Référence
            </label>
            <RefSelector
              groups={groupedRefs}
              selected={selectedRef}
              onSelect={setSelectedRefId}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
              Couleur
            </label>
            <ColorSelector
              colors={selectedRef?.colors ?? []}
              selected={selectedColorSlug}
              onSelect={setSelectedColorSlug}
            />
          </div>
        </div>

        {/* Case discrète : ajoute les deux vues de côté (gauche + droite).
            Masquée pour les articles sans notion de côté (ex. pochette). */}
        {selectedRef && selectedRef.sleeveType !== "none" && (
          <div className="mx-auto max-w-[1400px] px-6 pb-4">
            <label
              className={`inline-flex items-center gap-2.5 text-sm ${
                sideAvailable ? "cursor-pointer text-muted" : "cursor-not-allowed text-muted2"
              }`}
            >
              <input
                type="checkbox"
                checked={sidesEnabled && sideAvailable}
                disabled={!sideAvailable}
                onChange={(e) => setSidesEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-duck/30 text-duck focus:ring-1 focus:ring-duck-focus disabled:opacity-50"
              />
              <span>Ajouter les vues de côté (manches gauche + droite)</span>
              {!sideAvailable && (
                <span className="text-xs text-muted2">— indisponible pour ce modèle</span>
              )}
            </label>
          </div>
        )}

        {/* Tailles & quantités de la commande client (15 S · 2 M…) */}
        <div className="mx-auto max-w-[1400px] px-6 pb-4">
          <OrderSizesEditor sizes={orderSizes} onChange={setOrderSizes} />
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
            : "max-w-[1400px] lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)] lg:min-h-0 lg:py-4"
        }`}
      >
        <CanvasStage
          face="front"
          label="Avant"
          mockupUrl={frontUrl}
          state={front}
          onChange={setFront}
          onError={(m) => showToast(m, "error")}
          fitHeight={!showSides}
          showMarkSize
          included={frontIncluded}
          onToggleIncluded={(next) => toggleFaceIncluded("front", next)}
        />
        <CanvasStage
          face="back"
          label="Arrière"
          mockupUrl={backUrl}
          state={back}
          onChange={setBack}
          onError={(m) => showToast(m, "error")}
          fitHeight={!showSides}
          showMarkSize
          included={backIncluded}
          onToggleIncluded={(next) => toggleFaceIncluded("back", next)}
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
      <footer className="olda-bar border-t border-white/50 px-6 py-3">
        <p className="mx-auto max-w-[1400px] text-center text-xs text-muted">
          Clique sur un t-shirt pour ajouter le logo. Glisse et redimensionne directement dessus (lignes rouges = centre).
          Génère le PDF, envoie-le au client — il valide d'un simple <span className="font-semibold text-ink">OK</span> sur WhatsApp.
        </p>
      </footer>

      {/* ─── Toast ───────────────────────────────────────────────────── */}
      {toast && (
        <div
          key={toast.id}
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
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
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-duck/15 bg-white px-3 py-2 text-sm transition hover:border-duck/35 focus:border-duck-focus focus:outline-none focus:ring-1 focus:ring-duck-focus"
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex-shrink-0 rounded-md bg-duck/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
              {familyLabel}
            </span>
            <span className="flex-shrink-0 font-semibold text-ink">{selected.refInternal}</span>
            <span className="truncate text-muted2">{selected.refSupplier}</span>
          </span>
        ) : (
          <span className="text-muted2">Choisir une référence</span>
        )}
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-muted2 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          ref={popupRef}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[60vh] overflow-y-auto rounded-xl border border-duck/12 bg-white py-1 shadow-olda ring-1 ring-black/5"
        >
          {groups.map((g) => (
            <div key={g.category}>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/95 px-3 pb-1.5 pt-2.5 backdrop-blur">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted2">
                  {g.label}
                </span>
                <span className="h-px flex-1 bg-duck/10" />
                <span className="text-[10px] font-medium text-muted2">
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
                      isSel ? "bg-duck/10" : "hover:bg-duck/5"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline gap-2">
                        <span className="font-semibold text-ink">{r.refInternal}</span>
                        <span className="truncate text-xs text-muted2">{r.refSupplier}</span>
                      </span>
                      <span className="mt-0.5 text-[11px] text-muted2">
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
      className={`inline-block flex-shrink-0 rounded-full ${isLightHex(hex) ? "border border-duck/25" : ""}`}
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
    return <div className="text-sm italic text-muted2">Aucune couleur</div>;
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-duck/15 bg-white px-3 py-2 text-sm transition hover:border-duck/35 focus:border-duck-focus focus:outline-none focus:ring-1 focus:ring-duck-focus"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {current ? (
            <>
              <ColorSwatch hex={current.hex} />
              <span className="truncate font-medium text-ink">{current.label}</span>
            </>
          ) : (
            <span className="text-muted2">Choisir une couleur</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted2 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          ref={popupRef}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-duck/12 bg-white py-1 shadow-olda"
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
                  isSel ? "bg-duck/10" : "hover:bg-duck/5"
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
