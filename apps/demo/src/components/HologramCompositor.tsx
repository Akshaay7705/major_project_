"use client";

/**
 * HologramCompositor.tsx
 * Real-time four-view Pepper's Ghost compositor for PMMA pyramid hologram.
 *
 * COORDINATE SYSTEM & TRANSFORM RATIONALE
 * The display lies flat (horizontal) with the pyramid on top, apex up.
 * Screen coords: (0,0) = top-left, X = right, Y = down.
 *
 * Each pyramid face is a 45° inclined mirror. For the avatar to appear
 * upright in each reflection, its head must point TOWARD the screen center:
 *
 *   BOTTOM (front face): head toward center → rotation 0°
 *   TOP    (back face):  head toward center → rotation 180°
 *   LEFT   (left face):  head points right  → rotation 90° CW
 *   RIGHT  (right face): head points left   → rotation 270° (90° CCW)
 *
 * Single canvas layout (3×3 cross, each cell = 1/3 W or H by default):
 *
 *   ┌──────────┬─────────────────┬──────────┐
 *   │  (black) │  VIEW 1  (TOP)  │  (black) │
 *   ├──────────┼─────────────────┼──────────┤
 *   │  VIEW 4  │  (black center) │  VIEW 2  │
 *   │  (LEFT)  │                 │ (RIGHT)  │
 *   ├──────────┼─────────────────┼──────────┤
 *   │  (black) │ VIEW 3 (BOTTOM) │  (black) │
 *   └──────────┴─────────────────┴──────────┘
 */

import React, { useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HologramConfig {
  whiteRemoval: {
    enabled: boolean;
    threshold: number;
    saturationMax: number;
    feather: number;
  };
  globalScale: number;
  offsetX: number;
  offsetY: number;
  flipH: boolean;
  flipV: boolean;
}

export const DEFAULT_HOLOGRAM_CONFIG: HologramConfig = {
  whiteRemoval: {
    enabled: true,
    threshold: 100,
    saturationMax: 40,
    feather: 25,
  },
  globalScale: 1.0,
  offsetX: 0,
  offsetY: 0,
  flipH: false,
  flipV: false,
};

// ─── HologramCompositor component ─────────────────────────────────────────────

interface HologramCompositorProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  config?: HologramConfig;
}

export const HologramCompositor: React.FC<HologramCompositorProps> = ({
  videoRef,
  config = DEFAULT_HOLOGRAM_CONFIG,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const keyCanvasRef = useRef<HTMLCanvasElement>(null);
  const outCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    const video = videoRef.current;
    const keyCanvas = keyCanvasRef.current;
    const outCanvas = outCanvasRef.current;
    const wrapper = wrapperRef.current;
    if (!video || !keyCanvas || !outCanvas || !wrapper) return;

    const keyCtx = keyCanvas.getContext("2d", { willReadFrequently: true })!;
    const outCtx = outCanvas.getContext("2d")!;

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      outCanvas.width = Math.round(entry.contentRect.width);
      outCanvas.height = Math.round(entry.contentRect.height);
    });
    ro.observe(wrapper);

    const drawFrame = () => {
      rafRef.current = requestAnimationFrame(drawFrame);
      if (video.readyState < 2) return;

      const cfg = configRef.current;
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const W = outCanvas.width || 1;
      const H = outCanvas.height || 1;

      if (keyCanvas.width !== vw || keyCanvas.height !== vh) {
        keyCanvas.width = vw;
        keyCanvas.height = vh;
      }
      keyCtx.drawImage(video, 0, 0, vw, vh);

      if (cfg.whiteRemoval.enabled) {
        const { threshold, saturationMax, feather } = cfg.whiteRemoval;
        const id = keyCtx.getImageData(0, 0, vw, vh);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i]!;
          const g = d[i + 1]!;
          const b = d[i + 2]!;
          const lum = r * 0.299 + g * 0.587 + b * 0.114;
          const sat = Math.max(r, g, b) - Math.min(r, g, b);
          if (lum > threshold && sat < saturationMax) {
            const excess = lum - threshold;
            d[i + 3] = Math.round(
              d[i + 3]! * Math.max(0, 1 - excess / feather),
            );
          }
        }
        keyCtx.putImageData(id, 0, 0);
      }

      outCtx.fillStyle = "#000";
      outCtx.fillRect(0, 0, W, H);

      outCtx.save();
      // Center and apply transforms
      outCtx.translate(W / 2 + cfg.offsetX, H / 2 + cfg.offsetY);
      outCtx.scale(
        cfg.flipH ? -cfg.globalScale : cfg.globalScale,
        cfg.flipV ? -cfg.globalScale : cfg.globalScale,
      );

      // Calculate how to scale video to cover or fit
      const scaleToFit = Math.min(W / vw, H / vh);
      const drawW = vw * scaleToFit;
      const drawH = vh * scaleToFit;

      outCtx.drawImage(keyCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
      outCtx.restore();
    };

    drawFrame();
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [videoRef]);

  return (
    <div ref={wrapperRef} className="absolute inset-0 w-full h-full bg-black">
      <canvas ref={keyCanvasRef} className="hidden" />
      <canvas
        ref={outCanvasRef}
        className="w-full h-full block"
        style={{ background: "#000" }}
      />
    </div>
  );
};

