/** Equatorial ↔ horizontal sky math, sidereal time, and IAU constellation lookup. */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** J2000.0 = 2000 January 1, 12:00 TT. */
export const J2000_JD = 2451545.0;

/** Besselian epoch as a Julian Date (Newcomb). */
export function besselianJd(year: number): number {
  return 2415020.31352 + (year - 1900) * 365.242198781;
}

/** Equinox of the IAU constellation boundaries (Delporte 1930). */
export const B1875_JD = besselianJd(1875);

export function julianDate(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

/** Greenwich mean sidereal time in hours. Meeus, accurate to a fraction of a second. */
export function greenwichSiderealHours(date: Date): number {
  const jd = julianDate(date);
  const t = (jd - J2000_JD) / 36525;
  let gmst =
    280.46061837 +
    360.98564736629 * (jd - J2000_JD) +
    0.000387933 * t * t -
    (t * t * t) / 38_710_000;
  gmst = ((gmst % 360) + 360) % 360;
  return gmst / 15;
}

/** Local sidereal time in hours. Longitude is east-positive, in degrees. */
export function localSiderealHours(date: Date, longitudeDeg: number): number {
  const lst = greenwichSiderealHours(date) + longitudeDeg / 15;
  return ((lst % 24) + 24) % 24;
}

export type Vec3 = { x: number; y: number; z: number };

export function raDecToVec(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return { x: c * Math.cos(ra), y: c * Math.sin(ra), z: Math.sin(dec) };
}

export function vecToRaDec(v: Vec3): { ra: number; dec: number } {
  const ra = (Math.atan2(v.y, v.x) * RAD + 360) % 360;
  const dec = Math.asin(clamp(v.z, -1, 1)) * RAD;
  return { ra, dec };
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function precessionAngles(centuriesFromJ2000: number) {
  const T = centuriesFromJ2000;
  const arcsec = DEG / 3600;
  const zeta =
    ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * T +
      (0.30188 - 0.000344 * T) * T * T +
      0.017998 * T * T * T) *
    arcsec;
  const z =
    ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * T +
      (1.09468 + 0.000066 * T) * T * T +
      0.018203 * T * T * T) *
    arcsec;
  const theta =
    ((2004.3109 - 0.8533 * T - 0.000217 * T * T) * T -
      (0.42665 + 0.000217 * T) * T * T -
      0.041833 * T * T * T) *
    arcsec;
  return { zeta, z, theta };
}

/** IAU 1976 precession matrix taking J2000 equatorial vectors to the given epoch. */
function precessionMatrix(centuriesFromJ2000: number): number[] {
  const { zeta, z, theta } = precessionAngles(centuriesFromJ2000);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  const cth = Math.cos(theta);
  const sth = Math.sin(theta);
  const cze = Math.cos(zeta);
  const sze = Math.sin(zeta);
  return [
    cz * cth * cze - sz * sze,
    -cz * cth * sze - sz * cze,
    -cz * sth,
    sz * cth * cze + cz * sze,
    -sz * cth * sze + cz * cze,
    -sz * sth,
    sth * cze,
    -sth * sze,
    cth,
  ];
}

