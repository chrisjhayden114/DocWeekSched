import { clientPointToPercent } from "@event-app/shared";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

export type FloorPlanPin = {
  id: string;
  roomLabel: string;
  x: number;
  y: number;
  linkedRoomId?: string | null;
  linkedRoom?: { id: string; name: string } | null;
};

type Props = {
  imageUrl: string;
  pins: FloorPlanPin[];
  /** Zoom to and highlight this pin (View on map). */
  focusPinId?: string | null;
  selectedPinId?: string | null;
  onSelectPin?: (pin: FloorPlanPin) => void;
  /** Organizer: click empty floor to place a pin. */
  dropMode?: boolean;
  onDropPin?: (x: number, y: number) => void;
  /** Organizer: drag existing pin. */
  onMovePin?: (pinId: string, x: number, y: number) => void;
  className?: string;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

/**
 * Floor plan with percentage-stable pins, pinch/scroll zoom, and pan.
 * Designed to work at ~390px width.
 */
export function FloorPlanCanvas({
  imageUrl,
  pins,
  focusPinId,
  selectedPinId,
  onSelectPin,
  dropMode,
  onDropPin,
  onMovePin,
  className,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panOrigin = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchOrigin = useRef<{ dist: number; scale: number } | null>(null);
  const dragPin = useRef<{ id: string; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  const clampPan = useCallback((nextTx: number, nextTy: number, nextScale: number) => {
    const el = viewportRef.current;
    if (!el) return { tx: nextTx, ty: nextTy };
    const w = el.clientWidth;
    const h = el.clientHeight;
    const maxX = ((nextScale - 1) * w) / 2 + w * 0.15;
    const maxY = ((nextScale - 1) * h) / 2 + h * 0.15;
    return {
      tx: Math.min(maxX, Math.max(-maxX, nextTx)),
      ty: Math.min(maxY, Math.max(-maxY, nextTy)),
    };
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextScale: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = clientX - rect.left - rect.width / 2;
      const cy = clientY - rect.top - rect.height / 2;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const ratio = s / scale;
      const rawTx = cx - (cx - tx) * ratio;
      const rawTy = cy - (cy - ty) * ratio;
      const clamped = clampPan(rawTx, rawTy, s);
      setScale(s);
      setTx(clamped.tx);
      setTy(clamped.ty);
    },
    [clampPan, scale, tx, ty],
  );

  useEffect(() => {
    if (!focusPinId) return;
    const pin = pins.find((p) => p.id === focusPinId);
    const el = viewportRef.current;
    if (!pin || !el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const targetScale = 2.2;
    const pinPxX = ((pin.x / 100) * w - w / 2) * targetScale;
    const pinPxY = ((pin.y / 100) * h - h / 2) * targetScale;
    const clamped = clampPan(-pinPxX, -pinPxY, targetScale);
    setScale(targetScale);
    setTx(clamped.tx);
    setTy(clamped.ty);
  }, [focusPinId, pins, clampPan]);

  function onWheel(e: ReactWheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(e.clientX, e.clientY, scale * factor);
  }

  function onPointerDown(e: ReactPointerEvent) {
    const target = e.target as HTMLElement;
    const pinId = target.closest("[data-pin-id]")?.getAttribute("data-pin-id");
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinId && onMovePin) {
      dragPin.current = { id: pinId, moved: false };
      return;
    }

    if (pointers.current.size === 1) {
      panOrigin.current = { x: e.clientX, y: e.clientY, tx, ty };
      pinchOrigin.current = null;
    } else if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchOrigin.current = { dist, scale };
      panOrigin.current = null;
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (dragPin.current && onMovePin) {
      const layer = viewportRef.current?.querySelector(".floor-plan-layer") as HTMLElement | null;
      if (!layer) return;
      const rect = layer.getBoundingClientRect();
      const { x, y } = clientPointToPercent(e.clientX, e.clientY, rect);
      dragPin.current.moved = true;
      skipClick.current = true;
      onMovePin(dragPin.current.id, x, y);
      return;
    }

    if (pointers.current.size === 2 && pinchOrigin.current) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchOrigin.current.dist > 0) {
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        zoomAt(midX, midY, pinchOrigin.current.scale * (dist / pinchOrigin.current.dist));
      }
      return;
    }

    if (panOrigin.current && pointers.current.size === 1) {
      const dx = e.clientX - panOrigin.current.x;
      const dy = e.clientY - panOrigin.current.y;
      if (Math.hypot(dx, dy) > 4) skipClick.current = true;
      const clamped = clampPan(panOrigin.current.tx + dx, panOrigin.current.ty + dy, scale);
      setTx(clamped.tx);
      setTy(clamped.ty);
    }
  }

  function onPointerUp(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchOrigin.current = null;
    if (pointers.current.size === 0) {
      panOrigin.current = null;
      dragPin.current = null;
    }
  }

  function onLayerClick(e: ReactMouseEvent) {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    const pinEl = (e.target as HTMLElement).closest("[data-pin-id]");
    if (pinEl) {
      const id = pinEl.getAttribute("data-pin-id");
      const pin = pins.find((p) => p.id === id);
      if (pin) onSelectPin?.(pin);
      return;
    }
    if (dropMode && onDropPin) {
      const layer = e.currentTarget as HTMLElement;
      const rect = layer.getBoundingClientRect();
      const { x, y } = clientPointToPercent(e.clientX, e.clientY, rect);
      onDropPin(x, y);
    }
  }

  return (
    <div className={`floor-plan-viewport ${className || ""}`.trim()} ref={viewportRef} onWheel={onWheel}>
      <div
        className="floor-plan-transform"
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={`floor-plan-layer${dropMode ? " is-drop-mode" : ""}`}
          onClick={onLayerClick}
          role="presentation"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="floor-plan-image" draggable={false} />
          {pins.map((pin) => {
            const focused = pin.id === focusPinId || pin.id === selectedPinId;
            return (
              <button
                key={pin.id}
                type="button"
                className={`floor-plan-pin${focused ? " is-focused" : ""}`}
                style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                data-pin-id={pin.id}
                aria-label={pin.linkedRoom?.name || pin.roomLabel}
                title={pin.linkedRoom?.name || pin.roomLabel}
              />
            );
          })}
        </div>
      </div>
      <div className="floor-plan-zoom-controls" aria-hidden>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            const el = viewportRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, scale * 1.2);
          }}
        >
          +
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            const el = viewportRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, scale / 1.2);
          }}
        >
          −
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setScale(1);
            setTx(0);
            setTy(0);
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
