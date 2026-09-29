import { fullRouteLibrary } from './fullRouteLibrary.generated';
import { curatedRouteOverrides } from './curatedRouteOverrides.generated';
import { mappedRouteGeometries } from './mappedRoutes.generated';
import { phase1RouteCandidates, RouteCandidate } from './phase1RouteCandidates';
import { centuryParkPerimeter } from './centuryPark';
import { supplementalRouteSpecs } from './supplementalRoutes';
import { wgs84ToGcj02 } from '../lib/coordinates';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type AppRoute = {
  id: string;
  rank: number;
  cityId: string;
  name: string;
  distance: string;
  duration: string;
  difficulty: string;
  elevation: string;
  tag: string;
  summary: string;
  bestTime: string;
  note: string;
  evidenceUrl: string;
  geometryStatus: 'mapped' | 'pending';
  statusLabel: string;
  start?: Coordinate;
  amapStart?: Coordinate;
  coordinates: Coordinate[];
};

type GeneratedRoute = {
  readonly id: string;
  readonly cityId: string;
  readonly name: string;
  readonly theme: string;
  readonly distanceKm: number;
  readonly durationMinutes: readonly [number, number];
  readonly difficulty: string;
  readonly bestTime: string;
  readonly note: string;
  readonly coordinates: ReadonlyArray<Coordinate>;
  readonly start: Coordinate;
  readonly source: {
    readonly candidateUrl?: string;
    readonly sourceUrls?: readonly string[];
  };
  readonly quality: {
    readonly status: string;
  };
  readonly productionStatus: string;
  readonly rank: number;
};

type MappedGeometry = {
  readonly distanceKm: number;
  readonly status: string;
  readonly coordinates: ReadonlyArray<Coordinate>;
};

const themeLabels: Record<string, string> = {
  park: '公园',
  waterfront: '滨水',
  landmark: '地标',
  greenway: '绿道',
  night: '夜跑',
  long: '长距离',
};

const generatedLibrary = fullRouteLibrary as unknown as Record<string, ReadonlyArray<GeneratedRoute>>;
const generatedCityIds = new Set(Object.keys(generatedLibrary));
const geometries = mappedRouteGeometries as unknown as Record<string, MappedGeometry>;

function durationFor(distanceKm: number) {
  return `${Math.round(distanceKm * 6)}–${Math.round(distanceKm * 8)} 分钟`;
}

function difficultyFor(distanceKm: number) {
  if (distanceKm <= 5) return '轻松';
  if (distanceKm <= 10) return '中等';
  return '长距离';
}

function bestTimeFor(theme: RouteCandidate['theme']) {
  if (theme === 'night') return '日落后至 21:00';
  if (theme === 'park') return '清晨或傍晚';
  if (theme === 'waterfront') return '清晨或日落前一小时';
  return '优先选择白天和人流较少时段';
}

function geometryFor(route: RouteCandidate): { distanceKm: number; coordinates: Coordinate[] } | undefined {
  if (route.id === 'shanghai-century-park') {
    return {
      distanceKm: centuryParkPerimeter.distanceKm,
      coordinates: centuryParkPerimeter.coordinates.map((coordinate) => ({ ...coordinate })),
    };
  }
  const geometry = geometries[route.id];
  if (!geometry) return undefined;
  return {
    distanceKm: geometry.distanceKm,
    coordinates: geometry.coordinates.map((coordinate) => ({ ...coordinate })),
  };
}

const representativeReviewName = /东湖港|沙湖港|象湖渠/;

function signaturePriority(route: GeneratedRoute) {
  if (route.cityId === 'dalian' && /滨海东路|滨海西路/.test(route.name)) return -1;
  return 0;
}