function apply(m: number[], v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

function transpose(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Precess an equatorial position from one Julian-date equinox to another. */
export function precess(
  raDeg: number,
  decDeg: number,
  fromJd: number,
  toJd: number,
): { ra: number; dec: number } {
  const tFrom = (fromJd - J2000_JD) / 36525;
  const tTo = (toJd - J2000_JD) / 36525;
  const viaJ2000 = apply(transpose(precessionMatrix(tFrom)), raDecToVec(raDeg, decDeg));
  return vecToRaDec(apply(precessionMatrix(tTo), viaJ2000));
}

export type BoundarySegment = {
  raLow: number;
  raUp: number;
  deLow: number;
  con: string;
};

/**
 * Constellation containing an equinox-1875 position.
 * Segments are the southern boundaries tabulated by Roman (1987): the
 * constellation is the one whose southern edge is the northernmost edge
 * still south of the point and whose right-ascension span covers it.
 */
export function findConstellation1875(
  raHours: number,
  decDeg: number,
  segments: BoundarySegment[],
): string | null {
  const ra = ((raHours % 24) + 24) % 24;
  let best: string | null = null;
  let bestDe = -1000;
  for (const s of segments) {
    if (decDeg < s.deLow - 1e-6) continue;
    if (ra < s.raLow - 1e-8 || ra >= s.raUp - 1e-8) continue;
    if (s.deLow > bestDe) {
      bestDe = s.deLow;
      best = s.con;
    }
  }
  return best;
}

/** IAU constellation for a J2000 right ascension and declination. */
export function constellationAtJ2000(
  raDeg: number,
  decDeg: number,
  segments: BoundarySegment[],
): string | null {
  const old = precess(raDeg, decDeg, J2000_JD, B1875_JD);
  return findConstellation1875(old.ra / 15, old.dec, segments);
}

/**
 * Horizontal coordinates.
 * Azimuth is degrees from north toward east (0 north, 90 east, 180 south).
 * Altitude is degrees above the horizon.
 * `raDeg` / `decDeg` must already be of the same equinox as `lstHours`.
 */
export function raDecToAltAz(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lstHours: number,
): { alt: number; az: number } {
  const ha = (lstHours * 15 - raDeg) * DEG;
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;
  const sinAlt =
    Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  const east = -Math.cos(dec) * Math.sin(ha);
  const north =
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(ha);
  const az = Math.atan2(east, north);
  return { alt: alt * RAD, az: (az * RAD + 360) % 360 };
}

/** Inverse of raDecToAltAz. Returns equatorial coordinates of the same date. */
export function altAzToRaDec(
  altDeg: number,
  azDeg: number,
  latDeg: number,
  lstHours: number,
): { ra: number; dec: number } {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const lat = latDeg * DEG;
  const sinDec =
    Math.sin(alt) * Math.sin(lat) + Math.cos(alt) * Math.cos(lat) * Math.cos(az);
  const dec = Math.asin(clamp(sinDec, -1, 1));
  const sinHaCos = -Math.cos(alt) * Math.sin(az);
  const cosHaCos =
    Math.sin(alt) * Math.cos(lat) - Math.cos(alt) * Math.sin(lat) * Math.cos(az);
  const ha = Math.atan2(sinHaCos, cosHaCos);
  const ra = (lstHours * 15 - ha * RAD + 360) % 360;
  return { ra, dec: dec * RAD };
}

/** Unit vector in the render frame: x east, y up, z north. */
export function altAzToVector(altDeg: number, azDeg: number): Vec3 {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const c = Math.cos(alt);
  return { x: c * Math.sin(az), y: Math.sin(alt), z: c * Math.cos(az) };
}

export function angleBetween(a: Vec3, b: Vec3): number {
  const d = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return Math.acos(d) * RAD;
}

/** Galactic (l, b) to J2000 equatorial degrees. */
export function galacticToEquatorial(lDeg: number, bDeg: number): { ra: number; dec: number } {
  const l = lDeg * DEG;
  const b = bDeg * DEG;
  const decNGP = 27.128336 * DEG;
  const raNGP = 192.859481 * DEG;
  const lNCP = 122.931918 * DEG;
  const sinDec =
    Math.sin(decNGP) * Math.sin(b) +
    Math.cos(decNGP) * Math.cos(b) * Math.cos(lNCP - l);
  const dec = Math.asin(clamp(sinDec, -1, 1));
  const y = Math.cos(b) * Math.sin(lNCP - l);
  const x =
    Math.cos(decNGP) * Math.sin(b) -
    Math.sin(decNGP) * Math.cos(b) * Math.cos(lNCP - l);
  let ra = Math.atan2(y, x) + raNGP;
  ra = (ra + Math.PI * 2) % (Math.PI * 2);
  return { ra: ra / DEG, dec: dec / DEG };
}

export type StarRecord = {
  hr: number;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
  name: string | null;
  con: string;
};

export type PlacedStar = StarRecord & {
  alt: number;
  az: number;
  dir: Vec3;
};

/** Place catalog stars (J2000) on the local sky for a civil instant. */
export function placeStars(
  stars: StarRecord[],
  latDeg: number,
  longitudeDeg: number,
  when: Date,
): { placed: PlacedStar[]; lst: number } {
  const lst = localSiderealHours(when, longitudeDeg);
  const epoch = julianDate(when);
  const placed = stars.map((star) => {
    const ofDate = precess(star.ra, star.dec, J2000_JD, epoch);
    const { alt, az } = raDecToAltAz(ofDate.ra, ofDate.dec, latDeg, lst);
    return { ...star, alt, az, dir: altAzToVector(alt, az) };
  });
  return { placed, lst };
}

export function constellationInView(
  altDeg: number,
  azDeg: number,
  latDeg: number,
  longitudeDeg: number,
  when: Date,
  segments: BoundarySegment[],
): string | null {
  const lst = localSiderealHours(when, longitudeDeg);
  const ofDate = altAzToRaDec(altDeg, azDeg, latDeg, lst);
  const j2000 = precess(ofDate.ra, ofDate.dec, julianDate(when), J2000_JD);
  return constellationAtJ2000(j2000.ra, j2000.dec, segments);
}

/** Aim the opening view at a bright patch above the horizon. */
export function suggestView(placed: PlacedStar[]): { alt: number; az: number } {
  let best = { alt: 42, az: 180, score: -1 };
  for (let alt = 26; alt <= 64; alt += 8) {
    for (let az = 0; az < 360; az += 10) {
      const center = altAzToVector(alt, az);
      let score = 0;
      for (const star of placed) {
        if (star.alt < 6 || star.mag > 3.6) continue;
        const ang = angleBetween(center, star.dir);
        if (ang < 24) score += Math.pow(10, -0.4 * star.mag) * (1 - ang / 32);
      }
      score *= 1 - Math.abs(alt - 42) / 140;
      if (score > best.score) best = { alt, az, score };
    }
  }
  return { alt: best.alt, az: best.az };
}

/**
 * Direction out the back of a phone, plus the on-screen "up" vector,
 * from a DeviceOrientation reading. Azimuth is degrees from north toward
 * east. `screenAngle` is `screen.orientation.angle` (0, 90, 180, 270).
 *
 * The rotation follows the W3C deviceorientation worked example: alpha,
 * beta, and gamma build a Z-X-Y matrix from the device body frame into an
 * east-north-up frame. The sky direction is the back of the phone (−Z).
 */
export function deviceLook(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngle: number,
): { az: number; alt: number; up: Vec3 } {
  const _x = betaDeg * DEG;
  const _y = gammaDeg * DEG;
  const _z = alphaDeg * DEG;
  const cX = Math.cos(_x);
  const sX = Math.sin(_x);
  const cY = Math.cos(_y);
  const sY = Math.sin(_y);
  const cZ = Math.cos(_z);
  const sZ = Math.sin(_z);

  const m11 = cZ * cY - sZ * sX * sY;
  const m12 = -cX * sZ;
  const m13 = cY * sZ * sX + cZ * sY;
  const m21 = cY * sZ + cZ * sX * sY;
  const m22 = cZ * cX;
  const m23 = sZ * sY - cZ * cY * sX;
  const m31 = -cX * sY;
  const m32 = sX;
  const m33 = cX * cY;

  const east = -m13;
  const north = -m23;
  const zen = -m33;
  const alt = Math.asin(clamp(zen, -1, 1)) * RAD;
  const az = (Math.atan2(east, north) * RAD + 360) % 360;

  let dx = 0;
  let dy = 1;
  const angle = ((screenAngle % 360) + 360) % 360;
  if (angle === 90) {
    dx = -1;
    dy = 0;
  } else if (angle === 180) {
    dx = 0;
    dy = -1;
  } else if (angle === 270) {
    dx = 1;
    dy = 0;
  }
  const suEast = m11 * dx + m12 * dy;
  const suNorth = m21 * dx + m22 * dy;
  const suUp = m31 * dx + m32 * dy;
  return { az, alt, up: { x: suEast, y: suUp, z: suNorth } };
}

export function formatHours(hours: number): string {
  const h = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((((hours % 24) + 24) % 1) * 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

/** Rough star color from a B−V color index. */
export function colorFromBV(bv: number): [number, number, number] {
  const t = clamp(bv, -0.35, 2);
  if (t < 0.15) {
    const u = (t + 0.35) / 0.5;
    return [0.62 + 0.28 * u, 0.74 + 0.2 * u, 1];
  }
  if (t < 0.6) {
    const u = (t - 0.15) / 0.45;
    return [0.9 + 0.1 * u, 0.94 - 0.04 * u, 1 - 0.18 * u];
  }
  if (t < 1.15) {
    const u = (t - 0.6) / 0.55;
    return [1, 0.88 - 0.28 * u, 0.72 - 0.32 * u];
  }
  const u = Math.min(1, (t - 1.15) / 0.7);
  return [1, 0.58 - 0.22 * u, 0.38 - 0.18 * u];
}

export function starPointSize(mag: number): number {
  const shine = Math.max(0, 5.8 - mag);
  return 1.85 + shine * shine * 0.26;
}
