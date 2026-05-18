import Konva from "konva";
import { ImagePlus, RotateCw, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Image as KonvaImage, Layer, Line, Stage, Transformer } from "react-konva";
import { ingestLogo, IngestError } from "../ingest";
import type { Face, FaceState } from "../types";

const SNAP_TOLERANCE = 4;
const MIN_LOGO_WIDTH_PCT = 5;
const MAX_LOGO_WIDTH_PCT = 80;
const LOGO_ACCEPT = "image/png,image/jpeg,image/svg+xml,application/pdf";

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
  onChange: (next: FaceState) => void;
  onError?: (msg: string) => void;
}

export function CanvasStage({
  face,
  label,
  mockupUrl,
  state,
  onChange,
  onError,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<Konva.Image>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const { width: boxW, height: boxH } = useContainerSize(containerRef);
  const mockupImg = useCachedImage(mockupUrl);
  const logoImg = useCachedImage(state.logo?.dataUrl ?? null);

  const mockupAspect = mockupImg ? mockupImg.naturalWidth / mockupImg.naturalHeight : 1;

  const stageSize = useMemo(() => {
    if (!boxW || !boxH) return { width: 0, height: 0 };
    const fitW = Math.min(boxW, boxH * mockupAspect);
    const fitH = fitW / mockupAspect;
    return { width: Math.round(fitW), height: Math.round(fitH) };
  }, [boxW, boxH, mockupAspect]);

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
      const cx = stageSize.width / 2;
      const cy = stageSize.height / 2;
      let x = node.x();
      let y = node.y();
      const snapV = Math.abs(x - cx) < SNAP_TOLERANCE;
      const snapH = Math.abs(y - cy) < SNAP_TOLERANCE;
      if (snapV) x = cx;
      if (snapH) y = cy;
      node.x(x);
      node.y(y);
      setSnap({ v: snapV, h: snapH });
    },
    [stageSize.width, stageSize.height],
  );

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setSnap({ v: false, h: false });
      if (!stageSize.width) return;
      const node = e.target;
      onChange({
        ...state,
        posXPct: clamp((node.x() / stageSize.width) * 100, 0, 100),
        posYPct: clamp((node.y() / stageSize.height) * 100, 0, 100),
      });
    },
    [stageSize.width, stageSize.height, onChange, state],
  );

  const handleTransformEnd = useCallback(() => {
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
      posXPct: clamp((node.x() / stageSize.width) * 100, 0, 100),
      posYPct: clamp((node.y() / stageSize.height) * 100, 0, 100),
      sizePct: Math.round(newSizePct),
    });
  }, [stageSize.width, stageSize.height, onChange, state]);

  async function handleLogoFile(f: File) {
    try {
      const asset = await ingestLogo(f);
      onChange({ ...state, logo: asset });
    } catch (err) {
      const msg = err instanceof IngestError ? err.message : "Logo illisible";
      onError?.(msg);
    }
  }

  const hasLogo = state.logo !== null;
  const hasMockup = mockupUrl !== null;
  const openFilePicker = () => logoInputRef.current?.click();

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {hasLogo && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openFilePicker}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-ink"
              title="Remplacer le logo"
            >
              <RotateCw className="h-3.5 w-3.5" /> Remplacer
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...state, logo: null })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-red-50 hover:text-accent"
              title="Retirer le logo"
            >
              <Trash2 className="h-3.5 w-3.5" /> Retirer
            </button>
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        onClick={hasMockup && !hasLogo ? openFilePicker : undefined}
        className={`group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${
          hasMockup && !hasLogo ? "cursor-pointer transition hover:border-ink hover:shadow-md" : ""
        }`}
      >
        {!hasMockup ? (
          <div className="px-6 text-center text-sm text-slate-400">
            Sélectionne d'abord une référence + couleur
          </div>
        ) : stageSize.width > 0 ? (
          <Stage width={stageSize.width} height={stageSize.height}>
            <Layer listening={false}>
              {mockupImg && (
                <KonvaImage
                  image={mockupImg}
                  x={0}
                  y={0}
                  width={stageSize.width}
                  height={stageSize.height}
                  listening={false}
                />
              )}
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
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onTransformEnd={handleTransformEnd}
                />
              )}
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                keepRatio
                enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
                boundBoxFunc={(oldBox, newBox) => {
                  const minPx = (MIN_LOGO_WIDTH_PCT / 100) * stageSize.width;
                  const maxPx = (MAX_LOGO_WIDTH_PCT / 100) * stageSize.width;
                  if (newBox.width < minPx || newBox.width > maxPx) return oldBox;
                  return newBox;
                }}
              />
              {snap.v && (
                <Line
                  points={[stageSize.width / 2, 0, stageSize.width / 2, stageSize.height]}
                  stroke="#E8001C"
                  strokeWidth={1}
                  dash={[4, 4]}
                  listening={false}
                />
              )}
              {snap.h && (
                <Line
                  points={[0, stageSize.height / 2, stageSize.width, stageSize.height / 2]}
                  stroke="#E8001C"
                  strokeWidth={1}
                  dash={[4, 4]}
                  listening={false}
                />
              )}
            </Layer>
          </Stage>
        ) : null}

        {/* Overlay "Cliquez pour importer" — visible uniquement quand mockup + pas de logo */}
        {hasMockup && !hasLogo && (
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-4">
            <div className="rounded-full bg-ink/85 px-4 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur transition group-hover:bg-ink">
              <span className="inline-flex items-center gap-2">
                <ImagePlus className="h-4 w-4" />
                Cliquez pour importer le logo
              </span>
            </div>
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
    </div>
  );
}
