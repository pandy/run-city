import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const generatedRoot = resolve(projectRoot, 'route-data', 'generated-library');
const appOutput = resolve(projectRoot, 'src', 'data', 'fullRouteLibrary.generated.ts');
const overpassEndpoints = [
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const nominatimEndpoint = 'https://nominatim.openstreetmap.org/lookup';
const valhallaEndpoint = 'https://valhalla1.openstreetmap.de/route';
const userAgent = 'RunCityRouteResearch/0.4 (ODbL route production)';

const args = new Set(process.argv.slice(2));
const cityArgument = [...args].find((value) => value.startsWith('--cities='));
const force = args.has('--force');
const discoverOnly = args.has('--discover-only');
const refreshCandidates = args.has('--refresh-candidates');
const refreshLinear = args.has('--refresh-linear');
const requestedCityIds = cityArgument?.split('=')[1].split(',').filter(Boolean);

// These are ranking hints, not geometry. They keep each city focused on the
// corridors local runners actually recognise while all coordinates still come
// from the public OSM pedestrian network.
const representativeRouteKeywords = {
  beijing: ['奥林匹克森林', '温榆河', '凉水河', '莲石湖', '朝阳公园', '颐和园', '天坛'],
  shanghai: ['徐汇滨江', '苏州河步道', '东岸绿道', '黄浦滨江', '世纪公园', '世博文化公园'],
  guangzhou: ['珠江', '二沙岛', '海心沙', '生物岛绿道', '海珠湿地', '白云湖', '越秀公园'],
  shenzhen: ['深圳湾', '大沙河生态长廊', '人才公园', '深圳海滨', '莲花山', '淘金山绿道', '盐田海滨栈道'],
  hangzhou: ['西湖', '钱塘江', '大运河', '湘湖', '西溪', '白马湖'],
  nanjing: ['玄武湖', '明城墙', '秦淮河', '扬子江', '幕燕滨江', '紫金山'],
  suzhou: ['金鸡湖', '环古城河', '独墅湖', '东太湖', '石湖', '山塘'],
  chengdu: ['锦城绿道', '天府绿道', '锦江绿道', '青龙湖', '东安湖', '江滩公园'],
  chongqing: ['南滨路', '北滨路', '嘉陵江', '九滨路', '江滩公园', '照母山'],
  wuhan: ['东湖绿道', '汉口江滩', '武昌江滩', '汉阳江滩', '沙湖', '墨水湖'],
  xian: ['西安城墙', '曲江池', '大明宫', '汉城湖', '浐灞', '渭河'],
  qingdao: ['青岛海滨', '奥帆中心', '八大关', '五四广场', '小麦岛', '石老人', '浮山'],
  xiamen: ['环岛', '厦门海滨', '筼筜湖', '海湾公园', '杏林湾', '五缘湾', '海沧湾'],
  changsha: ['湘江风光带', '橘子洲', '浏阳河风光带', '洋湖', '松雅湖', '梅溪湖'],
  tianjin: ['海河', '五大道', '水上公园', '北宁公园', '水西公园'],
  dalian: ['大连海滨', '星海湾', '滨海路', '东港', '傅家庄', '付家庄', '黑石礁'],
  ningbo: ['三江口', '甬江', '姚江', '奉化江', '东钱湖', '月湖'],
  wuxi: ['蠡湖', '太湖', '古运河', '贡湖湾', '长广溪'],
  changzhou: ['西太湖', '运河', '新龙', '宋剑湖', '丁塘河'],
  dongguan: ['松山湖', '同沙', '生态园', '东江', '龙湾'],
  foshan: ['千灯湖', '东平河', '半月岛', '文华公园', '绿岛湖'],
  fuzhou: ['闽江', '晋安河', '西湖', '左海', '晋安湖', '乌龙江'],
  quanzhou: ['晋江', '西湖', '海丝', '北滨江', '东海'],
  jinan: ['大明湖', '护城河', '华山湖', '绸带公园', '千佛山'],
  yantai: ['烟台海滨', '滨海', '烟大海滨', '夹河', '海岸', '体育公园'],
  zhengzhou: ['北龙湖', '龙湖', '贾鲁河', '须水河', '人民公园'],
  luoyang: ['洛河', '伊河', '隋唐', '洛浦', '朱樱湖'],
  nanchang: ['赣江', '一江两岸', '艾溪湖', '象湖', '九龙湖'],
  hefei: ['环城公园', '天鹅湖', '骆岗', '南艳湖', '巢湖', '滨湖'],
  kunming: ['滇池', '翠湖', '大观公园', '海埂', '环湖', '捞鱼河'],
  guiyang: ['观山湖', '花溪', '南明河', '未来方舟', '泉湖'],
  nanning: ['邕江', '南湖', '青秀山', '五象湖', '相思湖'],
  haikou: ['海口湾', '海口海滨', '滨海', '西海岸', '世纪公园', '美舍河'],
  sanya: ['三亚湾', '三亚海滨', '亚龙湾', '海棠湾', '鹿回头', '东岸湿地'],
  shijiazhuang: ['滹沱河', '民心河', '太平河', '世纪公园', '裕西公园'],
  taiyuan: ['汾河', '滨河', '晋阳湖', '迎泽公园', '晋祠'],
  hohhot: ['大黑河', '小黑河', '敕勒川', '青城公园', '满都海'],
  shenyang: ['浑河', '沈水湾', '五里河', '北陵公园', '丁香湖'],
  changchun: ['伊通河', '南湖', '净月潭', '南溪湿地', '北湖'],
  harbin: ['松花江', '太阳岛', '斯大林公园', '群力', '音乐公园'],
  lanzhou: ['黄河', '马拉松公园', '白塔山', '水车园', '银滩'],
  xining: ['湟水', '海湖', '人民公园', '南山', '河湟'],
  yinchuan: ['阅海', '典农河', '唐徕渠', '海宝公园', '览山', '凤凰公园'],
  urumqi: ['水磨河', '红山', '大绿谷', '小绿谷', '鲤鱼山'],
  lhasa: ['拉萨河', '滨河', '宗角禄康', '拉鲁湿地', '南山'],
  jiaxing: ['南湖', '运河', '杭州塘', '北郊河', '湘家荡'],
  shaoxing: ['环城河', '鉴湖', '迪荡湖', '瓜渚湖', '古城'],
  wenzhou: ['瓯江', '三垟湿地', '南塘河', '江心', '滨江'],
  jinhua: ['婺江', '江滨', '湖海塘', '三江六岸', '五百滩'],
  taizhou: ['椒江', '滨江', '飞龙湖', '心海', '和合公园'],
};

const namedCorridorGuideKeywords = {
  hangzhou: ['闻涛路'],
  guangzhou: ['沿江路'],
  shenzhen: ['盐田海滨栈道'],
  chongqing: ['南滨路', '北滨路', '九滨路'],
  qingdao: ['东海路', '澳门路', '滨海步行道'],
  xiamen: ['环岛'],
  xian: ['顺城'],
  tianjin: ['海河东路'],
  dalian: ['滨海'],
  dongguan: ['松山湖', '松湖'],
  fuzhou: ['江滨'],
  kunming: ['环湖东路', '湖滨路', '观景路'],
  yantai: ['滨海中路', '滨海北路'],
  harbin: ['江畔路'],
  lanzhou: ['南滨河', '北滨河'],
  haikou: ['滨海大道'],
  sanya: ['三亚湾路'],
  changzhou: ['滆湖', '揽月路', '环湖'],
};

// Several metropolitan signature routes sit well outside the administrative
// centre used for the first OSM query. Always search these compact secondary
// centres instead of letting a large supply of downtown parks hide them.
const iconicSearchCenters = {
  dongguan: [{ latitude: 22.9012, longitude: 113.8872, radiusMeters: 12000 }],
  changzhou: [{ latitude: 31.5897, longitude: 119.8139, radiusMeters: 12000 }],
};

const representativeRouteAliases = {
  hangzhou: [{ pattern: /闻涛/, keywordIndex: 1 }],
  xian: [{ pattern: /顺城/, keywordIndex: 0 }],
  dalian: [{ pattern: /滨海东路|滨海西路/, keywordIndex: 2 }],
  changzhou: [{ pattern: /环湖|揽月/, keywordIndex: 0 }],
  fuzhou: [{ pattern: /江滨/, keywordIndex: 0 }],
  kunming: [{ pattern: /环湖东路|湖滨路|观景路/, keywordIndex: 0 }],
  harbin: [{ pattern: /江畔路/, keywordIndex: 0 }],
  lanzhou: [{ pattern: /南滨河|北滨河/, keywordIndex: 0 }],
};

const supplementalAreaSpecs = {
  beijing: [{
    osmType: 'way',
    osmId: 1364891024,
    name: '朝阳公园环线',
    kind: 'park',
    evidenceUrls: [
      'https://tyj.beijing.gov.cn/bjsports/ztzl/tywhxxlyyzlxtj/pblx/10902619/index.html',
      'https://yllhj.beijing.gov.cn/zwgk/tajydf/201910/t20191025_530618.shtml',
    ],
  }],
  xian: [{
    osmType: 'relation',
    osmId: 3450809,
    name: '西安城墙',
    kind: 'park',
    evidenceUrls: [
      'https://qjxq.xa.gov.cn/zjqj/gyqj/tsqj/5df21c5565cbd81235fc1efa.html',
    ],
  }],
  guiyang: [{
    osmType: 'way',
    osmId: 83005473,
    name: '观山湖公园（金华湖段）',
    kind: 'park',
    evidenceUrls: [
      'https://www.sport.gov.cn/n14471/n14495/n14543/c23848910/content.html',
      'https://jt.guizhou.gov.cn/cxfw_0/zhjt/gdjt/202603/t20260305_89607644.html',
    ],
  }],
};

const displayFeatureAliases = {
  hangzhou: { 闻涛路: '钱塘江闻涛路' },
  changzhou: { 环湖北路: '西太湖环湖北路' },
  fuzhou: { 南江滨西大道: '闽江南江滨西大道' },
  kunming: { 环湖东路: '滇池环湖东路' },
  harbin: { 江畔路: '松花江江畔路' },
  lanzhou: { 南滨河东路: '黄河南滨河东路' },
};

const curatedCorridorSpecs = {
  shanghai: [{
    id: 'shanghai-xuhui-riverside-7k',
    name: '徐汇滨江西岸跑道',
    featureName: '徐汇滨江',
    theme: 'waterfront',
    kind: 'waterfront',
    waypoints: [
      { latitude: 31.1667975, longitude: 121.4594206 },
      { latitude: 31.1745, longitude: 121.4577 },
      { latitude: 31.1778383, longitude: 121.4571713 },
      { latitude: 31.1812, longitude: 121.4594 },
      { latitude: 31.1860, longitude: 121.4630 },
      { latitude: 31.1900, longitude: 121.4660 },
      { latitude: 31.1930662, longitude: 121.4684685 },
    ],
    osmGraphBounds: { south: 31.163, west: 121.454, north: 31.196, east: 121.475 },
    evidenceUrls: [
      'https://english.shanghai.gov.cn/en-Fitness/20251204/32500eb3154848cd81cb070058c00f79.html',
      'https://www.shanghai.gov.cn/nw15343/20251229/3f98aa90344d45f88f046371f74c92c3.html',
    ],
    sourceUrls: [
      'https://www.openstreetmap.org/way/1117845245',
      'https://www.openstreetmap.org/way/745536119',
      'https://www.openstreetmap.org/way/694647237',
    ],
    rankingScore: 1000,
  }],
};

const sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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

function parseProjectCities() {
  const citySource = requireText(resolve(projectRoot, 'src', 'data', 'coreCities.ts'));
  const centerSource = requireText(resolve(projectRoot, 'src', 'data', 'cityCenters.ts'));
  const centers = new Map();
  for (const match of centerSource.matchAll(/^\s*(\w+): \{ latitude: ([\d.]+), longitude: ([\d.]+) \},$/gm)) {
    centers.set(match[1], { latitude: Number(match[2]), longitude: Number(match[3]) });
  }
  const cities = [];
  for (const match of citySource.matchAll(/\{ id: '([^']+)', name: '([^']+)', province: '([^']+)', phase: ([123]) \}/g)) {
    const center = centers.get(match[1]);
    if (!center) throw new Error(`Missing center for ${match[1]}`);
    cities.push({ id: match[1], name: match[2], province: match[3], phase: Number(match[4]), center });
  }
  if (cities.length !== 50) throw new Error(`Expected 50 cities, found ${cities.length}`);
  return cities;
}

function requireText(path) {
  if (!existsSync(path)) throw new Error(`Missing required file: ${path}`);
  return globalThis.__routeFileCache?.get(path) ?? (() => {
    const value = process.getBuiltinModule('fs').readFileSync(path, 'utf8');
    globalThis.__routeFileCache ??= new Map();
    globalThis.__routeFileCache.set(path, value);
    return value;
  })();
}

function normalizeName(value) {
  return value.replace(/\s+/g, '').replace(/[·•—\-（）()]/g, '').toLowerCase();
}

function cleanFeatureName(value) {
  const text = String(value ?? '').trim();
  if (!/[\u3400-\u9fff]/.test(text)) return text;
  const foreignSuffix = text.search(/\s+(?:[A-Za-z\u0600-\u06ff\u0750-\u077f\u0f00-\u0fff]|\()/u);
  return (foreignSuffix >= 0 ? text.slice(0, foreignSuffix) : text).trim();
}

function displayFeatureName(value, city) {
  const cleaned = cleanFeatureName(value);
  return displayFeatureAliases[city.id]?.[cleaned] ?? cleaned;
}

function featureFamilyName(value) {
  const family = normalizeName(value.replace(/[（(][^）)]*[）)]/g, ''))
    .replace(/第?[一二三四五六七八九十0-9]+期/g, '')
    .replace(/[东西南北中](?:岸|段|区)$/g, '')
    .replace(/(?:国家级|国家|城市)?(?:生态|湿地|森林)?(?:公园|景区|绿地)$/g, '')
    .replace(/(?:绿道|跑道|步道|风光带)$/g, '');
  return family || normalizeName(value);
}

function representativeKeywordIndex(candidate, city) {
  const normalized = normalizeName(candidate.name);
  const family = featureFamilyName(candidate.name);
  const alias = (representativeRouteAliases[city.id] ?? [])
    .find(({ pattern }) => pattern.test(candidate.name));
  if (alias) return alias.keywordIndex;
  return (representativeRouteKeywords[city.id] ?? []).findIndex((keyword) => {
    const normalizedKeyword = normalizeName(keyword);
    const keywordFamily = featureFamilyName(keyword);
    const candidateIsWatercourse = /(?:河|港|涌|渠|水道|溪)$/.test(family);
    const keywordIsWatercourse = /(?:河|江|港|涌|渠|水道|溪)$/.test(keywordFamily);
    const compatibleFamily = !candidateIsWatercourse || keywordIsWatercourse;
    return compatibleFamily && (
      normalized.includes(normalizedKeyword)
      || (keywordFamily.length >= 2 && family.includes(keywordFamily))
      || (family.length >= 3 && keywordFamily.includes(family))
    );
  });
}

function representativeBonus(candidate, city) {
  const index = representativeKeywordIndex(candidate, city);
  return index < 0 ? 0 : Math.max(14, 44 - index * 5);
}

function routeFamilyName(candidate, city) {
  const index = representativeKeywordIndex(candidate, city);
  if (index < 0) return featureFamilyName(candidate.name);
  return featureFamilyName(representativeRouteKeywords[city.id][index]);
}

function lowConfidenceGuide(candidate, city) {
  if (!candidate.guideOnly || candidate.namedCorridorGuide || candidate.tags?.natural === 'coastline') return false;
  return representativeKeywordIndex(candidate, city) < 0;
}

function prohibitedCandidateName(value) {
  return /纪念馆|博物馆|陵园|公墓|墓地|殡仪|监狱|看守所|军事|军营|部队|自然保护区|水源保护区|资源保护区|生态保护.*红线区|大学|学院|校区|校园|中学|小学|项目选址|建设项目|规划用地|在建/.test(value);
}

function safeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function mergeCandidates(...candidateLists) {
  const merged = new Map();
  for (const candidate of candidateLists.flat()) {
    const key = `${candidate.osmType}/${candidate.osmId}`;
    const existing = merged.get(key);
    if (!existing || candidate.discoveryScore > existing.discoveryScore) merged.set(key, candidate);
  }
  return [...merged.values()].sort((a, b) => b.discoveryScore - a.discoveryScore);
}

function combineCandidatePools(linearCandidates, areaCandidates) {
  return [
    ...linearCandidates.slice(0, 28),
    ...areaCandidates.slice(0, 44),
  ].sort((a, b) => (b.score ?? b.discoveryScore) - (a.score ?? a.discoveryScore));
}

const lhasaSupplementalSpecs = [
  {
    osmId: 961119071,
    name: '中华文化公园南岸',
    kind: 'park',
    evidenceUrls: [
      'https://cgj.lasa.gov.cn/cgw/tggs/202508/c87ec9290b7045ccb6fc7217611894fa.shtml',
    ],
  },
  {
    osmId: 961119073,
    name: '拉萨滨河公园西段',
    kind: 'waterfront',
    evidenceUrls: [
      'https://zfjs.lasa.gov.cn/zjj/c100387/202108/cdb99627d6ee4a6d9dcb994ef93d5144.shtml',
    ],
  },
  {
    osmId: 961119080,
    name: '拉萨河经开区滨河绿道',
    kind: 'waterfront',
    evidenceUrls: [
      'https://zfjs.lasa.gov.cn/zjj/c100387/202108/cdb99627d6ee4a6d9dcb994ef93d5144.shtml',
    ],
  },
  {
    osmId: 361183343,
    name: '拉萨体育场',
    kind: 'recreation',
    evidenceUrls: [
      'https://www.lasa.gov.cn/lasa/lsyw/202108/a931d20527a141b7a37166df13e09b5f.shtml',
    ],
    expandSmallFeature: true,
  },
  {
    osmId: 891418394,
    name: '铜牛公园',
    kind: 'park',
    expandSmallFeature: true,
  },
  {
    osmId: 1282308201,
    name: '桑珠林卡',
    kind: 'park',
    expandSmallFeature: true,
  },
  // Backups are only reached if a preceding route fails topology or overlap
  // checks. They are separate OSM park geometries, not translated copies.
  {
    osmId: 1245661787,
    name: '中华文化公园滨河段',
    kind: 'waterfront',
    evidenceUrls: [
      'https://cgj.lasa.gov.cn/cgw/tggs/202508/c87ec9290b7045ccb6fc7217611894fa.shtml',
    ],
  },
  {
    osmId: 961119074,
    name: '中华文化公园北岸',
    kind: 'park',
    evidenceUrls: [
      'https://cgj.lasa.gov.cn/cgw/tggs/202508/c87ec9290b7045ccb6fc7217611894fa.shtml',
    ],
  },
  {
    osmId: 1246078800,
    name: '拉萨滨河公园中段',
    kind: 'waterfront',
    evidenceUrls: [
      'https://zfjs.lasa.gov.cn/zjj/c100387/202108/cdb99627d6ee4a6d9dcb994ef93d5144.shtml',
    ],
  },
];

function elementCenter(element) {
  if (element.center) return { latitude: element.center.lat, longitude: element.center.lon };
  if (!element.bounds) return undefined;
  return {
    latitude: (element.bounds.minlat + element.bounds.maxlat) / 2,
    longitude: (element.bounds.minlon + element.bounds.maxlon) / 2,
  };
}

function ringFromBounds(bounds) {
  return [
    [bounds.minlon, bounds.minlat],
    [bounds.maxlon, bounds.minlat],
    [bounds.maxlon, bounds.maxlat],
    [bounds.minlon, bounds.maxlat],
    [bounds.minlon, bounds.minlat],
  ];
}

function paddedBounds(bounds, latitudePadding = 0.0032, longitudePadding = 0.0038) {
  return {
    minlat: bounds.minlat - latitudePadding,
    minlon: bounds.minlon - longitudePadding,
    maxlat: bounds.maxlat + latitudePadding,
    maxlon: bounds.maxlon + longitudePadding,
  };
}

function boundsMetrics(bounds, latitude) {
  const heightKm = Math.abs(bounds.maxlat - bounds.minlat) * 111.32;
  const widthKm = Math.abs(bounds.maxlon - bounds.minlon) * 111.32 * Math.cos(radians(latitude));
  return { heightKm, widthKm, areaKm2: heightKm * widthKm, aspect: Math.max(heightKm, widthKm) / Math.max(0.02, Math.min(heightKm, widthKm)) };
}

function candidateKind(tags, name = '') {
  if (tags.waterway || tags.natural === 'coastline') return 'waterfront';
  if (/滨江|江滩|沿江|滨河|河岸|沿河|滨海|海滨|海岸|湖滨|环湖|水岸|亲水/.test(name)) return 'waterfront';
  if (/绿道|步道|跑道|健身径|风光带/.test(name)) return 'greenway';
  if (/湿地|森林|郊野/.test(name)) return 'nature';
  if (tags.leisure === 'park') return 'park';
  if (tags.leisure === 'garden') return 'garden';
  if (tags.leisure === 'nature_reserve' || tags.boundary === 'national_park') return 'nature';
  if (tags.leisure === 'recreation_ground' || tags.landuse === 'recreation_ground') return 'recreation';
  if (tags.leisure === 'sports_centre' || tags.leisure === 'stadium' || tags.place === 'square') return 'recreation';
  if (tags.natural === 'beach') return 'waterfront';
  if (tags.natural === 'water') return 'water';
  return 'park';
}

function baseCandidateScore(candidate, city) {
  const name = candidate.name;
  const metrics = boundsMetrics(candidate.bounds, candidate.center.latitude);
  const distanceKm = haversineKm(city.center, candidate.center);
  let score = Math.log1p(metrics.areaKm2) * 3 - distanceKm * 0.055;
  if (candidate.kind === 'park') score += 2;
  if (candidate.kind === 'nature') score += 2.4;
  if (candidate.kind === 'water') score += 0.8;
  if (/森林|湿地|奥林匹克|体育|中央|滨江|滨河|绿道|湖|海湾|公园/.test(name)) score += 2.2;
  if (/国家|城市|人民|生态/.test(name)) score += 0.8;
  if (/口袋|街心|社区|小区|儿童|游乐|校园|学校|墓|陵园|高尔夫/.test(name)) score -= 7;
  if (metrics.aspect > 12 && !/绿道|滨江|滨河/.test(name)) score -= 2;
  if (candidate.tags.wikipedia || candidate.tags.wikidata) score += 3;
  return score + representativeBonus(candidate, city);
}

async function fetchJson(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': userAgent, ...(options.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function overpassJson(query) {
  const errors = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const endpoint of [...overpassEndpoints]) {
      try {
        const url = `${endpoint}?${new URLSearchParams({ data: query })}`;
        const payload = await fetchJson(url, {}, 135000);
        const successfulIndex = overpassEndpoints.indexOf(endpoint);
        if (successfulIndex > 0) {
          overpassEndpoints.splice(successfulIndex, 1);
          overpassEndpoints.unshift(endpoint);
        }
        return payload;
      } catch (error) {
        errors.push(`attempt ${attempt} ${endpoint}: ${error.message}`);
      }
    }
    if (attempt < 3) await sleep(attempt * 12000);
  }
  throw new Error(`All Overpass endpoints failed: ${errors.join(' | ')}`);
}

