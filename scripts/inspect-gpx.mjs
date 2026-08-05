import { readFileSync } from 'node:fs';

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('用法：npm run inspect:gpx -- <路线文件.gpx>');
  process.exit(1);
}

const gpx = readFileSync(inputPath, 'utf8');
const points = [];
const pointPattern = /<trkpt\b([^>]*)>/g;
let match;

while ((match = pointPattern.exec(gpx))) {
  const attributes = match[1];
  const latitude = Number(attributes.match(/\blat=["']([^"']+)["']/)?.[1]);
  const longitude = Number(attributes.match(/\blon=["']([^"']+)["']/)?.[1]);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) points.push({ latitude, longitude });
}

if (points.length < 2) {
  console.error('没有找到至少两个有效 trkpt 点。请确认文件是 GPX 轨迹文件。');
  process.exit(1);
}

function haversineKm(a, b) {
  const earthRadiusKm = 6371;
  const toRadians = (value) => value * Math.PI / 180;
  const deltaLatitude = toRadians(b.latitude - a.latitude);
  const deltaLongitude = toRadians(b.longitude - a.longitude);
  const startLatitude = toRadians(a.latitude);
  const endLatitude = toRadians(b.latitude);
  const angle = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle));
}

const distanceKm = points.slice(1).reduce((total, point, index) => total + haversineKm(points[index], point), 0);
const latitudes = points.map((point) => point.latitude);
const longitudes = points.map((point) => point.longitude);

console.log(JSON.stringify({
  status: 'candidate',
  coordinateCount: points.length,
  computedDistanceKm: Number(distanceKm.toFixed(2)),
  start: points[0],
  finish: points.at(-1),
  bounds: {
    south: Math.min(...latitudes), north: Math.max(...latitudes),
    west: Math.min(...longitudes), east: Math.max(...longitudes)
  },
  coordinates: points
}, null, 2));
