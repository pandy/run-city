import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import {
  AppState,
  FlatList,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { AppRoute, Coordinate, appRoutes, readyCityCount, routeCountByCity, routesForCity } from './src/data/appRoutes';
import { cityCenters } from './src/data/cityCenters';
import { coreCities } from './src/data/coreCities';
import { wgs84ToGcj02 } from './src/lib/coordinates';
import {
  authorizeHealthKit,
  HealthWorkoutRecord,
  isHealthKitPlatformSupported,
  subscribeToHealthKitWorkouts,
  syncHealthKitRunningWorkouts,
} from './src/lib/healthKitSync';
import { distanceFromLocationToRouteKm, formatLocationDistanceKm } from './src/lib/routeDistance';
import { matchRunsToRoutes } from './src/lib/routeOverlap';

const DEFAULT_CITY_ID = 'shanghai';
const PERSONAL_RUNS_FILE_NAME = 'run-city-personal-runs.json';
const HEALTHKIT_RUNS_FILE_NAME = 'run-city-healthkit-runs.json';
type LocationStatus = 'loading' | 'ready' | 'denied' | 'unavailable' | 'error';
type HealthSyncStatus = 'unavailable' | 'not-connected' | 'connecting' | 'syncing' | 'ready' | 'error';
type RunPeriod = 'day' | 'month' | 'year';

type PersonalRun = {
  id: string;
  source: 'codoon' | 'apple-health' | 'garmin';
  sourceName?: string;
  sourceBundleIdentifier?: string;
  deviceName?: string;
  sport: 'running';
  startTime?: string;
  endTime?: string;
  distanceKm?: number;
  durationSeconds?: number;
  averagePaceSecondsPerKm?: number;
  calories?: number;
  averageHeartRate?: number;
  coordinateSystem: 'wgs84';
  encodedPath: string;
  originalPointCount: number;
  displayPointCount: number;
  validationStatus?: string;
};

type PersonalRouteMatch = {
  routeId: string;
  routeName: string;
  overlapPercent: number;
  matchedDistanceKm: number;
  matched: boolean;
  runId?: string;
  runDate?: string;
  runDistanceKm?: number;
};

type PersonalRunImport = {
  records: PersonalRun[];
  routeMatches: Record<string, PersonalRouteMatch>;
};

type StoredHealthKitRuns = {
  schemaVersion: 1;
  source: 'apple-health';
  enabled: boolean;
  anchor?: string;
  lastSyncAt?: string;
  records: PersonalRun[];
};

function dateForRun(run: PersonalRun) {
  if (!run.startTime) return undefined;
  const date = new Date(run.startTime);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function runsForPeriod(runs: PersonalRun[], period: RunPeriod) {
  const now = new Date();
  return runs.filter((run) => {
    const date = dateForRun(run);
    if (!date) return false;
    if (period === 'day') return date.toDateString() === now.toDateString();
    if (period === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    return date.getFullYear() === now.getFullYear();
  });
}

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
      let byte: number;
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

function parsePersonalRunImport(text: string): PersonalRunImport {
  const payload = JSON.parse(text) as {
    schemaVersion?: unknown;
    source?: unknown;
    records?: unknown;
    routeMatches?: unknown;
  };
  if (payload.schemaVersion !== 1 || payload.source !== 'codoon' || !Array.isArray(payload.records)) {
    throw new Error('不是有效的跑城咕咚导入文件');
  }
  const records = payload.records.filter((item): item is PersonalRun => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<PersonalRun>;
    return typeof candidate.id === 'string'
      && candidate.source === 'codoon'
      && candidate.sport === 'running'
      && candidate.coordinateSystem === 'wgs84'
      && typeof candidate.encodedPath === 'string';
  });
  if (!records.length) throw new Error('导入文件中没有可用跑步记录');
  const routeMatches = Array.isArray(payload.routeMatches)
    ? payload.routeMatches.reduce<Record<string, PersonalRouteMatch>>((matches, item) => {
      if (!item || typeof item !== 'object') return matches;
      const candidate = item as Partial<PersonalRouteMatch>;
      if (typeof candidate.routeId !== 'string'
        || typeof candidate.routeName !== 'string'
        || typeof candidate.overlapPercent !== 'number'
        || typeof candidate.matchedDistanceKm !== 'number'
        || candidate.matched !== true
        || candidate.overlapPercent < 20) return matches;
      matches[candidate.routeId] = candidate as PersonalRouteMatch;
      return matches;
    }, {})
    : {};
  return {
    records: [...records].sort((a, b) => String(b.startTime ?? '').localeCompare(String(a.startTime ?? ''))),
    routeMatches,
  };
}

function parseStoredHealthKitRuns(text: string): StoredHealthKitRuns {
  const payload = JSON.parse(text) as Partial<StoredHealthKitRuns>;
  if (payload.schemaVersion !== 1 || payload.source !== 'apple-health' || !Array.isArray(payload.records)) {
    throw new Error('Apple 健康本地记录格式不正确');
  }
  const records = payload.records.filter((item): item is PersonalRun => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<PersonalRun>;
    return typeof candidate.id === 'string'
      && (candidate.source === 'apple-health' || candidate.source === 'garmin')
      && candidate.sport === 'running'
      && candidate.coordinateSystem === 'wgs84'
      && typeof candidate.encodedPath === 'string';
  });
  return {
    schemaVersion: 1,
    source: 'apple-health',
    enabled: payload.enabled === true,
    anchor: typeof payload.anchor === 'string' ? payload.anchor : undefined,
    lastSyncAt: typeof payload.lastSyncAt === 'string' ? payload.lastSyncAt : undefined,
    records,
  };
}

function mergePersonalRuns(...groups: PersonalRun[][]) {
  const records = new Map<string, PersonalRun>();
  groups.flat().forEach((run) => records.set(run.id, run));
  return [...records.values()].sort((a, b) =>
    String(b.startTime ?? '').localeCompare(String(a.startTime ?? '')));
}

function personalRunSourceLabel(run: PersonalRun) {
  if (run.source === 'garmin') return 'Garmin';
  if (run.source === 'apple-health') return run.sourceName && !/health/i.test(run.sourceName)
    ? run.sourceName
    : 'Apple 健康';
  return '咕咚';
}

function formatSyncTime(value?: string) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function saveHealthKitRuns(payload: StoredHealthKitRuns) {
  const storedFile = new File(Paths.document, HEALTHKIT_RUNS_FILE_NAME);
  if (storedFile.exists) storedFile.delete();
  storedFile.create();
  storedFile.write(JSON.stringify(payload));
}

function formatRunDate(value?: string) {
  if (!value) return '日期未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '日期未知';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatRunDay(value?: string) {
  const date = new Date(value ?? '');
  return Number.isFinite(date.getTime()) ? String(date.getDate()).padStart(2, '0') : '--';
}

function formatRunDuration(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatRunPace(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 60)}'${String(total % 60).padStart(2, '0')}\"`;
}

function regionForCity(cityId: string): Region {
  const center = cityCenters[cityId] ?? cityCenters[DEFAULT_CITY_ID];
  const displayCenter = Platform.OS === 'ios' ? wgs84ToGcj02(center) : center;
  return {
    ...displayCenter,
    latitudeDelta: 0.18,
    longitudeDelta: 0.18,
  };
}

function regionForCountry(): Region {
  const center = { latitude: 35.5, longitude: 105.5 };
  const displayCenter = Platform.OS === 'ios' ? wgs84ToGcj02(center) : center;
  return {
    ...displayCenter,
    latitudeDelta: 34,
    longitudeDelta: 42,
  };
}

function coordinateForEmbeddedMap(coordinate: Coordinate) {
  return Platform.OS === 'ios' ? wgs84ToGcj02(coordinate) : coordinate;
}

// OSM route data remains WGS-84. On iOS in mainland China, the embedded
// MapKit basemap is backed by AMap, so only the preview overlay uses GCJ-02.
function coordinatesForEmbeddedMap(route: AppRoute) {
  return Platform.OS === 'ios'
    ? route.coordinates.map(wgs84ToGcj02)
    : route.coordinates;
}

