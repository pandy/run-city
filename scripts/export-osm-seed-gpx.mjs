import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const routes = [
  {
    id: 'beijing-olympic-south-5k',
    cityId: 'beijing',
    name: '奥森南园智慧跑道',
    targetDistanceKm: 5,
    wayIds: [
      93467809,
      119980751,
      119980755,
      119980763,
      173491961,
      173491949,
      355471681,
      355471680,
      1350824884,
      1350824882,
    ],
    evidenceUrls: [
      'https://tyj.beijing.gov.cn/bjsports/ztzl/tywhxxlyyzlxtj/pblx/10902574/index.html',
      'https://mp.visitbeijing.com.cn/a1/48AKetvfWqa',
    ],
  },
  { id: 'shanghai-century-park', cityId: 'shanghai', name: '世纪公园外缘', osmId: 'R1919664' },
  { id: 'guangzhou-tianhe-park', cityId: 'guangzhou', name: '天河公园外缘', osmId: 'W194415752' },
  { id: 'shenzhen-talent-park', cityId: 'shenzhen', name: '人才公园外缘', osmId: 'R18459537' },
];

const outputRoot = resolve('route-data');
const nominatimEndpoint = 'https://nominatim.openstreetmap.org/lookup';
const overpassEndpoint = 'https://overpass-api.de/api/interpreter';
const osmApiEndpoint = 'https://api.openstreetmap.org/api/0.6';

function distanceKm(points) {
  const radians = (value) => value * Math.PI / 180;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [previousLongitude, previousLatitude] = points[index - 1];
    const [longitude, latitude] = points[index];
    const deltaLatitude = radians(latitude - previousLatitude);
    const deltaLongitude = radians(longitude - previousLongitude);
    const value = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(previousLatitude)) * Math.cos(radians(latitude)) * Math.sin(deltaLongitude / 2) ** 2;
    total += 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }
  return Number(total.toFixed(2));
}

function toGpx(route, points) {
  const trackPoints = points.map(([longitude, latitude]) => `      <trkpt lat="${latitude}" lon="${longitude}" />`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Run City / OpenStreetMap" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${route.name}</name><copyright author="OpenStreetMap contributors"><license>https://www.openstreetmap.org/copyright</license></copyright></metadata>\n  <trk><name>${route.name}</name><trkseg>\n${trackPoints}\n  </trkseg></trk>\n</gpx>\n`;
}

function endpointGapMeters(points) {
  if (points.length < 2) return Infinity;
  const [startLongitude, startLatitude] = points[0];
  const [endLongitude, endLatitude] = points.at(-1);
  const latitudeMeters = (endLatitude - startLatitude) * 111320;
  const longitudeMeters = (endLongitude - startLongitude) * 111320 * Math.cos(startLatitude * Math.PI / 180);
  return Math.hypot(latitudeMeters, longitudeMeters);
}

async function fetchPolygon(route) {
  const query = new URLSearchParams({ osm_ids: route.osmId, format: 'jsonv2', polygon_geojson: '1' });
  const response = await fetch(`${nominatimEndpoint}?${query}`, { headers: { 'User-Agent': 'RunCityRouteEditor/0.1' } });
  if (!response.ok) throw new Error(`${route.id}: OSM lookup failed with ${response.status}`);
  const [place] = await response.json();
  if (!place || place.geojson?.type !== 'Polygon') throw new Error(`${route.id}: expected one OSM polygon`);
  return {
    points: place.geojson.coordinates[0],
    sourceUrls: [`https://www.openstreetmap.org/${place.osm_type}/${place.osm_id}`],
    sourceType: 'osm_polygon_boundary',
  };
}

async function fetchOrderedWays(route) {
  const overpassQuery = `[out:json][timeout:90];way(id:${route.wayIds.join(',')});out tags geom;`;
  const query = new URLSearchParams({ data: overpassQuery });
  const response = await fetch(`${overpassEndpoint}?${query}`, { headers: { 'User-Agent': 'RunCityRouteEditor/0.1' } });
  let wayById;
  if (response.ok) {
    const payload = await response.json();
    wayById = new Map(payload.elements.map((way) => [way.id, way]));
  } else {
    console.warn(`${route.id}: Overpass returned ${response.status}; falling back to the OSM API`);
    const ways = await Promise.all(route.wayIds.map(async (wayId) => {
      const wayResponse = await fetch(`${osmApiEndpoint}/way/${wayId}/full.json`, {
        headers: { 'User-Agent': 'RunCityRouteEditor/0.1' },
      });
      if (!wayResponse.ok) throw new Error(`${route.id}: OSM way ${wayId} failed with ${wayResponse.status}`);
      const payload = await wayResponse.json();
      const nodeById = new Map(
        payload.elements
          .filter((element) => element.type === 'node')
          .map((node) => [node.id, { lat: node.lat, lon: node.lon }]),
      );
      const way = payload.elements.find((element) => element.type === 'way' && element.id === wayId);
      if (!way) throw new Error(`${route.id}: OSM way ${wayId} was not returned`);
      return { ...way, geometry: way.nodes.map((nodeId) => nodeById.get(nodeId)) };
    }));
    wayById = new Map(ways.map((way) => [way.id, way]));
  }
  const missingWayIds = route.wayIds.filter((wayId) => !wayById.has(wayId));
  if (missingWayIds.length > 0) throw new Error(`${route.id}: missing OSM ways ${missingWayIds.join(', ')}`);

  const points = [];
  for (const wayId of route.wayIds) {
    const geometry = wayById.get(wayId).geometry.map(({ lon, lat }) => [lon, lat]);
    for (const point of geometry) {
      const previous = points.at(-1);
      if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point);
    }
  }

  return {
    points,
    sourceUrls: route.wayIds.map((wayId) => `https://www.openstreetmap.org/way/${wayId}`),
    sourceType: 'osm_running_track_ways',
  };
}