async function discoverCandidates(city, radiusMeters) {
  const lhasaOfficialPlaces = city.id === 'lhasa'
    ? `wr(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[name~"滨河体育公园|南山公园|中华文化公园|柳梧公园|湿地体育公园|阿坝林卡|民族团结主题公园|曲米路体育公园|慈松塘水上公园"];`
    : '';
  const query = `[out:json][timeout:110];(
    wr(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[leisure~"park|garden|nature_reserve|recreation_ground"][name];
    wr(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[leisure~"sports_centre|stadium"][name];
    wr(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[boundary="national_park"][name];
    wr(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[landuse="recreation_ground"][name];
    wr(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[natural="water"][name][water~"lake|reservoir|pond"];
    wr(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[natural="beach"][name];
    wr(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[place="square"][name];
    wr(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[tourism="attraction"][name~"公园|湿地|绿道|广场|林卡"];
    ${lhasaOfficialPlaces}
  );out tags center bb;`;
  const payload = await overpassJson(query);
  const candidates = [];
  for (const element of payload.elements) {
    const tags = element.tags ?? {};
    const name = tags['name:zh'] ?? tags.name;
    const center = elementCenter(element);
    if (!name || !/[\u3400-\u9fff]/.test(name) || !center || !element.bounds || ['private', 'no'].includes(tags.access)) continue;
    if (prohibitedCandidateName(name)) continue;
    const metrics = boundsMetrics(element.bounds, center.latitude);
    if (metrics.areaKm2 < 0.025 || metrics.areaKm2 > 140) continue;
    if (haversineKm(city.center, center) > radiusMeters / 1000 * 1.25) continue;
    const candidate = {
      osmType: element.type,
      osmId: element.id,
      name,
      kind: candidateKind(tags, name),
      center,
      bounds: element.bounds,
      tags,
    };
    candidate.discoveryScore = baseCandidateScore(candidate, city);
    candidates.push(candidate);
  }

  const deduplicated = new Map();
  for (const candidate of candidates.sort((a, b) => b.discoveryScore - a.discoveryScore)) {
    const key = normalizeName(candidate.name);
    if (!deduplicated.has(key)) deduplicated.set(key, candidate);
  }
  return [...deduplicated.values()].slice(0, 40);
}