export default function App() {
  const { height: windowHeight } = useWindowDimensions();
  const cityPageHeight = Math.max(560, windowHeight - 62);
  const expandedMapHeight = Math.round(cityPageHeight * 0.6);
  const mapRef = useRef<MapView>(null);
  const pageRef = useRef<ScrollView>(null);
  const mapTopRef = useRef(0);
  const initialRoutes = routesForCity(DEFAULT_CITY_ID);
  const [selectedCityId, setSelectedCityId] = useState(DEFAULT_CITY_ID);
  const [selectedId, setSelectedId] = useState<string | null>(initialRoutes[0]?.id ?? null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [personalRunsOpen, setPersonalRunsOpen] = useState(false);
  const [trailOpen, setTrailOpen] = useState(false);
  const [selectedPersonalRunId, setSelectedPersonalRunId] = useState<string>();
  const [runPeriod, setRunPeriod] = useState<RunPeriod>('month');
  const [importedPersonalRuns, setImportedPersonalRuns] = useState<PersonalRun[]>([]);
  const [healthKitRuns, setHealthKitRuns] = useState<PersonalRun[]>([]);
  const [personalRouteMatches, setPersonalRouteMatches] = useState<Record<string, PersonalRouteMatch>>({});
  const [runImportStatus, setRunImportStatus] = useState('尚未导入');
  const [healthSyncStatus, setHealthSyncStatus] = useState<HealthSyncStatus>(
    isHealthKitPlatformSupported() ? 'not-connected' : 'unavailable',
  );
  const [healthSyncError, setHealthSyncError] = useState<string>();
  const [healthSyncDiagnostics, setHealthSyncDiagnostics] = useState<string>();
  const [healthKitEnabled, setHealthKitEnabled] = useState(false);
  const [lastHealthSyncAt, setLastHealthSyncAt] = useState<string>();
  const [cityOverviewOpen, setCityOverviewOpen] = useState(true);
  const [cityQuery, setCityQuery] = useState('');
  const [routesCollapsed, setRoutesCollapsed] = useState(false);
  const [userLocation, setUserLocation] = useState<Coordinate>();
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('loading');
  const [canAskLocationAgain, setCanAskLocationAgain] = useState(true);
  const healthKitRunsRef = useRef<PersonalRun[]>([]);
  const healthKitAnchorRef = useRef<string | undefined>(undefined);
  const healthSyncInProgressRef = useRef(false);

  const city = coreCities.find((item) => item.id === selectedCityId) ?? coreCities[0];
  const personalRuns = useMemo(
    () => mergePersonalRuns(importedPersonalRuns, healthKitRuns),
    [healthKitRuns, importedPersonalRuns],
  );
  const cityRoutes = useMemo(() => routesForCity(selectedCityId), [selectedCityId]);
  const syncedRouteMatches = useMemo(
    () => matchRunsToRoutes(cityRoutes, healthKitRuns),
    [cityRoutes, healthKitRuns],
  );
  const routeMatchesById = useMemo(() => {
    const matches: Record<string, PersonalRouteMatch> = { ...personalRouteMatches };
    Object.values(syncedRouteMatches).forEach((match) => {
      if (!matches[match.routeId] || match.overlapPercent > matches[match.routeId].overlapPercent) {
        matches[match.routeId] = match;
      }
    });
    return matches;
  }, [personalRouteMatches, syncedRouteMatches]);
  const selected = useMemo(
    () => cityRoutes.find((route) => route.id === selectedId) ?? cityRoutes[0],
    [cityRoutes, selectedId],
  );
  const selectedMapCoordinates = useMemo(
    () => selected ? coordinatesForEmbeddedMap(selected) : [],
    [selected],
  );
  const routeDistancesById = useMemo(() => {
    if (!userLocation) return new Map<string, number>();
    return new Map(cityRoutes.map((route) => [
      route.id,
      distanceFromLocationToRouteKm(userLocation, route.coordinates),
    ]));
  }, [cityRoutes, userLocation]);
  const selectedDistanceKm = selected ? routeDistancesById.get(selected.id) : undefined;
  const selectedRouteMatch = selected ? routeMatchesById[selected.id] : undefined;
  const savedRoutes = useMemo(
    () => appRoutes.filter((route) => savedIds.includes(route.id)),
    [savedIds],
  );
  const selectedPersonalRun = useMemo(
    () => personalRuns.find((run) => run.id === selectedPersonalRunId),
    [personalRuns, selectedPersonalRunId],
  );
  const personalRunDistanceKm = useMemo(
    () => personalRuns.reduce((total, run) => total + (run.distanceKm ?? 0), 0),
    [personalRuns],
  );
  const trailMarkers = useMemo(() => personalRuns.map((run) => {
    const point = run.encodedPath ? decodePolyline(run.encodedPath)[0] : undefined;
    if (!point) return undefined;
    let nearest = coreCities[0];
    let best = Number.POSITIVE_INFINITY;
    coreCities.forEach((item) => {
      const center = cityCenters[item.id];
      if (!center) return;
      const distance = (center.latitude - point.latitude) ** 2 + (center.longitude - point.longitude) ** 2;
      if (distance < best) { best = distance; nearest = item; }
    });
    return { run, point, city: nearest };
  }).filter(Boolean) as Array<{ run: PersonalRun; point: Coordinate; city: typeof coreCities[number] }>, [personalRuns]);
  const trailProvinceCount = useMemo(() => new Set(trailMarkers.map((item) => item.city.province)).size, [trailMarkers]);
  const periodRuns = useMemo(() => runsForPeriod(personalRuns, runPeriod), [personalRuns, runPeriod]);
  const periodDistanceKm = useMemo(
    () => periodRuns.reduce((total, run) => total + (run.distanceKm ?? 0), 0),
    [periodRuns],
  );
  const garminRunCount = useMemo(
    () => healthKitRuns.filter((run) => run.source === 'garmin').length,
    [healthKitRuns],
  );
  const filteredCities = useMemo(() => {
    const query = cityQuery.trim().toLowerCase();
    if (!query) return coreCities;
    return coreCities.filter((item) =>
      `${item.name}${item.province}${item.id}`.toLowerCase().includes(query),
    );
  }, [cityQuery]);

  const locateUser = useCallback(async () => {
    setLocationStatus('loading');
    try {
      if (!await Location.hasServicesEnabledAsync()) {
        setLocationStatus('unavailable');
        return;
      }
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      setCanAskLocationAgain(permission.canAskAgain);
      if (!permission.granted) {
        setLocationStatus('denied');
        return;
      }

      const cachedLocation = await Location.getLastKnownPositionAsync({
        maxAge: 5 * 60 * 1000,
        requiredAccuracy: 1000,
      });
      if (cachedLocation) {
        setUserLocation({
          latitude: cachedLocation.coords.latitude,
          longitude: cachedLocation.coords.longitude,
        });
        setLocationStatus('ready');
      }

      try {
        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        });
        setLocationStatus('ready');
      } catch {
        if (!cachedLocation) setLocationStatus('error');
      }
    } catch {
      setLocationStatus('error');
    }
  }, []);

  useEffect(() => {
    void locateUser();
  }, [locateUser]);

  useEffect(() => {
    const storedFile = new File(Paths.document, PERSONAL_RUNS_FILE_NAME);
    if (!storedFile.exists) return;
    void storedFile.text()
      .then((text) => {
        const imported = parsePersonalRunImport(text);
        setImportedPersonalRuns(imported.records);
        setPersonalRouteMatches(imported.routeMatches);
        setRunImportStatus(`已导入 ${imported.records.length} 条`);
      })
      .catch(() => setRunImportStatus('本地记录读取失败，请重新导入'));
  }, []);

  useEffect(() => {
    const storedFile = new File(Paths.document, HEALTHKIT_RUNS_FILE_NAME);
    if (!storedFile.exists) return;
    void storedFile.text()
      .then((text) => {
        const stored = parseStoredHealthKitRuns(text);
        healthKitRunsRef.current = stored.records;
        healthKitAnchorRef.current = stored.anchor;
        setHealthKitRuns(stored.records);
        setHealthKitEnabled(stored.enabled);
        setLastHealthSyncAt(stored.lastSyncAt);
        setHealthSyncStatus(stored.enabled ? 'ready' : 'not-connected');
      })
      .catch(() => {
        setHealthSyncStatus('error');
        setHealthSyncError('Apple 健康本地记录读取失败，请重新连接。');
      });
  }, []);

  const performHealthKitSync = useCallback(async (requestPermission = false, forceFull = false) => {
    if (!isHealthKitPlatformSupported()) {
      setHealthSyncStatus('unavailable');
      setHealthSyncError('Apple 健康同步仅支持 iPhone。');
      return;
    }
    if (healthSyncInProgressRef.current) return;
    healthSyncInProgressRef.current = true;
    setHealthSyncStatus(requestPermission ? 'connecting' : 'syncing');
    setHealthSyncError(undefined);
    try {
      if (requestPermission) await authorizeHealthKit();
      const result = await syncHealthKitRunningWorkouts(forceFull ? undefined : healthKitAnchorRef.current);
      const deleted = new Set(result.deletedRecordIds);
      const merged = new Map<string, PersonalRun>();
      healthKitRunsRef.current.forEach((run) => {
        if (!deleted.has(run.id)) merged.set(run.id, run);
      });
      result.records.forEach((run: HealthWorkoutRecord) => merged.set(run.id, run));
      const records = mergePersonalRuns([...merged.values()]);
      const lastSyncAt = new Date().toISOString();
      healthKitRunsRef.current = records;
      healthKitAnchorRef.current = result.newAnchor;
      setHealthKitRuns(records);
      setHealthKitEnabled(true);
      setLastHealthSyncAt(lastSyncAt);
      setHealthSyncDiagnostics(`读取 ${result.queriedWorkoutCount} 条，识别 ${result.matchedWorkoutCount} 条`);
      saveHealthKitRuns({
        schemaVersion: 1,
        source: 'apple-health',
        enabled: true,
        anchor: result.newAnchor,
        lastSyncAt,
        records,
      });
      setHealthSyncStatus('ready');
    } catch (error) {
      setHealthSyncStatus('error');
      setHealthSyncError(error instanceof Error ? error.message : 'Apple 健康同步失败，请稍后重试。');
    } finally {
      healthSyncInProgressRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!healthKitEnabled) return undefined;
    void performHealthKitSync();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void performHealthKitSync();
    });
    let removeHealthKitSubscription: () => void = () => undefined;
    void subscribeToHealthKitWorkouts(() => void performHealthKitSync())
      .then((remove) => { removeHealthKitSubscription = remove; });
    return () => {
      appStateSubscription.remove();
      removeHealthKitSubscription();
    };
  }, [healthKitEnabled, performHealthKitSync]);

  const importPersonalRuns = useCallback(async () => {
    setRunImportStatus('正在选择文件…');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) {
        setRunImportStatus(importedPersonalRuns.length ? `已导入 ${importedPersonalRuns.length} 条` : '尚未导入');
        return;
      }
      const sourceFile = new File(result.assets[0].uri);
      const text = await sourceFile.text();
      const imported = parsePersonalRunImport(text);
      const storedFile = new File(Paths.document, PERSONAL_RUNS_FILE_NAME);
      if (storedFile.exists) storedFile.delete();
      storedFile.create();
      storedFile.write(text);
      setImportedPersonalRuns(imported.records);
      setPersonalRouteMatches(imported.routeMatches);
      setRunImportStatus(`已导入 ${imported.records.length} 条`);
      setPersonalRunsOpen(true);
    } catch (error) {
      setRunImportStatus(error instanceof Error ? error.message : '导入失败，请重试');
    }
  }, [importedPersonalRuns.length]);

  function handleLocationAction() {
    if (locationStatus === 'denied' && !canAskLocationAgain) {
      void Linking.openSettings();
      return;
    }
    void locateUser();
  }

  const locationActionLabel = locationStatus === 'ready'
    ? '更新我的位置'
    : locationStatus === 'loading'
      ? '正在定位…'
      : locationStatus === 'denied'
        ? '开启定位'
        : '重新定位';
  const healthSyncBusy = healthSyncStatus === 'connecting' || healthSyncStatus === 'syncing';
  const healthSyncActionLabel = healthSyncStatus === 'unavailable'
    ? '仅限 iPhone'
    : healthSyncStatus === 'connecting'
      ? '授权中…'
      : healthSyncStatus === 'syncing'
        ? '同步中…'
        : healthKitEnabled
          ? '立即同步'
          : '连接';
  const healthSyncSubtitle = healthKitEnabled
    ? `${healthKitRuns.length} 条健康记录${garminRunCount ? `，其中 Garmin ${garminRunCount} 条` : ''} · ${formatSyncTime(lastHealthSyncAt)}${healthSyncDiagnostics ? ` · ${healthSyncDiagnostics}` : ''}`
    : '同步手机与 Apple Watch；Garmin 可同步训练摘要';

  const routeDrawerPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 34 || gesture.vy > 0.45) setRoutesCollapsed(true);
      if (gesture.dy < -34 || gesture.vy < -0.45) setRoutesCollapsed(false);
    },
  }), []);

  function showRouteOnMap(route: AppRoute | undefined, animated = true) {
    if (route && route.coordinates.length > 1) {
      mapRef.current?.fitToCoordinates(coordinatesForEmbeddedMap(route), {
        edgePadding: { top: 52, right: 34, bottom: 52, left: 34 },
        animated,
      });
      return;
    }
    mapRef.current?.animateToRegion(regionForCity(route?.cityId ?? selectedCityId), animated ? 350 : 0);
  }

  useEffect(() => {
    if (cityOverviewOpen) return undefined;
    const frame = requestAnimationFrame(() => showRouteOnMap(selected, false));
    return () => cancelAnimationFrame(frame);
  }, [cityOverviewOpen, routesCollapsed, selected]);

  function selectRoute(route: AppRoute) {
    setSelectedId(route.id);
    requestAnimationFrame(() => {
      pageRef.current?.scrollTo({ y: Math.max(0, mapTopRef.current - 12), animated: true });
      showRouteOnMap(route);
    });
  }

  function selectCity(cityId: string) {
    const nextRoutes = routesForCity(cityId);
    const nextRoute = nextRoutes[0];
    setSelectedCityId(cityId);
    setSelectedId(nextRoute?.id ?? null);
    setRoutesCollapsed(false);
    setCityOverviewOpen(false);
    setCityQuery('');
    requestAnimationFrame(() => pageRef.current?.scrollTo({ y: 0, animated: false }));
  }

  function openSavedRoute(route: AppRoute) {
    setSelectedCityId(route.cityId);
    setSelectedId(route.id);
    setRoutesCollapsed(false);
    setCityOverviewOpen(false);
    setProfileOpen(false);
  }

  function toggleSaved() {
    if (!selected) return;
    setSavedIds((current) =>
      current.includes(selected.id)
        ? current.filter((id) => id !== selected.id)
        : [...current, selected.id],
    );
  }

  function openStartPoint(route: AppRoute | undefined = selected) {
    if (!route?.amapStart) return;
    const { latitude, longitude } = route.amapStart;
    Linking.openURL(`https://uri.amap.com/marker?position=${longitude},${latitude}&name=${encodeURIComponent(route.name)}`);
  }

  function renderRouteList() {
    return (
      <View style={styles.routeList}>
        {cityRoutes.map((route) => {
          const active = route.id === selected?.id;
          const proximityKm = routeDistancesById.get(route.id);
          const proximityLabel = proximityKm === undefined ? undefined : formatLocationDistanceKm(proximityKm);
          const runMatch = routeMatchesById[route.id];
          return (
            <Pressable
              key={route.id}
              accessibilityRole="button"
              accessibilityLabel={`${String(route.rank).padStart(2, '0')} ${route.name}，${route.distance}${runMatch ? `，已跑过，重合百分之${Math.round(runMatch.overlapPercent)}` : ''}${proximityLabel ? `，距你${proximityLabel}` : ''}`}
              accessibilityState={{ selected: active }}
              onPress={() => selectRoute(route)}
              style={({ pressed }) => [
                styles.routeRow,
                active && styles.routeRowActive,
                pressed && styles.routeRowPressed,
              ]}
            >
              <Text style={[styles.routeNumber, active && styles.routeNumberActive]}>
                {String(route.rank).padStart(2, '0')}
              </Text>
              <View style={styles.routeRowCopy}>
                <Text numberOfLines={1} style={styles.routeName}>
                  {route.name}
                </Text>
                <Text numberOfLines={1} style={styles.routeMeta}>
                  {route.tag} · {route.geometryStatus === 'mapped' ? '地图已核验' : '轨迹整理中'}
                </Text>
                {runMatch ? (
                  <Text numberOfLines={1} style={styles.routeRunMatch}>
                    ✓ 跑过 · 重合 {Math.round(runMatch.overlapPercent)}%
                  </Text>
                ) : null}
              </View>
              <View style={styles.routeRowAction}>
                <View style={styles.routeRowMetrics}>
                  <Text style={[styles.routeDistance, active && styles.routeDistanceActive]}>{route.distance}</Text>
                  {proximityLabel ? (
                    <Text style={[styles.routeProximity, active && styles.routeProximityActive]}>
                      距你 {proximityLabel}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.routeArrow, active && styles.routeArrowActive]}>›</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }

  if (trailOpen) {
    const trailRegion: Region = { latitude: 35.8, longitude: 106.5, latitudeDelta: 22, longitudeDelta: 35 };
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.profileHeader}>
          <Pressable onPress={() => setTrailOpen(false)} style={styles.profileBackButton}><Text style={styles.profileBackText}>‹ 返回</Text></Pressable>
          <Text style={styles.profileHeaderTitle}>我的轨迹</Text><View style={styles.profileHeaderSpacer} />
        </View>
        <MapView style={styles.trailMap} initialRegion={trailRegion}>
          {trailMarkers.map(({ run, point, city: markerCity }) => (
            <Marker key={run.id} coordinate={point} title={markerCity.name} description={formatRunDate(run.startTime)} pinColor="#FF5B36" />
          ))}
        </MapView>
        <View style={styles.trailSummaryCard}>
          <Text style={styles.trailSummaryTitle}>跑过的地方</Text>
          <Text style={styles.trailSummaryStats}>{trailProvinceCount} 个省份 · {new Set(trailMarkers.map((item) => item.city.id)).size} 个城市</Text>
          <Text style={styles.trailSummaryCopy}>地图标记来自每条跑步记录的 GPS 起点；没有轨迹的记录不会猜测位置。</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (selectedPersonalRun) {
    return (
      <PersonalRunDetail
        run={selectedPersonalRun}
        onBack={() => setSelectedPersonalRunId(undefined)}
      />
    );
  }

  if (personalRunsOpen) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.profileHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回我的页面"
            onPress={() => setPersonalRunsOpen(false)}
            style={styles.profileBackButton}
          >
            <Text style={styles.profileBackText}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.profileHeaderTitle}>跑步记录</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新导入跑步记录"
            onPress={() => void importPersonalRuns()}
            style={styles.profileImportButton}
          >
            <Text style={styles.profileImportButtonText}>导入</Text>
          </Pressable>
        </View>
        <FlatList
          data={periodRuns}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.personalRunListContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={(
            <View>
              <View style={styles.personalRunSummaryCard}>
                <View>
                  <Text style={styles.personalRunSummaryValue}>{periodRuns.length}</Text>
                  <Text style={styles.personalRunSummaryLabel}>本期次数</Text>
                </View>
                <View style={styles.personalRunSummaryDivider} />
                <View>
                  <Text style={styles.personalRunSummaryValue}>{periodDistanceKm.toFixed(1)}</Text>
                  <Text style={styles.personalRunSummaryLabel}>本期公里</Text>
                </View>
                <View style={styles.personalRunSummaryDivider} />
                <View>
                  <Text style={styles.personalRunSummaryValue}>
                    {personalRuns.filter((run) => run.encodedPath).length}
                  </Text>
                  <Text style={styles.personalRunSummaryLabel}>包含轨迹</Text>
                </View>
              </View>
              <View style={styles.runPeriodTabs}>
                {([['day', '日'], ['month', '月'], ['year', '年']] as const).map(([value, label]) => (
                  <Pressable key={value} onPress={() => setRunPeriod(value)} style={[styles.runPeriodTab, runPeriod === value && styles.runPeriodTabActive]}>
                    <Text style={[styles.runPeriodTabText, runPeriod === value && styles.runPeriodTabTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              {healthKitEnabled ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={healthSyncBusy}
                  onPress={() => void performHealthKitSync(false, true)}
                  style={styles.personalRunSyncBar}
                >
                  <View style={styles.personalRunSyncDot} />
                  <Text style={styles.personalRunSyncText}>{healthSyncSubtitle}</Text>
                  <Text style={styles.personalRunSyncAction}>{healthSyncActionLabel}</Text>
                </Pressable>
              ) : null}
              {healthSyncError ? <Text style={styles.personalRunSyncError}>{healthSyncError}</Text> : null}
            </View>
          )}
          ListEmptyComponent={(
            <View style={styles.profileEmptyCard}>
              <Text style={styles.profileEmptyTitle}>还没有跑步记录</Text>
              <Text style={styles.profileEmptyCopy}>连接 Apple 健康自动同步，或点击右上角“导入”选择迁移文件。</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${formatRunDate(item.startTime)}，${item.distanceKm?.toFixed(2) ?? '未知'}公里`}
              onPress={() => setSelectedPersonalRunId(item.id)}
              style={({ pressed }) => [styles.personalRunRow, pressed && styles.savedRouteRowPressed]}
            >
              <View style={styles.personalRunDateBadge}>
                <Text style={styles.personalRunDateDay}>{formatRunDay(item.startTime)}</Text>
                <Text style={styles.personalRunDateMonth}>{item.startTime ? String(new Date(item.startTime).getMonth() + 1).padStart(2, '0') : '--'}月</Text>
              </View>
              <View style={styles.personalRunRowCopy}>
                <Text style={styles.personalRunRowTitle}>{personalRunSourceLabel(item)} · {item.distanceKm?.toFixed(2) ?? '—'} km</Text>
                <Text style={styles.personalRunRowMeta}>
                  {formatRunDate(item.startTime)} · {formatRunDuration(item.durationSeconds)} · {formatRunPace(item.averagePaceSecondsPerKm)}/km
                </Text>
              </View>
              <View style={[styles.personalRunMapBadge, !item.encodedPath && styles.personalRunMapBadgeMissing]}>
                <Text style={[styles.personalRunMapBadgeText, !item.encodedPath && styles.personalRunMapBadgeTextMissing]}>
                  {item.encodedPath ? '轨迹' : '无轨迹'}
                </Text>
              </View>
              <Text style={styles.savedRouteArrow}>›</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    );
  }

  if (profileOpen) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.profileHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回跑步地图"
            onPress={() => setProfileOpen(false)}
            style={styles.profileBackButton}
          >
            <Text style={styles.profileBackText}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.profileHeaderTitle}>我的</Text>
          <View style={styles.profileHeaderSpacer} />
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.profileContent}>
          <View style={styles.profileHero}>
            <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>跑</Text></View>
            <View style={styles.profileHeroCopy}>
              <Text style={styles.profileName}>跑城用户</Text>
              <Text style={styles.profileSubtitle}>收藏喜欢的路线，建立自己的城市跑步地图。</Text>
            </View>
          </View>

          <View style={styles.profileStats}>
            <ProfileMetric value={String(personalRuns.length)} label="跑步次数" />
            <ProfileMetric value={personalRunDistanceKm.toFixed(1)} label="累计公里" />
            <ProfileMetric value={String(savedRoutes.length)} label="收藏路线" />
          </View>

          <View style={styles.profileSectionHeading}>
            <Text style={styles.profileSectionTitle}>我的收藏</Text>
            <Text style={styles.profileSectionCount}>{savedRoutes.length} 条</Text>
          </View>
          {savedRoutes.length ? (
            <View style={styles.savedRouteList}>
              {savedRoutes.map((route) => {
                const routeCity = coreCities.find((item) => item.id === route.cityId)?.name ?? route.cityId;
                return (
                  <Pressable
                    key={route.id}
                    accessibilityRole="button"
                    onPress={() => openSavedRoute(route)}
                    style={({ pressed }) => [styles.savedRouteRow, pressed && styles.savedRouteRowPressed]}
                  >
                    <View style={styles.savedRouteIcon}><Text style={styles.savedRouteIconText}>跑</Text></View>
                    <View style={styles.savedRouteCopy}>
                      <Text numberOfLines={1} style={styles.savedRouteName}>{route.name}</Text>
                      <Text style={styles.savedRouteMeta}>{routeCity} · {route.distance}</Text>
                    </View>
                    <Text style={styles.savedRouteArrow}>›</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.profileEmptyCard}>
              <Text style={styles.profileEmptyTitle}>还没有收藏路线</Text>
              <Text style={styles.profileEmptyCopy}>进入城市路线详情，点击♡即可收藏。</Text>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => setTrailOpen(true)}
            style={({ pressed }) => [styles.profileTrailRow, pressed && styles.savedRouteRowPressed]}
          >
            <View style={styles.profileMenuIcon}><Text style={styles.profileMenuIconText}>轨</Text></View>
            <View style={styles.profileMenuCopy}>
              <Text style={styles.profileMenuTitle}>我的轨迹</Text>
              <Text style={styles.profileMenuSubtitle}>查看跑过的省份、城市和 GPS 起点</Text>
            </View>
            <Text style={styles.profileMenuStatus}>查看 ›</Text>
          </Pressable>

          <Text style={styles.profileDataSectionTitle}>数据与权限</Text>
          <View style={styles.profileMenu}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Apple 健康同步，${healthSyncActionLabel}`}
              disabled={healthSyncBusy || healthSyncStatus === 'unavailable'}
              onPress={() => void performHealthKitSync(!healthKitEnabled, true)}
              style={({ pressed }) => [styles.profileMenuRow, pressed && styles.savedRouteRowPressed]}
            >
              <View style={[styles.profileMenuIcon, healthKitEnabled && styles.profileHealthIconReady]}>
                <Text style={[styles.profileMenuIconText, healthKitEnabled && styles.profileHealthIconTextReady]}>健</Text>
              </View>
              <View style={styles.profileMenuCopy}>
                <Text style={styles.profileMenuTitle}>Apple 健康 / Garmin</Text>
                <Text style={styles.profileMenuSubtitle}>{healthSyncSubtitle}</Text>
              </View>
              <Text style={[styles.profileMenuStatus, healthKitEnabled && styles.profileMenuStatusReady]}>
                {healthSyncActionLabel}
              </Text>
            </Pressable>
            {healthSyncError ? (
              <View style={styles.profileImportStatusRow}>
                <Text style={styles.profileImportStatusText}>{healthSyncError}</Text>
              </View>
            ) : null}
            {healthKitEnabled && garminRunCount > 0 ? (
              <View style={styles.profileHealthNote}>
                <Text style={styles.profileHealthNoteText}>Garmin 官方不会把 GPS 轨迹写入 Apple 健康，因此佳明记录可能只有距离和时间。</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => personalRuns.length ? setPersonalRunsOpen(true) : void importPersonalRuns()}
              style={({ pressed }) => [styles.profileMenuRow, pressed && styles.savedRouteRowPressed]}
            >
              <View style={styles.profileMenuIcon}><Text style={styles.profileMenuIconText}>记</Text></View>
              <View style={styles.profileMenuCopy}>
                <Text style={styles.profileMenuTitle}>跑步记录</Text>
                <Text style={styles.profileMenuSubtitle}>
                  {personalRuns.length ? `${personalRuns.length} 条记录，点击查看或更新` : '选择跑城咕咚迁移文件导入'}
                </Text>
              </View>
              <Text style={[styles.profileMenuStatus, personalRuns.length > 0 && styles.profileMenuStatusReady]}>
                {personalRuns.length ? '查看 ›' : '导入'}
              </Text>
            </Pressable>
            {runImportStatus !== '尚未导入' && !personalRuns.length ? (
              <View style={styles.profileImportStatusRow}>
                <Text style={styles.profileImportStatusText}>{runImportStatus}</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={locationStatus === 'loading'}
              onPress={handleLocationAction}
              style={({ pressed }) => [styles.profileMenuRow, pressed && styles.savedRouteRowPressed]}
            >
              <View style={styles.profileMenuIcon}><Text style={styles.profileMenuIconText}>位</Text></View>
              <View style={styles.profileMenuCopy}>
                <Text style={styles.profileMenuTitle}>位置权限</Text>
                <Text style={styles.profileMenuSubtitle}>用于计算你到路线最近点的距离</Text>
              </View>
              <Text style={[styles.profileMenuStatus, locationStatus === 'ready' && styles.profileMenuStatusReady]}>
                {locationStatus === 'ready' ? '已开启' : locationActionLabel}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (cityOverviewOpen) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.cityOverviewPage}>
          <MapView
            initialRegion={regionForCountry()}
            showsUserLocation={locationStatus === 'ready'}
            style={styles.cityOverviewMap}
          >
            {coreCities.map((item) => {
              const center = cityCenters[item.id];
              const count = routeCountByCity[item.id] ?? 0;
              if (!center || count === 0) return null;
              return (
                <Marker
                  key={item.id}
                  coordinate={coordinateForEmbeddedMap(center)}
                  onPress={() => selectCity(item.id)}
                  title={item.name}
                  description={`${count} 条路线`}
                >
                  <View style={styles.cityMapMarker}>
                    <Text style={styles.cityMapMarkerText}>{count}</Text>
                  </View>
                </Marker>
              );
            })}
          </MapView>
          <View style={styles.cityOverviewHeader}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}><Text style={styles.brandMarkText}>跑</Text></View>
              <View><Text style={styles.brand}>跑城</Text><Text style={styles.brandEn}>RUN CITY</Text></View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开我的页面"
              onPress={() => setProfileOpen(true)}
              style={styles.profileEntryButton}
            >
              <Text style={styles.profileEntryText}>我的</Text>
            </Pressable>
          </View>
          <View style={styles.cityOverviewSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.cityPanelHeader}>
              <View>
                <Text style={styles.cityPanelEyebrow}>50 城路线库</Text>
                <Text style={styles.cityPanelTitle}>选择一座城市</Text>
              </View>
              <View style={styles.cityCountBadge}>
                <Text style={styles.cityCountBadgeValue}>{readyCityCount}</Text>
                <Text style={styles.cityCountBadgeLabel}>城市可用</Text>
              </View>
            </View>
            <Text style={styles.cityOverviewCopy}>点城市卡片后，进入该城市的地图与 10 条精选跑步路线。</Text>
            <TextInput
              value={cityQuery}
              onChangeText={setCityQuery}
              placeholder="搜索城市或省份"
              placeholderTextColor="#8A96A5"
              autoCorrect={false}
              style={styles.citySearch}
            />
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.cityOverviewList}
              contentContainerStyle={styles.cityGrid}
            >
              {filteredCities.map((item) => {
                const count = routeCountByCity[item.id] ?? 0;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}，${count} 条路线`}
                    onPress={() => selectCity(item.id)}
                    style={({ pressed }) => [styles.cityCard, pressed && styles.cityCardPressed]}
                  >
                    <View style={styles.cityCardTop}>
                      <Text style={styles.cityCardName}>{item.name}</Text>
                      <Text style={styles.cityCardArrow}>›</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.cityProvince}>{item.province}</Text>
                    <Text style={[styles.cityRouteCount, count > 0 && styles.cityRouteCountReady]}>
                      {count > 0 ? `${count} 条精选路线` : '路线整理中'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <View style={styles.headerRightGroup}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>跑</Text></View>
            <View><Text style={styles.brand}>跑城</Text><Text style={styles.brandEn}>RUN CITY</Text></View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="选择城市"
            onPress={() => setCityOverviewOpen(true)}
            style={styles.cityButton}
          >
            <Text style={styles.city}>{city.name}</Text><Text style={styles.cityChevron}>⌄</Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开我的页面"
          onPress={() => setProfileOpen(true)}
          style={styles.profileEntryButton}
        >
          <Text style={styles.profileEntryText}>我的</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={pageRef}
        scrollEnabled={!routesCollapsed}
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
      >
        <View
          onLayout={(event) => { mapTopRef.current = event.nativeEvent.layout.y; }}
          style={[
            styles.cityRouteMap,
            {
              height: routesCollapsed
                ? Math.max(420, windowHeight - 154)
                : expandedMapHeight,
            },
          ]}
        >
          <MapView
            ref={mapRef}
            initialRegion={regionForCity(selectedCityId)}
            onMapReady={() => showRouteOnMap(selected, false)}
            showsUserLocation={locationStatus === 'ready'}
            style={StyleSheet.absoluteFill}
          >
            {selectedMapCoordinates.length ? (
              <>
                <Polyline
                  coordinates={selectedMapCoordinates}
                  strokeColor="#FF5B36"
                  strokeWidth={5}
                  lineCap="round"
                  lineJoin="round"
                />
                <Marker
                  key={`start-${selected?.id ?? 'unknown'}`}
                  coordinate={selectedMapCoordinates[0]}
                  description="点击用地图打开起点"
                  identifier={`start-${selected?.id ?? 'unknown'}`}
                  onPress={() => openStartPoint(selected)}
                  pinColor="#FF5B36"
                  title={selected?.name}
                />
              </>
            ) : null}
          </MapView>
          <View style={[styles.mapStatus, selected?.geometryStatus !== 'mapped' && styles.mapStatusPending]}>
            <View style={[styles.mapStatusDot, selected?.geometryStatus !== 'mapped' && styles.mapStatusDotPending]} />
            <Text numberOfLines={1} style={styles.mapStatusText}>
              {selected ? selected.statusLabel : `${city.name}路线整理中`}
            </Text>
          </View>
          {selected?.geometryStatus !== 'mapped' ? (
            <View style={styles.mapEmptyCard}>
              <Text style={styles.mapEmptyTitle}>暂不显示未经核验的路线</Text>
              <Text style={styles.mapEmptyCopy}>轨迹与底图一致后会显示。</Text>
            </View>
          ) : null}
          <View style={styles.osmAttribution}>
            <Text style={styles.osmAttributionText}>© OpenStreetMap contributors</Text>
          </View>
        </View>

        <View
          {...routeDrawerPanResponder.panHandlers}
          style={[styles.routeDrawer, routesCollapsed && styles.routeDrawerCollapsed]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={routesCollapsed ? '展开精选路线' : '收起精选路线'}
            onPress={() => setRoutesCollapsed((current) => !current)}
            style={styles.routeDrawerButton}
          >
            <View style={styles.routeDrawerHandle} />
            {routesCollapsed ? (
              <View style={styles.routeDrawerSelectedRow}>
                <View style={styles.routeDrawerSelectedCopy}>
                  <Text style={styles.routeDrawerEyebrow}>当前路线 · 上滑展开</Text>
                  <Text numberOfLines={1} style={styles.routeDrawerTitle}>{selected?.name ?? `${city.name}精选路线`}</Text>
                </View>
                <Text style={styles.routeDrawerChevron}>⌃</Text>
              </View>
            ) : (
              <View style={styles.routeDrawerExpandedRow}>
                <Text style={styles.routeDrawerExpandedTitle}>{city.name}路线</Text>
                <Text style={styles.routeDrawerExpandedHint}>下滑收起，只看地图</Text>
              </View>
            )}
          </Pressable>
        </View>

        {!routesCollapsed ? (
          <>

        <View style={styles.intro}>
          <Text style={styles.eyebrow}>跑步城市名片 · 50 城计划</Text>
          <Text style={styles.title}>
            {city.name}{cityRoutes.length > 0 ? ` ${cityRoutes.length} 大跑步路线` : ' 跑步路线'}
          </Text>
          <Text style={styles.subtitle}>
            {cityRoutes.length > 0
              ? '每条轨迹均经过位置、闭环、里程和重复度检查。'
              : '城市已进入路线库，10 条精选路线正在整理。'}
          </Text>
        </View>

        <View style={styles.routeSection}>
          <View style={styles.routeSectionHeading}>
            <View>
              <Text style={styles.sectionEyebrow}>ROUTES</Text>
              <Text style={styles.sectionTitle}>精选路线</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={locationActionLabel}
              disabled={locationStatus === 'loading'}
              hitSlop={8}
              onPress={handleLocationAction}
            >
              <Text style={[styles.sectionHint, locationStatus === 'ready' && styles.sectionHintReady]}>
                {locationActionLabel}
              </Text>
            </Pressable>
          </View>

          {cityRoutes.length > 0 ? (
            renderRouteList()
          ) : (
            <View style={styles.routeEmptyBar}>
              <View style={styles.pendingDot} />
              <Text style={styles.routeEmptyText}>路线团队正在整理 {city.name} 的首批 10 条路线</Text>
            </View>
          )}
        </View>

        {selected ? (
          <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetTop}>
            <View style={styles.sheetHeading}>
              <Text style={styles.routeTag}>
                {String(selected.rank).padStart(2, '0')} · {selected.tag}
                {selectedRouteMatch ? ` · ✓ 跑过 ${Math.round(selectedRouteMatch.overlapPercent)}%` : ''}
              </Text>
              <Text numberOfLines={1} style={styles.sheetTitle}>{selected.name}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={savedIds.includes(selected.id) ? '取消收藏' : '收藏'}
              onPress={toggleSaved}
              style={[styles.heartButton, savedIds.includes(selected.id) && styles.heartButtonActive]}
            >
              <Text style={[styles.heart, savedIds.includes(selected.id) && styles.heartActive]}>
                {savedIds.includes(selected.id) ? '♥' : '♡'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.summary}>{selected.summary}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={selectedDistanceKm === undefined
              ? locationActionLabel
              : `距你 ${formatLocationDistanceKm(selectedDistanceKm)}，点击更新位置`}
            disabled={locationStatus === 'loading'}
            onPress={handleLocationAction}
            style={styles.proximityCard}
          >
            <View style={[styles.proximityIcon, locationStatus === 'ready' && styles.proximityIconReady]}>
              <Text style={[styles.proximityIconText, locationStatus === 'ready' && styles.proximityIconTextReady]}>⌖</Text>
            </View>
            <View style={styles.proximityCopy}>
              <Text style={styles.proximityValue}>
                {selectedDistanceKm === undefined
                  ? locationStatus === 'loading'
                    ? '正在获取当前位置…'
                    : locationStatus === 'denied'
                      ? '开启定位后显示距离'
                      : '暂时无法获取位置'
                  : `距你 ${formatLocationDistanceKm(selectedDistanceKm)}`}
              </Text>
              <Text style={styles.proximityLabel}>
                {selectedDistanceKm === undefined ? '点击重试或前往系统设置' : '到路线最近点的直线距离'}
              </Text>
            </View>
            <Text style={styles.proximityAction}>{selectedDistanceKm === undefined ? '›' : '更新'}</Text>
          </Pressable>
          <View style={styles.stats}>
            <Metric value={selected.distance} label="距离" />
            <Metric value={selected.duration} label="预计时长" />
            <Metric value={selected.difficulty} label="难度" />
            <Metric value={selected.elevation} label="累计爬升" />
          </View>
          <View style={styles.notes}>
            <Text style={styles.note}><Text style={styles.noteStrong}>最佳时段  </Text>{selected.bestTime}</Text>
            <Text style={styles.note}><Text style={styles.noteStrong}>路线状态  </Text>{selected.note}</Text>
          </View>
          <Pressable
            accessibilityRole="link"
            disabled={!selected.amapStart}
            onPress={() => openStartPoint(selected)}
            style={[styles.primaryButton, !selected.amapStart && styles.primaryButtonDisabled]}
          >
            <Text style={styles.primaryButtonText}>{selected.amapStart ? '用地图打开起点' : '轨迹核验后开放导航'}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(selected.evidenceUrl)} style={styles.sourceLink}>
            <Text style={styles.sourceLinkText}>查看路线推荐来源</Text>
          </Pressable>
          </View>
        ) : (
          <View style={styles.emptySheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.emptySheetTitle}>{city.name}路线正在整理</Text>
          <Text style={styles.emptySheetCopy}>城市已经加入 50 城路线库。完成路线筛选、公开 GPX 匹配和地图核验后，会在这里显示首批 10 条路线。</Text>
          <Pressable onPress={() => setCityOverviewOpen(true)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>查看其他城市</Text>
          </Pressable>
          </View>
        )}
          </>
        ) : null}
      </ScrollView>

    </SafeAreaView>
  );
}

function PersonalRunDetail({ run, onBack }: { run: PersonalRun; onBack: () => void }) {
  const personalMapRef = useRef<MapView>(null);
  const rawCoordinates = useMemo(() => decodePolyline(run.encodedPath), [run.encodedPath]);
  const displayCoordinates = useMemo(
    () => rawCoordinates.map(coordinateForEmbeddedMap),
    [rawCoordinates],
  );
  const initialCoordinate = displayCoordinates[0] ?? coordinateForEmbeddedMap(cityCenters[DEFAULT_CITY_ID]);

  function fitPersonalRun() {
    if (displayCoordinates.length > 1) {
      personalMapRef.current?.fitToCoordinates(displayCoordinates, {
        edgePadding: { top: 56, right: 34, bottom: 56, left: 34 },
        animated: false,
      });
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.profileHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回跑步记录"
          onPress={onBack}
          style={styles.profileBackButton}
        >
          <Text style={styles.profileBackText}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.profileHeaderTitle}>跑步详情</Text>
        <View style={styles.profileHeaderSpacer} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.personalRunDetailContent}>
        {displayCoordinates.length ? (
          <MapView
            ref={personalMapRef}
            initialRegion={{
              ...initialCoordinate,
              latitudeDelta: 0.08,
              longitudeDelta: 0.08,
            }}
            onMapReady={fitPersonalRun}
            style={styles.personalRunDetailMap}
          >
            <Polyline coordinates={displayCoordinates} strokeColor="#FF5B36" strokeWidth={5} />
            <Marker
              identifier={`personal-run-start-${run.id}`}
              coordinate={displayCoordinates[0]}
              title="跑步起点"
              pinColor="#FF5B36"
            />
          </MapView>
        ) : (
          <View style={styles.personalRunNoMap}>
            <Text style={styles.personalRunNoMapTitle}>这次跑步没有GPS轨迹</Text>
            <Text style={styles.personalRunNoMapCopy}>距离和时间记录仍然保留。</Text>
          </View>
        )}
        <View style={styles.personalRunDetailCard}>
          <Text style={styles.personalRunDetailEyebrow}>
            {personalRunSourceLabel(run)} · 跑步{run.deviceName ? ` · ${run.deviceName}` : ''}
          </Text>
          <Text style={styles.personalRunDetailTitle}>{formatRunDate(run.startTime)}</Text>
          <View style={styles.personalRunDetailMetrics}>
            <Metric value={`${run.distanceKm?.toFixed(2) ?? '—'} km`} label="距离" />
            <Metric value={formatRunDuration(run.durationSeconds)} label="运动时间" />
            <Metric value={`${formatRunPace(run.averagePaceSecondsPerKm)}/km`} label="平均配速" />
          </View>
          <View style={styles.personalRunSecondaryMetrics}>
            <Text style={styles.personalRunSecondaryMetric}>热量 {run.calories?.toFixed(0) ?? '—'} kcal</Text>
            <Text style={styles.personalRunSecondaryMetric}>平均心率 {run.averageHeartRate?.toFixed(0) ?? '—'} bpm</Text>
            <Text style={styles.personalRunSecondaryMetric}>轨迹点 {run.originalPointCount}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metric}>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function ProfileMetric({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.profileMetric}>
      <Text style={styles.profileMetricValue}>{value}</Text>
      <Text style={styles.profileMetricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F7FA' },
  profileHeader: { height: 58, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E0E6ED', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileBackButton: { minWidth: 58, height: 36, borderRadius: 11, backgroundColor: '#F2F5F7', alignItems: 'center', justifyContent: 'center' },
  profileBackText: { color: '#14233B', fontSize: 12, fontWeight: '800' },
  profileHeaderTitle: { color: '#14233B', fontSize: 17, fontWeight: '800' },
  profileHeaderSpacer: { width: 58 },
  profileImportButton: { minWidth: 58, height: 36, borderRadius: 11, backgroundColor: '#FFF0EB', alignItems: 'center', justifyContent: 'center' },
  profileImportButtonText: { color: '#E94D2A', fontSize: 12, fontWeight: '800' },
  profileContent: { padding: 18, paddingBottom: 36 },
  profileHero: { padding: 18, borderRadius: 20, backgroundColor: '#14233B', flexDirection: 'row', alignItems: 'center', gap: 14 },
  profileAvatar: { width: 56, height: 56, borderRadius: 19, backgroundColor: '#FF5B36', alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: '#FFFFFF', fontSize: 23, fontWeight: '900' },
  profileHeroCopy: { flex: 1 },
  profileName: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  profileSubtitle: { marginTop: 5, color: '#B8C1CD', fontSize: 10, lineHeight: 15 },
  profileStats: { marginTop: 12, paddingVertical: 14, borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row' },
  profileMetric: { flex: 1, alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderColor: '#E0E6ED' },
  profileMetricValue: { color: '#14233B', fontSize: 18, fontWeight: '900' },
  profileMetricLabel: { marginTop: 3, color: '#657283', fontSize: 9 },
  profileSectionHeading: { marginTop: 22, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileSectionTitle: { color: '#14233B', fontSize: 16, fontWeight: '800' },
  profileDataSectionTitle: { marginTop: 22, marginBottom: 10, color: '#14233B', fontSize: 16, fontWeight: '800' },
  profileTrailRow: { marginTop: 14, minHeight: 68, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 11 },
  trailMap: { flex: 1, minHeight: 420 },
  trailSummaryCard: { padding: 20, backgroundColor: '#14233B', borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  trailSummaryTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  trailSummaryStats: { marginTop: 8, color: '#FFB09A', fontSize: 17, fontWeight: '800' },
  trailSummaryCopy: { marginTop: 8, color: '#B8C1CD', fontSize: 11, lineHeight: 17 },
  profileSectionCount: { color: '#657283', fontSize: 10, fontWeight: '700' },
  savedRouteList: { gap: 8 },
  savedRouteRow: { minHeight: 64, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: '#E7ECF0', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10 },
  savedRouteRowPressed: { opacity: .68 },
  savedRouteIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#FFF0EB', alignItems: 'center', justifyContent: 'center' },
  savedRouteIconText: { color: '#FF5B36', fontSize: 12, fontWeight: '900' },
  savedRouteCopy: { flex: 1, minWidth: 0 },
  savedRouteName: { color: '#14233B', fontSize: 13, fontWeight: '800' },
  savedRouteMeta: { marginTop: 3, color: '#657283', fontSize: 9 },
  savedRouteArrow: { color: '#A1ABB6', fontSize: 22 },
  profileEmptyCard: { padding: 18, borderRadius: 16, borderWidth: 1, borderColor: '#E5EAEF', borderStyle: 'dashed', backgroundColor: '#FFFFFF', alignItems: 'center' },
  profileEmptyTitle: { color: '#14233B', fontSize: 13, fontWeight: '800' },
  profileEmptyCopy: { marginTop: 4, color: '#657283', fontSize: 10 },
  profileMenu: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#FFFFFF' },
  profileMenuRow: { minHeight: 68, paddingHorizontal: 13, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E7ECF0', flexDirection: 'row', alignItems: 'center', gap: 11 },
  profileMenuIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#EEF3F6', alignItems: 'center', justifyContent: 'center' },
  profileMenuIconText: { color: '#536374', fontSize: 11, fontWeight: '900' },
  profileHealthIconReady: { backgroundColor: '#E4F4EA' },
  profileHealthIconTextReady: { color: '#258452' },
  profileMenuCopy: { flex: 1 },
  profileMenuTitle: { color: '#14233B', fontSize: 12, fontWeight: '800' },
  profileMenuSubtitle: { marginTop: 3, color: '#657283', fontSize: 9 },
  profileMenuStatus: { color: '#8A96A5', fontSize: 9, fontWeight: '800' },
  profileMenuStatusReady: { color: '#3B8A5C' },
  profileImportStatusRow: { paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#FFF8F5' },
  profileImportStatusText: { color: '#B6583F', fontSize: 9, lineHeight: 14 },
  profileHealthNote: { paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#F3F7F5', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E2EAE5' },
  profileHealthNoteText: { color: '#4E715C', fontSize: 9, lineHeight: 14 },
  personalRunListContent: { padding: 16, paddingBottom: 36, gap: 8 },
  personalRunSummaryCard: { marginBottom: 8, paddingHorizontal: 18, paddingVertical: 16, borderRadius: 18, backgroundColor: '#14233B', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  personalRunSummaryValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  personalRunSummaryLabel: { marginTop: 3, color: '#B8C1CD', fontSize: 9, textAlign: 'center' },
  personalRunSummaryDivider: { width: StyleSheet.hairlineWidth, height: 30, backgroundColor: '#566276' },
  runPeriodTabs: { marginBottom: 12, padding: 4, borderRadius: 12, backgroundColor: '#EEF3F6', flexDirection: 'row' },
  runPeriodTab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  runPeriodTabActive: { backgroundColor: '#FFFFFF' },
  runPeriodTabText: { color: '#657283', fontSize: 12, fontWeight: '700' },
  runPeriodTabTextActive: { color: '#E94D2A' },
  personalRunSyncBar: { minHeight: 42, marginBottom: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#EAF6EF', flexDirection: 'row', alignItems: 'center', gap: 8 },
  personalRunSyncDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#38A269' },
  personalRunSyncText: { flex: 1, color: '#3C6F51', fontSize: 9 },
  personalRunSyncAction: { color: '#258452', fontSize: 9, fontWeight: '900' },
  personalRunSyncError: { marginBottom: 8, paddingHorizontal: 4, color: '#B6583F', fontSize: 9, lineHeight: 14 },
  personalRunRow: { minHeight: 72, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 15, borderWidth: 1, borderColor: '#E5EAEF', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10 },
  personalRunDateBadge: { width: 42, height: 48, borderRadius: 12, backgroundColor: '#FFF0EB', alignItems: 'center', justifyContent: 'center' },
  personalRunDateDay: { color: '#E94D2A', fontSize: 16, fontWeight: '900', lineHeight: 18 },
  personalRunDateMonth: { marginTop: 2, color: '#A65A45', fontSize: 8, fontWeight: '700' },
  personalRunRowCopy: { flex: 1, minWidth: 0 },
  personalRunRowTitle: { color: '#14233B', fontSize: 13, fontWeight: '800' },
  personalRunRowMeta: { marginTop: 4, color: '#657283', fontSize: 8, lineHeight: 12 },
  personalRunMapBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 8, backgroundColor: '#EAF6EF' },
  personalRunMapBadgeMissing: { backgroundColor: '#F1F3F5' },
  personalRunMapBadgeText: { color: '#3B8A5C', fontSize: 8, fontWeight: '800' },
  personalRunMapBadgeTextMissing: { color: '#8A96A5' },
  personalRunDetailContent: { paddingBottom: 30 },
  personalRunDetailMap: { height: 430, backgroundColor: '#E9F2F6' },
  personalRunNoMap: { height: 280, backgroundColor: '#E9EEF2', alignItems: 'center', justifyContent: 'center' },
  personalRunNoMapTitle: { color: '#14233B', fontSize: 15, fontWeight: '800' },
  personalRunNoMapCopy: { marginTop: 6, color: '#657283', fontSize: 10 },
  personalRunDetailCard: { margin: 16, marginTop: -20, padding: 18, borderRadius: 21, backgroundColor: '#FFFFFF', shadowColor: '#14233B', shadowOffset: { width: 0, height: 5 }, shadowOpacity: .1, shadowRadius: 13, elevation: 7 },
  personalRunDetailEyebrow: { color: '#FF5B36', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  personalRunDetailTitle: { marginTop: 6, color: '#14233B', fontSize: 21, fontWeight: '900' },
  personalRunDetailMetrics: { marginTop: 18, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#E5EAEF', flexDirection: 'row' },
  personalRunSecondaryMetrics: { marginTop: 16, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#E5EAEF', gap: 7 },
  personalRunSecondaryMetric: { color: '#657283', fontSize: 10, fontWeight: '600' },
  cityOverviewPage: { flex: 1, backgroundColor: '#E9F2F6' },
  cityOverviewMap: { height: '48%', minHeight: 310 },
  cityOverviewHeader: { position: 'absolute', top: 16, left: 16, right: 16, height: 48, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(255,255,255,.94)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cityOverviewHeaderTitle: { color: '#14233B', fontSize: 14, fontWeight: '800' },
  cityOverviewSheet: { flex: 1, marginTop: -24, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#FFFFFF', shadowColor: '#14233B', shadowOffset: { width: 0, height: -6 }, shadowOpacity: .1, shadowRadius: 14, elevation: 10 },
  cityOverviewCopy: { marginTop: 7, color: '#657283', fontSize: 11, lineHeight: 16 },
  cityOverviewList: { flex: 1, marginTop: 12 },
  cityCountBadge: { minWidth: 62, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: '#FFF0EB', alignItems: 'center' },
  cityCountBadgeValue: { color: '#E94D2A', fontSize: 14, fontWeight: '900' },
  cityCountBadgeLabel: { marginTop: 1, color: '#A65A45', fontSize: 8, fontWeight: '700' },
  cityMapMarker: { minWidth: 24, height: 24, paddingHorizontal: 5, borderRadius: 12, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: '#FF5B36', alignItems: 'center', justifyContent: 'center', shadowColor: '#14233B', shadowOpacity: .2, shadowRadius: 3, elevation: 3 },
  cityMapMarkerText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' },
  page: { flex: 1 },
  pageContent: { paddingBottom: 18 },
  header: { height: 62, paddingHorizontal: 20, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E0E6ED', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRightGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  profileEntryButton: { minWidth: 54, height: 36, paddingHorizontal: 11, borderRadius: 11, backgroundColor: '#F2F5F7', alignItems: 'center', justifyContent: 'center' },
  profileEntryText: { color: '#14233B', fontSize: 12, fontWeight: '800' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#FF5B36', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  brand: { color: '#14233B', fontSize: 17, fontWeight: '800', lineHeight: 18 },
  brandEn: { color: '#657283', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  cityButton: { minWidth: 72, height: 38, paddingHorizontal: 11, borderRadius: 12, backgroundColor: '#F5F7FA', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  city: { color: '#14233B', fontSize: 14, fontWeight: '800' },
  cityChevron: { marginTop: -3, color: '#657283', fontSize: 15, fontWeight: '700' },
  intro: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18, backgroundColor: '#FFFFFF' },
  eyebrow: { color: '#FF5B36', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { marginTop: 6, color: '#14233B', fontSize: 26, fontWeight: '800', letterSpacing: -1 },
  subtitle: { marginTop: 7, color: '#657283', fontSize: 13 },
  routeSection: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#EDF0F3' },
  routeSectionHeading: { marginBottom: 13, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionEyebrow: { color: '#FF5B36', fontSize: 9, fontWeight: '900', letterSpacing: 1.6 },
  sectionTitle: { marginTop: 3, color: '#14233B', fontSize: 19, fontWeight: '800' },
  sectionHint: { paddingBottom: 2, color: '#7A8797', fontSize: 11, fontWeight: '600' },
  sectionHintReady: { color: '#3B8A5C' },
  routeList: { gap: 8 },
  routeRow: { minHeight: 68, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: '#E7ECF0', backgroundColor: '#F8FAFB', flexDirection: 'row', alignItems: 'center', gap: 11 },
  routeRowActive: { borderColor: '#FFC6B7', borderLeftWidth: 3, backgroundColor: '#FFF2ED' },
  routeRowPressed: { opacity: .72 },
  routeNumber: { width: 34, height: 34, borderRadius: 11, textAlign: 'center', textAlignVertical: 'center', color: '#657283', backgroundColor: '#EAF0F4', fontSize: 12, fontWeight: '800' },
  routeNumberActive: { color: '#FFFFFF', backgroundColor: '#FF5B36' },
  routeRowCopy: { flex: 1, minWidth: 0 },
  routeName: { color: '#14233B', fontSize: 14, fontWeight: '800' },
  routeMeta: { marginTop: 3, color: '#657283', fontSize: 11 },
  routeRunMatch: { marginTop: 4, color: '#258452', fontSize: 10, fontWeight: '800' },
  routeRowAction: { minWidth: 96, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  routeRowMetrics: { alignItems: 'flex-end', gap: 3 },
  routeDistance: { color: '#536374', fontSize: 11, fontWeight: '800' },
  routeDistanceActive: { color: '#E94D2A' },
  routeProximity: { color: '#3B8A5C', fontSize: 9, fontWeight: '700' },
  routeProximityActive: { color: '#D94A29' },
  routeArrow: { color: '#A1ABB6', fontSize: 24, fontWeight: '300', lineHeight: 25 },
  routeArrowActive: { color: '#FF5B36' },
  routeEmptyBar: { minHeight: 62, paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#F8FAFB', flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F2A33A' },
  routeEmptyText: { color: '#657283', fontSize: 12, fontWeight: '600' },
  cityRouteMap: { height: 360, backgroundColor: '#E9F2F6' },
  routeDrawer: { minHeight: 62, marginTop: -18, paddingTop: 8, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#FFFFFF', shadowColor: '#14233B', shadowOffset: { width: 0, height: -5 }, shadowOpacity: .1, shadowRadius: 12, elevation: 9 },
  routeDrawerCollapsed: { minHeight: 88 },
  routeDrawerButton: { flex: 1, paddingHorizontal: 20, paddingBottom: 10 },
  routeDrawerHandle: { alignSelf: 'center', width: 38, height: 4, marginBottom: 9, borderRadius: 2, backgroundColor: '#D8E0E6' },
  routeDrawerSelectedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeDrawerSelectedCopy: { flex: 1, minWidth: 0 },
  routeDrawerEyebrow: { color: '#FF5B36', fontSize: 9, fontWeight: '800' },
  routeDrawerTitle: { marginTop: 3, color: '#14233B', fontSize: 16, fontWeight: '800' },
  routeDrawerChevron: { color: '#657283', fontSize: 19, fontWeight: '700' },
  routeDrawerExpandedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  routeDrawerExpandedTitle: { color: '#14233B', fontSize: 16, fontWeight: '800' },
  routeDrawerExpandedHint: { color: '#7A8797', fontSize: 10, fontWeight: '600' },
  mapStatus: { position: 'absolute', top: 13, right: 13, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,.94)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  mapStatusPending: { backgroundColor: 'rgba(255,248,236,.95)' },
  mapStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#42A66B' },
  mapStatusDotPending: { backgroundColor: '#F2A33A' },
  mapStatusText: { maxWidth: 150, color: '#536374', fontSize: 10, fontWeight: '700' },
  mapEmptyCard: { position: 'absolute', alignSelf: 'center', top: '38%', width: '82%', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.94)', shadowColor: '#14233B', shadowOpacity: .08, shadowRadius: 10, elevation: 3 },
  mapEmptyTitle: { color: '#14233B', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  mapEmptyCopy: { marginTop: 4, color: '#657283', fontSize: 11, lineHeight: 16, textAlign: 'center' },
  osmAttribution: { position: 'absolute', right: 7, bottom: 6, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 4, backgroundColor: 'rgba(255,255,255,.88)' },
  osmAttributionText: { color: '#536374', fontSize: 8 },
  sheet: { paddingHorizontal: 20, paddingTop: 9, paddingBottom: 14, backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, shadowColor: '#14233B', shadowOffset: { width: 0, height: -6 }, shadowOpacity: .08, shadowRadius: 14, elevation: 8 },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, marginBottom: 12, borderRadius: 2, backgroundColor: '#DDE4EA' },
  sheetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  sheetHeading: { flex: 1 },
  routeTag: { color: '#FF5B36', fontSize: 11, fontWeight: '800' },
  sheetTitle: { marginTop: 3, color: '#14233B', fontSize: 20, fontWeight: '800', letterSpacing: -.5 },
  heartButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#E0E6ED' },
  heartButtonActive: { borderColor: '#FFCCBE', backgroundColor: '#FFF0EB' },
  heart: { color: '#657283', fontSize: 22 },
  heartActive: { color: '#FF5B36' },
  summary: { marginTop: 9, color: '#425066', fontSize: 12, lineHeight: 18 },
  proximityCard: { minHeight: 54, marginTop: 11, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 13, backgroundColor: '#F3F7F5', flexDirection: 'row', alignItems: 'center', gap: 10 },
  proximityIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#E6EBEF', alignItems: 'center', justifyContent: 'center' },
  proximityIconReady: { backgroundColor: '#DCEFE4' },
  proximityIconText: { color: '#657283', fontSize: 18, fontWeight: '800' },
  proximityIconTextReady: { color: '#2F8655' },
  proximityCopy: { flex: 1 },
  proximityValue: { color: '#14233B', fontSize: 12, fontWeight: '800' },
  proximityLabel: { marginTop: 2, color: '#657283', fontSize: 9 },
  proximityAction: { color: '#657283', fontSize: 10, fontWeight: '800' },
  stats: { flexDirection: 'row', marginTop: 12, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E0E6ED' },
  metric: { flex: 1 },
  metricValue: { color: '#14233B', fontSize: 12, fontWeight: '800' },
  metricLabel: { marginTop: 3, color: '#657283', fontSize: 9 },
  notes: { marginTop: 10, gap: 5 },
  note: { color: '#657283', fontSize: 10, lineHeight: 15 },
  noteStrong: { color: '#14233B', fontWeight: '800' },
  primaryButton: { height: 43, marginTop: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF5B36' },
  primaryButtonDisabled: { backgroundColor: '#AAB4C0' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  sourceLink: { alignSelf: 'center', paddingHorizontal: 12, paddingTop: 9, paddingBottom: 1 },
  sourceLinkText: { color: '#657283', fontSize: 10, fontWeight: '700', textDecorationLine: 'underline' },
  emptySheet: { paddingHorizontal: 20, paddingTop: 9, paddingBottom: 20, backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  emptySheetTitle: { color: '#14233B', fontSize: 20, fontWeight: '800' },
  emptySheetCopy: { marginTop: 8, color: '#657283', fontSize: 12, lineHeight: 18 },
  secondaryButton: { height: 43, marginTop: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2F5' },
  secondaryButtonText: { color: '#14233B', fontSize: 13, fontWeight: '800' },
  cityPanelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cityPanelEyebrow: { color: '#FF5B36', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  cityPanelTitle: { marginTop: 3, color: '#14233B', fontSize: 25, fontWeight: '800' },
  citySearch: { height: 44, marginTop: 14, paddingHorizontal: 14, borderRadius: 13, backgroundColor: '#F3F6F8', color: '#14233B', fontSize: 14 },
  cityGrid: { paddingBottom: 28, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  cityCard: { width: '48.5%', minHeight: 91, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#E7ECF0', backgroundColor: '#FAFBFC' },
  cityCardPressed: { opacity: .7, borderColor: '#FFB7A5', backgroundColor: '#FFF3EF' },
  cityCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cityCardName: { color: '#14233B', fontSize: 15, fontWeight: '800' },
  cityCardArrow: { color: '#A1ABB6', fontSize: 20, fontWeight: '400' },
  cityProvince: { marginTop: 4, color: '#8A96A5', fontSize: 10 },
  cityRouteCount: { marginTop: 9, color: '#8A96A5', fontSize: 10, fontWeight: '700' },
  cityRouteCountReady: { color: '#3B8A5C' },
});
