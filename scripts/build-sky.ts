/**
 * Build src/data/sky.json from the Yale Bright Star Catalogue (public-domain
 * ADC/NASA distribution) and the Roman 1987 tabulation of Delporte's 1930
 * constellation boundaries.
 *
 * Stick figures are original pairings of Bayer stars, not a copy of any
 * planetarium's line file. Constellations without a hand-drawn figure get a
 * short minimum spanning tree of their brighter stars.
 *
 * Inputs (downloaded by this script if missing):
 *   /tmp/catalog/catalog   V/50
 *   /tmp/catalog/notes     V/50
 *   /tmp/catalog/data.dat  VI/42
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  angleBetween,
  constellationAtJ2000,
  raDecToVec,
  type BoundarySegment,
  type StarRecord,
} from "../src/lib/astro.ts";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "src/data/sky.json");
const CACHE = "/tmp/catalog";

function ensureInputs() {
  mkdirSync(CACHE, { recursive: true });
  const need: [string, string][] = [
    ["catalog.gz", "https://cdsarc.cds.unistra.fr/ftp/cats/V/50/catalog.gz"],
    ["notes.gz", "https://cdsarc.cds.unistra.fr/ftp/cats/V/50/notes.gz"],
    ["data.dat", "https://cdsarc.cds.unistra.fr/ftp/cats/VI/42/data.dat"],
  ];
  for (const [file, url] of need) {
    const plain = file.endsWith(".gz") ? file.slice(0, -3) : file;
    if (existsSync(`${CACHE}/${plain}`)) continue;
    execFileSync("curl", ["-fsSL", "-o", `${CACHE}/${file}`, url], { stdio: "inherit" });
    if (file.endsWith(".gz")) execFileSync("gunzip", ["-f", `${CACHE}/${file}`]);
  }
}

type RawStar = StarRecord & { bayer: string | null; flam: number | null };

const CURATED: Record<string, string> = {
  "Alp And": "Alpheratz",
  "Bet And": "Mirach",
  "Gam And": "Almach",
  "Alp Cas": "Schedar",
  "Bet Cas": "Caph",
  "Gam Cas": "Navi",
  "Del Cas": "Ruchbah",
  "Eps Cas": "Segin",
  "Alp UMi": "Polaris",
  "Bet UMi": "Kochab",
  "Gam UMi": "Pherkad",
  "Alp Eri": "Achernar",
  "Bet Eri": "Cursa",
  "Alp Tau": "Aldebaran",
  "Bet Tau": "Elnath",
  "Eta Tau": "Alcyone",
  "Alp Aur": "Capella",
  "Bet Aur": "Menkalinan",
  "Bet Ori": "Rigel",
  "Gam Ori": "Bellatrix",
  "Del Ori": "Mintaka",
  "Eps Ori": "Alnilam",
  "Zet Ori": "Alnitak",
  "Kap Ori": "Saiph",
  "Alp Ori": "Betelgeuse",
  "Lam Ori": "Meissa",
  "Alp CMa": "Sirius",
  "Bet CMa": "Mirzam",
  "Del CMa": "Wezen",
  "Eps CMa": "Adhara",
  "Eta CMa": "Aludra",
  "Alp Gem": "Castor",
  "Bet Gem": "Pollux",
  "Gam Gem": "Alhena",
  "Eps Gem": "Mebsuta",
  "Mu Gem": "Tejat",
  "Eta Gem": "Propus",
  "Del Gem": "Wasat",
  "Zet Gem": "Mekbuda",
  "Alp CMi": "Procyon",
  "Bet CMi": "Gomeisa",
  "Alp Leo": "Regulus",
  "Bet Leo": "Denebola",
  "Gam Leo": "Algieba",
  "Del Leo": "Zosma",
  "Eps Leo": "Algenubi",
  "Zet Leo": "Adhafera",
  "Alp UMa": "Dubhe",
  "Bet UMa": "Merak",
  "Gam UMa": "Phecda",
  "Del UMa": "Megrez",
  "Eps UMa": "Alioth",
  "Zet UMa": "Mizar",
  "Eta UMa": "Alkaid",
  "Alp Vir": "Spica",
  "Eps Vir": "Vindemiatrix",
  "Gam Vir": "Porrima",
  "Alp Boo": "Arcturus",
  "Eps Boo": "Izar",
  "Bet Boo": "Nekkar",
  "Gam Boo": "Seginus",
  "Eta Boo": "Muphrid",
  "Alp Cen": "Rigil Kentaurus",
  "Bet Cen": "Hadar",
  "Alp Cru": "Acrux",
  "Bet Cru": "Mimosa",
  "Gam Cru": "Gacrux",
  "Del Cru": "Imai",
  "Alp Sco": "Antares",
  "Lam Sco": "Shaula",
  "The Sco": "Sargas",
  "Eps Sco": "Larawag",
  "Del Sco": "Dschubba",
  "Bet Sco": "Acrab",
  "Sig Sco": "Alniyat",
  "Kap Sco": "Girtab",
  "Ups Sco": "Lesath",
  "Mu Sco": "Xamidimura",
  "Alp Lyr": "Vega",
  "Bet Lyr": "Sheliak",
  "Gam Lyr": "Sulafat",
  "Alp Aql": "Altair",
  "Bet Aql": "Alshain",
  "Gam Aql": "Tarazed",
  "Alp Cyg": "Deneb",
  "Bet Cyg": "Albireo",
  "Gam Cyg": "Sadr",
  "Eps Cyg": "Aljanah",
  "Del Cyg": "Fawaris",
  "Eta Cyg": "Aljanah's neighbor",
  "Alp PsA": "Fomalhaut",
  "Eps Peg": "Enif",
  "Alp Peg": "Markab",
  "Bet Peg": "Scheat",
  "Gam Peg": "Algenib",
  "Alp Per": "Mirfak",
  "Bet Per": "Algol",
  "Alp Ari": "Hamal",
  "Bet Ari": "Sheratan",
  "Gam Ari": "Mesarthim",
  "Alp Aqr": "Sadalmelik",
  "Bet Aqr": "Sadalsuud",
  "Eps Sgr": "Kaus Australis",
  "Del Sgr": "Kaus Media",
  "Lam Sgr": "Kaus Borealis",
  "Gam Sgr": "Alnasl",
  "Sig Sgr": "Nunki",
  "Zet Sgr": "Ascella",
  "Alp Cep": "Alderamin",
  "Bet Cep": "Alfirk",
  "Gam Cep": "Errai",
  "Alp Dra": "Thuban",
  "Gam Dra": "Eltanin",
  "Bet Dra": "Rastaban",
  "Alp Oph": "Rasalhague",
  "Bet Oph": "Cebalrai",
  "Alp Her": "Rasalgethi",
  "Bet Her": "Kornephoros",
  "Alp Ser": "Unukalhai",
  "Alp CrB": "Alphecca",
  "Alp Lib": "Zubenelgenubi",
  "Bet Lib": "Zubeneschamali",
  "Del Cap": "Deneb Algedi",
  "Bet Cap": "Dabih",
  "Alp Hya": "Alphard",
  "Alp Crv": "Alchiba",
  "Gam Crv": "Gienah",
  "Bet Crv": "Kraz",
  "Del Crv": "Algorab",
  "Eps Crv": "Minkar",
  "Alp CVn": "Cor Caroli",
  "Alp Car": "Canopus",
  "Bet Car": "Miaplacidus",
  "Eps Car": "Avior",
  "Alp Gru": "Alnair",
  "Bet Gru": "Tiaki",
  "Alp Phe": "Ankaa",
  "Alp TrA": "Atria",
  "Alp Pav": "Peacock",
  "Bet Cet": "Diphda",
  "Alp Cet": "Menkar",
  "Omi Cet": "Mira",
  "Alp Psc": "Alrescha",
  "The1 Tau": "The Hyades",
};

// Eta Cyg is not "Aljanah's neighbor" — drop that bad label. Aljanah is epsilon.
delete CURATED["Eta Cyg"];

/** Hand-drawn stick figures. Tokens are Bayer designations; `@Con` crosses a border. */
const FIGURES: Record<string, string[]> = {
  Ori: ["Lam-Alp", "Lam-Gam", "Alp-Zet", "Gam-Del", "Del-Eps-Zet", "Zet-Kap", "Del-Bet", "Eps-Iot"],
  UMa: ["Alp-Bet-Gam-Del-Alp", "Del-Eps-Zet-Eta"],
  UMi: ["Alp-Del-Eps-Zet-Eta-Gam-Bet-Zet"],
  Cas: ["Bet-Alp-Gam-Del-Eps"],
  Cyg: ["Alp-Gam-Bet", "Del-Gam-Eps", "Gam-Eta"],
  Lyr: ["Alp-Eps1", "Alp-Zet", "Zet-Bet-Gam-Del-Zet"],
  Sco: [
    "Bet-Del-Pi-Alp",
    "Bet-Nu",
    "Alp-Sig",
    "Alp-Tau-Eps-Mu1-Zet2-Eta-The-Iot1-Kap-Lam-Ups",
  ],
  Sgr: ["Eps-Zet-Tau-Sig-Phi-Lam-Del-Eps", "Del-Gam-Eps"],
  Leo: ["Eps-Mu-Zet-Gam-Eta-Alp", "Gam-Del-Bet", "Del-The"],
  Gem: ["Alp-Tau-Eps-Mu-Eta", "Bet-Ups-Kap-Del-Zet-Gam", "Alp-Bet", "Mu-Xi"],
  Tau: ["Gam-Del-The1-Alp", "Eps-Alp", "Gam-Eps", "Bet-Zet-Tau", "Tau-Eta", "Alp-Lam"],
  CMa: ["Bet-Alp", "Alp-Del-Eps-Eta", "Del-Omi2", "Bet-Zet", "Alp-Iot"],
  Aql: ["Gam-Alp-Bet", "The-Eta-Del-Alp", "Del-Lam", "Bet-Gam"],
  And: ["Alp-Del-Bet-Gam", "Bet-Mu", "Del-Pi"],
  Per: ["Eta-Gam-Alp-Del-Eps-Zet", "Alp-Bet-Rho", "Bet-Pi"],
  Boo: ["Bet-Gam-Rho-Eps-Alp", "Bet-Del-Eps", "Alp-Eta"],
  Vir: ["Eps-Del-Gam-Alp", "Gam-Eta-Bet", "Alp-The"],
  Peg: ["Alp-Bet-Alp@And-Gam-Alp", "Bet-Eta-Mu", "Alp-Zet-The-Eps", "Gam-Xi"],
  Her: ["Pi-Eta-Zet-Eps-Pi", "Eta-Tau", "Zet-Bet-Gam", "Eps-Del-Mu-Alp", "Pi-The", "Bet-Del"],
  Dra: ["Gam-Bet-Nu2-Xi-Gam", "Xi-Del-Eps-Zet-Chi-Tau-Eta-The-Iot-Alp-Kap-Lam"],
  Cru: ["Alp-Gam", "Bet-Del"],
  CMi: ["Alp-Bet"],
  Ari: ["Alp-Bet-Gam"],
  Aur: ["Alp-Bet-The-Bet@Tau-Iot-Alp", "Alp-Eps"],
  Lib: ["Alp1-Sig-Gam", "Alp2-Bet", "Bet-Gam", "Gam-Ups"],
  CrB: ["The-Bet-Alp-Gam-Del-Eps-Iot"],
  Cep: ["Alp-Bet-Gam-Iot-Zet-Alp", "Bet-Iot"],
  Del: ["Alp-Gam-Del-Bet-Alp", "Bet-Eps"],
  Crv: ["Del-Gam-Eps-Bet-Del", "Alp-Eps"],
  CVn: ["Alp-Bet"],
  PsA: ["Alp-Eps-Gam", "Alp-Bet", "Gam-Del"],
  TrA: ["Alp-Bet-Gam-Alp"],
  Cen: ["Alp-Bet", "Bet-Eps-Zet-Eta-The", "Gam-Del-Rho", "Gam-Tau", "Eps-Gam", "Alp-Gam"],
  Car: ["The-Ups-Eps-Iot-Bet", "Eps-Chi", "Alp-The"],
  Vel: ["Gam-Lam-Del", "Kap-Del-Phi", "Del-Mu", "Psi-Phi"],
  Pup: ["Zet-Pi-Nu-Xi", "Rho-Xi-Tau", "Pi-Omi"],
  Aqr: ["Gam-Zet-Eta-Pi", "Zet-Alp", "Alp-Bet", "Pi-Lam"],
  Cap: ["Alp2-Bet-Psi-Ome-Zet", "Del-Gam-Iot-Eps-Alp2", "Del-Gam"],
  Lep: ["Alp-Bet-Gam", "Bet-Del-Eps", "Alp-Mu", "Eps-Zet"],
  Psc: ["Alp-Omi-Eta-Gam", "Gam-Kap-Lam", "Alp-Nu", "Iot-Lam-Kap"],
  Tri: ["Alp-Bet-Gam-Alp"],
  Gru: ["Gam-Alp-Bet-Eps-Zet", "Bet-Del-Mu", "Alp-Del"],
  Phe: ["Alp-Bet-Gam", "Bet-Del-Eps", "Alp-Kap"],
  Hya: ["Del-Eps-Zet-Eta-Sig", "Del-Ome", "Zet-Alp", "Eps-Rho"],
  Oph: ["Bet-Gam-Nu", "Alp-Bet", "Alp-Kap", "Kap-Iot", "Alp-Eta-Zet", "Zet-Del", "Eta-The"],
  Ser: ["Bet-Gam-Kap-Iot-Bet", "Kap-Alp-Eps-Del", "Eta-The1", "Xi-Omi-Eta", "Nu-Xi"],
  Cnc: ["Alp-Del-Gam-Iot", "Bet-Del"],
  Col: ["Alp-Bet", "Bet-Gam-Del-Eps", "Alp-Eps"],
  Sge: ["Gam-Del-Alp-Bet"],
  Sct: ["Alp-Bet-Gam-Del-Alp"],
  Mus: ["Alp-Bet-Gam-Del-Alp", "Bet-Eps"],
  Hyi: ["Alp-Bet-Gam", "Bet-Del"],
  Pav: ["Alp-Bet-Gam-Del", "Bet-Del", "Gam-Eps"],
  Tuc: ["Alp-Gam-Bet", "Gam-Del", "Bet-Zet"],
  Ret: ["Alp-Bet-Gam-Del-Alp"],
  Cet: ["Alp-Lam-Mu-Xi-Gam-Alp", "Gam-Del-Omi-Zet-The-Bet"],
  LyrExtra: [],
};

