import { readFile, writeFile } from 'node:fs/promises';

const output = new URL('../src/data/mappedRoutes.generated.ts', import.meta.url);
const routes = [
  ['beijing-olympic-south-5k', '../route-data/beijing/beijing-olympic-south-5k'],
  ['shanghai-century-park', '../route-data/shanghai/shanghai-century-park'],
  ['guangzhou-tianhe-park', '../route-data/guangzhou/guangzhou-tianhe-park'],
  ['shenzhen-talent-park', '../route-data/shenzhen/shenzhen-talent-park'],
];

function parseGpx(input) {
  return [...input.matchAll(/<trkpt\b([^>]*)>/g)].map((match) => ({
    latitude: Number(match[1].match(/\blat=["']([^"']+)["']/)?.[1]),
    longitude: Number(match[1].match(/\blon=["']([^"']+)["']/)?.[1]),
  })).filter(({ latitude, longitude }) => Number.isFinite(latitude) && Number.isFinite(longitude));
}

const mappedRoutes = {};
for (const [routeId, directory] of routes) {
  const [metadataInput, gpxInput] = await Promise.all([
    readFile(new URL(`${directory}/metadata.json`, import.meta.url), 'utf8'),
    readFile(new URL(`${directory}/route.gpx`, import.meta.url), 'utf8'),
  ]);
  const metadata = JSON.parse(metadataInput);
  const coordinates = parseGpx(gpxInput);
  if (coordinates.length < 2) throw new Error(`${routeId}: GPX contains fewer than two coordinates`);
  mappedRoutes[routeId] = {
    distanceKm: metadata.computedDistanceKm,
    status: metadata.status,
    coordinates,
  };
}

const source = `// Generated from route-data GPX files. Do not edit by hand.\n` +
  `// Route geometry remains WGS-84; AMap links are converted separately.\n` +
  `export const mappedRouteGeometries = ${JSON.stringify(mappedRoutes, null, 2)} as const;\n`;
await writeFile(output, source);
console.log(`Generated ${Object.keys(mappedRoutes).length} mapped route geometries.`);