// ─── Calibration Panel ────────────────────────────────────────────────────────

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  onChange,
}) => (
  <div className="space-y-1">
    <div className="flex justify-between">
      <span className="text-white/50 text-xs uppercase tracking-wider">
        {label}
      </span>
      <span className="text-white/80 text-xs font-mono">
        {step < 1 ? value.toFixed(2) : value.toFixed(0)}
        {unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
      style={{ accentColor: "#ffffff" }}
    />
  </div>
);

interface ToggleProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  color?: string;
}

const Toggle: React.FC<ToggleProps> = ({
  label,
  value,
  onChange,
  color = "#ffffff",
}) => (
  <button
    onClick={() => onChange(!value)}
    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
      value
        ? "text-black border-transparent"
        : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"
    }`}
    style={value ? { background: color, borderColor: color } : {}}
  >
    {label}
  </button>
);

type PanelTab = "global" | "white";

export interface CalibrationPanelProps {
  config: HologramConfig;
  onChange: (cfg: HologramConfig) => void;
  onClose: () => void;
}

export const CalibrationPanel: React.FC<CalibrationPanelProps> = ({
  config,
  onChange,
  onClose,
}) => {
  const [tab, setTab] = useState<PanelTab>("global");

  const setGlobal = (patch: Partial<HologramConfig>) =>
    onChange({ ...config, ...patch });
  const setWhite = (patch: Partial<HologramConfig["whiteRemoval"]>) =>
    onChange({ ...config, whiteRemoval: { ...config.whiteRemoval, ...patch } });

  const tabs: { id: PanelTab; label: string }[] = [
    { id: "global", label: "Display" },
    { id: "white", label: "BG Key" },
  ];

  return (
    <div
      className="absolute left-4 top-1/2 -translate-y-1/2 z-50 w-72 rounded-2xl overflow-hidden"
      style={{
        background: "rgba(0,0,0,0.80)",
        backdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-white/90 text-sm font-semibold tracking-wide">
            Display Settings
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          ✕
        </button>
      </div>

      <div
        className="flex overflow-x-auto px-2 pt-2 pb-1 gap-1"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
            style={
              tab === id
                ? {
                    background: "rgba(255,255,255,0.1)",
                    color: "#ffffff",
                    border: "1px solid rgba(255,255,255,0.2)",
                  }
                : {
                    color: "rgba(255,255,255,0.4)",
                    border: "1px solid transparent",
                  }
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="px-4 pb-4 pt-3 space-y-4 max-h-96 overflow-y-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {tab === "global" && (
          <>
            <Slider
              label="Scale"
              value={config.globalScale}
              min={0.1}
              max={3}
              step={0.05}
              onChange={(v) => setGlobal({ globalScale: v })}
            />
            <Slider
              label="Offset X"
              value={config.offsetX}
              min={-500}
              max={500}
              step={1}
              unit="px"
              onChange={(v) => setGlobal({ offsetX: v })}
            />
            <Slider
              label="Offset Y"
              value={config.offsetY}
              min={-500}
              max={500}
              step={1}
              unit="px"
              onChange={(v) => setGlobal({ offsetY: v })}
            />

            <div
              className="pt-2"
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p className="text-white/50 text-xs uppercase tracking-wider mb-2">
                Mirror
              </p>
              <div className="flex gap-2">
                <Toggle
                  label="Flip H"
                  value={config.flipH}
                  onChange={(v) => setGlobal({ flipH: v })}
                />
                <Toggle
                  label="Flip V"
                  value={config.flipV}
                  onChange={(v) => setGlobal({ flipV: v })}
                />
              </div>
            </div>

            <div
              className="pt-2"
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
            >
              <button
                onClick={() => onChange(DEFAULT_HOLOGRAM_CONFIG)}
                className="w-full py-2 rounded-lg text-xs text-white/50 border border-white/10 hover:bg-white/5 hover:text-white/80 transition-all"
              >
                Reset to Defaults
              </button>
            </div>
          </>
        )}
        {tab === "white" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-white/60 text-xs uppercase tracking-wider">
                White BG Removal
              </span>
              <Toggle
                label={config.whiteRemoval.enabled ? "ON" : "OFF"}
                value={config.whiteRemoval.enabled}
                onChange={(v) => setWhite({ enabled: v })}
                color="#ff8844"
              />
            </div>
            <Slider
              label="Brightness Threshold"
              value={config.whiteRemoval.threshold}
              min={100}
              max={254}
              step={1}
              onChange={(v) => setWhite({ threshold: v })}
            />
            <Slider
              label="Saturation Max"
              value={config.whiteRemoval.saturationMax}
              min={0}
              max={120}
              step={1}
              onChange={(v) => setWhite({ saturationMax: v })}
            />
            <Slider
              label="Edge Feather"
              value={config.whiteRemoval.feather}
              min={1}
              max={80}
              step={1}
              unit="px"
              onChange={(v) => setWhite({ feather: v })}
            />
            <p className="text-white/30 text-xs leading-relaxed">
              Raise threshold to remove more white. Lower feather for hard
              edges, raise for soft blend.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
