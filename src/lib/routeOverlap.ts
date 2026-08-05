import type { AppRoute, Coordinate } from '../data/appRoutes';

export type RouteOverlapRun = {
  id: string;
  startTime?: string;
  distanceKm?: number;
  encodedPath: string;
};

export type CalculatedRouteMatch = {
  routeId: string;
  routeName: string;
  overlapPercent: number;
  matchedDistanceKm: number;
  matched: true;
  runId: string;
  runDate?: string;
  runDistanceKm?: number;
};

const CORRIDOR_METERS = 50;
const SAMPLE_METERS = 25;
const MATCH_THRESHOLD = 0.2;

function decodePolyline(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const deltas: number[] = [];
    for (let coordinateIndex = 0; coordinateIndex < 2; coordinateIndex += 1) {
      let result = 0;
      let shift = 0;
      let byte = 0;
      do {
        if (index >= encoded.length) return points;
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      deltas.push((result & 1) ? ~(result >> 1) : result >> 1);
    }
    latitude += deltas[0];
    longitude += deltas[1];
    points.push({ latitude: latitude / 100000, longitude: longitude / 100000 });
  }
  return points;
}

function project(point: Coordinate, referenceLatitude: number) {
  return {
    x: point.longitude * 111320 * Math.cos(referenceLatitude * Math.PI / 180),
    y: point.latitude * 110540,
  };
}

function resample(points: Coordinate[], spacingMeters = SAMPLE_METERS) {
  if (points.length < 2) return points;
  const referenceLatitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const projected = points.map((point) => project(point, referenceLatitude));
  const output = [points[0]];
  let remaining = spacingMeters;
  for (let index = 0; index < points.length - 1; index += 1) {
    let start = points[index];
    let startProjected = projected[index];
    const end = points[index + 1];
    const endProjected = projected[index + 1];
    let segmentLength = Math.hypot(endProjected.x - startProjected.x, endProjected.y - startProjected.y);
    while (segmentLength >= remaining && segmentLength > 0) {
      const ratio = remaining / segmentLength;
      start = {
        latitude: start.latitude + (end.latitude - start.latitude) * ratio,
        longitude: start.longitude + (end.longitude - start.longitude) * ratio,
      };
      output.push(start);
      startProjected = project(start, referenceLatitude);
      segmentLength = Math.hypot(endProjected.x - startProjected.x, endProjected.y - startProjected.y);
      remaining = spacingMeters;
    }
    remaining -= segmentLength;
  }
  const last = points[points.length - 1];
  if (output[output.length - 1] !== last) output.push(last);
  return output;
}

function boundingBox(points: Coordinate[]) {
  return points.reduce((box, point) => ({
    minLatitude: Math.min(box.minLatitude, point.latitude),
    minLongitude: Math.min(box.minLongitude, point.longitude),
    maxLatitude: Math.max(box.maxLatitude, point.latitude),
    maxLongitude: Math.max(box.maxLongitude, point.longitude),
  }), {
    minLatitude: Number.POSITIVE_INFINITY,
    minLongitude: Number.POSITIVE_INFINITY,
    maxLatitude: Number.NEGATIVE_INFINITY,
    maxLongitude: Number.NEGATIVE_INFINITY,
  });
}

function boxesIntersect(first: ReturnType<typeof boundingBox>, second: ReturnType<typeof boundingBox>) {
  const margin = 0.01;
  return !(first.maxLatitude < second.minLatitude - margin
    || first.minLatitude > second.maxLatitude + margin
    || first.maxLongitude < second.minLongitude - margin
    || first.minLongitude > second.maxLongitude + margin);
}

function coverageFor(routePoints: Coordinate[], runPoints: Coordinate[]) {
  const referenceLatitude = routePoints.reduce((sum, point) => sum + point.latitude, 0) / routePoints.length;
  const routeSamples = resample(routePoints);
  const runSamples = resample(runPoints);
  const grid = new Map<string, Array<{ x: number; y: number }>>();
  runSamples.forEach((point) => {
    const projected = project(point, referenceLatitude);
    const key = `${Math.floor(projected.x / CORRIDOR_METERS)}:${Math.floor(projected.y / CORRIDOR_METERS)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(projected);
    else grid.set(key, [projected]);
  });
  let covered = 0;
  routeSamples.forEach((point) => {
    const projected = project(point, referenceLatitude);
    const cellX = Math.floor(projected.x / CORRIDOR_METERS);
    const cellY = Math.floor(projected.y / CORRIDOR_METERS);
    let found = false;
    for (let offsetX = -1; offsetX <= 1 && !found; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1 && !found; offsetY += 1) {
        found = (grid.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? []).some((candidate) =>
          (candidate.x - projected.x) ** 2 + (candidate.y - projected.y) ** 2
            <= CORRIDOR_METERS ** 2);
      }
    }
    if (found) covered += 1;
  });
  return routeSamples.length ? covered / routeSamples.length : 0;
}

function routeLengthKm(points: Coordinate[]) {
  if (points.length < 2) return 0;
  const referenceLatitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const projected = points.map((point) => project(point, referenceLatitude));
  return projected.slice(1).reduce((length, point, index) =>
    length + Math.hypot(point.x - projected[index].x, point.y - projected[index].y), 0) / 1000;
}

export function matchRunsToRoutes(routes: AppRoute[], runs: RouteOverlapRun[]) {
  const decodedRuns = runs
    .filter((run) => run.encodedPath)
    .map((run) => ({ run, points: decodePolyline(run.encodedPath) }))
    .filter((entry) => entry.points.length > 1)
    .map((entry) => ({ ...entry, box: boundingBox(entry.points) }));

  return routes.reduce<Record<string, CalculatedRouteMatch>>((matches, route) => {
    if (route.coordinates.length < 2) return matches;
    const routeBox = boundingBox(route.coordinates);
    let bestCoverage = 0;
    let bestRun: RouteOverlapRun | undefined;
    decodedRuns.forEach((entry) => {
      if (!boxesIntersect(routeBox, entry.box)) return;
      const coverage = coverageFor(route.coordinates, entry.points);
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestRun = entry.run;
      }
    });
    if (bestRun && bestCoverage >= MATCH_THRESHOLD) {
      matches[route.id] = {
        routeId: route.id,
        routeName: route.name,
        overlapPercent: Math.round(bestCoverage * 1000) / 10,
        matchedDistanceKm: Math.round(bestCoverage * routeLengthKm(route.coordinates) * 100) / 100,
        matched: true,
        runId: bestRun.id,
        runDate: bestRun.startTime,
        runDistanceKm: bestRun.distanceKm,
      };
    }
    return matches;
  }, {});
}
