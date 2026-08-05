import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
const outputPath = resolve(scriptDirectory, '../src/data/curatedRouteOverrides.generated.ts');
const osmApi = 'https://api.openstreetmap.org/api/0.6';
const headers = { 'User-Agent': 'RunCityRouteCorrection/1.0 (public OSM route curation)' };
const radians = (value) => value * Math.PI / 180;

function attribute(source, name) {
  return source.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
}

function haversineKm(a, b) {
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function lineDistanceKm(points) {
  return points.slice(1).reduce((total, point, index) => total + haversineKm(points[index], point), 0);
}

function pointToSegmentMeters(point, start, end) {
  const latitudeScale = 111_320;
  const longitudeScale = Math.cos(radians(point.latitude)) * 111_320;
  const px = point.longitude * longitudeScale;
  const py = point.latitude * latitudeScale;
  const ax = start.longitude * longitudeScale;
  const ay = start.latitude * latitudeScale;
  const bx = end.longitude * longitudeScale;
  const by = end.latitude * latitudeScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
}

function nearestGuideDistanceMeters(point, guide) {
  let nearest = Infinity;
  for (let index = 1; index < guide.length; index += 1) {
    nearest = Math.min(nearest, pointToSegmentMeters(point, guide[index - 1], guide[index]));
  }
  return nearest;
}

function parseOsmXml(xml) {
  const nodes = new Map();
  for (const match of xml.matchAll(/<node\b([^>]*)\/?>(?:<\/node>)?/g)) {
    nodes.set(attribute(match[1], 'id'), {
      latitude: Number(attribute(match[1], 'lat')),
      longitude: Number(attribute(match[1], 'lon')),
    });
  }
  const ways = [];
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const nodeIds = [...match[2].matchAll(/<nd\s+ref="(\d+)"\s*\/>/g)].map((node) => node[1]);
    const tags = Object.fromEntries([...match[2].matchAll(/<tag\s+k="([^"]+)"\s+v="([^"]*)"\s*\/>/g)]
      .map((tag) => [tag[1], tag[2]]));
    ways.push({ id: Number(attribute(match[1], 'id')), nodeIds, tags });
  }
  return { nodes, ways };
}

async function fetchMap(west, south, east, north) {
  const response = await fetch(`${osmApi}/map?bbox=${west},${south},${east},${north}`, { headers });
  if (!response.ok) throw new Error(`OSM map HTTP ${response.status}`);
  return parseOsmXml(await response.text());
}

async function fetchWay(id) {
  const response = await fetch(`${osmApi}/way/${id}/full`, { headers });
  if (!response.ok) throw new Error(`OSM way ${id} HTTP ${response.status}`);
  const { nodes, ways } = parseOsmXml(await response.text());
  const way = ways.find((candidate) => candidate.id === id);
  if (!way) throw new Error(`OSM way ${id} was not returned`);
  return { ...way, coordinates: way.nodeIds.map((nodeId) => nodes.get(nodeId)).filter(Boolean) };
}

function heapPush(heap, item) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].distance <= item.distance) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = item;
}

function heapPop(heap) {
  if (!heap.length) return undefined;
  const first = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= heap.length) break;
      const child = right < heap.length && heap[right].distance < heap[left].distance ? right : left;
      if (heap[child].distance >= last.distance) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
  }
  return first;
}

function shortestPath(graph, startId, endId) {
  const distances = new Map([[startId, 0]]);
  const previous = new Map();
  const heap = [];
  heapPush(heap, { id: startId, distance: 0 });
  while (heap.length) {
    const current = heapPop(heap);
    if (!current || current.distance !== distances.get(current.id)) continue;
    if (current.id === endId) break;
    for (const edge of graph.get(current.id) ?? []) {
      const distance = current.distance + edge.cost;
      if (distance >= (distances.get(edge.id) ?? Infinity)) continue;
      distances.set(edge.id, distance);
      previous.set(edge.id, { id: current.id, wayId: edge.wayId });
      heapPush(heap, { id: edge.id, distance });
    }
  }
  if (!distances.has(endId)) return undefined;
  const nodeIds = [endId];
  const wayIds = new Set();
  while (nodeIds[0] !== startId) {
    const step = previous.get(nodeIds[0]);
    if (!step) return undefined;
    wayIds.add(step.wayId);
    nodeIds.unshift(step.id);
  }
  return { nodeIds, wayIds };
}