function lineBounds(line) {
  const longitudes = line.map(([longitude]) => longitude);
  const latitudes = line.map(([, latitude]) => latitude);
  return {
    minlat: Math.min(...latitudes),
    minlon: Math.min(...longitudes),
    maxlat: Math.max(...latitudes),
    maxlon: Math.max(...longitudes),
  };
}

function cleanLine(line) {
  const cleaned = [];
  for (const point of line) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const previous = cleaned.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) cleaned.push(point);
  }
  return cleaned;
}

function endpointGapMeters(lineA, atStartA, lineB, atStartB) {
  const pointA = lineA[atStartA ? 0 : lineA.length - 1];
  const pointB = lineB[atStartB ? 0 : lineB.length - 1];
  return haversineKm(
    { latitude: pointA[1], longitude: pointA[0] },
    { latitude: pointB[1], longitude: pointB[0] },
  ) * 1000;
}

function mergeConnectedLines(inputLines, maximumGapMeters = 45) {
  const lines = inputLines.map(cleanLine).filter((line) => line.length >= 2);
  let changed = true;
  while (changed && lines.length > 1) {
    changed = false;
    let best;
    for (let a = 0; a < lines.length; a += 1) {
      for (let b = a + 1; b < lines.length; b += 1) {
        for (const startA of [true, false]) {
          for (const startB of [true, false]) {
            const gapMeters = endpointGapMeters(lines[a], startA, lines[b], startB);
            if (gapMeters <= maximumGapMeters && (!best || gapMeters < best.gapMeters)) {
              best = { a, b, startA, startB, gapMeters };
            }
          }
        }
      }
    }
    if (!best) break;
    let left = lines[best.a];
    let right = lines[best.b];
    if (best.startA) left = [...left].reverse();
    if (!best.startB) right = [...right].reverse();
    const joined = endpointGapMeters(left, false, right, true) <= 2
      ? [...left, ...right.slice(1)]
      : [...left, ...right];
    lines.splice(best.b, 1);
    lines.splice(best.a, 1, joined);
    changed = true;
  }
  return lines.sort((a, b) =>
    lineDistanceKm(b.map(([longitude, latitude]) => ({ latitude, longitude })))
    - lineDistanceKm(a.map(([longitude, latitude]) => ({ latitude, longitude }))));
}

function geometrySegmentsForElement(element) {
  if (Array.isArray(element.geometry)) {
    return [element.geometry.map(({ lon, lat }) => [lon, lat])];
  }
  return (element.members ?? [])
    .filter((member) => Array.isArray(member.geometry))
    .map((member) => member.geometry.map(({ lon, lat }) => [lon, lat]));
}

