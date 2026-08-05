type Coordinate = { latitude: number; longitude: number };

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outsideChina(latitude: number, longitude: number) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function transformLatitude(x: number, y: number) {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  value += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  value += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
  return value + (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
}

function transformLongitude(x: number, y: number) {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  value += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  value += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
  return value + (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
}

/** Converts OpenStreetMap / GPS WGS-84 coordinates for display on mainland-China map SDKs. */
export function wgs84ToGcj02({ latitude, longitude }: Coordinate): Coordinate {
  if (outsideChina(latitude, longitude)) return { latitude, longitude };
  const latitudeDelta = transformLatitude(longitude - 105, latitude - 35);
  const longitudeDelta = transformLongitude(longitude - 105, latitude - 35);
  const radians = latitude / 180 * PI;
  const magic = 1 - EE * Math.sin(radians) * Math.sin(radians);
  const sqrtMagic = Math.sqrt(magic);
  return {
    latitude: latitude + (latitudeDelta * 180) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI),
    longitude: longitude + (longitudeDelta * 180) / (A / sqrtMagic * Math.cos(radians) * PI),
  };
}
