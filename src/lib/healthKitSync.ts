import { Platform } from 'react-native';
import type { Coordinate } from '../data/appRoutes';

export type HealthWorkoutRecord = {
  id: string;
  source: 'apple-health' | 'garmin';
  sourceName: string;
  sourceBundleIdentifier?: string;
  deviceName?: string;
  sport: 'running';
  startTime?: string;
  endTime?: string;
  distanceKm?: number;
  durationSeconds?: number;
  averagePaceSecondsPerKm?: number;
  calories?: number;
  coordinateSystem: 'wgs84';
  encodedPath: string;
  originalPointCount: number;
  displayPointCount: number;
  validationStatus: 'healthkit';
};

export type HealthKitSyncResult = {
  records: HealthWorkoutRecord[];
  queriedWorkoutCount: number;
  matchedWorkoutCount: number;
  deletedRecordIds: string[];
  newAnchor: string;
};

const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier' as const;
const WORKOUT_ROUTE_TYPE = 'HKWorkoutRouteTypeIdentifier' as const;
const MAXIMUM_ROUTE_POINTS = 900;

function encodePolyline(points: Coordinate[]) {
  const output: string[] = [];
  let previousLatitude = 0;
  let previousLongitude = 0;
  points.forEach((point) => {
    const latitude = Math.round(point.latitude * 100000);
    const longitude = Math.round(point.longitude * 100000);
    [latitude - previousLatitude, longitude - previousLongitude].forEach((delta) => {
      let value = delta < 0 ? ~(delta << 1) : delta << 1;
      while (value >= 0x20) {
        output.push(String.fromCharCode((0x20 | (value & 0x1f)) + 63));
        value >>= 5;
      }
      output.push(String.fromCharCode(value + 63));
    });
    previousLatitude = latitude;
    previousLongitude = longitude;
  });
  return output.join('');
}

function capRoutePoints(points: Coordinate[]) {
  if (points.length <= MAXIMUM_ROUTE_POINTS) return points;
  const selected = new Set<number>();
  for (let index = 0; index < MAXIMUM_ROUTE_POINTS; index += 1) {
    selected.add(Math.round(index * (points.length - 1) / (MAXIMUM_ROUTE_POINTS - 1)));
  }
  return [...selected].sort((a, b) => a - b).map((index) => points[index]);
}

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function healthKitUnavailableMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/nitro|native module|not found|unavailable/i.test(message)) {
    return '当前安装包不含 Apple 健康组件，请安装跑城开发版或正式版。';
  }
  return message || 'Apple 健康同步失败，请稍后重试。';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isHealthKitPlatformSupported() {
  return Platform.OS === 'ios';
}

export async function authorizeHealthKit() {
  if (!isHealthKitPlatformSupported()) {
    throw new Error('Apple 健康同步仅支持 iPhone。');
  }
  try {
    const healthKit = await import('@kingstinct/react-native-healthkit');
    if (!await healthKit.isHealthDataAvailableAsync()) {
      throw new Error('这台设备无法使用 Apple 健康。');
    }
    await healthKit.requestAuthorization({
      toRead: [WORKOUT_TYPE, WORKOUT_ROUTE_TYPE],
    });
    await healthKit.configureBackgroundTypes(
      [WORKOUT_TYPE],
      healthKit.UpdateFrequency.immediate,
    );
    await healthKit.enableBackgroundDelivery(
      WORKOUT_TYPE,
      healthKit.UpdateFrequency.immediate,
    );
  } catch (error) {
    throw new Error(healthKitUnavailableMessage(error));
  }
}

