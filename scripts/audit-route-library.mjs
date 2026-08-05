import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const libraryRoot = resolve(projectRoot, 'route-data', 'generated-library');
const auditRoot = resolve(libraryRoot, 'audit');
const prohibitedName = /纪念馆|博物馆|陵园|公墓|墓地|殡仪|监狱|看守所|军事|军营|部队|自然保护区|水源保护区|资源保护区|生态保护.*红线区|大学|学院|校区|校园|中学|小学|项目选址|建设项目|规划用地|在建/;
const radians = (value) => value * Math.PI / 180;

function haversineKm(a, b) {
  const deltaLatitude = radians(b.latitude - a.latitude);
  const deltaLongitude = radians(b.longitude - a.longitude);
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function lineDistanceKm(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += haversineKm(points[index - 1], points[index]);
  return total;
}

function parseCities() {
  const source = readFileSync(resolve(projectRoot, 'src', 'data', 'coreCities.ts'), 'utf8');
  return [...source.matchAll(/\{ id: '([^']+)', name: '([^']+)', province: '([^']+)', phase: ([123]) \}/g)]
    .map((match) => ({ id: match[1], name: match[2] }));
}

function addIssue(issues, city, route, code, detail) {
  issues.push({
    cityId: city.id,
    cityName: city.name,
    routeId: route?.id,
    routeName: route?.name,
    code,
    detail,
  });
}

const cities = parseCities();
const issues = [];
const warnings = [];
const routeIds = new Set();
const cityAudits = [];
let routeCount = 0;

for (const city of cities) {
  const path = resolve(libraryRoot, `${city.id}.json`);
  if (!existsSync(path)) {
    addIssue(issues, city, undefined, 'missing_city_file', '城市数据文件不存在');
    cityAudits.push({ ...city, status: 'missing', routeCount: 0 });
    continue;
  }
  const result = JSON.parse(await readFile(path, 'utf8'));
  const routes = result.routes ?? [];
  cityAudits.push({ ...city, status: result.status, routeCount: routes.length });
  if (result.status !== 'complete') addIssue(issues, city, undefined, 'city_incomplete', `状态为 ${result.status}`);
  if (routes.length !== 10) addIssue(issues, city, undefined, 'route_count', `应为 10 条，实际 ${routes.length} 条`);

  const featureNames = new Set();
  const featureFamilies = new Set();
  let representativeRouteCount = 0;
  let guideOnlyCount = 0;
  for (const route of routes) {
    routeCount += 1;
    if (routeIds.has(route.id)) addIssue(issues, city, route, 'duplicate_route_id', route.id);
    routeIds.add(route.id);
    const normalizedFeature = String(route.featureName ?? '').replace(/\s+/g, '').toLowerCase();
    if (featureNames.has(normalizedFeature)) addIssue(issues, city, route, 'duplicate_feature_name', route.featureName);
    featureNames.add(normalizedFeature);
    const normalizedFamily = String(route.featureFamily ?? '').replace(/\s+/g, '').toLowerCase();
    if (normalizedFamily && featureFamilies.has(normalizedFamily)) {
      addIssue(issues, city, route, 'duplicate_feature_family', route.featureFamily);
    }
    if (normalizedFamily) featureFamilies.add(normalizedFamily);
    if ((route.representativeKeywordIndex ?? -1) >= 0) representativeRouteCount += 1;
    if (route.guideOnly) guideOnlyCount += 1;
    if (prohibitedName.test(`${route.name} ${route.featureName}`)) {
      addIssue(issues, city, route, 'prohibited_place_name', `${route.name} / ${route.featureName}`);
    }
    if (!/[\u3400-\u9fff]/.test(`${route.name} ${route.featureName}`)) {
      addIssue(issues, city, route, 'missing_chinese_name', `${route.name} / ${route.featureName}`);
    }
    if (/[\u0600-\u06ff\u0750-\u077f\u0f00-\u0fff]/u.test(`${route.name} ${route.featureName}`)) {
      addIssue(issues, city, route, 'foreign_script_suffix', `${route.name} / ${route.featureName}`);
    }
    if (route.cityId !== city.id) addIssue(issues, city, route, 'wrong_city_id', route.cityId);
    if (route.quality?.status !== 'pass') addIssue(issues, city, route, 'quality_not_passed', route.quality?.status);
    if (!String(route.productionStatus).endsWith('_checks_passed')) {
      addIssue(issues, city, route, 'production_status', route.productionStatus);
    }
    if (route.source?.license !== 'ODbL' || !String(route.source?.attribution).includes('OpenStreetMap')) {
      addIssue(issues, city, route, 'source_attribution', JSON.stringify(route.source));
    }
    const coordinates = route.coordinates ?? [];
    if (coordinates.length < 4) {
      addIssue(issues, city, route, 'coordinate_count', String(coordinates.length));
      continue;
    }
    if (coordinates.some((point) =>
      !Number.isFinite(point.latitude)
      || !Number.isFinite(point.longitude)
      || point.latitude < 18
      || point.latitude > 54
      || point.longitude < 73
      || point.longitude > 136,
    )) addIssue(issues, city, route, 'invalid_coordinate', '坐标非有限数或不在中国范围内');
    const computedDistanceKm = lineDistanceKm(coordinates);
    const differencePercent = Math.abs(computedDistanceKm - route.distanceKm) / Math.max(0.01, route.distanceKm) * 100;
    if (differencePercent > 3) addIssue(issues, city, route, 'distance_mismatch', `${differencePercent.toFixed(1)}%`);
    const endpointGapMeters = haversineKm(coordinates[0], coordinates.at(-1)) * 1000;
    if (endpointGapMeters > 100) addIssue(issues, city, route, 'not_closed', `${endpointGapMeters.toFixed(1)} m`);
    if (route.distanceKm < 1.5 || route.distanceKm > 21) addIssue(issues, city, route, 'distance_out_of_range', route.distanceKm);
    if ((route.quality?.highestAcceptedRouteOverlapPercent ?? 0) >= 65) {
      addIssue(issues, city, route, 'duplicate_geometry', `${route.quality.highestAcceptedRouteOverlapPercent}%`);
    }
    if (route.pathType === 'out_and_back'
      && route.quality?.guideAlignmentPercent !== undefined
      && route.quality.guideAlignmentPercent < 75) {
      addIssue(issues, city, route, 'guide_alignment', `${route.quality.guideAlignmentPercent}%`);
    }
    if (route.guideOnly
      && /港|渠|沟|排|涌/.test(route.featureName)
      && !/唐徕渠/.test(route.featureName)) {
      warnings.push({
        cityId: city.id,
        cityName: city.name,
        routeId: route.id,
        routeName: route.name,
        code: 'low_confidence_waterway_ranking',
        detail: '轨迹几何通过，但城市代表性需继续复核',
      });
    }
  }
  if (guideOnlyCount > 2) addIssue(issues, city, undefined, 'guide_only_quota', `${guideOnlyCount} 条`);
  if (representativeRouteCount < 2) {
    warnings.push({
      cityId: city.id,
      cityName: city.name,
      code: 'representative_coverage',
      detail: `仅 ${representativeRouteCount} 条命中城市代表性关键词`,
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  expectedCities: 50,
  expectedRoutes: 500,
  completeCities: cityAudits.filter((city) => city.status === 'complete' && city.routeCount === 10).length,
  routeCount,
  passed: issues.length === 0 && routeCount === 500,
  issues,
  warnings,
  cities: cityAudits,
};

const markdown = [
  '# 50 城跑步路线库审计',
  '',
  `- 完整城市：${report.completeCities}/50`,
  `- 路线总数：${report.routeCount}/500`,
  `- 审计结果：${report.passed ? '通过' : `未通过（${issues.length} 个问题）`}`,
  `- 代表性复核提醒：${warnings.length} 条`,
  '',
  '| 城市 | 状态 | 路线数 |',
  '|---|---:|---:|',
  ...cityAudits.map((city) => `| ${city.name} | ${city.status} | ${city.routeCount} |`),
  '',
  ...(issues.length
    ? ['## 问题', '', ...issues.map((issue) => `- ${issue.cityName}${issue.routeName ? ` / ${issue.routeName}` : ''}: ${issue.code} — ${issue.detail}`)]
    : ['全部结构、来源、闭环、距离、坐标范围及重复度检查通过。']),
  '',
  ...(warnings.length
    ? ['## 复核提醒', '', ...warnings.map((warning) => `- ${warning.cityName}${warning.routeName ? ` / ${warning.routeName}` : ''}: ${warning.code} — ${warning.detail}`)]
    : ['没有代表性复核提醒。']),
  '',
].join('\n');

await mkdir(auditRoot, { recursive: true });
await Promise.all([
  writeFile(resolve(auditRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
  writeFile(resolve(auditRoot, 'report.md'), markdown),
]);

console.log(JSON.stringify({
  completeCities: report.completeCities,
  routeCount: report.routeCount,
  issueCount: issues.length,
  warningCount: warnings.length,
  passed: report.passed,
}, null, 2));
if (!report.passed) process.exitCode = 1;
