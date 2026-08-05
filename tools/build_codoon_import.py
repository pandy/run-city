#!/usr/bin/env python3
"""Build one compact, on-device import file from local Codoon GPX exports."""

from __future__ import annotations

import argparse
import json
import math
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = PROJECT_ROOT / "private-data" / "codoon"
DEFAULT_OUTPUT = DEFAULT_SOURCE / "run-city-codoon-import.json"
ROUTE_LIBRARY = PROJECT_ROOT / "src" / "data" / "fullRouteLibrary.generated.ts"
ROUTE_OVERRIDES = PROJECT_ROOT / "src" / "data" / "curatedRouteOverrides.generated.ts"
GPX_NAMESPACE = {"g": "http://www.topografix.com/GPX/1/1"}
MATCH_DISTANCE_METERS = 50.0
MATCH_THRESHOLD = 0.20
MATCH_SAMPLE_METERS = 25.0


def project_xy(point: tuple[float, float], reference_latitude: float) -> tuple[float, float]:
    latitude, longitude = point
    return (
        longitude * 111_320 * math.cos(math.radians(reference_latitude)),
        latitude * 110_540,
    )


def point_segment_distance(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    x, y = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    ratio = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + ratio * dx), y - (y1 + ratio * dy))


def simplify(points: list[tuple[float, float]], tolerance_meters: float) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points
    reference_latitude = sum(point[0] for point in points) / len(points)
    projected = [project_xy(point, reference_latitude) for point in points]
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start_index, end_index = stack.pop()
        maximum_distance = 0.0
        maximum_index = None
        for index in range(start_index + 1, end_index):
            distance = point_segment_distance(
                projected[index], projected[start_index], projected[end_index]
            )
            if distance > maximum_distance:
                maximum_distance = distance
                maximum_index = index
        if maximum_index is not None and maximum_distance > tolerance_meters:
            keep.add(maximum_index)
            stack.append((start_index, maximum_index))
            stack.append((maximum_index, end_index))
    return [points[index] for index in sorted(keep)]


def cap_points(points: list[tuple[float, float]], maximum: int) -> list[tuple[float, float]]:
    if len(points) <= maximum:
        return points
    indices = {round(index * (len(points) - 1) / (maximum - 1)) for index in range(maximum)}
    return [points[index] for index in sorted(indices)]


def encode_polyline(points: list[tuple[float, float]]) -> str:
    output: list[str] = []
    previous_latitude = 0
    previous_longitude = 0
    for latitude, longitude in points:
        latitude_value = round(latitude * 100_000)
        longitude_value = round(longitude * 100_000)
        for delta in (
            latitude_value - previous_latitude,
            longitude_value - previous_longitude,
        ):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                output.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            output.append(chr(value + 63))
        previous_latitude = latitude_value
        previous_longitude = longitude_value
    return "".join(output)


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    index = 0
    latitude = 0
    longitude = 0
    while index < len(encoded):
        deltas: list[int] = []
        for _ in range(2):
            result = 0
            shift = 0
            while True:
                if index >= len(encoded):
                    return points
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        latitude += deltas[0]
        longitude += deltas[1]
        points.append((latitude / 100_000, longitude / 100_000))
    return points