function buildXuhuiRoute(osm) {
  const guide = [
    { latitude: 31.1667975, longitude: 121.4594206 },
    { latitude: 31.1745, longitude: 121.4577 },
    { latitude: 31.1778383, longitude: 121.4571713 },
    { latitude: 31.1812, longitude: 121.4594 },
    { latitude: 31.1860, longitude: 121.4630 },
    { latitude: 31.1900, longitude: 121.4660 },
    { latitude: 31.1930662, longitude: 121.4684685 },
  ];
  const allowedHighways = /^(footway|path|pedestrian|cycleway|track|steps|living_street|service)$/;
  const routeNodes = new Map();
  const graph = new Map();
  const addEdge = (fromId, toId, cost, wayId) => {
    const edges = graph.get(fromId) ?? [];
    edges.push({ id: toId, cost, wayId });
    graph.set(fromId, edges);
  };
  for (const way of osm.ways) {
    if (!allowedHighways.test(way.tags.highway ?? '')) continue;
    if (way.tags.access === 'private' || way.tags.access === 'no' || way.tags.foot === 'no') continue;
    const points = way.nodeIds.map((nodeId) => osm.nodes.get(nodeId));
    if (points.some((point) => !point)) continue;
    const highwayPenalty = /footway|path|pedestrian/.test(way.tags.highway)
      ? 1 : way.tags.highway === 'cycleway' ? 1.04 : 1.22;
    way.nodeIds.forEach((nodeId, index) => routeNodes.set(nodeId, points[index]));
    for (let index = 1; index < way.nodeIds.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const midpoint = {
        latitude: (start.latitude + end.latitude) / 2,
        longitude: (start.longitude + end.longitude) / 2,
      };
      const guideDistance = nearestGuideDistanceMeters(midpoint, guide);
      const corridorPenalty = 1 + Math.max(0, guideDistance - 75) / 120;
      const cost = haversineKm(start, end) * highwayPenalty * corridorPenalty;
      addEdge(way.nodeIds[index - 1], way.nodeIds[index], cost, way.id);
      if (way.tags['oneway:foot'] !== 'yes') addEdge(way.nodeIds[index], way.nodeIds[index - 1], cost, way.id);
    }
  }

  // OSM paths sometimes touch visually but use separate nodes. Only bridge
  // tiny gaps; this keeps the result on the mapped west-bank path network.
  const cellSize = 0.0003;
  const buckets = new Map();
  for (const [nodeId, point] of routeNodes) {
    const key = `${Math.floor(point.latitude / cellSize)},${Math.floor(point.longitude / cellSize)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push([nodeId, point]);
    buckets.set(key, bucket);
  }
  for (const [nodeId, point] of routeNodes) {
    const row = Math.floor(point.latitude / cellSize);
    const column = Math.floor(point.longitude / cellSize);
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        for (const [otherId, otherPoint] of buckets.get(`${row + rowOffset},${column + columnOffset}`) ?? []) {
          if (nodeId >= otherId) continue;
          const gapKm = haversineKm(point, otherPoint);
          if (gapKm * 1000 > 24) continue;
          addEdge(nodeId, otherId, gapKm * 1.18, 'virtual');
          addEdge(otherId, nodeId, gapKm * 1.18, 'virtual');
        }
      }
    }
  }

  const nearestNode = (waypoint) => {
    let nearest;
    for (const [nodeId, point] of routeNodes) {
      const distanceMeters = haversineKm(waypoint, point) * 1000;
      if (!nearest || distanceMeters < nearest.distanceMeters) nearest = { nodeId, point, distanceMeters };
    }
    if (!nearest || nearest.distanceMeters > 180) {
      throw new Error(`No west-bank OSM path within 180 m of ${JSON.stringify(waypoint)}`);
    }
    return nearest;
  };

  const snapped = guide.map(nearestNode);
  const outbound = [];
  const usedWayIds = new Set();
  for (let index = 1; index < snapped.length; index += 1) {
    const result = shortestPath(graph, snapped[index - 1].nodeId, snapped[index].nodeId);
    if (!result) throw new Error(`West-bank OSM graph disconnected at guide segment ${index}`);
    const points = result.nodeIds.map((nodeId) => routeNodes.get(nodeId));
    outbound.push(...(outbound.length ? points.slice(1) : points));
    for (const wayId of result.wayIds) if (Number.isFinite(wayId)) usedWayIds.add(wayId);
  }
  const coordinates = [...outbound, ...outbound.slice(0, -1).reverse()];
  const distanceKm = lineDistanceKm(coordinates);
  if (distanceKm < 5 || distanceKm > 10) throw new Error(`Unexpected Xuhui route distance: ${distanceKm}`);
  const maxLongitudeAtSouth = Math.max(...coordinates
    .filter((point) => point.latitude < 31.179)
    .map((point) => point.longitude));
  if (maxLongitudeAtSouth > 121.462) throw new Error('Xuhui route drifted to the east bank');
  return {
    coordinates,
    distanceKm: Number(distanceKm.toFixed(2)),
    sourceUrls: [...usedWayIds].slice(0, 30).map((wayId) => `https://www.openstreetmap.org/way/${wayId}`),
    snapDistancesMeters: snapped.map((item) => Number(item.distanceMeters.toFixed(1))),
  };
}

