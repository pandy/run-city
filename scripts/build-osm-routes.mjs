import { writeFile } from 'node:fs/promises';

const endpoint = 'https://valhalla1.openstreetmap.de/route';
const output = new URL('../src/data/osmRoutes.generated.ts', import.meta.url);

// Waypoints are editorial choices. The routing geometry and distance are generated
// from OpenStreetMap pedestrian-network data; run this only when refreshing routes.
const candidates = [
  [[31.2413, 121.4864], [31.2372, 121.4865], [31.2347, 121.4839], [31.2378, 121.4818], [31.2410, 121.4831], [31.2413, 121.4864]],
  [[31.1768, 121.4520], [31.1810, 121.4590], [31.1860, 121.4580], [31.1920, 121.4580], [31.1980, 121.4580], [31.1940, 121.4540], [31.1880, 121.4540], [31.1810, 121.4500], [31.1768, 121.4520]],
  [[31.2230, 121.5480], [31.2290, 121.5510], [31.2300, 121.5600], [31.2250, 121.5660], [31.2170, 121.5630], [31.2140, 121.5550], [31.2170, 121.5480], [31.2230, 121.5480]],
  [[31.2375, 121.4390], [31.2390, 121.4470], [31.2400, 121.4560], [31.2390, 121.4660], [31.2410, 121.4750], [31.2390, 121.4850], [31.2360, 121.4770], [31.2370, 121.4660], [31.2360, 121.4550], [31.2375, 121.4390]],
  [[31.1850, 121.4500], [31.1900, 121.4550], [31.1950, 121.4600], [31.2000, 121.4620], [31.1960, 121.4520], [31.1900, 121.4480], [31.1850, 121.4500]],
  [[31.2480, 121.4920], [31.2530, 121.4950], [31.2580, 121.4980], [31.2620, 121.4960], [31.2650, 121.4910], [31.2600, 121.4880], [31.2540, 121.4890], [31.2500, 121.4900], [31.2480, 121.4920]],
  [[31.2790, 121.5690], [31.2840, 121.5700], [31.2880, 121.5750], [31.2860, 121.5800], [31.2800, 121.5800], [31.2760, 121.5760], [31.2790, 121.5690]],
  [[31.1510, 121.4350], [31.1550, 121.4390], [31.1550, 121.4460], [31.1510, 121.4520], [31.1450, 121.4500], [31.1420, 121.4440], [31.1450, 121.4370], [31.1510, 121.4350]],
  [[31.2280, 121.4490], [31.2310, 121.4570], [31.2350, 121.4650], [31.2390, 121.4740], [31.2420, 121.4750], [31.2380, 121.4700], [31.2320, 121.4680], [31.2270, 121.4600], [31.2240, 121.4540], [31.2280, 121.4490]],
  [[31.3270, 121.5100], [31.3330, 121.5130], [31.3400, 121.5170], [31.3450, 121.5120], [31.3420, 121.5050], [31.3360, 121.5050], [31.3290, 121.5070], [31.3270, 121.5100]],
];

function decodePolyline6(value) {
  const points = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < value.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do { byte = value.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do { byte = value.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: latitude / 1e6, longitude: longitude / 1e6 });
  }
  return points;
}

async function createRoute(locations, index) {
  const json = JSON.stringify({
    locations: locations.map(([lat, lon]) => ({ lat, lon })),
    costing: 'bicycle',
    costing_options: { bicycle: { use_ferry: 0 } },
    units: 'kilometers',
  });
  const response = await fetch(`${endpoint}?${new URLSearchParams({ json })}`);
  if (!response.ok) throw new Error(`路线 ${index + 1} 请求失败：${response.status}`);
  const result = await response.json();
  if (result.trip.summary.has_ferry) throw new Error(`路线 ${index + 1} 包含渡轮，请调整候选路点后重新生成。`);
  if (result.trip.summary.length > 25) throw new Error(`路线 ${index + 1} 发生异常绕行（${result.trip.summary.length} km），请调整候选路点后重新生成。`);
  const coordinates = result.trip.legs.flatMap((leg, legIndex) => {
    const points = decodePolyline6(leg.shape);
    return legIndex === 0 ? points : points.slice(1);
  });
  return { distanceKm: Number(result.trip.summary.length.toFixed(1)), coordinates };
}

const routes = [];
for (const [index, candidate] of candidates.entries()) {
  routes.push(await createRoute(candidate, index));
  await new Promise((resolve) => setTimeout(resolve, 700));
}

const source = `// Generated from OpenStreetMap bicycle-and-path routing. Do not edit by hand.\n// Attribution required in every published build: © OpenStreetMap contributors (ODbL).\nexport const osmRouteGeometries = ${JSON.stringify(routes, null, 2)} as const;\n`;
await writeFile(output, source);
console.log(`Generated ${routes.length} OSM route geometries.`);