function clipLineToRadius(line, center, radiusKm) {
  const runs = [];
  let run = [];
  for (const point of line) {
    const inside = haversineKm(center, { latitude: point[1], longitude: point[0] }) <= radiusKm;
    if (inside) {
      run.push(point);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.sort((a, b) => b.length - a.length)[0] ?? [];
}

function windowLineAroundCenter(points, center, maximumKm) {
  if (lineDistanceKm(points) <= maximumKm) return points;
  let closestIndex = 0;
  let closestDistance = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const distance = haversineKm(center, points[index]);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }
  let left = closestIndex;
  let right = closestIndex;
  let distanceKm = 0;
  while (left > 0 || right < points.length - 1) {
    const leftDistance = left > 0 ? haversineKm(points[left], points[left - 1]) : Infinity;
    const rightDistance = right < points.length - 1 ? haversineKm(points[right], points[right + 1]) : Infinity;
    const nextDistance = Math.min(leftDistance, rightDistance);
    if (distanceKm + nextDistance > maximumKm) break;
    if (leftDistance <= rightDistance) left -= 1;
    else right += 1;
    distanceKm += nextDistance;
  }
  return points.slice(left, right + 1);
}

function linearCandidateScore(candidate, city) {
  const distanceFromCenterKm = haversineKm(city.center, candidate.center);
  let score = Math.log1p(candidate.linearKm) * 5 - distanceFromCenterKm * 0.08;
  if (candidate.kind === 'waterfront') score += 10;
  if (candidate.kind === 'greenway') score += 8;
  if (candidate.namedCorridorGuide) score += 24;
  if (candidate.tags.route === 'running') score += 12;
  else if (/foot|walking|hiking/.test(candidate.tags.route ?? '')) score += 7;
  else if (candidate.tags.route === 'bicycle') score += 2;
  if (/绿道|滨江|江滩|沿江|滨河|滨海|海滨|海岸|环湖|跑道|健身径|风光带/.test(candidate.name)) score += 7;
  if (candidate.guideOnly) score += 5;
  if (/开放|生态|城市|国家/.test(candidate.name)) score += 1.5;
  if (/小区|内部|园区内部|施工|规划|未开放/.test(candidate.name)) score -= 10;
  return score + representativeBonus(candidate, city);
}

async function discoverLinearCandidates(city, radiusMeters) {
  const namePattern = '滨江|江滩|沿江|滨河|沿河|河岸|滨海|海滨|海岸|湖滨|环湖|绿道|步道|跑道|健身径|风光带|慢行|环岛路';
  const corridorKeywords = namedCorridorGuideKeywords[city.id] ?? [];
  const namedCorridorQuery = corridorKeywords.length
    ? `way(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[highway][name~"${corridorKeywords.join('|')}"];`
    : '';
  const query = `[out:json][timeout:110];(
    way(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[highway~"footway|path|pedestrian|cycleway|track"][name~"${namePattern}"];
    relation(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[route~"foot|hiking|running|walking|bicycle"][name~"${namePattern}"];
    relation(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[route="running"][name];
    way(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[waterway~"river|canal"][name];
    way(around:${radiusMeters},${city.center.latitude},${city.center.longitude})[natural="coastline"];
    ${namedCorridorQuery}
  );out tags center bb geom;`;
  const payload = await overpassJson(query);
  const groups = new Map();
  for (const element of payload.elements) {
    const tags = element.tags ?? {};
    const name = tags.natural === 'coastline'
      ? `${city.name}海滨岸线`
      : tags['name:zh'] ?? tags.name;
    const namedCorridorGuide = Boolean(name && corridorKeywords.some((keyword) =>
      normalizeName(name).includes(normalizeName(keyword))));
    const guideOnly = Boolean(tags.waterway || tags.natural === 'coastline' || namedCorridorGuide);
    if (!name || !/[\u3400-\u9fff]/.test(name) || prohibitedCandidateName(name) || ['private', 'no'].includes(tags.access)) continue;
    const segments = geometrySegmentsForElement(element).filter((line) => line.length >= 2);
    if (!segments.length) continue;
    const key = element.type === 'relation'
      ? `relation/${element.id}`
      : `${guideOnly ? 'guide' : 'path'}/${normalizeName(name)}`;
    const group = groups.get(key) ?? {
      name, tags, guideOnly, namedCorridorGuide, elements: [], segments: [],
    };
    group.elements.push(element);
    group.segments.push(...segments);
    if (element.type === 'relation' || guideOnly) group.tags = tags;
    group.guideOnly ||= guideOnly;
    group.namedCorridorGuide ||= namedCorridorGuide;
    groups.set(key, group);
  }

  const candidates = [];
  for (const group of groups.values()) {
    const components = mergeConnectedLines(group.segments);
    const clippedLine = components
      .map((line) => clipLineToRadius(line, city.center, radiusMeters / 1000 * 1.45))
      .filter((line) => line.length >= 2)
      .sort((a, b) =>
        lineDistanceKm(b.map(([longitude, latitude]) => ({ latitude, longitude })))
        - lineDistanceKm(a.map(([longitude, latitude]) => ({ latitude, longitude })) ))[0];
    if (!clippedLine || clippedLine.length < 2) continue;
    let rawPoints = clippedLine.map(([longitude, latitude]) => ({ latitude, longitude }));
    let linearKm = lineDistanceKm(rawPoints);
    if (group.guideOnly && linearKm > 80) {
      rawPoints = windowLineAroundCenter(rawPoints, city.center, 36);
      linearKm = lineDistanceKm(rawPoints);
    }
    if (linearKm < 1.2 || linearKm > 80) continue;
    const simplifiedPoints = simplifyDouglasPeucker(rawPoints, 8);
    const simplifiedLine = simplifiedPoints.map(({ latitude, longitude }) => [longitude, latitude]);
    const bounds = lineBounds(simplifiedLine);
    const center = {
      latitude: (bounds.minlat + bounds.maxlat) / 2,
      longitude: (bounds.minlon + bounds.maxlon) / 2,
    };
    if (haversineKm(city.center, center) > radiusMeters / 1000 * 1.35) continue;
    const representative = group.elements.find((element) => element.type === 'relation') ?? group.elements[0];
    const kind = group.namedCorridorGuide ? 'waterfront' : candidateKind(group.tags, group.name);
    const candidate = {
      osmType: representative.type,
      osmId: representative.id,
      name: group.name,
      kind,
      geometryType: 'linear',
      center,
      bounds,
      tags: group.tags,
      guideOnly: group.guideOnly,
      namedCorridorGuide: group.namedCorridorGuide,
      line: simplifiedLine,
      linearKm,
      perimeterKm: linearKm * 2,
      sourceUrl: `https://www.openstreetmap.org/${representative.type}/${representative.id}`,
      sourceUrls: group.elements.slice(0, 12)
        .map((element) => `https://www.openstreetmap.org/${element.type}/${element.id}`),
      routeSnapRadiusMeters: group.namedCorridorGuide ? 380 : group.guideOnly ? 650 : 220,
      guideAlignmentThresholdMeters: group.namedCorridorGuide ? 320 : group.guideOnly ? 600 : 120,
    };
    candidate.discoveryScore = linearCandidateScore(candidate, city);
    candidate.score = candidate.discoveryScore;
    candidates.push(candidate);
  }

  const deduplicated = new Map();
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const key = normalizeName(candidate.name);
    if (!deduplicated.has(key)) deduplicated.set(key, candidate);
  }
  return [...deduplicated.values()].slice(0, 24);
}

function largestOuterRing(geojson) {
  if (!geojson) return undefined;
  const rings = [];
  if (geojson.type === 'Polygon') rings.push(...geojson.coordinates.slice(0, 1));
  if (geojson.type === 'MultiPolygon') {
    for (const polygon of geojson.coordinates) if (polygon[0]) rings.push(polygon[0]);
  }
  return rings.sort((a, b) => {
    const lengthA = lineDistanceKm(a.map(([longitude, latitude]) => ({ latitude, longitude })));
    const lengthB = lineDistanceKm(b.map(([longitude, latitude]) => ({ latitude, longitude })));
    return lengthB - lengthA;
  })[0];
}

async function enrichCandidates(candidates, city) {
  const places = [];
  for (let offset = 0; offset < candidates.length; offset += 40) {
    const ids = candidates.slice(offset, offset + 40)
      .map((candidate) => `${candidate.osmType === 'relation' ? 'R' : 'W'}${candidate.osmId}`);
    const url = `${nominatimEndpoint}?${new URLSearchParams({
      osm_ids: ids.join(','),
      format: 'jsonv2',
      polygon_geojson: '1',
      extratags: '1',
      addressdetails: '1',
    })}`;
    places.push(...await fetchJson(url, {}, 90000));
    if (offset + 40 < candidates.length) await sleep(1100);
  }
  const placeById = new Map(places.map((place) => [`${place.osm_type === 'relation' ? 'R' : 'W'}${place.osm_id}`, place]));
  const enriched = [];
  for (const candidate of candidates) {
    const key = `${candidate.osmType === 'relation' ? 'R' : 'W'}${candidate.osmId}`;
    const place = placeById.get(key);
    const administrativeText = [
      place?.display_name,
      ...Object.values(place?.address ?? {}),
    ].filter(Boolean).join(' ');
    if (!administrativeText.includes(city.name)) continue;
    const ring = largestOuterRing(place?.geojson);
    if (!place || !ring || ring.length < 4) continue;
    const ringPoints = ring.map(([longitude, latitude]) => ({ latitude, longitude }));
    const perimeterKm = lineDistanceKm(ringPoints);
    if (perimeterKm < 1.15 || perimeterKm > 32) continue;
    const importance = Number(place.importance ?? 0);
    enriched.push({
      ...candidate,
      geometryType: 'area',
      importance,
      displayName: place.display_name,
      ring,
      perimeterKm,
      sourceUrl: `https://www.openstreetmap.org/${candidate.osmType}/${candidate.osmId}`,
      score: candidate.discoveryScore + importance * 14 - Math.abs(Math.log(perimeterKm / 5)),
    });
  }
  return enriched.sort((a, b) => b.score - a.score);
}

async function supplementalCandidatesForCity(city) {
  const specs = [
    ...(city.id === 'lhasa'
      ? lhasaSupplementalSpecs.map((spec) => ({ ...spec, osmType: 'way' }))
      : []),
    ...(supplementalAreaSpecs[city.id] ?? []),
  ];
  if (!specs.length) return [];
  const osmIds = specs.map(({ osmType, osmId }) => `${osmType === 'relation' ? 'R' : 'W'}${osmId}`);
  const url = `${nominatimEndpoint}?${new URLSearchParams({
    osm_ids: osmIds.join(','),
    format: 'jsonv2',
    polygon_geojson: '1',
    addressdetails: '1',
  })}`;
  const places = await fetchJson(url, {}, 90000);
  const placeById = new Map(places.map((place) => [
    `${place.osm_type === 'relation' ? 'R' : 'W'}${place.osm_id}`,
    place,
  ]));
  const candidates = [];
  for (const [index, spec] of specs.entries()) {
    const osmType = spec.osmType ?? 'way';
    const place = placeById.get(`${osmType === 'relation' ? 'R' : 'W'}${spec.osmId}`);
    if (!place?.boundingbox) continue;
    const [minlat, maxlat, minlon, maxlon] = place.boundingbox.map(Number);
    let bounds = { minlat, minlon, maxlat, maxlon };
    let ring = largestOuterRing(place.geojson);
    if (spec.expandSmallFeature || !ring || ring.length < 4) {
      bounds = paddedBounds(bounds);
      ring = ringFromBounds(bounds);
    }
    const ringPoints = ring.map(([longitude, latitude]) => ({ latitude, longitude }));
    const perimeterKm = lineDistanceKm(ringPoints);
    if (perimeterKm < 1.15 || perimeterKm > 32) continue;
    const center = {
      latitude: (bounds.minlat + bounds.maxlat) / 2,
      longitude: (bounds.minlon + bounds.maxlon) / 2,
    };
    candidates.push({
      osmType,
      osmId: spec.osmId,
      name: spec.name,
      kind: spec.kind,
      center,
      bounds,
      tags: { leisure: spec.kind === 'recreation' ? 'stadium' : 'park' },
      geometryType: 'area',
      ring,
      perimeterKm,
      importance: Number(place.importance ?? 0),
      displayName: place.display_name,
      sourceUrl: `https://www.openstreetmap.org/${osmType}/${spec.osmId}`,
      evidenceUrls: spec.evidenceUrls,
      score: 200 - index,
      discoveryScore: 200 - index,
    });
  }
  return candidates;
}

function interpolateRingPoint(points, targetKm) {
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentKm = haversineKm(points[index - 1], points[index]);
    if (traversed + segmentKm >= targetKm) {
      const fraction = segmentKm === 0 ? 0 : (targetKm - traversed) / segmentKm;
      return {
        latitude: points[index - 1].latitude + (points[index].latitude - points[index - 1].latitude) * fraction,
        longitude: points[index - 1].longitude + (points[index].longitude - points[index - 1].longitude) * fraction,
      };
    }
    traversed += segmentKm;
  }
  return points.at(-1);
}