const requestedRouteId = process.argv[2];
const selectedRoutes = requestedRouteId ? routes.filter((route) => route.id === requestedRouteId) : routes;
if (selectedRoutes.length === 0) throw new Error(`Unknown route id: ${requestedRouteId}`);

for (const [index, route] of selectedRoutes.entries()) {
  if (index > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1100));
  const { points, sourceUrls, sourceType } = route.wayIds ? await fetchOrderedWays(route) : await fetchPolygon(route);
  const directory = resolve(outputRoot, route.cityId, route.id);
  await mkdir(directory, { recursive: true });
  const reference = {
    type: 'Feature',
    properties: {
      name: route.name,
      sources: sourceUrls,
      evidenceUrls: route.evidenceUrls ?? [],
      license: 'ODbL',
    },
    geometry: { type: 'LineString', coordinates: points },
  };
  const computedDistanceKm = distanceKm(points);
  const endpointGap = endpointGapMeters(points);
  const metadata = {
    id: route.id,
    cityId: route.cityId,
    name: route.name,
    targetDistanceKm: route.targetDistanceKm,
    computedDistanceKm,
    distanceDifferencePercent: route.targetDistanceKm
      ? Number((Math.abs(computedDistanceKm - route.targetDistanceKm) / route.targetDistanceKm * 100).toFixed(1))
      : undefined,
    sourceType,
    sourceUrls,
    evidenceUrls: route.evidenceUrls ?? [],
    license: 'ODbL',
    coordinateSystem: 'WGS-84',
    topology: {
      endpointGapMeters: Number(endpointGap.toFixed(1)),
      closedLoop: endpointGap <= 5,
    },
    geometryAlignment: 'pending_validation',
    mapReview: { ios: 'pending', android: 'pending' },
    fieldReview: 'pending',
    status: route.wayIds && endpointGap <= 5 ? 'geometry_verified_needs_map_review' : 'geometry_candidate',
  };
  await writeFile(resolve(directory, 'route.gpx'), toGpx(route, points));
  await writeFile(resolve(directory, 'reference.geojson'), `${JSON.stringify(reference, null, 2)}\n`);
  await writeFile(resolve(directory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`${route.id}: ${metadata.computedDistanceKm} km`);
}
