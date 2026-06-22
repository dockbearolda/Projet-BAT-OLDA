import Konva from "konva";
import { Check } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage, Text, Transformer } from "react-konva";
import { ingestLogo, IngestError } from "../ingest";
import { LOGO_PALETTE, tintLogo } from "../logoColor";
import {
  clearDefaultOverride,
  loadDefaultOverride,
  saveDefaultOverride,
  SIDE_VISIBLE_FRACTION,
  type Face,
  type FaceState,
} from "../types";

const SNAP_TOLERANCE = 4;
const MIN_LOGO_WIDTH_PCT = 5;
const MAX_LOGO_WIDTH_PCT = 80;
const LOGO_ACCEPT = "image/png,image/jpeg,image/svg+xml,application/pdf";

const DUCK = "#4A6274";

// Rayon d'aimantation d'une zone, en % de la largeur du mockup.
const ZONE_SNAP_PCT = 5;

interface MarkingZone {
  id: string;
  label: string;
  xPct: number; // cible du CENTRE du logo
  yPct: number;
}

// Zones de marquage standard (impression textile). Le logo s'aimante au centre
// de la zone la plus proche. Côtés : pas de zone (marquage manche libre).
const MARKING_ZONES: Partial<Record<Face, MarkingZone[]>> = {
  front: [
    { id: "centre", label: "Centre poitrine", xPct: 50, yPct: 32 },
    { id: "coeur", label: "Cœur", xPct: 62, yPct: 29 },
  ],
  back: [
    { id: "dos", label: "Dos complet", xPct: 50, yPct: 35 },
    { id: "nuque", label: "Nuque", xPct: 50, yPct: 14 },
  ],
};

const imageCache = new Map<string, HTMLImageElement>();

