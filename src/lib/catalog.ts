import raw from "@/data/sky.json";
import type { BoundarySegment, StarRecord } from "@/lib/astro";

type BoundaryTuple = [number, number, number, string];

export const skyStars = raw.stars as StarRecord[];
export const skyLines = raw.lines as [number, number][];
export const skyBoundaries: BoundarySegment[] = (raw.boundaries as BoundaryTuple[]).map(
  ([raLow, raUp, deLow, con]) => ({ raLow, raUp, deLow, con }),
);
export const skyMeta = raw.meta;

export const FALLBACK_PLACE = {
  lat: 40.7128,
  lon: -74.006,
  name: "New York",
};
