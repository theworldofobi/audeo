"use client";

import { useEffect, useRef, useState } from "react";
import { useReader } from "@/lib/store";
import { MAX_RATE, MIN_RATE, RATE_PRESETS, VOICES } from "@/lib/tts/types";

interface Props {
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSkip: (seconds: number) => void;
  onRate: (rate: number) => void;
  onVoice: (voice: string) => void;
}

export function PlayerBar({
  onToggle,
  onPrev,
  onNext,
  onSkip,
  onRate,
  onVoice,
}: Props) {
  const playing = useReader((s) => s.playing);
  const loading = useReader((s) => s.loading);
  const rate = useReader((s) => s.rate);
  const voice = useReader((s) => s.voice);
  const [showSpeed, setShowSpeed] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);

  // Close the speed popover on outside click or Escape.
  useEffect(() => {
    if (!showSpeed) return;
    const onDown = (e: PointerEvent) => {
      if (!speedRef.current?.contains(e.target as Node)) setShowSpeed(false);
    };
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setShowSpeed(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showSpeed]);

  return (
    <div className="border-t border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-1">
          <IconButton label="Previous sentence (←)" onClick={onPrev}>
            <path d="M6 6h2v12H6zM9.5 12 18 18V6z" />
          </IconButton>
          <IconButton
            label="Back 10 seconds (Shift+←)"
            onClick={() => onSkip(-10)}
          >
            <path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
          </IconButton>
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing || loading ? "Pause (Space)" : "Play (Space)"}
            data-testid="play"
            className="mx-1 grid h-14 w-14 place-items-center rounded-full bg-violet-600 text-white shadow-lg transition hover:bg-violet-700 active:scale-95"
          >
            {loading ? (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : playing ? (
              <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 fill-current">
                <path d="M7 4v16l13-8z" />
              </svg>
            )}
          </button>
          <IconButton
            label="Forward 10 seconds (Shift+→)"
            onClick={() => onSkip(10)}
          >
            <path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z" />
          </IconButton>
          <IconButton label="Next sentence (→)" onClick={onNext}>
            <path d="M16 6h2v12h-2zM14.5 12 6 18V6z" />
          </IconButton>
        </div>

        <div className="flex items-center gap-3">
          <div ref={speedRef} className="relative">
            <button
              type="button"
              onClick={() => setShowSpeed((v) => !v)}
              className="min-w-16 rounded-full border border-neutral-300 px-3 py-1.5 text-sm font-semibold tabular-nums hover:bg-neutral-50"
              aria-label="Playback speed"
              data-testid="speed"
            >
              {rate.toFixed(1)}×
            </button>
            {showSpeed && (
              <div className="absolute bottom-12 right-0 z-20 w-72 rounded-xl border border-neutral-200 bg-white p-4 shadow-xl">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">Speed</span>
                  <span className="tabular-nums text-neutral-500">
                    {rate.toFixed(1)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={MIN_RATE}
                  max={MAX_RATE}
                  step={0.1}
                  value={rate}
                  onChange={(e) => onRate(Number(e.target.value))}
                  className="w-full accent-violet-600"
                  aria-label="Speed"
                  data-testid="speed-slider"
                />
                <div className="mt-3 flex justify-between gap-1">
                  {RATE_PRESETS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => onRate(r)}
                      data-testid={`speed-${r}`}
                      className={`flex-1 rounded-md py-1 text-sm ${
                        Math.abs(rate - r) < 0.05
                          ? "bg-violet-600 text-white"
                          : "bg-neutral-100 hover:bg-neutral-200"
                      }`}
                    >
                      {r}×
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <select
            value={voice}
            onChange={(e) => onVoice(e.target.value)}
            className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            aria-label="Voice"
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-full text-neutral-700 hover:bg-neutral-100"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
        {children}
      </svg>
    </button>
  );
}