const [xuhuiMap, chaoyangWay] = await Promise.all([
  fetchMap(121.454, 31.163, 121.471, 31.197),
  fetchWay(1364891024),
]);
const xuhuiRiverside = buildXuhuiRoute(xuhuiMap);
const chaoyangDistanceKm = Number(lineDistanceKm(chaoyangWay.coordinates).toFixed(2));
if (chaoyangWay.coordinates.length < 50 || chaoyangDistanceKm < 4.5 || chaoyangDistanceKm > 6) {
  throw new Error('Chaoyang Park public track failed geometry checks');
}

const overrides = {
  xuhuiRiverside: {
    id: 'shanghai-xuhui-riverside-7k',
    name: '徐汇滨江西岸跑道',
    distanceKm: xuhuiRiverside.distanceKm,
    coordinates: xuhuiRiverside.coordinates,
    sourceUrls: xuhuiRiverside.sourceUrls,
    evidenceUrl: 'https://english.shanghai.gov.cn/en-Fitness/20251204/32500eb3154848cd81cb070058c00f79.html',
    snapDistancesMeters: xuhuiRiverside.snapDistancesMeters,
  },
  chaoyangPark: {
    id: 'beijing-chaoyang-park-loop',
    name: '朝阳公园环线',
    distanceKm: chaoyangDistanceKm,
    coordinates: chaoyangWay.coordinates,
    sourceUrls: ['https://www.openstreetmap.org/way/1364891024'],
    evidenceUrl: 'https://tyj.beijing.gov.cn/bjsports/ztzl/tywhxxlyyzlxtj/pblx/10902619/index.html',
  },
};

await writeFile(outputPath,
  `// Generated by mobile/scripts/build-curated-route-overrides.mjs.\n`
  + `// Geometry: © OpenStreetMap contributors, ODbL.\n`
  + `export const curatedRouteOverrides = ${JSON.stringify(overrides, null, 2)} as const;\n`);

console.log(JSON.stringify({
  outputPath,
  xuhui: {
    distanceKm: xuhuiRiverside.distanceKm,
    points: xuhuiRiverside.coordinates.length,
    sources: xuhuiRiverside.sourceUrls.length,
    snaps: xuhuiRiverside.snapDistancesMeters,
  },
  chaoyang: { distanceKm: chaoyangDistanceKm, points: chaoyangWay.coordinates.length },
}, null, 2));
