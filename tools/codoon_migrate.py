#!/usr/bin/env python3
"""One-time, local-only Codoon running history exporter.

The password is collected with getpass, kept only in memory, and sent directly
to Codoon over HTTPS. Access and refresh tokens are never printed or persisted.

This is an unofficial migration utility. It is intentionally separate from the
shipping mobile application and should not be used as an App Store sync API.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import gzip
import hashlib
import hmac
import json
import math
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


API_ORIGIN = "https://api.codoon.com"
CLIENT_ID = "099cce28c05f6c39ad5e04e51ed60704"
BASIC_AUTH = (
    "MDk5Y2NlMjhjMDVmNmMzOWFkNWUwNGU1MWVkNjA3MDQ6"
    "YzM5ZDNmYmVhMWU4NWJlY2VlNDFjMTk5N2FjZjBlMzY="
)
SIGNING_KEY = b"ecc140ad6e1e12f7d972af04add2c7ee"
DEVICE_ID = "24-ffffffff-faac-3052-0033-c5870033c587"
USER_AGENT = "CodoonSport(8.9.0 1170;Android 7;Sony XZ1)"
DAVINCI = "0"
SHANGHAI_TZ = timezone(timedelta(hours=8))
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "private-data" / "codoon"


class MigrationError(RuntimeError):
    pass


def json_body(payload: dict[str, Any]) -> str:
    # Matches the JSON representation used by the reference Codoon client.
    return json.dumps(payload, ensure_ascii=True)


def make_signature(
    authorization: str,
    path_url: str,
    body: str = "",
    timestamp: str = "0",
) -> str:
    path, separator, encoded_query = path_url.partition("?")
    query = urllib.parse.unquote(encoded_query) if separator else ""
    message = (
        f"Authorization={authorization}&Davinci={DAVINCI}&Did={DEVICE_ID}"
        f"&Timestamp={timestamp}|path={path}|body={body}|{query}"
    ).encode("utf-8")
    digest = hmac.new(SIGNING_KEY, message, hashlib.sha1).digest()
    return base64.b64encode(digest).decode("ascii")


def response_json(response: Any) -> dict[str, Any]:
    raw = response.read()
    if response.headers.get("Content-Encoding", "").lower() == "gzip":
        raw = gzip.decompress(raw)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MigrationError("咕咚返回了无法解析的数据。") from exc
    if not isinstance(value, dict):
        raise MigrationError("咕咚返回的数据结构不正确。")
    return value


def safe_error_description(data: dict[str, Any]) -> str:
    for key in ("description", "message", "error_description", "error"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:240]
    return "请确认账号、密码和网络连接后重试。"


class CodoonClient:
    def __init__(self) -> None:
        self.access_token = ""
        self.user_id = ""
        self.context = ssl.create_default_context()

    @staticmethod
    def base_headers() -> dict[str, str]:
        return {
            "User-Agent": USER_AGENT,
            "Did": DEVICE_ID,
            "Davinci": DAVINCI,
            "Accept": "application/json",
        }

    def send(self, request: urllib.request.Request) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(request, timeout=35, context=self.context) as response:
                return response_json(response)
        except urllib.error.HTTPError as exc:
            try:
                data = response_json(exc)
                message = safe_error_description(data)
            except Exception:
                message = f"HTTP {exc.code}"
            raise MigrationError(f"咕咚请求失败：{message}") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", None)
            raise MigrationError(f"无法连接咕咚服务器：{reason or '网络错误'}") from exc

    def login(self, account: str, password: str) -> None:
        params = [
            ("client_id", CLIENT_ID),
            ("email", account),
            ("grant_type", "password"),
            ("password", password),
            ("scope", "user"),
        ]
        path_url = "/token?" + urllib.parse.urlencode(params)
        authorization = "Basic " + BASIC_AUTH
        headers = self.base_headers()
        headers.update(
            {
                "Authorization": authorization,
                "Timestamp": "0",
                "Signature": make_signature(authorization, path_url),
            }
        )
        data = self.send(
            urllib.request.Request(API_ORIGIN + path_url, headers=headers, method="GET")
        )
        if data.get("status") == "Error":
            raise MigrationError(f"登录失败：{safe_error_description(data)}")
        token = data.get("access_token")
        user_id = data.get("user_id")
        if not isinstance(token, str) or not token or user_id is None:
            raise MigrationError("登录失败：咕咚没有返回有效授权信息。")
        self.access_token = token
        self.user_id = str(user_id)

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.access_token:
            raise MigrationError("尚未登录咕咚。")
        body = json_body(payload)
        timestamp = str(int(time.time()))
        authorization = "Bearer " + self.access_token
        headers = self.base_headers()
        headers.update(
            {
                "Authorization": authorization,
                "Timestamp": timestamp,
                "Signature": make_signature(authorization, path, body, timestamp),
                "Content-Type": "application/json; charset=utf-8",
            }
        )
        request = urllib.request.Request(
            API_ORIGIN + path,
            data=body.encode("utf-8"),
            headers=headers,
            method="POST",
        )
        return self.send(request)

    def list_running_records(self) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        page = 1
        while page <= 100:
            result = self.post(
                "/api/get_old_route_log",
                {"limit": 500, "page": page, "user_id": self.user_id},
            )
            data = result.get("data")
            if not isinstance(data, dict):
                raise MigrationError("无法读取咕咚运动记录列表。")
            page_records = data.get("log_list")
            if not isinstance(page_records, list):
                raise MigrationError("咕咚运动记录列表格式不正确。")
            records.extend(
                item
                for item in page_records
                if isinstance(item, dict) and str(item.get("sports_type")) == "1"
            )
            if not data.get("has_more"):
                break
            page += 1
        else:
            raise MigrationError("运动记录分页异常，已停止以避免重复请求。")

        records.sort(key=lambda item: str(item.get("start_time", "")), reverse=True)
        return records

    def get_record(self, route_id: Any) -> dict[str, Any]:
        result = self.post("/api/get_single_log", {"route_id": route_id})
        data = result.get("data")
        if not isinstance(data, dict):
            raise MigrationError("单条运动记录格式不正确。")
        return data


def as_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def parse_local_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return parsed.replace(tzinfo=SHANGHAI_TZ) if parsed.tzinfo is None else parsed


def gpx_timestamp(value: Any) -> str | None:
    parsed = parse_local_time(value)
    if not parsed:
        return None
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class TrackPoint:
    latitude: float
    longitude: float
    elevation: float | None
    timestamp: str | None


def track_points(raw_points: Any) -> list[TrackPoint]:
    if not isinstance(raw_points, list):
        return []
    result: list[TrackPoint] = []
    for raw in raw_points:
        if not isinstance(raw, dict):
            continue
        latitude = as_float(raw.get("latitude"))
        longitude = as_float(raw.get("longitude"))
        if latitude is None or longitude is None:
            continue
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            continue
        result.append(
            TrackPoint(
                latitude=latitude,
                longitude=longitude,
                elevation=as_float(raw.get("elevation")),
                timestamp=gpx_timestamp(raw.get("time_stamp")),
            )
        )
    return result


def haversine_km(a: TrackPoint, b: TrackPoint) -> float:
    radius_km = 6371.0088
    lat1 = math.radians(a.latitude)
    lat2 = math.radians(b.latitude)
    delta_lat = lat2 - lat1
    delta_lon = math.radians(b.longitude - a.longitude)
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * radius_km * math.asin(min(1.0, math.sqrt(value)))


def track_distance_km(points: list[TrackPoint]) -> float:
    return sum(haversine_km(a, b) for a, b in zip(points, points[1:]))


def average_heart_rate(value: Any) -> float | None:
    if not isinstance(value, dict):
        return None
    readings = [number for item in value.values() if (number := as_float(item)) is not None]
    return round(sum(readings) / len(readings), 1) if readings else None


def write_private_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    try:
        temporary.chmod(0o600)
    except OSError:
        pass
    temporary.replace(path)


def write_gpx(path: Path, record_id: str, start_time: Any, points: list[TrackPoint]) -> None:
    ET.register_namespace("", "http://www.topografix.com/GPX/1/1")
    root = ET.Element(
        "{http://www.topografix.com/GPX/1/1}gpx",
        {
            "version": "1.1",
            "creator": "Run City Codoon local migration",
        },
    )
    metadata = ET.SubElement(root, "{http://www.topografix.com/GPX/1/1}metadata")
    ET.SubElement(metadata, "{http://www.topografix.com/GPX/1/1}name").text = (
        f"Codoon run {record_id}"
    )
    track = ET.SubElement(root, "{http://www.topografix.com/GPX/1/1}trk")
    ET.SubElement(track, "{http://www.topografix.com/GPX/1/1}name").text = (
        f"咕咚跑步 {start_time or record_id}"
    )
    ET.SubElement(track, "{http://www.topografix.com/GPX/1/1}type").text = "running"
    segment = ET.SubElement(track, "{http://www.topografix.com/GPX/1/1}trkseg")
    for point in points:
        node = ET.SubElement(
            segment,
            "{http://www.topografix.com/GPX/1/1}trkpt",
            {"lat": f"{point.latitude:.8f}", "lon": f"{point.longitude:.8f}"},
        )
        if point.elevation is not None:
            ET.SubElement(node, "{http://www.topografix.com/GPX/1/1}ele").text = (
                f"{point.elevation:.2f}"
            )
        if point.timestamp:
            ET.SubElement(node, "{http://www.topografix.com/GPX/1/1}time").text = point.timestamp
    xml = ET.tostring(root, encoding="unicode", xml_declaration=True)
    write_private_text(path, xml)


def validation_for(points: list[TrackPoint], reported_distance_km: float | None) -> dict[str, Any]:
    measured = track_distance_km(points) if len(points) > 1 else 0.0
    delta_percent = None
    if reported_distance_km and reported_distance_km > 0:
        delta_percent = abs(measured - reported_distance_km) / reported_distance_km * 100

    in_mainland_bounds = all(3 <= point.latitude <= 54 and 73 <= point.longitude <= 136 for point in points)
    if len(points) < 2:
        status = "no-route"
        notes = ["没有可用的 GPS 轨迹点"]
    else:
        notes = []
        if not in_mainland_bounds:
            notes.append("部分坐标不在中国大陆常用范围内")
        if delta_percent is not None and delta_percent > 35:
            notes.append("轨迹计算距离与咕咚里程差异较大")
        status = "warning" if notes else "passed"

    return {
        "status": status,
        "pointCount": len(points),
        "trackDistanceKm": round(measured, 3),
        "reportedDistanceDeltaPercent": round(delta_percent, 1) if delta_percent is not None else None,
        "notes": notes,
    }


def record_summary(record: dict[str, Any], gpx_relative_path: str | None) -> dict[str, Any]:
    record_id = str(record.get("id", ""))
    length_m = as_float(record.get("total_length"))
    duration_seconds = as_float(record.get("total_time"))
    distance_km = length_m / 1000 if length_m is not None else None
    points = track_points(record.get("points"))
    pace = None
    if duration_seconds is not None and distance_km and distance_km > 0:
        pace = duration_seconds / distance_km
    return {
        "id": record_id,
        "source": "codoon",
        "sport": "running",
        "startTime": record.get("start_time"),
        "endTime": record.get("end_time"),
        "distanceKm": round(distance_km, 3) if distance_km is not None else None,
        "durationSeconds": round(duration_seconds) if duration_seconds is not None else None,
        "averagePaceSecondsPerKm": round(pace) if pace is not None else None,
        "calories": as_float(record.get("total_calories")),
        "averageHeartRate": average_heart_rate(record.get("heart_rate")),
        "startCoordinate": (
            {"latitude": points[0].latitude, "longitude": points[0].longitude}
            if points
            else None
        ),
        "coordinateSystem": "wgs84-unverified",
        "gpxFile": gpx_relative_path,
        "validation": validation_for(points, distance_km),
    }


def load_existing(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    records = data.get("records") if isinstance(data, dict) else None
    if not isinstance(records, list):
        return {}
    return {
        str(item.get("id")): item
        for item in records
        if isinstance(item, dict) and item.get("id") is not None
    }


def save_manifest(path: Path, records: Iterable[dict[str, Any]]) -> None:
    sorted_records = sorted(records, key=lambda item: str(item.get("startTime", "")), reverse=True)
    payload = {
        "schemaVersion": 1,
        "source": "codoon",
        "exportedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "privacy": "local-only",
        "records": sorted_records,
    }
    write_private_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="本地导出本人咕咚跑步记录和 GPX 轨迹")
    parser.add_argument("--limit", type=int, help="只处理最近 N 条跑步记录")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="本地私有输出目录")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.limit is not None and args.limit <= 0:
        raise MigrationError("--limit 必须大于 0。")

    print("跑城 · 咕咚本地一次性迁移")
    print("账号和密码只用于本次连接，不会保存。")
    account = input("咕咚手机号或邮箱：").strip()
    if not account:
        raise MigrationError("账号不能为空。")
    password = getpass.getpass("咕咚密码（输入时不会显示）：")
    if not password:
        raise MigrationError("密码不能为空。")

    client = CodoonClient()
    print("正在登录咕咚……")
    try:
        client.login(account, password)
    finally:
        password = ""
    print("登录成功，正在读取跑步记录列表……")

    records = client.list_running_records()
    if args.limit is not None:
        records = records[: args.limit]
    print(f"本次将处理 {len(records)} 条跑步记录。")

    output_dir = args.output.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest_path = output_dir / "records.json"
    summaries = load_existing(manifest_path)

    for index, list_record in enumerate(records, start=1):
        log_id = str(list_record.get("log_id", ""))
        route_id = list_record.get("route_id")
        if not log_id or route_id is None:
            print(f"[{index}/{len(records)}] 跳过缺少编号的记录")
            continue
        print(f"[{index}/{len(records)}] 下载记录 {log_id}……")
        detail = client.get_record(route_id)
        detail["id"] = log_id
        points = track_points(detail.get("points"))
        relative_path = None
        if points:
            relative_path = f"gpx/{log_id}.gpx"
            write_gpx(output_dir / relative_path, log_id, detail.get("start_time"), points)
        summaries[log_id] = record_summary(detail, relative_path)
        save_manifest(manifest_path, summaries.values())

    passed = sum(
        item.get("validation", {}).get("status") == "passed" for item in summaries.values()
    )
    warning = sum(
        item.get("validation", {}).get("status") == "warning" for item in summaries.values()
    )
    no_route = sum(
        item.get("validation", {}).get("status") == "no-route" for item in summaries.values()
    )
    print("\n迁移文件已保存在：")
    print(output_dir)
    print(f"当前共 {len(summaries)} 条：通过 {passed}，待检查 {warning}，无轨迹 {no_route}。")
    print("下一步不要上传该目录；由跑城 App 的本地导入流程读取。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n已取消，没有保存账号或密码。", file=sys.stderr)
        raise SystemExit(130)
    except MigrationError as exc:
        print(f"\n迁移失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
