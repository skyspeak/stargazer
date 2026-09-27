# Stargazer

A planetarium for the sky above you. It plots real bright stars in altitude and azimuth from your latitude, longitude, and the local sidereal time, then names whatever sits in the center of the view.

Drag to look around on a desktop. On a phone, aim with the gyroscope and compass. Scroll or pinch to zoom. The time slider moves the sky through the night.

## Run it

```bash
npm install
npm run dev
```

The dev server listens on [http://localhost:43123](http://localhost:43123).

`npm run check:sky` checks sidereal time, the altitude/azimuth conversion, and constellation lookup. `npm run sky:build` rebuilds `src/data/sky.json` from the source catalogs (it downloads them into `/tmp/catalog` if they are not already there).

## What you are looking at

The chart uses a bright-star subset of the Yale Bright Star Catalogue, 5th Revised Edition (Hoffleit & Warren 1991), distributed by the NASA Astronomical Data Center as catalog V/50. Stars are kept down to about magnitude 5.5, with a few fainter ones where a stick figure needs them. Positions are J2000, precessed to the selected date.

Constellation names in the reticle come from the 1930 IAU boundaries (Delporte), in the arrangement published by Roman (1987) and distributed as CDS catalog VI/42. Stick figures are original pairings of Bayer stars drawn for this app.

Geolocation is requested when the page opens. If it is blocked or unavailable, the horizon stays at New York (40.71° N, 74.01° W) until you enter coordinates.

## Look around

- Drag, or the arrow keys, pans and tilts. Scroll, or `+` / `-`, zooms.
- On a phone, **Aim with phone** asks for motion access (required on iOS) and then points the view out the back of the device. If sensors are denied or missing, dragging still works.
- The reticle names the constellation under it, and the nearest bright named star when one is close. Tap a star or a constellation name to hold that selection until you look away.
- Lines and names can be turned off. **Bright patch** aims the view at a rich part of the current sky.
