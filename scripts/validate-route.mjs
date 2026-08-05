import { readFileSync } from 'node:fs';

const [gpxPath, referencePath, ...options] = process.argv.slice(2);
const thresholdOption = options.find((option) => option.startsWith('--threshold='));
const thresholdMeters = Number(thresholdOption?.split('=')[1] ?? 30);

if (!gpxPath || !referencePath || !Number.isFinite(thresholdMeters)) {
  console.error('用法：npm run validate:route -- <路线.gpx> <OSM参考线.geojson> [--threshold=30]');
  process.exit(1);
}

function gpxPoints(input) {
  const points = [];
  for (const match of input.matchAll(/<trkpt\b([^>]*)>/g)) {
    const latitude = Number(match[1].match(/\blat=["']([^"']+)["']/)?.[1]);
    const longitude = Number(match[1].match(/\blon=["']([^"']+)["']/)?.[1]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) points.push({ latitude, longitude });
  }
  return points;
}

function geoJsonLine(input) {
  const geometry = input.type === 'Feature' ? input.geometry : input;
  if (geometry.type === 'LineString') return geometry.coordinates;
  if (geometry.type === 'MultiLineString') return geometry.coordinates.flat();
  throw new Error('参考文件必须是 GeoJSON LineString、MultiLineString 或 Feature。');
}

function meters(point, origin) {
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos(origin.latitude * Math.PI / 180);
  return { x: (point.longitude - origin.longitude) * longitudeScale, y: (point.latitude - origin.latitude) * latitudeScale };
}

function pointToSegmentMeters(point, start, end) {
  const a = meters(start, point);
  const b = meters(end, point);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const factor = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + factor * dx, a.y + factor * dy);
}

function nearestDistance(point, line) {
  let closest = Infinity;
  for (let index = 1; index < line.length; index += 1) closest = Math.min(closest, pointToSegmentMeters(point, line[index - 1], line[index]));
  return closest;
}

const gpx = gpxPoints(readFileSync(gpxPath, 'utf8'));
const reference = geoJsonLine(JSON.parse(readFileSync(referencePath, 'utf8'))).map(([longitude, latitude]) => ({ latitude, longitude }));
if (gpx.length < 2 || reference.length < 2) throw new Error('GPX 与参考线均至少需要两个有效坐标点。');

const stride = Math.max(1, Math.ceil(gpx.length / 400));
const samples = gpx.filter((_, index) => index % stride === 0 || index === gpx.length - 1);
const distances = samples.map((point) => nearestDistance(point, reference)).sort((a, b) => a - b);
const percentile = (fraction) => distances[Math.min(distances.length - 1, Math.floor((distances.length - 1) * fraction))];
const withinThreshold = distances.filter((distance) => distance <= thresholdMeters).length / distances.length;
const result = {
  coordinateSystem: 'WGS-84 required for both GPX and reference GeoJSON',
  samples: samples.length,
  thresholdMeters,
  medianDeviationMeters: Number(percentile(0.5).toFixed(1)),
  p95DeviationMeters: Number(percentile(0.95).toFixed(1)),
  withinThresholdPercent: Number((withinThreshold * 100).toFixed(1)),
  status: withinThreshold >= 0.9 && percentile(0.95) <= thresholdMeters * 2 ? 'pass' : 'fail',
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === 'pass' ? 0 : 2;