function useCachedImage(src: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(() => {
    if (!src) return null;
    const hit = imageCache.get(src);
    return hit && hit.complete && hit.naturalWidth > 0 ? hit : null;
  });

  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const hit = imageCache.get(src);
    if (hit && hit.complete && hit.naturalWidth > 0) {
      setImg(hit);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      imageCache.set(src, image);
      setImg(image);
    };
    image.onerror = () => {
      if (!cancelled) setImg(null);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return img;
}

function useContainerSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export interface CanvasStageProps {
  face: Face;
  label: string;
  mockupUrl: string | null;
  state: FaceState;
  onChange: (next: FaceState | ((prev: FaceState) => FaceState)) => void;
  onError?: (msg: string) => void;
  /** Rognage par la hauteur : le mockup remplit la hauteur de la bulle et son
   *  blanc latéral déborde (clippé). Pour les profils étroits (vues de côté). */
  cover?: boolean;
  /** Miroir horizontal du mockup (le logo n'est jamais miroité). Vue droite. */
  mirror?: boolean;
  /** Sur grand écran, la bulle remplit la hauteur dispo (au lieu d'être carrée)
   *  pour que le t-shirt tienne sans scroll en paysage tablette. */
  fitHeight?: boolean;
}

export function CanvasStage({
  face,
  label,
  mockupUrl,
  state,
  onChange,
  onError,
  cover = false,
  mirror = false,
  fitHeight = false,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<Konva.Image>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const { width: boxW, height: boxH } = useContainerSize(containerRef);
  const mockupImg = useCachedImage(mockupUrl);
  const logoImg = useCachedImage(state.logoTintedUrl ?? state.logo?.dataUrl ?? null);

  const mockupAspect = mockupImg ? mockupImg.naturalWidth / mockupImg.naturalHeight : 1;

  const stageSize = useMemo(() => {
    if (!boxW || !boxH) return { width: 0, height: 0 };
    if (cover) {
      // Remplit la hauteur ; la largeur (mockup carré) déborde et est clippée
      // par la bulle → profil étroit, t-shirt à pleine hauteur.
      const fitH = boxH;
      const fitW = fitH * mockupAspect;
      return { width: Math.round(fitW), height: Math.round(fitH) };
    }
    const fitW = Math.min(boxW, boxH * mockupAspect);
    const fitH = fitW / mockupAspect;
    return { width: Math.round(fitW), height: Math.round(fitH) };
  }, [boxW, boxH, mockupAspect, cover]);

  const logoAspect = useMemo(() => {
    if (!state.logo) return 1;
    return state.logo.naturalWidth / state.logo.naturalHeight;
  }, [state.logo]);

  const logoPx = useMemo(() => {
    if (!stageSize.width || !state.logo) return null;
    const width = (state.sizePct / 100) * stageSize.width;
    const height = width / logoAspect;
    const x = (state.posXPct / 100) * stageSize.width;
    const y = (state.posYPct / 100) * stageSize.height;
    return { x, y, width, height };
  }, [stageSize, state, logoAspect]);

  const [snap, setSnap] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  // Pendant un drag/resize, on masque la croix de suppression (sa position est
  // dérivée de l'état, qui ne se met à jour qu'en fin d'interaction).
  const [interacting, setInteracting] = useState(false);
  // Zone magnétique actuellement "accrochée" (mise en évidence).
  const [activeZone, setActiveZone] = useState<string | null>(null);
  // Lecture live de la position/taille pendant le drag/resize.
  const [live, setLive] = useState<{ xPct: number; yPct: number; sizePct: number } | null>(null);
  // Une position par défaut perso est-elle enregistrée pour cette face ?
  const [hasCustomDefault, setHasCustomDefault] = useState(() => loadDefaultOverride(face) !== null);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const zones = useMemo(() => MARKING_ZONES[face] ?? [], [face]);

  useEffect(() => {
    setHasCustomDefault(loadDefaultOverride(face) !== null);
  }, [face]);

  function setAsDefault() {
    saveDefaultOverride(face, {
      posXPct: state.posXPct,
      posYPct: state.posYPct,
      sizePct: state.sizePct,
    });
    setHasCustomDefault(true);
    setSavedFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1600);
  }

  function resetDefault() {
    clearDefaultOverride(face);
    setHasCustomDefault(false);
  }

  useEffect(() => {
    const tr = transformerRef.current;
    const node = logoRef.current;
    if (!tr) return;
    if (node && logoImg) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    } else {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
    }
  }, [logoImg, state.logo, face]);

  const handleDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (!stageSize.width) return;
      const node = e.target;
      const w = stageSize.width;
      const h = stageSize.height;
      let x = node.x();
      let y = node.y();

      // Aimantation aux zones standard (cible = centre du logo).
      let zoneId: string | null = null;
      if (zones.length) {
        let best = (ZONE_SNAP_PCT / 100) * w;
        let bx = x;
        let by = y;
        for (const z of zones) {
          const zx = (z.xPct / 100) * w;
          const zy = (z.yPct / 100) * h;
          const d = Math.hypot(x - zx, y - zy);
          if (d < best) {
            best = d;
            bx = zx;
            by = zy;
            zoneId = z.id;
          }
        }
        if (zoneId) {
          x = bx;
          y = by;
        }
      }

      // Repère centre (uniquement si aucune zone n'est accrochée).
      const cx = w / 2;
      const cy = h / 2;
      const snapV = !zoneId && Math.abs(x - cx) < SNAP_TOLERANCE;
      const snapH = !zoneId && Math.abs(y - cy) < SNAP_TOLERANCE;
      if (snapV) x = cx;
      if (snapH) y = cy;

      node.x(x);
      node.y(y);
      setSnap({ v: snapV, h: snapH });
      setActiveZone(zoneId);
      setLive({
        xPct: clamp((x / w) * 100, 0, 100),
        yPct: clamp((y / h) * 100, 0, 100),
        sizePct: state.sizePct,
      });
    },
    [stageSize.width, stageSize.height, zones, state.sizePct],
  );

  // En mode cover (vues de côté), seule la bande centrale est visible/exportée
  // (largeur SIDE_VISIBLE_FRACTION). On y borne la position X du logo pour
  // qu'il ne puisse pas être lâché dans la zone latérale rognée.
  const xMinPct = cover ? 50 - 50 * SIDE_VISIBLE_FRACTION : 0;
  const xMaxPct = cover ? 50 + 50 * SIDE_VISIBLE_FRACTION : 100;

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setSnap({ v: false, h: false });
      setInteracting(false);
      setActiveZone(null);
      setLive(null);
      if (!stageSize.width) return;
      const node = e.target;
      onChange({
        ...state,
        posXPct: clamp((node.x() / stageSize.width) * 100, xMinPct, xMaxPct),
        posYPct: clamp((node.y() / stageSize.height) * 100, 0, 100),
      });
    },
    [stageSize.width, stageSize.height, onChange, state, xMinPct, xMaxPct],
  );

  // Lecture live de la taille pendant le redimensionnement.
  const handleTransform = useCallback(() => {
    const node = logoRef.current;
    if (!node || !stageSize.width) return;
    const wpx = Math.max(1, node.width() * node.scaleX());
    const sizePct = clamp((wpx / stageSize.width) * 100, MIN_LOGO_WIDTH_PCT, MAX_LOGO_WIDTH_PCT);
    setLive({
      xPct: clamp((node.x() / stageSize.width) * 100, 0, 100),
      yPct: clamp((node.y() / stageSize.height) * 100, 0, 100),
      sizePct: Math.round(sizePct),
    });
  }, [stageSize.width, stageSize.height]);

  const handleTransformEnd = useCallback(() => {
    setInteracting(false);
    setActiveZone(null);
    setLive(null);
    const node = logoRef.current;
    if (!node || !stageSize.width) return;
    const scaleX = node.scaleX();
    node.scaleX(1);
    node.scaleY(1);
    const newWidthPx = Math.max(1, node.width() * scaleX);
    const newSizePct = clamp(
      (newWidthPx / stageSize.width) * 100,
      MIN_LOGO_WIDTH_PCT,
      MAX_LOGO_WIDTH_PCT,
    );
    onChange({
      ...state,
      posXPct: clamp((node.x() / stageSize.width) * 100, xMinPct, xMaxPct),
      posYPct: clamp((node.y() / stageSize.height) * 100, 0, 100),
      sizePct: Math.round(newSizePct),
    });
  }, [stageSize.width, stageSize.height, onChange, state, xMinPct, xMaxPct]);

  async function handleLogoFile(f: File) {
    try {
      const asset = await ingestLogo(f);
      // updater fonctionnel : ne pas écraser une position/taille modifiée pendant l'await
      onChange((prev) => ({ ...prev, logo: asset, logoTint: null, logoTintedUrl: null }));
    } catch (err) {
      const msg = err instanceof IngestError ? err.message : "Logo illisible";
      onError?.(msg);
    }
  }

  async function applyTint(hex: string | null) {
    if (!state.logo) return;
    if (hex === null) {
      onChange((prev) => ({ ...prev, logoTint: null, logoTintedUrl: null }));
      return;
    }
    try {
      const url = await tintLogo(state.logo.dataUrl, hex);
      // updater fonctionnel : un drag/resize pendant le calcul du tint n'est pas perdu
      onChange((prev) => ({ ...prev, logoTint: hex, logoTintedUrl: url }));
    } catch {
      onError?.("Recoloration impossible");
    }
  }

  function removeLogo() {
    const container = logoRef.current?.getStage()?.container();
    if (container) container.style.cursor = "default";
    onChange((prev) => ({ ...prev, logo: null, logoTint: null, logoTintedUrl: null }));
  }

  const hasLogo = state.logo !== null;
  const hasMockup = mockupUrl !== null;
  const openFilePicker = () => logoInputRef.current?.click();

  // Valeurs affichées dans le bandeau live : valeurs en cours de manip si dispo,
  // sinon valeurs validées de l'état.
  const disp = live ?? { xPct: state.posXPct, yPct: state.posYPct, sizePct: state.sizePct };
  const activeZoneLabel = activeZone ? zones.find((z) => z.id === activeZone)?.label : null;

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
        {hasLogo && (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={setAsDefault}
              title="Mémoriser cette position et cette taille comme départ des prochains logos de cette face"
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-duck transition hover:bg-duck/10"
            >
              {savedFlash ? "✓ Enregistré" : "Définir par défaut"}
            </button>
            {hasCustomDefault && (
              <button
                type="button"
                onClick={resetDefault}
                title="Revenir à la position standard"
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted2 transition hover:text-ink"
              >
                Réinitialiser
              </button>
            )}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        onClick={hasMockup && !hasLogo ? openFilePicker : undefined}
        className={`olda-glass group relative flex w-full items-center justify-center overflow-hidden rounded-2xl ${
          // Côté : aspect 1:2 (= SIDE_VISIBLE_FRACTION) à TOUS les breakpoints,
          // pour que la fenêtre visible == la zone rognée du PDF (WYSIWYG).
          // fitHeight : carré en mobile, mais remplit la hauteur dispo en lg+
          // (le t-shirt se met à l'échelle et tient sans scroll en paysage).
          cover
            ? "aspect-[1/2]"
            : fitHeight
              ? "aspect-square lg:aspect-auto lg:min-h-0 lg:flex-1"
              : "aspect-square"
        } ${
          hasMockup && !hasLogo ? "cursor-pointer transition hover:border-duck/40 hover:shadow-olda" : ""
        }`}
      >
        {!hasMockup ? (
          <div className="px-6 text-center text-sm text-muted2">
            Sélectionne d'abord une référence + couleur
          </div>
        ) : stageSize.width > 0 ? (
          <Stage width={stageSize.width} height={stageSize.height}>
            <Layer listening={false}>
              {mockupImg && (
                <KonvaImage
                  image={mockupImg}
                  x={mirror ? stageSize.width : 0}
                  y={0}
                  width={stageSize.width}
                  height={stageSize.height}
                  scaleX={mirror ? -1 : 1}
                  listening={false}
                />
              )}

              {/* Zones magnétiques standard : repères discrets, affichés tant
                  qu'aucun logo n'est posé OU pendant le déplacement. La zone
                  active (logo aimanté) est mise en évidence. */}
              {zones.length > 0 &&
                (!hasLogo || interacting) &&
                zones.map((z) => {
                  const zx = (z.xPct / 100) * stageSize.width;
                  const zy = (z.yPct / 100) * stageSize.height;
                  const on = activeZone === z.id;
                  return (
                    <Group key={z.id} listening={false} opacity={on ? 1 : 0.5}>
                      <Circle
                        x={zx}
                        y={zy}
                        radius={on ? 10 : 7}
                        stroke={DUCK}
                        strokeWidth={on ? 2 : 1.25}
                        dash={on ? undefined : [3, 3]}
                        fill={on ? "rgba(74,98,116,0.16)" : undefined}
                      />
                      <Line points={[zx - 13, zy, zx + 13, zy]} stroke={DUCK} strokeWidth={1} opacity={on ? 0.9 : 0.4} />
                      <Line points={[zx, zy - 13, zx, zy + 13]} stroke={DUCK} strokeWidth={1} opacity={on ? 0.9 : 0.4} />
                      <Text
                        x={zx - 60}
                        y={zy + 14}
                        width={120}
                        align="center"
                        text={z.label}
                        fontSize={10}
                        fontStyle={on ? "bold" : "normal"}
                        fill={DUCK}
                      />
                    </Group>
                  );
                })}
            </Layer>
            <Layer>
              {logoImg && logoPx && (
                <KonvaImage
                  ref={logoRef}
                  image={logoImg}
                  x={logoPx.x}
                  y={logoPx.y}
                  width={logoPx.width}
                  height={logoPx.height}
                  offsetX={logoPx.width / 2}
                  offsetY={logoPx.height / 2}
                  draggable
                  onDragStart={() => setInteracting(true)}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onTransformStart={() => setInteracting(true)}
                  onTransform={handleTransform}
                  onTransformEnd={handleTransformEnd}
                />
              )}
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                keepRatio
                enabledAnchors={["top-left", "bottom-left", "bottom-right"]}
                boundBoxFunc={(oldBox, newBox) => {
                  const minPx = (MIN_LOGO_WIDTH_PCT / 100) * stageSize.width;
                  const maxPx = (MAX_LOGO_WIDTH_PCT / 100) * stageSize.width;
                  if (newBox.width < minPx || newBox.width > maxPx) return oldBox;
                  return newBox;
                }}
              />

              {/* Croix rouge de suppression, placée JUSTE EN DEHORS du coin
                  haut-droit du logo : décalée en diagonale d'au moins r/√2 pour
                  que sa zone tactile (r=20) ne chevauche jamais le corps du logo
                  ni les poignées restantes, même à la taille minimale. */}
              {logoImg && logoPx && !interacting && (
                <Group
                  x={clamp(logoPx.x + logoPx.width / 2 + 16, 14, stageSize.width - 14)}
                  y={clamp(logoPx.y - logoPx.height / 2 - 16, 14, stageSize.height - 14)}
                  onClick={removeLogo}
                  onTap={removeLogo}
                  onMouseEnter={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = "pointer";
                  }}
                  onMouseLeave={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = "default";
                  }}
                >
                  {/* zone tactile (~40px) */}
                  <Circle radius={20} fill="rgba(0,0,0,0.001)" />
                  <Circle
                    radius={12}
                    fill="#DC2626"
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    shadowColor="#000000"
                    shadowBlur={4}
                    shadowOpacity={0.25}
                  />
                  <Line points={[-4.5, -4.5, 4.5, 4.5]} stroke="#FFFFFF" strokeWidth={2} lineCap="round" />
                  <Line points={[-4.5, 4.5, 4.5, -4.5]} stroke="#FFFFFF" strokeWidth={2} lineCap="round" />
                </Group>
              )}
              {snap.v && (
                <Line
                  points={[stageSize.width / 2, 0, stageSize.width / 2, stageSize.height]}
                  stroke="#DC2626"
                  strokeWidth={1}
                  dash={[4, 4]}
                  listening={false}
                />
              )}
              {snap.h && (
                <Line
                  points={[0, stageSize.height / 2, stageSize.width, stageSize.height / 2]}
                  stroke="#DC2626"
                  strokeWidth={1}
                  dash={[4, 4]}
                  listening={false}
                />
              )}
            </Layer>
          </Stage>
        ) : null}

        {/* Bandeau live : position + taille du logo (et zone aimantée). */}
        {hasLogo && stageSize.width > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-ink/85 px-2 py-1 text-[10px] font-medium tabular-nums text-white shadow-sm">
            {activeZoneLabel && (
              <span className="font-semibold normal-case tracking-normal text-white">{activeZoneLabel} · </span>
            )}
            X {Math.round(disp.xPct)}%  ·  Y {Math.round(disp.yPct)}%  ·  L {Math.round(disp.sizePct)}%
          </div>
        )}

        <input
          ref={logoInputRef}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleLogoFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Bandeau de couleurs sous le t-shirt : visible quand le logo est
          monochrome (recolorable). Clic = recoloration immédiate. */}
      {state.logo?.isMonochrome && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted2">
              Couleur du logo
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => applyTint(null)}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition ${
                  state.logoTint === null ? "bg-duck/10 text-ink" : "text-muted2 hover:text-ink"
                }`}
              >
                Original
              </button>
              <input
                type="color"
                value={state.logoTint ?? "#000000"}
                onChange={(e) => applyTint(e.target.value.toUpperCase())}
                title="Couleur personnalisée"
                className="h-6 w-7 cursor-pointer rounded border border-duck/15 bg-white"
              />
            </div>
          </div>
          <div className="olda-glass flex flex-wrap justify-center gap-2 rounded-xl p-2.5">
            {LOGO_PALETTE.map(({ name, hex }) => {
              const sel = state.logoTint?.toUpperCase() === hex.toUpperCase();
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => applyTint(hex)}
                  title={name}
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition hover:scale-110 ${
                    isLight(hex) ? "border border-duck/25" : ""
                  } ${sel ? "ring-2 ring-duck-focus ring-offset-1" : ""}`}
                  style={{ backgroundColor: hex }}
                >
                  {sel && (
                    <Check className={`h-3.5 w-3.5 ${isLight(hex) ? "text-ink" : "text-white"}`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── isLight : couleur claire ? (bordure des pastilles claires) ─────────
function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.82;
}
