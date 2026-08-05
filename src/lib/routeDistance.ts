import { wgs84ToGcj02 } from './coordinates';

export type LocationCoordinate = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_KM = 6371.0088;
const radians = (degrees: number) => degrees * Math.PI / 180;

function angularDistance(start: LocationCoordinate, end: LocationCoordinate) {
  const latitudeDelta = radians(end.latitude - start.latitude);
  const longitudeDelta = radians(end.longitude - start.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(start.latitude)) * Math.cos(radians(end.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function initialBearing(start: LocationCoordinate, end: LocationCoordinate) {
  const startLatitude = radians(start.latitude);
  const endLatitude = radians(end.latitude);
  const longitudeDelta = radians(end.longitude - start.longitude);
  return Math.atan2(
    Math.sin(longitudeDelta) * Math.cos(endLatitude),
    Math.cos(startLatitude) * Math.sin(endLatitude)
      - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDelta),
  );
}

function distanceToSegmentKm(
  location: LocationCoordinate,
  start: LocationCoordinate,
  end: LocationCoordinate,
) {
  const segmentAngularDistance = angularDistance(start, end);
  if (segmentAngularDistance < 1e-12) return angularDistance(location, start) * EARTH_RADIUS_KM;

  const locationAngularDistance = angularDistance(start, location);
  const bearingDelta = initialBearing(start, location) - initialBearing(start, end);
  const crossTrackAngularDistance = Math.asin(Math.max(-1, Math.min(
    1,
    Math.sin(locationAngularDistance) * Math.sin(bearingDelta),
  )));
  const alongTrackAngularDistance = Math.atan2(
    Math.sin(locationAngularDistance) * Math.cos(bearingDelta),
    Math.cos(locationAngularDistance),
  );
  if (alongTrackAngularDistance < 0 || alongTrackAngularDistance > segmentAngularDistance) {
    return Math.min(
      angularDistance(location, start) * EARTH_RADIUS_KM,
      angularDistance(location, end) * EARTH_RADIUS_KM,
    );
  }
  return Math.abs(crossTrackAngularDistance) * EARTH_RADIUS_KM;
}

function distanceToPolylineKm(location: LocationCoordinate, coordinates: ReadonlyArray<LocationCoordinate>) {
  if (!coordinates.length) return Infinity;

  if (coordinates.length === 1) {
    return angularDistance(location, coordinates[0]) * EARTH_RADIUS_KM;
  }

  let nearestKm = Infinity;
  for (let index = 1; index < coordinates.length; index += 1) {
    nearestKm = Math.min(nearestKm, distanceToSegmentKm(
      location,
      coordinates[index - 1],
      coordinates[index],
    ));
  }
  return nearestKm;
}

/**
 * Returns the straight-line distance from the device to the nearest point on
 * the route. Mainland iOS location coordinates can follow either WGS-84 or
 * GCJ-02 depending on the runtime, so both route representations are checked.
 */
export function distanceFromLocationToRouteKm(
  location: LocationCoordinate,
  routeCoordinates: ReadonlyArray<LocationCoordinate>,
) {
  const wgsDistance = distanceToPolylineKm(location, routeCoordinates);
  const gcjDistance = distanceToPolylineKm(location, routeCoordinates.map(wgs84ToGcj02));
  return Math.min(wgsDistance, gcjDistance);
}

export function formatLocationDistanceKm(distanceKm: number) {
  if (!Number.isFinite(distanceKm)) return '—';
  if (distanceKm < 0.05) return '<0.1 km';
  if (distanceKm < 100) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm)} km`;
}
