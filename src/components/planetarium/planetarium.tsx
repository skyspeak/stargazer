"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  FALLBACK_PLACE,
  skyBoundaries,
  skyStars,
} from "@/lib/catalog";
import { constellationInfo, starNote } from "@/lib/constellations";
import {
  altAzToVector,
  angleBetween,
  constellationInView,
  deviceLook,
  formatHours,
  formatLatLon,
  localSiderealHours,
  placeStars,
  suggestView,
  type PlacedStar,
} from "@/lib/astro";
import type { ScreenLabel, ViewState } from "@/components/sky/sky-view";

const SkyView = dynamic(() => import("@/components/sky/sky-view"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-sm text-[#c9d4ea]">
      Plotting the bright stars…
    </div>
  ),
});

type LocStatus = "pending" | "device" | "denied" | "manual";
type SensorStatus = "off" | "listening" | "denied" | "missing";

type Pin =
  | { kind: "star"; hr: number; az: number; alt: number }
  | { kind: "constellation"; code: string; az: number; alt: number };

function dayString(ms: number) {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function minutesOf(ms: number) {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
}

function withDay(ms: number, day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(ms);
  next.setFullYear(year, month - 1, date);
  return next.getTime();
}

function withMinutes(ms: number, minutes: number) {
  const next = new Date(ms);
  next.setHours(0, 0, 0, 0);
  next.setMinutes(minutes);
  return next.getTime();
}

function clockLabel(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function useCoarsePointer() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window,
    () => false,
  );
}