export async function syncHealthKitRunningWorkouts(anchor?: string): Promise<HealthKitSyncResult> {
  if (!isHealthKitPlatformSupported()) {
    throw new Error('Apple 健康同步仅支持 iPhone。');
  }
  try {
    const healthKit = await import('@kingstinct/react-native-healthkit');
    // Always query without a native activity predicate. Garmin and some
    // other writers occasionally use the `other` subtype for valid runs.
    // A missing anchor performs a complete history refresh.
    const response = await healthKit.queryWorkoutSamplesWithAnchor({
      limit: -1,
      anchor,
      filter: undefined,
    });
    const records: HealthWorkoutRecord[] = [];
    const workouts = [...response.workouts];
    const activityWorkouts = workouts.filter((workout) => {
      const source = `${workout.sourceRevision.source.name} ${workout.sourceRevision.source.bundleIdentifier} ${workout.device?.name} ${workout.device?.manufacturer} ${workout.device?.model}`;
      return /garmin|sigma|咕咚|codoon|strava/i.test(source)
        || workout.workoutActivityType === healthKit.WorkoutActivityType.running;
    });

    for (let batchStart = 0; batchStart < activityWorkouts.length; batchStart += 8) {
      const batch = activityWorkouts.slice(batchStart, batchStart + 8);
      const converted = await Promise.allSettled(batch.map(async (workout) => {
        const sourceName = workout.sourceRevision.source.name || 'Apple 健康';
        const sourceBundleIdentifier = workout.sourceRevision.source.bundleIdentifier;
        const deviceName = workout.device?.name ?? workout.device?.model;
        const isGarmin = /garmin/i.test(`${sourceName} ${sourceBundleIdentifier} ${deviceName ?? ''} ${workout.device?.manufacturer ?? ''}`);
        let routePoints: Coordinate[] = [];
        try {
          const routes = await withTimeout(workout.getWorkoutRoutes(), 2500);
          routePoints = (routes ?? []).flatMap((route) => route.locations)
            .filter((location) => validCoordinate(location.latitude, location.longitude))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map((location) => ({ latitude: location.latitude, longitude: location.longitude }));
        } catch {
          routePoints = [];
        }
        const displayPoints = capRoutePoints(routePoints);
        const distanceKm = workout.totalDistance?.quantity === undefined
          ? undefined
          : workout.totalDistance.quantity / 1000;
        const durationSeconds = workout.duration?.quantity;
        return {
          id: `healthkit:${workout.uuid}`,
          source: isGarmin ? 'garmin' as const : 'apple-health' as const,
          sourceName,
          sourceBundleIdentifier,
          deviceName,
          sport: 'running' as const,
          startTime: new Date(workout.startDate).toISOString(),
          endTime: new Date(workout.endDate).toISOString(),
          distanceKm,
          durationSeconds,
          averagePaceSecondsPerKm: distanceKm && durationSeconds
            ? durationSeconds / distanceKm
            : undefined,
          calories: workout.totalEnergyBurned?.quantity,
          coordinateSystem: 'wgs84' as const,
          encodedPath: encodePolyline(displayPoints),
          originalPointCount: routePoints.length,
          displayPointCount: displayPoints.length,
          validationStatus: 'healthkit' as const,
        };
      }));
      converted.forEach((result) => {
        if (result.status === 'fulfilled') records.push(result.value);
      });
    }

    return {
      records,
      queriedWorkoutCount: workouts.length,
      matchedWorkoutCount: activityWorkouts.length,
      deletedRecordIds: response.deletedSamples.map((sample) => `healthkit:${sample.uuid}`),
      newAnchor: response.newAnchor,
    };
  } catch (error) {
    throw new Error(healthKitUnavailableMessage(error));
  }
}

export async function subscribeToHealthKitWorkouts(onChange: () => void) {
  if (!isHealthKitPlatformSupported()) return () => undefined;
  try {
    const healthKit = await import('@kingstinct/react-native-healthkit');
    const subscription = healthKit.subscribeToChanges(WORKOUT_TYPE, ({ errorMessage }) => {
      if (!errorMessage) onChange();
    });
    return () => { subscription.remove(); };
  } catch {
    return () => undefined;
  }
}