function angDeg(a: { ra: number; dec: number }, b: { ra: number; dec: number }) {
  return angleBetween(raDecToVec(a.ra, a.dec), raDecToVec(b.ra, b.dec));
}

function parseBoundaries(): BoundarySegment[] {
  return readFileSync(`${CACHE}/data.dat`, "utf8")
    .split(/\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const m = line.match(/^\s*([0-9.]+)\s+([0-9.]+)\s+([+-]?[0-9.]+)\s+([A-Za-z]{3})\s*$/);
      if (!m) throw new Error(`bad boundary ${JSON.stringify(line)}`);
      return { raLow: Number(m[1]), raUp: Number(m[2]), deLow: Number(m[3]), con: m[4] };
    });
}

function parseNames(): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of readFileSync(`${CACHE}/notes`, "utf8").split(/\n/)) {
    const m = line.match(/^\s*(\d+)\s+\d+N:\s*(.*)$/);
    if (!m || names.has(Number(m[1]))) continue;
    let text = m[2].trim();
    if (/^\d/.test(text)) continue;
    if (/nebula|cluster|galaxy|nova|cpd|misnumber|called/i.test(text)) continue;
    text = text.split(/[;.]/)[0].split(",")[0].replace(/\(.*$/, "").trim();
    if (text.length < 3 || text.length > 28) continue;
    if (!/^[A-Za-z][A-Za-z' \-]+$/.test(text)) continue;
    if (text === text.toUpperCase()) {
      text = text
        .toLowerCase()
        .replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
    }
    names.set(Number(m[1]), text);
  }
  return names;
}

function parseCatalog(boundaries: BoundarySegment[], names: Map<number, string>): RawStar[] {
  const stars: RawStar[] = [];
  for (const line of readFileSync(`${CACHE}/catalog`, "utf8").split(/\n/)) {
    if (line.length < 110) continue;
    const hr = Number(line.slice(0, 4));
    if (!Number.isFinite(hr)) continue;
    const nameField = line.slice(4, 14);
    if (/NOVA|NGC/i.test(nameField)) continue;
    const magRaw = line.slice(102, 107).trim();
    if (!magRaw) continue;
    const mag = Number(magRaw);
    if (!Number.isFinite(mag) || mag > 6.5) continue;
    const rah = Number(line.slice(75, 77));
    const ram = Number(line.slice(77, 79));
    const ras = Number(line.slice(79, 83));
    const sign = line[83] === "-" ? -1 : 1;
    const ded = Number(line.slice(84, 86));
    const dem = Number(line.slice(86, 88));
    const des = Number(line.slice(88, 90));
    if (![rah, ram, ras, ded, dem, des].every(Number.isFinite)) continue;
    const ra = (rah + ram / 60 + ras / 3600) * 15;
    const dec = sign * (ded + dem / 60 + des / 3600);
    const bvRaw = line.slice(109, 114).trim();
    let bv = bvRaw ? Number(bvRaw) : Number.NaN;
    const spec = line.slice(127, 147).trim();
    if (!Number.isFinite(bv)) {
      const letter = spec.match(/[OBAFGKM]/)?.[0] ?? "A";
      bv = { O: -0.32, B: -0.15, A: 0.05, F: 0.35, G: 0.65, K: 1.05, M: 1.5 }[letter] ?? 0;
    }
    const conField = nameField.slice(7, 10);
    const bayerRaw = nameField.slice(3, 6).trim();
    const bayerNum = /[0-9]/.test(nameField[6]) ? nameField[6] : "";
    const bayer = bayerRaw ? `${bayerRaw}${bayerNum} ${conField}` : null;
    const flam = Number(nameField.slice(0, 3));
    const con = constellationAtJ2000(ra, dec, boundaries) ?? (/^[A-Z][A-Za-z]{2}$/.test(conField) ? conField : "");
    if (!con) continue;
    const curated = bayer ? CURATED[bayer] : undefined;
    stars.push({
      hr,
      ra,
      dec,
      mag,
      bv,
      name: curated ?? names.get(hr) ?? null,
      con,
      bayer,
      flam: Number.isFinite(flam) ? flam : null,
    });
  }
  return stars;
}

function dedupe(stars: RawStar[]): RawStar[] {
  const sorted = [...stars].sort((a, b) => a.mag - b.mag || a.hr - b.hr);
  const kept: RawStar[] = [];
  for (const star of sorted) {
    const twin = kept.find((other) => angDeg(other, star) < 0.005 && other.con === star.con);
    if (twin) {
      if (!twin.name && star.name) twin.name = star.name;
      if (!twin.bayer && star.bayer) twin.bayer = star.bayer;
      continue;
    }
    kept.push(star);
  }
  return kept;
}

function indexByBayer(stars: RawStar[]) {
  const map = new Map<string, RawStar>();
  for (const star of stars) {
    if (!star.bayer) continue;
    const prev = map.get(star.bayer);
    if (!prev || star.mag < prev.mag) map.set(star.bayer, star);
  }
  return map;
}

function tokenToKey(token: string, con: string) {
  if (token.includes("@")) {
    const [bayer, other] = token.split("@");
    return `${bayer} ${other}`;
  }
  return `${token} ${con}`;
}

function lookupBayer(byBayer: Map<string, RawStar>, key: string) {
  const exact = byBayer.get(key);
  if (exact) return exact;
  const [bayer, con] = key.split(" ");
  if (!bayer || !con || /\d$/.test(bayer)) return undefined;
  let best: RawStar | undefined;
  for (const n of "123456789") {
    const star = byBayer.get(`${bayer}${n} ${con}`);
    if (star && (!best || star.mag < best.mag)) best = star;
  }
  return best;
}

function manualEdges(byBayer: Map<string, RawStar>) {
  const edges: [number, number][] = [];
  const missing: string[] = [];
  const long: string[] = [];
  for (const [con, chains] of Object.entries(FIGURES)) {
    if (con.endsWith("Extra")) continue;
    for (const chain of chains) {
      const parts = chain.split("-");
      for (let i = 1; i < parts.length; i++) {
        const ka = tokenToKey(parts[i - 1], con);
        const kb = tokenToKey(parts[i], con);
        const a = lookupBayer(byBayer, ka);
        const b = lookupBayer(byBayer, kb);
        if (!a || !b) {
          missing.push(`${ka} – ${kb}`);
          continue;
        }
        const d = angDeg(a, b);
        if (d > 36) {
          long.push(`${d.toFixed(1)}° ${ka} – ${kb}`);
          continue;
        }
        edges.push([a.hr, b.hr]);
      }
    }
  }
  return { edges, missing, long };
}

function mstEdges(stars: RawStar[], maxDeg: number): [number, number][] {
  if (stars.length < 2) return [];
  const used = new Set<number>([0]);
  const edges: [number, number][] = [];
  while (used.size < stars.length) {
    let best: { i: number; j: number; d: number } | null = null;
    for (const i of used) {
      for (let j = 0; j < stars.length; j++) {
        if (used.has(j)) continue;
        const d = angDeg(stars[i], stars[j]);
        if (d <= maxDeg && (!best || d < best.d)) best = { i, j, d };
      }
    }
    if (!best) break;
    used.add(best.j);
    edges.push([stars[best.i].hr, stars[best.j].hr]);
  }
  return edges;
}

function round(n: number, places: number) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

ensureInputs();
const boundaries = parseBoundaries();
const names = parseNames();
const raw = dedupe(parseCatalog(boundaries, names));
const byBayer = indexByBayer(raw);
const manual = manualEdges(byBayer);

const manualCons = new Set(Object.keys(FIGURES).filter((c) => !c.endsWith("Extra")));
const byCon = new Map<string, RawStar[]>();
for (const star of raw) {
  const list = byCon.get(star.con) ?? [];
  list.push(star);
  byCon.set(star.con, list);
}

const edges = [...manual.edges];
const mstCons: string[] = [];
for (const [con, members] of byCon) {
  if (manualCons.has(con)) continue;
  const bright = members.filter((s) => s.mag <= 5.0);
  const pool = bright.length >= 2 ? bright : members.filter((s) => s.mag <= 5.6);
  const extra = mstEdges(pool, 16);
  if (extra.length) {
    edges.push(...extra);
    mstCons.push(con);
  }
}

// Hydra's body is a long west-east snake; add a declination-bounded RA path
// of its brighter stars so Alphard connects toward the tail.
const hydra = (byCon.get("Hya") ?? [])
  .filter((s) => s.mag <= 4.6)
  .sort((a, b) => a.ra - b.ra);
for (let i = 1; i < hydra.length; i++) {
  if (angDeg(hydra[i - 1], hydra[i]) <= 22) edges.push([hydra[i - 1].hr, hydra[i].hr]);
}
const eridanus = (byCon.get("Eri") ?? [])
  .filter((s) => s.mag <= 4.5)
  .sort((a, b) => b.dec - a.dec);
for (let i = 1; i < eridanus.length; i++) {
  if (angDeg(eridanus[i - 1], eridanus[i]) <= 18) edges.push([eridanus[i - 1].hr, eridanus[i].hr]);
}

const used = new Set<number>();
for (const [a, b] of edges) {
  used.add(a);
  used.add(b);
}

const kept = raw.filter((s) => s.mag <= 5.5 || used.has(s.hr));
kept.sort((a, b) => a.mag - b.mag || a.hr - b.hr);
const hrOk = new Set(kept.map((s) => s.hr));
const lines = edges.filter(([a, b]) => hrOk.has(a) && hrOk.has(b) && a !== b);
const uniqueLines: [number, number][] = [];
const seenLine = new Set<string>();
for (const [a, b] of lines) {
  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
  if (seenLine.has(key)) continue;
  seenLine.add(key);
  uniqueLines.push([a, b]);
}

const starsOut = kept.map((s) => ({
  hr: s.hr,
  ra: round(s.ra, 4),
  dec: round(s.dec, 4),
  mag: round(s.mag, 2),
  bv: round(s.bv, 2),
  name: s.name,
  con: s.con,
}));

const payload = {
  meta: {
    stars: starsOut.length,
    named: starsOut.filter((s) => s.name).length,
    lines: uniqueLines.length,
    magLimit: 5.5,
    equinox: "J2000",
    sources: [
      "Yale Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), NASA ADC V/50",
      "Constellation boundaries: Delporte 1930 as arranged by Roman 1987, CDS VI/42",
    ],
  },
  boundaries: boundaries.map((s) => [round(s.raLow, 4), round(s.raUp, 4), round(s.deLow, 4), s.con]),
  stars: starsOut,
  lines: uniqueLines,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload));

const consWithLines = new Set<string>();
const byHr = new Map(kept.map((s) => [s.hr, s]));
for (const [a, b] of uniqueLines) {
  consWithLines.add(byHr.get(a)!.con);
  consWithLines.add(byHr.get(b)!.con);
}
const quiet = [...byCon.keys()].filter((c) => !consWithLines.has(c)).sort();

console.log(JSON.stringify(payload.meta));
console.log("missing", manual.missing.length);
for (const m of manual.missing) console.log("  missing", m);
console.log("long", manual.long.length);
for (const m of manual.long) console.log("  long", m);
console.log("mst constellations", mstCons.sort().join(" "));
console.log("no lines", quiet.join(" ") || "(none)");
console.log("wrote", OUT, "bytes", Buffer.byteLength(JSON.stringify(payload)));
