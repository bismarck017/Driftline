"use client";

import { useEffect, useRef, useState } from "react";
import { CARS, type CarSpec } from "@/game/cars";
import { DriveGame, type HudStats } from "@/game/engine";
import { CarPreview } from "./CarPreview";
import { Minimap } from "./Minimap";
import { Button } from "@/components/ui/button";

type View = "garage" | "drive";

interface DayNightPrefs {
  cycle: boolean;
  dayLength: number; // real seconds per in-world day
  time: number; // locked hour [0, 24)
}

const DEFAULT_DN: DayNightPrefs = { cycle: true, dayLength: 240, time: 10 };

function loadDayNightPrefs(): DayNightPrefs {
  try {
    const raw = window.localStorage.getItem("driftline-daynight");
    if (raw) {
      const p = JSON.parse(raw) as Partial<DayNightPrefs>;
      return {
        cycle: typeof p.cycle === "boolean" ? p.cycle : DEFAULT_DN.cycle,
        dayLength: typeof p.dayLength === "number" ? p.dayLength : DEFAULT_DN.dayLength,
        time: typeof p.time === "number" ? p.time : DEFAULT_DN.time,
      };
    }
  } catch {
    // private mode — defaults are fine
  }
  return DEFAULT_DN;
}

function formatClock(hours: number): string {
  const h = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDayLength(sec: number): string {
  return sec < 120 ? `${sec}s` : sec % 60 === 0 ? `${sec / 60}min` : `${(sec / 60).toFixed(1)}min`;
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-xs font-medium tracking-wide text-stone-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-900/10">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.round(value * 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.9rem] items-center justify-center rounded-lg border border-stone-300/70 bg-white/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-stone-600 shadow-sm">
      {children}
    </kbd>
  );
}