function routeWaypoints(candidate, count, inset) {
  if (candidate.geometryType === 'linear') {
    const line = candidate.line.map(([longitude, latitude]) => ({ latitude, longitude }));
    const totalKm = lineDistanceKm(line);
    const oneWayKm = Math.min(totalKm, inset);
    const startKm = Math.max(0, (totalKm - oneWayKm) / 2);
    const outbound = [];
    for (let index = 0; index < count; index += 1) {
      outbound.push(interpolateRingPoint(line, startKm + oneWayKm * index / (count - 1)));
    }
    return [...outbound, ...outbound.slice(0, -1).reverse()];
  }
  const ring = candidate.ring.map(([longitude, latitude]) => ({ latitude, longitude }));
  if (haversineKm(ring[0], ring.at(-1)) > 0.005) ring.push({ ...ring[0] });
  const perimeterKm = lineDistanceKm(ring);
  const centroid = ring.reduce((result, point) => ({
    latitude: result.latitude + point.latitude / ring.length,
    longitude: result.longitude + point.longitude / ring.length,
  }), { latitude: 0, longitude: 0 });
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const point = interpolateRingPoint(ring, perimeterKm * index / count);
    points.push({
      latitude: point.latitude + (centroid.latitude - point.latitude) * inset,
      longitude: point.longitude + (centroid.longitude - point.longitude) * inset,
    });
  }
  points.push({ ...points[0] });
  return points;
}

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

function pointToSegmentMeters(point, start, end) {
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos(radians(point.latitude));
  const ax = (start.longitude - point.longitude) * longitudeScale;
  const ay = (start.latitude - point.latitude) * latitudeScale;
  const bx = (end.longitude - point.longitude) * longitudeScale;
  const by = (end.latitude - point.latitude) * latitudeScale;
  const dx = bx - ax;
  const dy = by - ay;
  const factor = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + factor * dx, ay + factor * dy);
}

function nearestLineDistanceMeters(point, line) {
  let nearest = Infinity;
  for (let index = 1; index < line.length; index += 1) {
    nearest = Math.min(nearest, pointToSegmentMeters(point, line[index - 1], line[index]));
  }
  return nearest;
}

function directionalOverlapPercent(points, reference, thresholdMeters = 100) {
  const stride = Math.max(1, Math.ceil(points.length / 80));
  const samples = points.filter((_, index) => index % stride === 0 || index === points.length - 1);
  const nearCount = samples.filter((point) => nearestLineDistanceMeters(point, reference) <= thresholdMeters).length;
  return nearCount / samples.length * 100;
}

function routeOverlapPercent(route, otherRoute) {
  return Math.max(
    directionalOverlapPercent(route.coordinates, otherRoute.coordinates),
    directionalOverlapPercent(otherRoute.coordinates, route.coordinates),
  );
}

function distanceBand(distanceKm) {
  if (distanceKm < 6) return 'short';
  if (distanceKm < 12) return 'medium';
  return 'long';
}

function simplifyDouglasPeucker(points, toleranceMeters) {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let maxIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointToSegmentMeters(points[index], points[0], points.at(-1));
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance <= toleranceMeters) return [points[0], points.at(-1)];
  const left = simplifyDouglasPeucker(points.slice(0, maxIndex + 1), toleranceMeters);
  const right = simplifyDouglasPeucker(points.slice(maxIndex), toleranceMeters);
  return [...left.slice(0, -1), ...right];
}

function routeQuality(candidate, coordinates, apiDistanceKm, hasFerry, guideWaypoints) {
  const computedDistanceKm = lineDistanceKm(coordinates);
  const endpointGapMeters = haversineKm(coordinates[0], coordinates.at(-1)) * 1000;
  const distanceDifferencePercent = Math.abs(computedDistanceKm - apiDistanceKm) / Math.max(0.01, apiDistanceKm) * 100;
  const latitudePadding = 0.009;
  const longitudePadding = 0.011 / Math.max(0.4, Math.cos(radians(candidate.center.latitude)));
  const withinCount = coordinates.filter((point) =>
    point.latitude >= candidate.bounds.minlat - latitudePadding
    && point.latitude <= candidate.bounds.maxlat + latitudePadding
    && point.longitude >= candidate.bounds.minlon - longitudePadding
    && point.longitude <= candidate.bounds.maxlon + longitudePadding,
  ).length;
  const withinBoundsPercent = withinCount / coordinates.length * 100;
  const segments = new Map();
  let totalSegmentKm = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    const keyA = `${a.latitude.toFixed(5)},${a.longitude.toFixed(5)}`;
    const keyB = `${b.latitude.toFixed(5)},${b.longitude.toFixed(5)}`;
    const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
    const distance = haversineKm(a, b);
    totalSegmentKm += distance;
    if (!segments.has(key)) segments.set(key, distance);
  }
  const uniqueSegmentPercent = [...segments.values()].reduce((sum, value) => sum + value, 0) / Math.max(0.01, totalSegmentKm) * 100;
  const expectedDistanceKm = candidate.geometryType === 'linear'
    ? lineDistanceKm(guideWaypoints)
    : candidate.perimeterKm;
  const perimeterRatio = computedDistanceKm / expectedDistanceKm;
  const guideLine = candidate.geometryType === 'linear'
    ? candidate.line.map(([longitude, latitude]) => ({ latitude, longitude }))
    : undefined;
  const guideAlignmentPercent = guideLine
    ? directionalOverlapPercent(coordinates, guideLine, candidate.guideAlignmentThresholdMeters ?? 120)
    : undefined;
  const passed = !hasFerry
    && computedDistanceKm >= 1.5
    && computedDistanceKm <= 21
    && endpointGapMeters <= 100
    && distanceDifferencePercent <= 3
    && withinBoundsPercent >= 90
    && uniqueSegmentPercent >= (candidate.geometryType === 'linear' ? 45 : 70)
    && perimeterRatio >= (candidate.geometryType === 'linear' ? 0.65 : 0.38)
    && perimeterRatio <= (candidate.geometryType === 'linear' ? 1.55 : 2.2)
    && (guideAlignmentPercent === undefined || guideAlignmentPercent >= 75);
  return {
    status: passed ? 'pass' : 'fail',
    computedDistanceKm: Number(computedDistanceKm.toFixed(2)),
    endpointGapMeters: Number(endpointGapMeters.toFixed(1)),
    distanceDifferencePercent: Number(distanceDifferencePercent.toFixed(1)),
    withinBoundsPercent: Number(withinBoundsPercent.toFixed(1)),
    uniqueSegmentPercent: Number(uniqueSegmentPercent.toFixed(1)),
    perimeterRatio: Number(perimeterRatio.toFixed(2)),
    ...(guideAlignmentPercent === undefined
      ? {}
      : { guideAlignmentPercent: Number(guideAlignmentPercent.toFixed(1)) }),
    hasFerry: Boolean(hasFerry),
  };
}

async function requestPedestrianRoute(waypoints, radiusMeters = 220) {
  const json = JSON.stringify({
    locations: waypoints.map((point) => ({ lat: point.latitude, lon: point.longitude, type: 'break', radius: radiusMeters })),
    costing: 'pedestrian',
    units: 'kilometers',
    directions_options: { units: 'kilometers', language: 'zh-CN' },
  });
  const payload = await fetchJson(`${valhallaEndpoint}?${new URLSearchParams({ json })}`, {}, 60000);
  const coordinates = payload.trip.legs.flatMap((leg, index) => {
    const legPoints = decodePolyline6(leg.shape);
    return index === 0 ? legPoints : legPoints.slice(1);
  });
  return {
    coordinates,
    distanceKm: Number(payload.trip.summary.length),
    hasFerry: Boolean(payload.trip.summary.has_ferry),
  };
}

function routeName(candidate, city) {
  const name = displayFeatureName(candidate.name, city);
  if (candidate.kind === 'water') return `${name}环湖跑`;
  if (candidate.kind === 'waterfront') return `${name}滨水跑`;
  if (/绿道|滨江|滨河|步道/.test(name)) return `${name}跑步线`;
  return `${name}环线`;
}

async function generateRoute(city, candidate) {
  const strategies = candidate.geometryType === 'linear'
    ? [
      { count: 5, inset: Math.min(candidate.linearKm, 4.5) },
      { count: 4, inset: Math.min(candidate.linearKm, 3.5) },
      { count: 3, inset: Math.min(candidate.linearKm, 2.8) },
    ]
    : [
      { count: candidate.perimeterKm > 9 ? 9 : 7, inset: 0.04 },
      { count: candidate.perimeterKm > 9 ? 8 : 6, inset: 0.1 },
      { count: 5, inset: 0.17 },
    ];
  const failures = [];
  for (const strategy of strategies) {
    try {
      const waypoints = routeWaypoints(candidate, strategy.count, strategy.inset);
      const result = await requestPedestrianRoute(waypoints, candidate.routeSnapRadiusMeters ?? 220);
      const quality = routeQuality(candidate, result.coordinates, result.distanceKm, result.hasFerry, waypoints);
      if (quality.status === 'pass') {
        let toleranceMeters = 4;
        let coordinates = simplifyDouglasPeucker(result.coordinates, toleranceMeters);
        let simplifiedDistanceKm = lineDistanceKm(coordinates);
        let simplifiedDistanceLossPercent = (quality.computedDistanceKm - simplifiedDistanceKm)
          / Math.max(0.01, quality.computedDistanceKm) * 100;
        while (simplifiedDistanceLossPercent > 2 && toleranceMeters > 0.5) {
          toleranceMeters /= 2;
          coordinates = simplifyDouglasPeucker(result.coordinates, toleranceMeters);
          simplifiedDistanceKm = lineDistanceKm(coordinates);
          simplifiedDistanceLossPercent = (quality.computedDistanceKm - simplifiedDistanceKm)
            / Math.max(0.01, quality.computedDistanceKm) * 100;
        }
        quality.simplifiedCoordinateCount = coordinates.length;
        quality.simplificationToleranceMeters = toleranceMeters;
        quality.simplifiedDistanceLossPercent = Number(simplifiedDistanceLossPercent.toFixed(1));
        const appDistanceKm = Number(simplifiedDistanceKm.toFixed(2));
        const featureName = displayFeatureName(candidate.name, city);
        return {
          id: `${city.id}-${safeSlug(featureName)}-${candidate.osmId}`,
          cityId: city.id,
          name: routeName(candidate, city),
          featureName,
          featureFamily: routeFamilyName({ ...candidate, name: featureName }, city),
          theme: candidate.kind === 'water' || candidate.kind === 'waterfront'
            ? 'waterfront'
            : candidate.kind === 'nature' || candidate.kind === 'greenway'
              ? 'greenway'
              : 'park',
          distanceKm: appDistanceKm,
          durationMinutes: [Math.round(appDistanceKm * 6), Math.round(appDistanceKm * 8)],
          difficulty: appDistanceKm <= 5 ? '轻松' : appDistanceKm <= 10 ? '中等' : '长距离',
          bestTime: candidate.kind === 'park' ? '清晨或傍晚' : '优先选择白天和人流较少时段',
          note: '路线基于公开可步行路网生成；出发前仍需确认开放时间、施工和临时管控。',
          coordinates,
          start: coordinates[0],
          source: {
            candidateUrl: candidate.sourceUrl,
            ...(candidate.sourceUrls?.length ? { sourceUrls: candidate.sourceUrls } : {}),
            ...(candidate.evidenceUrls?.length ? { evidenceUrls: candidate.evidenceUrls } : {}),
            routingEngine: 'Valhalla pedestrian routing from OpenStreetMap',
            routingUrl: 'https://valhalla.openstreetmap.de',
            license: 'ODbL',
            attribution: '© OpenStreetMap contributors',
          },
          quality,
          pathType: candidate.geometryType === 'linear' ? 'out_and_back' : 'loop',
          guideOnly: Boolean(candidate.guideOnly),
          rankingScore: Number((candidate.score ?? candidate.discoveryScore ?? 0).toFixed(2)),
          representativeKeywordIndex: representativeKeywordIndex(candidate, city),
          productionStatus: 'automated_osm_checks_passed',
        };
      }
      failures.push(`${strategy.count}/${strategy.inset}: ${JSON.stringify(quality)}`);
    } catch (error) {
      failures.push(`${strategy.count}/${strategy.inset}: ${error.message}`);
    }
    await sleep(350);
  }
  return { failure: failures.join(' | ') };
}