const generatedRoutesBase: AppRoute[] = Object.values(generatedLibrary).flatMap((routes) =>
  [...routes]
    .sort((a, b) => signaturePriority(a) - signaturePriority(b)
      || Number(representativeReviewName.test(a.name)) - Number(representativeReviewName.test(b.name)))
    .map((route, index) => {
    const routeOverride = route.id === curatedRouteOverrides.xuhuiRiverside.id
      ? curatedRouteOverrides.xuhuiRiverside
      : undefined;
    const coordinates = (routeOverride?.coordinates ?? route.coordinates)
      .map((coordinate) => ({ ...coordinate }));
    const distanceKm = routeOverride?.distanceKm ?? route.distanceKm;
    const start = coordinates[0];
    const displayName = route.name.replace(/\s+[^\u3400-\u9fff]+(环线|环湖跑|跑步线)$/, '$1');
    const representativeReview = representativeReviewName.test(route.name);
    return {
      id: route.id,
      rank: index + 1,
      cityId: route.cityId,
      name: displayName,
      distance: `${distanceKm.toFixed(1)} km`,
      duration: routeOverride ? durationFor(distanceKm) : `${route.durationMinutes[0]}–${route.durationMinutes[1]} 分钟`,
      difficulty: routeOverride ? difficultyFor(distanceKm) : route.difficulty,
      elevation: '待核验',
      tag: `${themeLabels[route.theme] ?? '城市'} · 已有轨迹`,
      summary: routeOverride
        ? '使用公开 OSM 西岸步行与骑行路网重新生成，已核对全线位于黄浦江西岸。'
        : representativeReview
        ? '轨迹已通过 OSM 路网检查；该路线的城市代表性仍待下一轮公开数据复核。'
        : '基于公开 OSM 可步行路网生成，已通过闭环、里程、位置归属、折返和重复度自动检查。',
      bestTime: route.bestTime,
      note: route.note,
      evidenceUrl: routeOverride?.evidenceUrl
        ?? route.source.candidateUrl
        ?? route.source.sourceUrls?.[0]
        ?? 'https://www.openstreetmap.org',
      geometryStatus: 'mapped' as const,
      statusLabel: representativeReview
        ? '轨迹通过 · 热度待复核'
        : route.productionStatus.startsWith('curated') ? '人工核验通过' : '自动校验通过',
      start,
      amapStart: start ? wgs84ToGcj02(start) : undefined,
      coordinates,
    };
  }),
);

const chaoyangParkCoordinates = curatedRouteOverrides.chaoyangPark.coordinates
  .map((coordinate) => ({ ...coordinate }));
const chaoyangParkStart = chaoyangParkCoordinates[0];
const chaoyangParkRoute: AppRoute = {
  id: curatedRouteOverrides.chaoyangPark.id,
  rank: 2,
  cityId: 'beijing',
  name: curatedRouteOverrides.chaoyangPark.name,
  distance: `${curatedRouteOverrides.chaoyangPark.distanceKm.toFixed(1)} km`,
  duration: durationFor(curatedRouteOverrides.chaoyangPark.distanceKm),
  difficulty: difficultyFor(curatedRouteOverrides.chaoyangPark.distanceKm),
  elevation: '待核验',
  tag: '公园 · 公开跑道轨迹',
  summary: '朝阳公园核心闭环跑道；采用 OSM 中明确标记为跑道的 5.25 km 公开轨迹。',
  bestTime: '清晨或傍晚',
  note: '园内有塑胶跑道与距离标识；出发前请确认公园开放时间和临时活动安排。',
  evidenceUrl: curatedRouteOverrides.chaoyangPark.evidenceUrl,
  geometryStatus: 'mapped',
  statusLabel: '人工核验通过',
  start: chaoyangParkStart,
  amapStart: chaoyangParkStart ? wgs84ToGcj02(chaoyangParkStart) : undefined,
  coordinates: chaoyangParkCoordinates,
};

