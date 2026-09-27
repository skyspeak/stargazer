import { readFileSync } from "node:fs";
import {
  B1875_JD,
  J2000_JD,
  altAzToRaDec,
  besselianJd,
  constellationAtJ2000,
  deviceLook,
  findConstellation1875,
  galacticToEquatorial,
  greenwichSiderealHours,
  localSiderealHours,
  precess,
  raDecToAltAz,
  type BoundarySegment,
} from "../src/lib/astro.ts";

const raw = readFileSync("/tmp/catalog/data.dat", "utf8").split(/\n/).filter((l) => l.trim());
const segments: BoundarySegment[] = raw.map((line) => {
  const m = line.match(/^\s*([0-9.]+)\s+([0-9.]+)\s+([+-]?[0-9.]+)\s+([A-Za-z]{3})\s*$/);
  if (!m) throw new Error(`bad boundary line ${JSON.stringify(line)}`);
  return { raLow: Number(m[1]), raUp: Number(m[2]), deLow: Number(m[3]), con: m[4] };
});

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name, detail);
  } else {
    console.log("ok  ", name, detail);
  }
}

const gmst = greenwichSiderealHours(new Date("2000-01-01T12:00:00Z"));
check("GMST at J2000", Math.abs(gmst - 18.697374558) < 0.002, gmst.toFixed(6));

const gc = galacticToEquatorial(0, 0);
check(
  "galactic center",
  Math.abs(((gc.ra - 266.4 + 540) % 360) - 180) < 1.5 && Math.abs(gc.dec + 28.94) < 1,
  `${gc.ra.toFixed(2)} ${gc.dec.toFixed(2)}`,
);

// Roman 1987 examples are B1950 positions. Precess them to B1875 and identify.
const examples: [number, number, string][] = [
  [9, 65, "UMa"],
  [23.5, -20, "Aqr"],
  [5.12, 9.12, "Ori"],
  [9.4555, -19.9, "Hya"],
  [12.8888, 22, "Com"],
  [15.6687, -12.1234, "Lib"],
  [19, -40, "CrA"],
  [6.2222, -81.1234, "Men"],
];
const b1950 = besselianJd(1950);
for (const [rah, dec, expect] of examples) {
  const p = precess(rah * 15, dec, b1950, B1875_JD);
  const got = findConstellation1875(p.ra / 15, p.dec, segments);
  check(`B1950 ${rah}h ${dec} → ${expect}`, got === expect, `got ${got} at ${p.ra.toFixed(2)} ${p.dec.toFixed(2)}`);
}

// Direct 1875 lookup of the same examples should also be close; the published
// sample was identified after precession, so this is only a sanity print.

const famous: [string, number, number, string][] = [
  ["Betelgeuse", 88.792938, 7.407064, "Ori"],
  ["Sirius", 101.287155, -16.716116, "CMa"],
  ["Vega", 279.234735, 38.783689, "Lyr"],
  ["Polaris", 37.954561, 89.264109, "UMi"],
  ["Acrux", 186.649563, -63.099093, "Cru"],
  ["Schedar", 10.1268, 56.5373, "Cas"],
];
for (const [name, ra, dec, expect] of famous) {
  const got = constellationAtJ2000(ra, dec, segments);
  check(`${name} in ${expect}`, got === expect, `got ${got}`);
}

// Full-sky grid should almost always resolve.
let misses = 0;
const seen = new Set<string>();
for (let dec = -89; dec <= 89; dec += 2) {
  for (let ra = 0; ra < 360; ra += 2) {
    const c = constellationAtJ2000(ra, dec, segments);
    if (!c) misses += 1;
    else seen.add(c);
  }
}
check("grid coverage", misses === 0 && seen.size === 88, `misses ${misses} constellations ${seen.size}`);
check("north polar cap is UMi", constellationAtJ2000(10, 89.2, segments) === "UMi");

// Sirius on the meridian from latitude 40.
const siriusLst = 101.287155 / 15;
const sirius = raDecToAltAz(101.287155, -16.716116, 40, siriusLst);
check(
  "Sirius culminates south",
  Math.abs(sirius.alt - 33.28) < 0.2 && Math.abs(sirius.az - 180) < 0.2,
  `alt ${sirius.alt.toFixed(2)} az ${sirius.az.toFixed(2)}`,
);

const pol = raDecToAltAz(37.95, 89.264, 40, 0);
check(
  "Polaris near the north pole",
  pol.alt > 39 && pol.alt < 42 && (pol.az < 5 || pol.az > 355),
  `alt ${pol.alt.toFixed(2)} az ${pol.az.toFixed(2)}`,
);

const back = altAzToRaDec(sirius.alt, sirius.az, 40, siriusLst);
check(
  "alt/az round trip",
  Math.abs(back.ra - 101.287155) < 0.02 && Math.abs(back.dec + 16.716116) < 0.02,
  `${back.ra.toFixed(3)} ${back.dec.toFixed(3)}`,
);

const horizonNorth = deviceLook(0, 90, 0, 0);
check(
  "phone upright facing north",
  Math.abs(horizonNorth.alt) < 0.2 && (horizonNorth.az < 0.2 || horizonNorth.az > 359.8),
  `alt ${horizonNorth.alt.toFixed(2)} az ${horizonNorth.az.toFixed(2)} up ${horizonNorth.up.y.toFixed(2)}`,
);
check("horizon stays level", Math.abs(horizonNorth.up.y - 1) < 0.05, JSON.stringify(horizonNorth.up));

const zenith = deviceLook(0, 180, 0, 0);
check("phone overhead looks at zenith", zenith.alt > 89, zenith.alt.toFixed(2));

const east = deviceLook(270, 90, 0, 0);
check("phone upright facing east", Math.abs(east.az - 90) < 0.3 && Math.abs(east.alt) < 0.3, `az ${east.az.toFixed(2)}`);

const lstNY = localSiderealHours(new Date("2026-09-27T03:10:00Z"), -74.006);
check("LST finite", lstNY >= 0 && lstNY < 24, lstNY.toFixed(3));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall checks passed");