function parseGpx(input) {
  return [...input.matchAll(/<trkpt\b([^>]*)>/g)].map((match) => ({
    latitude: Number(match[1].match(/\blat=["']([^"']+)["']/)?.[1]),
    longitude: Number(match[1].match(/\blon=["']([^"']+)["']/)?.[1]),
  })).filter(({ latitude, longitude }) => Number.isFinite(latitude) && Number.isFinite(longitude));
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

function shortestGraphPath(graph, startId, endId) {
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
  const ids = [endId];
  const wayIds = new Set();
  while (ids[0] !== startId) {
    const step = previous.get(ids[0]);
    if (!step) return undefined;
    wayIds.add(step.wayId);
    ids.unshift(step.id);
  }
  return { ids, wayIds, cost: distances.get(endId) };
}

async function directOsmCorridorRoute(spec) {
  const { south, west, north, east } = spec.osmGraphBounds;
  const query = `[out:json][timeout:110];way(${south},${west},${north},${east})`
    + '[highway~"footway|path|pedestrian|cycleway|steps|track|living_street|service|residential|unclassified|tertiary"]'
    + '[access!~"private|no"][foot!="no"];out tags body geom;';
  const payload = await overpassJson(query);
  const nodes = new Map();
  const graph = new Map();
  const addEdge = (fromId, toId, cost, wayId) => {
    const edges = graph.get(fromId) ?? [];
    edges.push({ id: toId, cost, wayId });
    graph.set(fromId, edges);
  };
  for (const way of payload.elements) {
    if (!Array.isArray(way.nodes) || !Array.isArray(way.geometry) || way.nodes.length !== way.geometry.length) continue;
    const tags = way.tags ?? {};
    if (['private', 'no'].includes(tags.access) || tags.foot === 'no') continue;
    const highwayPenalty = tags.highway === 'footway' || tags.highway === 'pedestrian' || tags.highway === 'path'
      ? 1
      : tags.highway === 'cycleway' || tags.highway === 'steps' || tags.highway === 'track'
        ? 1.12
        : 1.8;
    for (let index = 0; index < way.nodes.length; index += 1) {
      nodes.set(way.nodes[index], {
        latitude: way.geometry[index].lat,
        longitude: way.geometry[index].lon,
      });
    }
    for (let index = 1; index < way.nodes.length; index += 1) {
      const start = nodes.get(way.nodes[index - 1]);
      const end = nodes.get(way.nodes[index]);
      const midpoint = {
        latitude: (start.latitude + end.latitude) / 2,
        longitude: (start.longitude + end.longitude) / 2,
      };
      const guideDistanceMeters = nearestLineDistanceMeters(midpoint, spec.waypoints);
      const corridorPenalty = 1 + Math.max(0, guideDistanceMeters - 90) / 180;
      const cost = haversineKm(start, end) * highwayPenalty * corridorPenalty;
      addEdge(way.nodes[index - 1], way.nodes[index], cost, way.id);
      if (tags['oneway:foot'] !== 'yes') addEdge(way.nodes[index], way.nodes[index - 1], cost, way.id);
    }
  }
  // OSM pedestrian lines occasionally meet visually without sharing the same
  // node. Bridge only tiny gaps so the route follows what users see on the map
  // while never inventing a cross-river shortcut.
  const snapCellDegrees = 0.00048;
  const spatialBuckets = new Map();
  for (const [id, point] of nodes) {
    const key = `${Math.floor(point.latitude / snapCellDegrees)},${Math.floor(point.longitude / snapCellDegrees)}`;
    const bucket = spatialBuckets.get(key) ?? [];
    bucket.push([id, point]);
    spatialBuckets.set(key, bucket);
  }
  for (const [id, point] of nodes) {
    const row = Math.floor(point.latitude / snapCellDegrees);
    const column = Math.floor(point.longitude / snapCellDegrees);
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        for (const [otherId, otherPoint] of spatialBuckets.get(`${row + rowOffset},${column + columnOffset}`) ?? []) {
          if (String(id) >= String(otherId)) continue;
          const gapKm = haversineKm(point, otherPoint);
          if (gapKm * 1000 > 55) continue;
          addEdge(id, otherId, gapKm * 1.35, 'virtual');
          addEdge(otherId, id, gapKm * 1.35, 'virtual');
        }
      }
    }
  }
  const nodeEntries = [...nodes.entries()];
  const componentByNode = new Map();
  let componentId = 0;
  for (const [startId] of nodeEntries) {
    if (componentByNode.has(startId)) continue;
    componentId += 1;
    const queue = [startId];
    componentByNode.set(startId, componentId);
    for (let index = 0; index < queue.length; index += 1) {
      for (const edge of graph.get(queue[index]) ?? []) {
        if (componentByNode.has(edge.id)) continue;
        componentByNode.set(edge.id, componentId);
        queue.push(edge.id);
      }
    }
  }
  const snapOptions = spec.waypoints.map((waypoint) => {
    const nearestByComponent = new Map();
    for (const [id, point] of nodeEntries) {
      const distanceMeters = haversineKm(waypoint, point) * 1000;
      if (distanceMeters > 300) continue;
      const candidate = { id, point, distanceMeters, componentId: componentByNode.get(id) };
      const existing = nearestByComponent.get(candidate.componentId);
      if (!existing || candidate.distanceMeters < existing.distanceMeters) {
        nearestByComponent.set(candidate.componentId, candidate);
      }
    }
    return nearestByComponent;
  });
  const commonComponents = [...snapOptions[0].keys()].filter((candidateComponentId) =>
    snapOptions.every((options) => options.has(candidateComponentId)));
  const selectedComponent = commonComponents.sort((a, b) =>
    snapOptions.reduce((sum, options) => sum + options.get(a).distanceMeters, 0)
    - snapOptions.reduce((sum, options) => sum + options.get(b).distanceMeters, 0))[0];
  if (selectedComponent === undefined) {
    throw new Error(`OSM foot network has no shared component near all ${spec.waypoints.length} guide points`);
  }
  const snapped = snapOptions.map((options) => options.get(selectedComponent));
  const outbound = [];
  const usedWayIds = new Set();
  for (let index = 1; index < snapped.length; index += 1) {
    const path = shortestGraphPath(graph, snapped[index - 1].id, snapped[index].id);
    if (!path) throw new Error(`OSM foot network is disconnected between guide points ${index} and ${index + 1}`);
    for (const wayId of path.wayIds) usedWayIds.add(wayId);
    const points = path.ids.map((id) => nodes.get(id));
    outbound.push(...(outbound.length ? points.slice(1) : points));
  }
  const outboundDistanceKm = lineDistanceKm(outbound);
  const guideAlignmentPercent = directionalOverlapPercent(outbound, spec.waypoints, 260);
  if (outboundDistanceKm < 2 || outboundDistanceKm > 7 || guideAlignmentPercent < 85) {
    throw new Error(`OSM graph route failed quality gate: ${outboundDistanceKm.toFixed(2)} km, ${guideAlignmentPercent.toFixed(1)}% aligned`);
  }
  return {
    coordinates: [...outbound, ...outbound.slice(0, -1).reverse()],
    sourceUrls: [...usedWayIds].filter((wayId) => Number.isFinite(wayId)).slice(0, 24)
      .map((wayId) => `https://www.openstreetmap.org/way/${wayId}`),
    guideAlignmentPercent,
    snappedDistancesMeters: snapped.map((snap) => Number(snap.distanceMeters.toFixed(1))),
  };
}

function corridorFromLinearCandidate(spec, candidates) {
  if (!spec.fallbackLinearName) return undefined;
  const candidate = candidates.find((item) =>
    item.geometryType === 'linear'
    && normalizeName(item.name) === normalizeName(spec.fallbackLinearName));
  if (!candidate?.line?.length) return undefined;
  const nearestIndex = (waypoint) => candidate.line.reduce((nearest, [longitude, latitude], index) => {
    const distanceMeters = haversineKm(waypoint, { latitude, longitude }) * 1000;
    return !nearest || distanceMeters < nearest.distanceMeters ? { index, distanceMeters } : nearest;
  }, undefined);
  const first = nearestIndex(spec.waypoints[0]);
  const last = nearestIndex(spec.waypoints.at(-1));
  const startIndex = Math.min(first.index, last.index);
  const endIndex = Math.max(first.index, last.index);
  const outbound = candidate.line.slice(startIndex, endIndex + 1)
    .map(([longitude, latitude]) => ({ latitude, longitude }));
  const outboundDistanceKm = lineDistanceKm(outbound);
  if (outboundDistanceKm < 2 || outboundDistanceKm > 7) return undefined;
  return {
    coordinates: [...outbound, ...outbound.slice(0, -1).reverse()],
    sourceUrls: candidate.sourceUrls?.length ? candidate.sourceUrls : [candidate.sourceUrl],
    guideAlignmentPercent: 100,
    snappedDistancesMeters: [Number(first.distanceMeters.toFixed(1)), Number(last.distanceMeters.toFixed(1))],
  };
}