export function GameClient() {
  const [view, setView] = useState<View>("garage");
  const [carIndex, setCarIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [radius, setRadius] = useState(2); // 2 => 5x5, 1 => 3x3
  const [shadows, setShadows] = useState(true);
  const [stats, setStats] = useState<HudStats | null>(null);
  const [showHints, setShowHints] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [unit, setUnit] = useState<"kmh" | "mph">(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem("driftline-unit") === "mph") {
      return "mph";
    }
    return "kmh";
  });
  const [dn, setDn] = useState<DayNightPrefs>(() =>
    typeof window === "undefined" ? DEFAULT_DN : loadDayNightPrefs(),
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DriveGame | null>(null);
  const carRef = useRef<CarSpec>(CARS[0]);
  const settingsRef = useRef({ radius, shadows });
  const dnRef = useRef(dn);

  // persist day-night prefs (best-effort)
  useEffect(() => {
    try {
      window.localStorage.setItem("driftline-daynight", JSON.stringify(dn));
    } catch {
      // private mode — persistence is best-effort only
    }
  }, [dn]);

  // keep refs in sync outside of render (they are read when the engine boots)
  useEffect(() => {
    carRef.current = CARS[carIndex];
    settingsRef.current = { radius, shadows };
    dnRef.current = dn;
  }, [carIndex, radius, shadows, dn]);

  const selectedCar = CARS[carIndex];

  // engine lifecycle — created when entering the drive view
  useEffect(() => {
    if (view !== "drive") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: DriveGame | null = null;
    // give the loading overlay a frame to paint before the synchronous world build
    const timer = window.setTimeout(() => {
      const { radius: r, shadows: sh } = settingsRef.current;
      try {
        engine = new DriveGame(canvas, carRef.current, {
          renderRadius: r,
          shadows: sh,
          onHud: (s) => setStats(s),
          timeOfDay: dnRef.current.time,
          cycleEnabled: dnRef.current.cycle,
          dayLength: dnRef.current.dayLength,
        });
        engineRef.current = engine;
        engine.start();
        setLoading(false);
        setShowHints(true);
      } catch (err) {
        console.error("[Driftline] engine failed to start:", err instanceof Error ? err.stack : String(err));
        setFatal(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }, 80);
    return () => {
      window.clearTimeout(timer);
      engine?.dispose();
      engineRef.current = null;
    };
  }, [view]);

  // fade the control hints after a few seconds of driving
  useEffect(() => {
    if (view !== "drive" || loading) return;
    const t = window.setTimeout(() => setShowHints(false), 8000);
    return () => window.clearTimeout(t);
  }, [view, loading, paused]);

  // ESC toggles pause while driving
  useEffect(() => {
    if (view !== "drive") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        setPaused((p) => {
          const next = !p;
          if (next) engineRef.current?.pause();
          else engineRef.current?.resume();
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const toggleUnit = () => {
    setUnit((u) => {
      const next = u === "kmh" ? "mph" : "kmh";
      try {
        window.localStorage.setItem("driftline-unit", next);
      } catch {
        // private mode — persistence is best-effort only
      }
      return next;
    });
  };

  // ── day-night controls ──────────────────────────────────────────────────
  const toggleCycle = () => {
    const cycle = !dn.cycle;
    setDn((d) => ({ ...d, cycle, time: cycle ? d.time : stats?.tod ?? d.time }));
    if (cycle) engineRef.current?.setCycle(true, dn.dayLength);
    else engineRef.current?.setCycle(false); // freezes at the current world time
  };

  const changeDayLength = (v: number) => {
    setDn((d) => ({ ...d, dayLength: v }));
    if (dn.cycle) engineRef.current?.setCycle(true, v);
  };

  const changeLockedTime = (v: number) => {
    setDn((d) => ({ ...d, cycle: false, time: v }));
    engineRef.current?.lockTimeOfDay(v);
  };

  const backToGarage = () => {
    setPaused(false);
    setStats(null);
    setFatal(null);
    setView("garage");
  };

  // ── garage ──────────────────────────────────────────────────────────────────
  if (view === "garage") {
    return (
      <div className="min-h-screen w-full bg-gradient-to-b from-[#f8f3e9] via-[#f2ecdd] to-[#e9e2cf] text-stone-800">
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8">
          <header className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-stone-400">
                Open world drive
              </p>
              <h1 className="mt-1 text-4xl font-bold tracking-tight text-stone-800 sm:text-5xl">
                Driftline
              </h1>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-stone-500">
                A calm, endless procedural world of pastel meadows, rivers and
                winding roads. Pick a car, then just drive.
              </p>
            </div>
            <span className="hidden rounded-full border border-stone-300/70 bg-white/50 px-4 py-1.5 text-xs font-medium text-stone-500 sm:block">
              Infinite tile-streamed terrain · roads never break
            </span>
          </header>

          <main className="mt-8 grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr]">
            {/* 3D preview */}
            <section className="relative overflow-hidden rounded-3xl border border-white/70 bg-white/50 shadow-xl shadow-stone-900/5 backdrop-blur">
              <div className="absolute left-5 top-5 z-10 rounded-2xl bg-stone-800/90 px-4 py-2">
                <p className="text-sm font-semibold text-[#f6efe2]">{selectedCar.name}</p>
                <p className="text-[11px] text-[#f6efe2]/70">{selectedCar.tag}</p>
              </div>
              <div className="absolute bottom-5 right-5 z-10 flex items-center gap-2 text-[11px] text-stone-500">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: selectedCar.body }} />
                <span className="font-medium">{selectedCar.body.toUpperCase()}</span>
                <span className="text-stone-400">· hand-built low-poly</span>
              </div>
              <CarPreview spec={selectedCar} className="h-[340px] w-full sm:h-[420px]" />
            </section>

            {/* car picker + stats */}
            <section className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-3">
                {CARS.map((car, i) => (
                  <button
                    key={car.id}
                    onClick={() => setCarIndex(i)}
                    aria-pressed={i === carIndex}
                    className={`group rounded-2xl border p-4 text-left transition-all duration-300 ${
                      i === carIndex
                        ? "border-stone-800/30 bg-white/80 shadow-lg shadow-stone-900/10"
                        : "border-white/70 bg-white/40 hover:bg-white/65 hover:shadow-md"
                    }`}
                  >
                    <span
                      className="mb-3 block h-10 w-10 rounded-xl transition-transform duration-300 group-hover:scale-105"
                      style={{ backgroundColor: car.body, boxShadow: `0 6px 14px -6px ${car.body}` }}
                    />
                    <span className="block text-sm font-semibold text-stone-800">{car.name}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-stone-500">
                      {car.tag}
                    </span>
                    <span className="mt-2 flex gap-1.5">
                      {Object.values(car.bars).map((v, k) => (
                        <span key={k} className="h-1 flex-1 overflow-hidden rounded-full bg-stone-900/10">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.round(v * 100)}%`,
                              backgroundColor: i === carIndex ? car.accent : "rgba(120,113,108,0.45)",
                            }}
                          />
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>

              <div className="rounded-3xl border border-white/70 bg-white/50 p-6 shadow-xl shadow-stone-900/5 backdrop-blur">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-400">
                  {selectedCar.name} · spec sheet
                </h2>
                <div className="mt-4 flex flex-col gap-3">
                  <StatBar label="Top speed" value={selectedCar.bars.speed} color={selectedCar.accent} />
                  <StatBar label="Accel" value={selectedCar.bars.accel} color={selectedCar.accent} />
                  <StatBar label="Handling" value={selectedCar.bars.grip} color={selectedCar.accent} />
                  <StatBar label="Off-road" value={selectedCar.bars.offroad} color={selectedCar.accent} />
                </div>
                <Button
                  size="lg"
                  className="mt-6 w-full rounded-2xl bg-stone-800 text-[#f6efe2] hover:bg-stone-700"
                  onClick={() => {
                    setLoading(true);
                    setView("drive");
                  }}
                >
                  Drive the {selectedCar.name}
                </Button>
                <p className="mt-3 text-center text-[11px] text-stone-400">
                  Keyboard recommended — <KeyCap>W A S D</KeyCap> to drive, <KeyCap>Esc</KeyCap> to pause
                </p>
              </div>
            </section>
          </main>

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-stone-300/50 pt-5 text-[11px] text-stone-400">
            <span>Procedural world · tile streaming 3×3 / 5×5 · roads, rivers & biomes generated on the fly</span>
            <span className="flex items-center gap-2">
              <KeyCap>W</KeyCap><KeyCap>A</KeyCap><KeyCap>S</KeyCap><KeyCap>D</KeyCap> drive
              <KeyCap>Space</KeyCap> handbrake
              <KeyCap>C</KeyCap> camera
              <KeyCap>R</KeyCap> back to road
            </span>
          </footer>
        </div>
      </div>
    );
  }

  // ── drive ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#e8dcc8]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {fatal && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-[#f4eee1] px-6 text-center">
          <p className="text-sm font-semibold text-red-700">The engine could not start</p>
          <p className="max-w-md font-mono text-xs text-stone-500">{fatal}</p>
          <Button variant="outline" className="rounded-2xl" onClick={backToGarage}>
            Back to garage
          </Button>
        </div>
      )}

      {loading && !fatal && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[#f4eee1]">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-stone-300 border-t-stone-700" />
          <p className="text-sm font-medium text-stone-500">Generating the world around you…</p>
        </div>
      )}

      {!loading && stats && (
        <>
          {/* speed panel — click to switch km/h ⇄ mph */}
          <button
            onClick={toggleUnit}
            aria-label={`Speed in ${unit === "kmh" ? "kilometres per hour" : "miles per hour"}. Click to switch units.`}
            className="absolute left-5 top-5 z-10 flex cursor-pointer select-none items-end gap-3 rounded-3xl bg-white/70 px-6 py-4 text-left shadow-xl shadow-stone-900/10 backdrop-blur-md transition-all hover:bg-white/85 active:scale-[0.97]"
          >
            <span className="text-5xl font-bold tabular-nums leading-none text-stone-800">
              {unit === "kmh" ? stats.kmh : Math.round(stats.kmh * 0.621371)}
            </span>
            <span className="flex flex-col gap-0.5 pb-1">
              <span className="text-xs font-semibold uppercase tracking-widest text-stone-500">
                {unit === "kmh" ? "km/h" : "mph"}
              </span>
              <span className="text-[9px] leading-none text-stone-400">tap to switch</span>
            </span>
          </button>

          {/* biome + position + world clock */}
          <div className="pointer-events-none absolute bottom-5 left-5 z-10 rounded-2xl bg-white/70 px-5 py-3 shadow-lg shadow-stone-900/10 backdrop-blur-md">
            <p className="flex items-center gap-2 text-sm font-semibold text-stone-700">
              {stats.biome}
              <span className="rounded-lg bg-stone-800/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-stone-600">
                {stats.clock}
              </span>
            </p>
            <p className="text-[11px] tabular-nums text-stone-400">
              {`${stats.x.toFixed(0)}, ${stats.z.toFixed(0)}`} · {stats.tilesLoaded} tiles streamed ·
              on road: {stats.onRoad ? "yes" : "no"}
            </p>
          </div>

          {/* minimap */}
          <div className="pointer-events-none absolute right-5 top-5 z-10">
            <Minimap stats={stats} />
          </div>

          {/* controls hint */}
          <div
            className={`pointer-events-none absolute bottom-5 right-5 z-10 rounded-2xl bg-white/70 px-5 py-3 text-[11px] text-stone-500 shadow-lg shadow-stone-900/10 backdrop-blur-md transition-opacity duration-1000 ${
              showHints ? "opacity-100" : "opacity-0"
            }`}
          >
            <p className="flex items-center gap-2">
              <KeyCap>W / S</KeyCap> accelerate & reverse
              <KeyCap>A / D</KeyCap> steer
              <KeyCap>Space</KeyCap> handbrake
            </p>
            <p className="mt-1.5 flex items-center gap-2">
              <KeyCap>C</KeyCap> camera
              <KeyCap>R</KeyCap> back to road
              <KeyCap>Esc</KeyCap> pause
            </p>
          </div>
        </>
      )}

      {/* pause overlay */}
      {paused && !loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-stone-900/30 backdrop-blur-sm">
          <div className="w-[min(92vw,420px)] rounded-3xl bg-[#f7f2e7] p-8 shadow-2xl">
            <h2 className="text-2xl font-bold text-stone-800">Paused</h2>
            <p className="mt-1 text-sm text-stone-500">
              The world keeps its math; it will be right here when you return.
            </p>

            <div className="mt-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-stone-600">Render distance</span>
                <div className="flex rounded-xl bg-stone-900/10 p-1">
                  {[1, 2].map((r) => (
                    <button
                      key={r}
                      onClick={() => {
                        setRadius(r);
                        engineRef.current?.setRenderRadius(r);
                      }}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                        radius === r ? "bg-stone-800 text-[#f6efe2]" : "text-stone-500 hover:text-stone-700"
                      }`}
                    >
                      {r === 1 ? "3×3" : "5×5"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-stone-600">Soft shadows</span>
                <button
                  onClick={() => {
                    setShadows((s) => {
                      engineRef.current?.setShadows(!s);
                      return !s;
                    });
                  }}
                  className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition-colors ${
                    shadows ? "bg-stone-800 text-[#f6efe2]" : "bg-stone-900/10 text-stone-500"
                  }`}
                >
                  {shadows ? "On" : "Off"}
                </button>
              </div>

              {/* day-night cycle controls */}
              <div className="flex flex-col gap-3 border-t border-stone-300/60 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-stone-600">Day-night cycle</span>
                  <button
                    onClick={toggleCycle}
                    className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition-colors ${
                      dn.cycle ? "bg-stone-800 text-[#f6efe2]" : "bg-stone-900/10 text-stone-500"
                    }`}
                  >
                    {dn.cycle ? "Cycling" : "Locked"}
                  </button>
                </div>
                {dn.cycle && (
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-stone-600">Day length</span>
                    <span className="flex flex-1 items-center gap-3">
                      <input
                        type="range"
                        min={60}
                        max={600}
                        step={30}
                        value={dn.dayLength}
                        onChange={(e) => changeDayLength(Number(e.target.value))}
                        className="h-1.5 flex-1 cursor-pointer accent-stone-800"
                      />
                      <span className="w-12 text-right text-xs font-semibold tabular-nums text-stone-500">
                        {formatDayLength(dn.dayLength)}
                      </span>
                    </span>
                  </label>
                )}
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-stone-600">Time of day</span>
                  <span className="flex flex-1 items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={24}
                      step={0.25}
                      value={dn.cycle ? (stats?.tod ?? dn.time) : dn.time}
                      onChange={(e) => changeLockedTime(Number(e.target.value))}
                      className="h-1.5 flex-1 cursor-pointer accent-stone-800"
                    />
                    <span className="w-12 text-right text-xs font-semibold tabular-nums text-stone-500">
                      {dn.cycle ? (stats ? formatClock(stats.tod) : "--:--") : formatClock(dn.time)}
                    </span>
                  </span>
                </label>
                <p className="text-[11px] leading-snug text-stone-400">
                  Drag the clock to lock the world at a fixed hour; switch to Cycling to let it run.
                </p>
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-2">
              <Button
                className="w-full rounded-2xl bg-stone-800 text-[#f6efe2] hover:bg-stone-700"
                onClick={() => {
                  engineRef.current?.resume();
                  setPaused(false);
                }}
              >
                Keep driving
              </Button>
              <Button
                variant="outline"
                className="w-full rounded-2xl border-stone-300 bg-transparent text-stone-600 hover:bg-white/60"
                onClick={backToGarage}
              >
                Back to garage
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