export function Planetarium() {
  const mounted = useIsClient();
  const coarse = useCoarsePointer();
  const [when, setWhen] = useState(() => Date.now());
  const [lat, setLat] = useState(FALLBACK_PLACE.lat);
  const [lon, setLon] = useState(FALLBACK_PLACE.lon);
  const [locStatus, setLocStatus] = useState<LocStatus>("pending");
  const [latText, setLatText] = useState(String(FALLBACK_PLACE.lat));
  const [lonText, setLonText] = useState(String(FALLBACK_PLACE.lon));
  const [locError, setLocError] = useState<string | null>(null);
  const [showLines, setShowLines] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("off");
  const [trim, setTrim] = useState(0);
  const [labels, setLabels] = useState<ScreenLabel[]>([]);
  const [pin, setPin] = useState<Pin | null>(null);
  const [view, setView] = useState<ViewState>({ az: 180, alt: 42, fov: 62, up: null });

  const viewRef = useRef<ViewState>({ az: 180, alt: 42, fov: 62, up: null });
  const trimRef = useRef(0);
  const aimedKey = useRef("");
  const locRef = useRef({ lat, lon, when });

  useEffect(() => {
    trimRef.current = trim;
    locRef.current = { lat, lon, when };
  }, [lat, lon, trim, when]);

  useEffect(() => {
    if (!navigator.geolocation) {
      const id = window.setTimeout(() => setLocStatus("denied"), 0);
      return () => window.clearTimeout(id);
    }
    let cancel = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancel) return;
        setLat(pos.coords.latitude);
        setLon(pos.coords.longitude);
        setLatText(pos.coords.latitude.toFixed(4));
        setLonText(pos.coords.longitude.toFixed(4));
        setLocStatus("device");
      },
      () => {
        if (!cancel) setLocStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 },
    );
    return () => {
      cancel = true;
    };
  }, []);

  const whenDate = useMemo(() => new Date(when), [when]);
  const { placed, lst } = useMemo(
    () => placeStars(skyStars, lat, lon, whenDate),
    [lat, lon, whenDate],
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const here = locRef.current;
      const key = `${here.lat.toFixed(3)},${here.lon.toFixed(3)}`;
      if (aimedKey.current !== key) {
        aimedKey.current = key;
        const sky = placeStars(skyStars, here.lat, here.lon, new Date(here.when)).placed;
        const aim = suggestView(sky);
        viewRef.current.az = aim.az;
        viewRef.current.alt = aim.alt;
        viewRef.current.up = null;
        setPin(null);
      }
      const next = viewRef.current;
      setPin((current) => {
        if (!current) return current;
        const shifted = angleBetween(
          altAzToVector(current.alt, current.az),
          altAzToVector(next.alt, next.az),
        );
        return shifted > 2.2 ? null : current;
      });
      setView((prev) => {
        if (
          Math.abs(prev.az - next.az) < 0.05 &&
          Math.abs(prev.alt - next.alt) < 0.05 &&
          Math.abs(prev.fov - next.fov) < 0.05
        ) {
          return prev;
        }
        return { az: next.az, alt: next.alt, fov: next.fov, up: next.up };
      });
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (sensorStatus !== "listening") return;
    let sawAbsolute = false;
    let sawAny = false;
    const apply = (event: DeviceOrientationEvent) => {
      if (event.beta == null || event.gamma == null) return;
      sawAny = true;
      let alpha = event.alpha ?? 0;
      const heading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof heading === "number" && heading >= 0) alpha = (360 - heading) % 360;
      const angle = window.screen?.orientation?.angle ?? 0;
      const look = deviceLook(alpha, event.beta, event.gamma, angle);
      viewRef.current.az = (look.az + trimRef.current + 360) % 360;
      viewRef.current.alt = Math.max(-80, Math.min(88, look.alt));
      viewRef.current.up = look.up;
    };
    const onAbsolute = (event: Event) => {
      sawAbsolute = true;
      apply(event as DeviceOrientationEvent);
    };
    const onRelative = (event: DeviceOrientationEvent) => {
      if (!sawAbsolute) apply(event);
    };
    window.addEventListener("deviceorientationabsolute", onAbsolute, true);
    window.addEventListener("deviceorientation", onRelative, true);
    const timeout = window.setTimeout(() => {
      if (!sawAny) setSensorStatus("missing");
    }, 2500);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onAbsolute, true);
      window.removeEventListener("deviceorientation", onRelative, true);
      window.clearTimeout(timeout);
    };
  }, [sensorStatus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const zoomIn = event.key === "+" || event.key === "=";
      const zoomOut = event.key === "-" || event.key === "_";
      if (sensorStatus === "listening" && !zoomIn && !zoomOut) return;
      const step = viewRef.current.fov / 16;
      if (event.key === "ArrowLeft") {
        viewRef.current.az = (viewRef.current.az - step + 360) % 360;
        viewRef.current.up = null;
      } else if (event.key === "ArrowRight") {
        viewRef.current.az = (viewRef.current.az + step) % 360;
        viewRef.current.up = null;
      } else if (event.key === "ArrowUp") {
        viewRef.current.alt = Math.min(88, viewRef.current.alt + step);
        viewRef.current.up = null;
      } else if (event.key === "ArrowDown") {
        viewRef.current.alt = Math.max(-28, viewRef.current.alt - step);
        viewRef.current.up = null;
      } else if (zoomIn) {
        viewRef.current.fov = Math.max(14, viewRef.current.fov / 1.08);
      } else if (zoomOut) {
        viewRef.current.fov = Math.min(100, viewRef.current.fov * 1.08);
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sensorStatus]);

  const onPick = useCallback((hr: number | null) => {
    if (hr == null) {
      setPin(null);
      return;
    }
    setPin({ kind: "star", hr, az: viewRef.current.az, alt: viewRef.current.alt });
  }, []);

  const onLabels = useCallback((next: ScreenLabel[]) => {
    setLabels((prev) => {
      if (prev.length === next.length && prev.every((item, i) => item.code === next[i]?.code && Math.abs(item.x - next[i].x) < 1 && Math.abs(item.y - next[i].y) < 1)) {
        return prev;
      }
      return next;
    });
  }, []);

  const reading = useMemo(() => {
    if (view.alt < -2) {
      return { mode: "ground" as const };
    }
    const code = constellationInView(view.alt, view.az, lat, lon, whenDate, skyBoundaries);
    const center = altAzToVector(view.alt, view.az);
    let nearest: PlacedStar | null = null;
    let nearestAng = 1e9;
    for (const star of placed) {
      if (!star.name || star.alt < -1) continue;
      const ang = angleBetween(center, star.dir);
      if (ang < nearestAng) {
        nearestAng = ang;
        nearest = star;
      }
    }
    const limit = Math.max(2.3, view.fov * 0.046);
    return {
      mode: "sky" as const,
      code,
      star: nearest && nearestAng <= limit ? nearest : null,
    };
  }, [lat, lon, placed, view.alt, view.az, view.fov, whenDate]);

  const pinnedStar = pin?.kind === "star" ? placed.find((star) => star.hr === pin.hr) ?? null : null;
  const pinnedCode = pin?.kind === "constellation" ? pin.code : pinnedStar?.con ?? null;
  const displayCode = pinnedCode ?? (reading.mode === "sky" ? reading.code : null);
  const displayStar =
    pinnedStar ??
    (pin?.kind === "constellation"
      ? placed
          .filter((star) => star.con === pin.code && star.name)
          .sort((a, b) => a.mag - b.mag)[0] ?? null
      : reading.mode === "sky"
        ? reading.star
        : null);
  const info = displayCode ? constellationInfo(displayCode) : null;

  async function aimWithPhone() {
    const ctor = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    try {
      if (typeof ctor.requestPermission === "function") {
        const result = await ctor.requestPermission();
        if (result !== "granted") {
          setSensorStatus("denied");
          return;
        }
      }
    } catch {
      setSensorStatus("denied");
      return;
    }
    setSensorStatus("listening");
  }

  function applyCoordinates() {
    const nextLat = Number(latText);
    const nextLon = Number(lonText);
    if (!Number.isFinite(nextLat) || nextLat < -90 || nextLat > 90) {
      setLocError("Latitude has to sit between −90 and 90.");
      return;
    }
    if (!Number.isFinite(nextLon) || nextLon < -180 || nextLon > 180) {
      setLocError("Longitude has to sit between −180 and 180.");
      return;
    }
    setLat(nextLat);
    setLon(nextLon);
    setLocStatus("manual");
    setLocError(null);
  }

  function faceBrightSky() {
    const aim = suggestView(placed);
    viewRef.current.az = aim.az;
    viewRef.current.alt = aim.alt;
    viewRef.current.up = null;
    setPin(null);
    if (sensorStatus === "listening") setSensorStatus("off");
  }

  const placeLine =
    locStatus === "device"
      ? `Sky from ${formatLatLon(lat, lon)}`
      : locStatus === "manual"
        ? `Sky from ${formatLatLon(lat, lon)}, the coordinates you entered`
        : locStatus === "pending"
          ? "Finding your horizon. Until then, this is the sky over New York."
          : "Location is off, so this is the sky over New York. Enter a latitude and longitude to move the horizon.";

  const sensorLine =
    sensorStatus === "listening"
      ? "This phone is aiming the view. Drag is paused."
      : sensorStatus === "denied"
        ? "Motion sensors are blocked. Drag the sky to look around."
        : sensorStatus === "missing"
          ? "No compass or gyro arrived. Drag still works."
          : coarse
            ? "Drag to look, or aim with the phone."
            : "Drag to look around. Scroll to zoom. Arrow keys work too.";

  if (!mounted) {
    return (
      <div className="grid h-dvh place-items-center bg-[#070b14] text-[#d5deef]">
        <p className="text-sm tracking-wide">Plotting the bright stars…</p>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#070b14] text-[#e7eefc]">
      <div className="absolute inset-0">
        <SkyView
          placed={placed}
          lat={lat}
          lon={lon}
          when={whenDate}
          viewRef={viewRef}
          dragEnabled={sensorStatus !== "listening"}
          showLines={showLines}
          showLabels={showLabels}
          selected={pinnedStar}
          onPick={onPick}
          onLabels={onLabels}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.38)_100%)]" />

      {showLabels
        ? labels.map((label) => (
            <button
              key={label.code}
              type="button"
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[10px] font-medium tracking-[0.16em] text-[#e4b56a] uppercase hover:bg-[#e4b56a]/15 sm:text-[11px]"
              style={{ left: label.x, top: label.y }}
              onClick={() =>
                setPin({
                  kind: "constellation",
                  code: label.code,
                  az: viewRef.current.az,
                  alt: viewRef.current.alt,
                })
              }
            >
              {label.name}
            </button>
          ))
        : null}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 sm:p-5">
        <div className="max-w-[min(36rem,calc(100%-1rem))]">
          <p className="font-serif text-2xl tracking-tight text-[#f3efe4] sm:text-3xl">Stargazer</p>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-[#b7c3da] sm:text-sm">{placeLine}</p>
          <p className="mt-1 text-xs text-[#8ea0bf]">
            {new Date(when).toLocaleString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            <span className="mx-1.5 text-[#5c6b84]">·</span>
            sidereal {formatHours(lst)}
          </p>
        </div>
      </header>

      <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="relative size-10">
          <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-[#e4b56a]/85" />
          <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-[#e4b56a]/85" />
          <span className="absolute inset-1.5 rounded-full border border-[#e4b56a]/80" />
        </div>
      </div>

      <section
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute top-28 left-1/2 z-10 w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 text-center sm:top-[calc(50%+2.8rem)]"
      >
        <p className="text-[10px] tracking-[0.22em] text-[#e4b56a]/80 uppercase">
          {view.alt < -2 ? "Ground" : pin ? "Selected" : "In the reticle"}
        </p>
        {view.alt < -2 && !pin ? (
          <p className="mt-1 text-sm text-[#d5deef]">The ground is in the reticle. Tilt up into the sky.</p>
        ) : (
          <>
            <h2 className="font-serif text-3xl text-[#f7f3ea] sm:text-4xl">{info?.name ?? "Open sky"}</h2>
            <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-[#c5d0e4]">
              {info?.blurb ?? "No constellation boundary covers this exact point."}
            </p>
            {displayStar?.name ? (
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#f0e2c4]">
                <span className="text-[#e4b56a]">{displayStar.name}</span>
                {" · "}
                {starNote(displayStar.name, info?.name ?? "the sky", displayStar.mag)}
              </p>
            ) : (
              <p className="mt-2 text-sm text-[#9aabc4]">No bright named star sits in the reticle.</p>
            )}
          </>
        )}
      </section>

      <footer className="absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-white/10 bg-[#0b1220]/82 p-3 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs text-[#e4d2b0]">{clockLabel(when)}</span>
            <Slider
              aria-label="Time of night"
              min={0}
              max={1439}
              step={1}
              value={[minutesOf(when)]}
              onValueChange={(value) => setWhen(withMinutes(when, value[0] ?? 0))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Input
              type="date"
              aria-label="Date"
              value={dayString(when)}
              onChange={(event) => setWhen(withDay(when, event.target.value))}
              className="w-[9.5rem] border-white/15 bg-black/20 text-[#e7eefc]"
            />
            <Label className="gap-2 text-xs text-[#d5deef]">
              <Switch checked={showLines} onCheckedChange={setShowLines} />
              Lines
            </Label>
            <Label className="gap-2 text-xs text-[#d5deef]">
              <Switch checked={showLabels} onCheckedChange={setShowLabels} />
              Names
            </Label>
            <Button variant="secondary" size="sm" onClick={() => setWhen(Date.now())}>
              Now
            </Button>
            <Button variant="secondary" size="sm" onClick={faceBrightSky}>
              Bright patch
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Place
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Where you stand</DialogTitle>
                  <DialogDescription>
                    The horizon follows latitude and longitude. East is positive, west is negative.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="lat">Latitude</Label>
                    <Input
                      id="lat"
                      inputMode="decimal"
                      value={latText}
                      onChange={(event) => setLatText(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="lon">Longitude</Label>
                    <Input
                      id="lon"
                      inputMode="decimal"
                      value={lonText}
                      onChange={(event) => setLonText(event.target.value)}
                    />
                  </div>
                  {locError ? <p className="text-xs text-[#e7b4a4]">{locError}</p> : null}
                  <Button onClick={applyCoordinates}>Use these coordinates</Button>
                  <p className="text-xs leading-relaxed text-[#9aabc4]">
                    Local sidereal time is {formatHours(localSiderealHours(whenDate, lon))}. That is the
                    right ascension on the meridian, and it is what turns the star chart into the sky
                    overhead.
                  </p>
                  <div className="grid gap-1.5">
                    <Label>Compass trim ({trim}°)</Label>
                    <Slider
                      min={-180}
                      max={180}
                      step={1}
                      value={[trim]}
                      onValueChange={(value) => setTrim(value[0] ?? 0)}
                    />
                  </div>
                  <Button variant="outline" onClick={aimWithPhone}>
                    {sensorStatus === "listening" ? "Aiming with this phone" : "Aim with this phone"}
                  </Button>
                  {sensorStatus === "listening" ? (
                    <Button variant="ghost" onClick={() => setSensorStatus("off")}>
                      Stop aiming and drag instead
                    </Button>
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
            {coarse ? (
              <Button variant="outline" size="sm" onClick={sensorStatus === "listening" ? () => setSensorStatus("off") : aimWithPhone}>
                {sensorStatus === "listening" ? "Stop aiming" : "Aim with phone"}
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] leading-relaxed text-[#8ea0bf]">{sensorLine}</p>
        </div>
      </footer>
    </div>
  );
}