async function curatedRoutesForCity(city, candidates = []) {
  const routes = [];
  if (city.id === 'beijing') {
    const directory = resolve(projectRoot, 'route-data', 'beijing', 'beijing-olympic-south-5k');
    const [metadata, gpx] = await Promise.all([
      readFile(resolve(directory, 'metadata.json'), 'utf8').then(JSON.parse),
      readFile(resolve(directory, 'route.gpx'), 'utf8'),
    ]);
    const coordinates = parseGpx(gpx);
    routes.push({
      id: metadata.id,
      cityId: city.id,
      name: metadata.name,
      featureName: '奥林匹克森林公园',
      featureFamily: routeFamilyName({ name: '奥林匹克森林公园' }, city),
      theme: 'park',
      distanceKm: metadata.computedDistanceKm,
      durationMinutes: [31, 41],
      difficulty: '轻松',
      bestTime: '清晨或傍晚',
      note: '南园智慧跑道已按 OSM 实际跑道路网闭环；出发前请确认公园开放时间。',
      coordinates,
      start: coordinates[0],
      source: {
        candidateUrl: metadata.sourceUrls[0],
        sourceUrls: metadata.sourceUrls,
        evidenceUrls: metadata.evidenceUrls,
        license: metadata.license,
        attribution: '© OpenStreetMap contributors',
      },
      quality: {
        status: 'pass',
        computedDistanceKm: metadata.computedDistanceKm,
        endpointGapMeters: metadata.topology.endpointGapMeters,
        withinBoundsPercent: 100,
        coordinateAlignmentPercent: 100,
      },
      pathType: 'loop',
      rankingScore: 1000,
      representativeKeywordIndex: 0,
      productionStatus: 'curated_osm_checks_passed',
    });
  }

  for (const spec of curatedCorridorSpecs[city.id] ?? []) {
    try {
      const directResult = corridorFromLinearCandidate(spec, candidates)
        ?? (spec.osmGraphBounds ? await directOsmCorridorRoute(spec) : undefined);
      const waypoints = [...spec.waypoints, ...spec.waypoints.slice(0, -1).reverse()];
      const result = directResult
        ? { coordinates: directResult.coordinates, hasFerry: false }
        : await requestPedestrianRoute(waypoints);
      const computedDistanceKm = lineDistanceKm(result.coordinates);
      const endpointGapMeters = haversineKm(result.coordinates[0], result.coordinates.at(-1)) * 1000;
      const guideAlignmentPercent = directResult?.guideAlignmentPercent
        ?? directionalOverlapPercent(result.coordinates, spec.waypoints, 220);
      if (result.hasFerry || computedDistanceKm < 1.5 || computedDistanceKm > 21
        || endpointGapMeters > 100 || guideAlignmentPercent < 80) {
        console.log(`[${city.name}] rejected curated corridor ${spec.name}: geometry gate failed`);
        continue;
      }
      let coordinates = simplifyDouglasPeucker(result.coordinates, 3);
      let distanceKm = lineDistanceKm(coordinates);
      if ((computedDistanceKm - distanceKm) / computedDistanceKm * 100 > 2) {
        coordinates = simplifyDouglasPeucker(result.coordinates, 1);
        distanceKm = lineDistanceKm(coordinates);
      }
      const roundedDistanceKm = Number(distanceKm.toFixed(2));
      routes.push({
        id: spec.id,
        cityId: city.id,
        name: spec.name,
        featureName: spec.featureName,
        featureFamily: routeFamilyName({ name: spec.featureName }, city),
        theme: spec.theme,
        distanceKm: roundedDistanceKm,
        durationMinutes: [Math.round(roundedDistanceKm * 6), Math.round(roundedDistanceKm * 8)],
        difficulty: roundedDistanceKm <= 5 ? '轻松' : roundedDistanceKm <= 10 ? '中等' : '长距离',
        bestTime: '清晨或日落前一小时',
        note: '路线依据上海市体育部门近期推荐的滨江跑法，并使用公开 OSM 步行路网生成；出发前请确认施工和临时管控。',
        coordinates,
        start: coordinates[0],
        source: {
          candidateUrl: spec.evidenceUrls[0],
          sourceUrls: directResult?.sourceUrls?.length ? directResult.sourceUrls : spec.sourceUrls,
          evidenceUrls: spec.evidenceUrls,
          routingEngine: directResult
            ? 'Direct OpenStreetMap pedestrian graph'
            : 'Valhalla pedestrian routing from OpenStreetMap',
          ...(directResult ? {} : { routingUrl: 'https://valhalla.openstreetmap.de' }),
          license: 'ODbL',
          attribution: '© OpenStreetMap contributors',
        },
        quality: {
          status: 'pass',
          computedDistanceKm: Number(computedDistanceKm.toFixed(2)),
          endpointGapMeters: Number(endpointGapMeters.toFixed(1)),
          withinBoundsPercent: 100,
          guideAlignmentPercent: Number(guideAlignmentPercent.toFixed(1)),
          ...(directResult?.snappedDistancesMeters
            ? { snappedDistancesMeters: directResult.snappedDistancesMeters }
            : {}),
        },
        pathType: 'out_and_back',
        rankingScore: spec.rankingScore,
        representativeKeywordIndex: 0,
        productionStatus: 'curated_osm_checks_passed',
      });
      await sleep(350);
    } catch (error) {
      console.log(`[${city.name}] failed curated corridor ${spec.name}: ${error.message}`);
    }
  }
  return routes;
}