def parse_typescript_json(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    start = text.index("{", text.index("export const"))
    end = text.rfind("} as const;")
    if end < start:
        raise ValueError(f"无法读取路线数据：{path}")
    return json.loads(text[start : end + 1])


def polyline_length_meters(points: list[tuple[float, float]]) -> float:
    if len(points) < 2:
        return 0.0
    reference_latitude = sum(point[0] for point in points) / len(points)
    projected = [project_xy(point, reference_latitude) for point in points]
    return sum(
        math.hypot(end[0] - start[0], end[1] - start[1])
        for start, end in zip(projected, projected[1:])
    )


def resample_polyline(
    points: list[tuple[float, float]], spacing_meters: float
) -> list[tuple[float, float]]:
    if len(points) < 2:
        return points
    reference_latitude = sum(point[0] for point in points) / len(points)
    projected = [project_xy(point, reference_latitude) for point in points]
    output = [points[0]]
    remaining = spacing_meters
    for index, (start, end) in enumerate(zip(projected, projected[1:])):
        segment_start = start
        segment_latitude, segment_longitude = points[index]
        end_latitude, end_longitude = points[index + 1]
        segment_length = math.hypot(end[0] - segment_start[0], end[1] - segment_start[1])
        while segment_length >= remaining and segment_length > 0:
            ratio = remaining / segment_length
            segment_latitude += (end_latitude - segment_latitude) * ratio
            segment_longitude += (end_longitude - segment_longitude) * ratio
            output.append((segment_latitude, segment_longitude))
            segment_start = project_xy((segment_latitude, segment_longitude), reference_latitude)
            segment_length = math.hypot(end[0] - segment_start[0], end[1] - segment_start[1])
            remaining = spacing_meters
        remaining -= segment_length
    if output[-1] != points[-1]:
        output.append(points[-1])
    return output


def bbox(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    latitudes = [point[0] for point in points]
    longitudes = [point[1] for point in points]
    return min(latitudes), min(longitudes), max(latitudes), max(longitudes)


def boxes_intersect(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
    margin_degrees: float = 0.01,
) -> bool:
    return not (
        first[2] < second[0] - margin_degrees
        or first[0] > second[2] + margin_degrees
        or first[3] < second[1] - margin_degrees
        or first[1] > second[3] + margin_degrees
    )


def route_coverage(
    route_points: list[tuple[float, float]], personal_points: list[tuple[float, float]]
) -> float:
    if len(route_points) < 2 or len(personal_points) < 2:
        return 0.0
    reference_latitude = sum(point[0] for point in route_points) / len(route_points)
    route_samples = resample_polyline(route_points, MATCH_SAMPLE_METERS)
    personal_samples = resample_polyline(personal_points, MATCH_SAMPLE_METERS)
    cell_size = MATCH_DISTANCE_METERS
    grid: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for point in personal_samples:
        x, y = project_xy(point, reference_latitude)
        cell = (math.floor(x / cell_size), math.floor(y / cell_size))
        grid.setdefault(cell, []).append((x, y))
    covered = 0
    maximum_squared = MATCH_DISTANCE_METERS * MATCH_DISTANCE_METERS
    for point in route_samples:
        x, y = project_xy(point, reference_latitude)
        cell_x = math.floor(x / cell_size)
        cell_y = math.floor(y / cell_size)
        found = False
        for offset_x in (-1, 0, 1):
            for offset_y in (-1, 0, 1):
                if any(
                    (candidate_x - x) ** 2 + (candidate_y - y) ** 2 <= maximum_squared
                    for candidate_x, candidate_y in grid.get((cell_x + offset_x, cell_y + offset_y), [])
                ):
                    found = True
                    break
            if found:
                break
        covered += int(found)
    return covered / len(route_samples) if route_samples else 0.0


def shanghai_route_matches(compact: list[dict[str, Any]]) -> list[dict[str, Any]]:
    library = parse_typescript_json(ROUTE_LIBRARY)
    overrides = parse_typescript_json(ROUTE_OVERRIDES)
    routes = library.get("shanghai", [])
    xuhui_override = overrides.get("xuhuiRiverside", {})
    personal_tracks = []
    for record in compact:
        encoded_path = record.get("encodedPath")
        if not isinstance(encoded_path, str) or not encoded_path:
            continue
        points = decode_polyline(encoded_path)
        if len(points) > 1:
            personal_tracks.append((record, points, bbox(points)))

    matches: list[dict[str, Any]] = []
    for route in routes:
        if not isinstance(route, dict):
            continue
        coordinates = route.get("coordinates")
        if route.get("id") == xuhui_override.get("id"):
            coordinates = xuhui_override.get("coordinates")
        if not isinstance(coordinates, list):
            continue
        route_points = [
            (float(point["latitude"]), float(point["longitude"]))
            for point in coordinates
            if isinstance(point, dict) and "latitude" in point and "longitude" in point
        ]
        if len(route_points) < 2:
            continue
        route_box = bbox(route_points)
        best_record: dict[str, Any] | None = None
        best_coverage = 0.0
        for record, personal_points, personal_box in personal_tracks:
            if not boxes_intersect(route_box, personal_box):
                continue
            coverage = route_coverage(route_points, personal_points)
            if coverage > best_coverage:
                best_coverage = coverage
                best_record = record
        geometry_km = polyline_length_meters(route_points) / 1000
        match = {
            "routeId": route.get("id"),
            "routeName": xuhui_override.get("name") if route.get("id") == xuhui_override.get("id") else route.get("name"),
            "overlapPercent": round(best_coverage * 100, 1),
            "matchedDistanceKm": round(best_coverage * geometry_km, 2),
            "matched": best_coverage >= MATCH_THRESHOLD,
        }
        if best_record:
            match.update({
                "runId": best_record.get("id"),
                "runDate": best_record.get("startTime"),
                "runDistanceKm": best_record.get("distanceKm"),
            })
        matches.append(match)
    return matches


def read_gpx(path: Path) -> list[tuple[float, float]]:
    root = ET.parse(path).getroot()
    points = []
    for node in root.findall(".//g:trkpt", GPX_NAMESPACE):
        try:
            points.append((float(node.attrib["lat"]), float(node.attrib["lon"])))
        except (KeyError, TypeError, ValueError):
            continue
    return points


def compact_record(
    source: Path,
    record: dict[str, Any],
    tolerance_meters: float,
    maximum_points: int,
) -> dict[str, Any]:
    validation = record.get("validation") if isinstance(record.get("validation"), dict) else {}
    delta_percent = validation.get("reportedDistanceDeltaPercent")
    route_is_usable = validation.get("status") != "no-route" and not (
        isinstance(delta_percent, (int, float)) and delta_percent > 35
    )
    gpx_file = record.get("gpxFile")
    points: list[tuple[float, float]] = []
    if route_is_usable and isinstance(gpx_file, str) and gpx_file:
        path = source / gpx_file
        if path.exists():
            points = read_gpx(path)
    simplified = cap_points(simplify(points, tolerance_meters), maximum_points)
    return {
        "id": str(record.get("id", "")),
        "source": "codoon",
        "sport": "running",
        "startTime": record.get("startTime"),
        "endTime": record.get("endTime"),
        "distanceKm": record.get("distanceKm"),
        "durationSeconds": record.get("durationSeconds"),
        "averagePaceSecondsPerKm": record.get("averagePaceSecondsPerKm"),
        "calories": record.get("calories"),
        "averageHeartRate": record.get("averageHeartRate"),
        "coordinateSystem": "wgs84",
        "encodedPath": encode_polyline(simplified),
        "originalPointCount": len(points),
        "displayPointCount": len(simplified),
        "validationStatus": validation.get("status"),
        "routeStatus": "verified" if points else "unavailable",
    }


def private_write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    try:
        temporary.chmod(0o600)
    except OSError:
        pass
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成跑城手机端咕咚记录导入文件")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--tolerance", type=float, default=6.0, help="轨迹简化误差（米）")
    parser.add_argument("--max-points", type=int, default=700, help="每条记录最多显示点数")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = args.source / "records.json"
    if not manifest_path.exists():
        raise SystemExit(f"找不到导出记录：{manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    records = manifest.get("records")
    if not isinstance(records, list):
        raise SystemExit("records.json 格式不正确")
    compact = [
        compact_record(args.source, record, args.tolerance, args.max_points)
        for record in records
        if isinstance(record, dict) and record.get("id") is not None
    ]
    payload = {
        "schemaVersion": 1,
        "source": "codoon",
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "recordCount": len(compact),
        "routeMatchRule": {
            "cityId": "shanghai",
            "thresholdPercent": round(MATCH_THRESHOLD * 100),
            "corridorMeters": round(MATCH_DISTANCE_METERS),
            "method": "single-activity-route-coverage",
        },
        "routeMatches": shanghai_route_matches(compact),
        "records": compact,
    }
    private_write(args.output, payload)
    route_count = sum(bool(record["encodedPath"]) for record in compact)
    print(f"已生成 {len(compact)} 条跑步记录，其中 {route_count} 条包含地图轨迹。")
    matched_routes = [match for match in payload["routeMatches"] if match["matched"]]
    print(f"上海路线匹配：{len(matched_routes)}/10 条达到 {MATCH_THRESHOLD:.0%} 重合标准。")
    for match in payload["routeMatches"]:
        marker = "跑过" if match["matched"] else "未达到"
        print(f"  {marker} {match['routeName']}：{match['overlapPercent']:.1f}%")
    print(args.output.resolve())
    print(f"文件大小：{args.output.stat().st_size / 1024 / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