// Beijing needs editorial curation in addition to automatic OSM ranking. The
// public track in Chaoyang Park is a signature daily-running venue, so it
// replaces the less representative Lianhuachi entry in the ten-route list.
const beijingRouteOrder = [
  'beijing-olympic-south-5k',
  'beijing-chaoyang-park-loop',
  'beijing-颐和园-29228773',
  'beijing-天坛公园-24824550',
  'beijing-朝阳绿道示范段-269758960',
  'beijing-玉渊潭公园-29222903',
  'beijing-圆明园遗址公园-24827108',
  'beijing-南海子公园-312174169',
  'beijing-北海公园-366464114',
  'beijing-陶然亭公园-30784976',
] as const;
const beijingRoutesById = new Map(
  [...generatedRoutesBase.filter((route) => route.cityId === 'beijing'), chaoyangParkRoute]
    .map((route) => [route.id, route]),
);
const curatedBeijingRoutes = beijingRouteOrder.flatMap((routeId, index) => {
  const route = beijingRoutesById.get(routeId);
  return route ? [{ ...route, rank: index + 1 }] : [];
});
const generatedRoutes: AppRoute[] = [
  ...generatedRoutesBase.filter((route) => route.cityId !== 'beijing'),
  ...curatedBeijingRoutes,
];

// Keep the original four-city research candidates as a temporary fallback while
// a city is still being generated. A completed city's ten-route library always
// replaces its earlier candidates as one atomic set.
const cityRanks = new Map<string, number>();
const fallbackRoutes: AppRoute[] = phase1RouteCandidates
  .filter((candidate) => !generatedCityIds.has(candidate.cityId))
  .map((candidate) => {
    const rank = (cityRanks.get(candidate.cityId) ?? 0) + 1;
    cityRanks.set(candidate.cityId, rank);
    const geometry = geometryFor(candidate);
    const distanceKm = geometry?.distanceKm ?? candidate.targetDistanceKm;
    const coordinates = geometry?.coordinates ?? [];
    const start = coordinates[0];
    const mapped = coordinates.length > 1;
    return {
      id: candidate.id,
      rank,
      cityId: candidate.cityId,
      name: candidate.name,
      distance: mapped ? `${distanceKm.toFixed(1)} km` : `约 ${candidate.targetDistanceKm} km`,
      duration: durationFor(distanceKm),
      difficulty: difficultyFor(distanceKm),
      elevation: '待核验',
      tag: `${themeLabels[candidate.theme]} · ${mapped ? '已有轨迹' : '整理中'}`,
      summary: mapped
        ? '已接入公开 OSM 路线坐标，正在进行移动端底图的最终目视复核。'
        : '路线名称已进入候选库；公开轨迹与底图一致性尚未核验，暂不显示轨迹。',
      bestTime: bestTimeFor(candidate.theme),
      note: mapped
        ? '地图轨迹可供预览；正式发布前仍需核对入口、开放时间和临时封路。'
        : '为避免路线与地图错位，完成轨迹核验前不提供起点导航。',
      evidenceUrl: candidate.evidenceUrl,
      geometryStatus: mapped ? 'mapped' : 'pending',
      statusLabel: mapped ? '地图待复核' : '轨迹整理中',
      start,
      amapStart: start ? wgs84ToGcj02(start) : undefined,
      coordinates,
    };
  });

const supplementalRoutes: AppRoute[] = supplementalRouteSpecs.map((route) => ({
  id: `${route.cityId}-candidate-${route.rank}`,
  rank: route.rank,
  cityId: route.cityId,
  name: route.name,
  distance: '待核验',
  duration: '待核验',
  difficulty: '待核验',
  elevation: '待核验',
  tag: '候选路线 · 待核验',
  summary: '已进入 100 城候选路线库；公开路网轨迹尚未通过位置、里程和道路贴合检查。',
  bestTime: '完成实地与开放时间核验后公布',
  note: '为避免路线与地图错位，完成公开 OSM/GPX 轨迹核验前不绘制示例线，也不开放起点导航。',
  evidenceUrl: `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${route.cityName} ${route.name}`)}`,
  geometryStatus: 'pending',
  statusLabel: '路线候选 · 轨迹待核验',
  coordinates: [],
}));

export const appRoutes: AppRoute[] = [...generatedRoutes, ...fallbackRoutes, ...supplementalRoutes];

export function routesForCity(cityId: string) {
  return appRoutes.filter((route) => route.cityId === cityId);
}

export const routeCountByCity = appRoutes.reduce<Record<string, number>>((counts, route) => {
  counts[route.cityId] = (counts[route.cityId] ?? 0) + 1;
  return counts;
}, {});

export const readyCityCount = Object.keys(routeCountByCity).length;