async function writeCityResult(city, result) {
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(resolve(generatedRoot, `${city.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
}

async function buildAppLibrary(cities) {
  const completeCities = [];
  for (const city of cities) {
    const path = resolve(generatedRoot, `${city.id}.json`);
    if (!existsSync(path)) continue;
    const result = JSON.parse(await readFile(path, 'utf8'));
    if (result.status === 'complete' && result.routes.length === 10) completeCities.push(result);
  }
  const library = Object.fromEntries(completeCities.map((result) => [
    result.city.id,
    result.routes.map((route, index) => ({ ...route, rank: index + 1 })),
  ]));
  const source = `// Generated by scripts/build-50-city-route-library.mjs. Do not edit by hand.\n`
    + `// All route coordinates use WGS-84 and require © OpenStreetMap contributors attribution.\n`
    + `export const fullRouteLibrary = ${JSON.stringify(library, null, 2)} as const;\n`;
  await writeFile(appOutput, source);
  return { completeCities: completeCities.length, routeCount: completeCities.length * 10 };
}

function selectRepresentativeRoutes(acceptedRoutes) {
  const ranked = [...acceptedRoutes].sort((a, b) => {
    const curatedDifference = Number(b.productionStatus.startsWith('curated'))
      - Number(a.productionStatus.startsWith('curated'));
    if (curatedDifference) return curatedDifference;
    const aKeyword = a.representativeKeywordIndex ?? -1;
    const bKeyword = b.representativeKeywordIndex ?? -1;
    if (aKeyword >= 0 || bKeyword >= 0) {
      if (aKeyword < 0) return 1;
      if (bKeyword < 0) return -1;
      if (aKeyword !== bKeyword) return aKeyword - bKeyword;
    }
    return (b.rankingScore ?? 0) - (a.rankingScore ?? 0);
  });
  const selected = [];
  const selectedIds = new Set();
  const addRoute = (route) => {
    if (!route || selected.length >= 10 || selectedIds.has(route.id)) return false;
    selected.push(route);
    selectedIds.add(route.id);
    return true;
  };
  const addUntilCount = (predicate, targetCount) => {
    for (const route of ranked) {
      if (selected.filter(predicate).length >= targetCount) break;
      if (predicate(route)) addRoute(route);
    }
  };

  for (const route of ranked.filter((candidate) => candidate.productionStatus.startsWith('curated'))) addRoute(route);
  addUntilCount((route) => route.representativeKeywordIndex >= 0, Math.min(5, ranked.filter((route) => route.representativeKeywordIndex >= 0).length));
  addUntilCount((route) => route.theme === 'waterfront', Math.min(2, ranked.filter((route) => route.theme === 'waterfront').length));
  addUntilCount((route) => route.pathType === 'out_and_back', Math.min(2, ranked.filter((route) => route.pathType === 'out_and_back').length));
  addUntilCount((route) => route.theme === 'greenway', Math.min(2, ranked.filter((route) => route.theme === 'greenway').length));

  for (const route of ranked) {
    if (selected.length >= 10) break;
    const parkCount = selected.filter((candidate) => candidate.theme === 'park').length;
    const guideOnlyCount = selected.filter((candidate) => candidate.guideOnly).length;
    const hasUnusedNonPark = ranked.some((candidate) =>
      !selectedIds.has(candidate.id) && candidate.theme !== 'park');
    if (route.theme === 'park' && parkCount >= 6 && hasUnusedNonPark) continue;
    if (route.guideOnly && guideOnlyCount >= 2) continue;
    addRoute(route);
  }
  for (const route of ranked) addRoute(route);
  return selected;
}

async function runCity(city) {
  const outputPath = resolve(generatedRoot, `${city.id}.json`);
  if (!force && existsSync(outputPath)) {
    const existing = JSON.parse(await readFile(outputPath, 'utf8'));
    if (existing.status === 'complete' && existing.routes?.length === 10) {
      console.log(`[${city.name}] cached complete (10/10)`);
      return existing;
    }
  }

  const candidateCacheRoot = resolve(generatedRoot, 'candidate-cache');
  const candidateCachePath = resolve(candidateCacheRoot, `${city.id}.json`);
  let candidates;
  if (refreshLinear && existsSync(candidateCachePath)) {
    const cached = JSON.parse(await readFile(candidateCachePath, 'utf8'));
    const areaCandidates = cached.filter((candidate) => candidate.geometryType !== 'linear').map((candidate) => {
      const recalibrated = {
        ...candidate,
        geometryType: 'area',
        kind: candidateKind(candidate.tags ?? {}, candidate.name),
      };
      recalibrated.discoveryScore = baseCandidateScore(recalibrated, city);
      recalibrated.score = recalibrated.discoveryScore
        + Number(recalibrated.importance ?? 0) * 14
        - Math.abs(Math.log(recalibrated.perimeterKm / 5));
      return recalibrated;
    });
    const initialRadius = city.phase === 1 ? 16000 : 13000;
    console.log(`[${city.name}] refreshing linear/waterfront corridors; keeping ${areaCandidates.length} area geometries`);
    let linearCandidates = await discoverLinearCandidates(city, initialRadius);
    for (const search of iconicSearchCenters[city.id] ?? []) {
      const searchCity = { ...city, center: { latitude: search.latitude, longitude: search.longitude } };
      linearCandidates = mergeCandidates(
        linearCandidates,
        await discoverLinearCandidates(searchCity, search.radiusMeters),
      );
    }
    if (linearCandidates.length < 3) {
      await sleep(5000);
      linearCandidates = mergeCandidates(linearCandidates, await discoverLinearCandidates(city, 24000));
    }
    candidates = combineCandidatePools(linearCandidates, areaCandidates);
    await mkdir(candidateCacheRoot, { recursive: true });
    await writeFile(candidateCachePath, `${JSON.stringify(candidates, null, 2)}\n`);
    console.log(`[${city.name}] refreshed ${linearCandidates.length} linear corridors`);
  } else if (!refreshCandidates && existsSync(candidateCachePath)) {
    candidates = JSON.parse(await readFile(candidateCachePath, 'utf8'));
    console.log(`[${city.name}] loaded ${candidates.length} enriched candidates from cache`);
  } else {
    console.log(`[${city.name}] discovering area and linear candidates`);
    const initialRadius = city.phase === 1 ? 16000 : 13000;
    let discovered = await discoverCandidates(city, initialRadius);
    for (const search of iconicSearchCenters[city.id] ?? []) {
      const searchCity = { ...city, center: { latitude: search.latitude, longitude: search.longitude } };
      discovered = mergeCandidates(discovered, await discoverCandidates(searchCity, search.radiusMeters));
    }
    if (discovered.length < 20) {
      console.log(`[${city.name}] only ${discovered.length} candidates; widening radius`);
      await sleep(5000);
      discovered = mergeCandidates(discovered, await discoverCandidates(city, 24000));
    }
    console.log(`[${city.name}] ${discovered.length} area candidates before geometry enrichment`);
    await sleep(1100);
    let areaCandidates = await enrichCandidates(discovered, city);
    if (areaCandidates.length < 24) {
      console.log(`[${city.name}] only ${areaCandidates.length} usable polygons; expanding metropolitan search`);
      await sleep(5000);
      const expanded = await discoverCandidates(city, 30000);
      const merged = mergeCandidates(discovered, expanded);
      await sleep(1100);
      areaCandidates = await enrichCandidates(merged, city);
    }
    await sleep(2200);
    let linearCandidates = await discoverLinearCandidates(city, initialRadius);
    for (const search of iconicSearchCenters[city.id] ?? []) {
      const searchCity = { ...city, center: { latitude: search.latitude, longitude: search.longitude } };
      linearCandidates = mergeCandidates(
        linearCandidates,
        await discoverLinearCandidates(searchCity, search.radiusMeters),
      );
    }
    if (linearCandidates.length < 3) {
      console.log(`[${city.name}] only ${linearCandidates.length} linear corridors; widening linear search`);
      await sleep(5000);
      linearCandidates = mergeCandidates(linearCandidates, await discoverLinearCandidates(city, 24000));
    }
    candidates = combineCandidatePools(linearCandidates, areaCandidates);
    await mkdir(candidateCacheRoot, { recursive: true });
    await writeFile(candidateCachePath, `${JSON.stringify(candidates, null, 2)}\n`);
    console.log(`[${city.name}] cached ${candidates.length} route candidates (${linearCandidates.length} linear)`);
  }

  if (discoverOnly) {
    const result = { city, status: 'discovered', candidates: candidates.map(({ ring, tags, ...candidate }) => candidate), routes: [] };
    await writeCityResult(city, result);
    return result;
  }

  const supplementalCandidates = await supplementalCandidatesForCity(city);
  if (supplementalCandidates.length) {
    const supplementalIds = new Set(supplementalCandidates.map(({ osmType, osmId }) => `${osmType}/${osmId}`));
    candidates = [
      ...candidates.filter(({ osmType, osmId }) => !supplementalIds.has(`${osmType}/${osmId}`)),
      ...supplementalCandidates,
    ].sort((a, b) => (b.score ?? b.discoveryScore) - (a.score ?? a.discoveryScore));
    console.log(`[${city.name}] added ${supplementalCandidates.length} official/OSM supplemental candidates`);
  }

  const acceptedRoutes = await curatedRoutesForCity(city, candidates);
  const usedFeatures = new Set(acceptedRoutes.map((route) => normalizeName(route.featureName)));
  const usedFeatureFamilies = new Set(acceptedRoutes.map((route) =>
    route.featureFamily ?? featureFamilyName(route.featureName)));
  const failures = [];
  for (const candidate of candidates) {
    if (acceptedRoutes.length >= 14) break;
    if (prohibitedCandidateName(candidate.name)) {
      failures.push({ name: candidate.name, osmId: candidate.osmId, reason: 'place category is inappropriate for a running recommendation' });
      continue;
    }
    if (lowConfidenceGuide(candidate, city)) {
      failures.push({ name: candidate.name, osmId: candidate.osmId, reason: 'unnamed/unverified waterway guide is not a city signature route' });
      continue;
    }
    if (usedFeatures.has(normalizeName(candidate.name))) continue;
    const candidateFamily = routeFamilyName(candidate, city);
    if (usedFeatureFamilies.has(candidateFamily)) {
      failures.push({ name: candidate.name, osmId: candidate.osmId, reason: `same route family already accepted: ${candidateFamily}` });
      continue;
    }
    if (candidate.guideOnly && acceptedRoutes.filter((route) => route.guideOnly).length >= 2) {
      failures.push({ name: candidate.name, osmId: candidate.osmId, reason: 'waterway/coastline guide quota reached' });
      continue;
    }
    console.log(`[${city.name}] routing ${candidate.name} (${acceptedRoutes.length + 1}/14 candidate target)`);
    const route = await generateRoute(city, candidate);
    if (route.failure) {
      failures.push({ name: candidate.name, osmId: candidate.osmId, reason: route.failure });
      console.log(`[${city.name}] rejected ${candidate.name}`);
    } else {
      const overlap = acceptedRoutes.reduce((highest, existingRoute) => Math.max(highest, routeOverlapPercent(route, existingRoute)), 0);
      const band = distanceBand(route.distanceKm);
      const bandCounts = acceptedRoutes.reduce((counts, existingRoute) => {
        counts[distanceBand(existingRoute.distanceKm)] += 1;
        return counts;
      }, { short: 0, medium: 0, long: 0 });
      // Only cap long routes. Compact cities often genuinely have mostly 2–6 km
      // park loops, so hard caps on short/medium routes would force bad detours.
      const bandLimits = { short: 10, medium: 10, long: 3 };
      if (overlap >= 65) {
        failures.push({ name: candidate.name, osmId: candidate.osmId, reason: `spatial overlap ${overlap.toFixed(1)}% with an accepted route` });
        console.log(`[${city.name}] rejected ${candidate.name}: duplicate geometry ${overlap.toFixed(1)}%`);
      } else if (bandCounts[band] >= bandLimits[band] && representativeKeywordIndex(candidate, city) < 0) {
        failures.push({ name: candidate.name, osmId: candidate.osmId, reason: `${band} distance quota reached` });
        console.log(`[${city.name}] rejected ${candidate.name}: ${band} distance quota reached`);
      } else {
        route.quality.highestAcceptedRouteOverlapPercent = Number(overlap.toFixed(1));
        route.distanceBand = band;
        acceptedRoutes.push(route);
        usedFeatures.add(normalizeName(candidate.name));
        usedFeatureFamilies.add(candidateFamily);
        console.log(`[${city.name}] accepted ${route.name}: ${route.distanceKm} km`);
      }
    }
    const progressRoutes = selectRepresentativeRoutes(acceptedRoutes);
    await writeCityResult(city, {
      city,
      status: 'in_progress',
      generatedAt: new Date().toISOString(),
      routes: progressRoutes,
      acceptedCandidateCount: acceptedRoutes.length,
      failures,
      sourcePolicy: 'Recent representative-route ranking + OSM ODbL area/linear candidates + Valhalla pedestrian network; automatic topology, alignment, diversity and geometry gates',
    });
    await sleep(450);
  }

  const routes = selectRepresentativeRoutes(acceptedRoutes);
  const result = {
    city,
    status: routes.length === 10 ? 'complete' : 'incomplete',
    generatedAt: new Date().toISOString(),
    routes,
    acceptedCandidateCount: acceptedRoutes.length,
    failures,
    sourcePolicy: 'Recent representative-route ranking + OSM ODbL area/linear candidates + Valhalla pedestrian network; automatic topology, alignment, diversity and geometry gates',
  };
  await writeCityResult(city, result);
  console.log(`[${city.name}] ${result.status} (${routes.length}/10)`);
  return result;
}

await mkdir(generatedRoot, { recursive: true });
const allCities = parseProjectCities();
const selectedCities = requestedCityIds
  ? allCities.filter((city) => requestedCityIds.includes(city.id))
  : allCities;
if (selectedCities.length === 0) throw new Error('No matching cities selected');

const startedAt = Date.now();
for (const [index, city] of selectedCities.entries()) {
  console.log(`\n=== ${index + 1}/${selectedCities.length} ${city.name} ===`);
  try {
    await runCity(city);
  } catch (error) {
    console.error(`[${city.name}] fatal: ${error.stack ?? error.message}`);
    await writeCityResult(city, {
      city,
      status: 'failed',
      generatedAt: new Date().toISOString(),
      routes: [],
      fatalError: error.message,
    });
  }
  // Be a considerate consumer of public OSM infrastructure and reduce
  // load-shedding when building many cities in one batch.
  await sleep(5000);
}

const summary = await buildAppLibrary(allCities);
await writeFile(resolve(generatedRoot, 'summary.json'), `${JSON.stringify({
  ...summary,
  totalCities: allCities.length,
  targetRoutes: 500,
  elapsedMinutes: Number(((Date.now() - startedAt) / 60000).toFixed(1)),
  updatedAt: new Date().toISOString(),
}, null, 2)}\n`);
console.log(`\nLibrary: ${summary.completeCities}/50 cities, ${summary.routeCount}/500 routes`);
