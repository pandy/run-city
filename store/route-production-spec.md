# 50 城 × 10 路线数据生产规范

目标是建立 500 条可发布跑步路线，而不是批量填充地图折线。城市名单见 `src/data/coreCities.ts`；一期先完成其中 16 城，每城 10 条。

## 每城 10 条的组合

每个城市优先覆盖：2 条江河/湖滨、2 条公园环线、2 条城市地标、2 条日常绿道、1 条夜跑、1 条周末长距离。路线应避免同质化，并至少包含 3 个距离档：3–5 km、6–10 km、10 km 以上。

## 可接受的数据来源

1. 作者明确以 CC0、CC BY、CC BY-SA 或书面协议授权再分发的 GPX。
2. 自行实跑或由签约跑者交付，并由贡献者协议授权的 GPX。
3. OpenStreetMap 的开放道路、步道或关系数据（ODbL），用于生成参考线或路线；发布时保留 `© OpenStreetMap contributors` 署名。

“能下载”的 Strava、Komoot、AllTrails、Plotaroute 等用户文件，若没有明确的再分发许可，不可入库。

## 必过的 6 道门

1. **城市与主题**：路线属于目标城市，且填补该城市的 10 类组合。
2. **许可**：记录原始链接、作者、许可证、抓取日期；没有明确许可即拒绝。
3. **坐标系**：主数据统一保存 WGS-84；高德等中国地图的 GCJ-02 仅在跳转链接层转换，绝不写回原始 GPX。
4. **几何对齐**：用同为 WGS-84 的 OSM 参考线运行 `npm run validate:route`。通过标准：至少 90% 采样点在 30 m 内，P95 偏差不超过 60 m。
5. **地图复核**：在 iOS 和 Android 各截一张目标地图底图截图；检查起终点、主要转弯、整条轮廓均贴合道路/公园范围。发现统一方向偏移，先排查坐标系，禁止直接“手工平移”。
6. **实跑与安全**：实跑确认封闭路段、过街、夜间照明、补给与开放时段；记录核验人和复核截止日期。

只有全部通过的路线状态才可以是 `published`。任何一项缺失只能是 `candidate` 或 `needs_review`。

## 最小路线记录

```json
{
  "id": "shanghai-century-park-01",
  "cityId": "shanghai",
  "name": "世纪公园环线",
  "sourceUrl": "https://…",
  "license": "ODbL",
  "coordinateSystem": "WGS-84",
  "geometryReferenceUrl": "https://www.openstreetmap.org/relation/…",
  "alignment": { "status": "pass", "medianMeters": 8, "p95Meters": 24 },
  "mapReview": { "ios": "pass", "android": "pass" },
  "fieldReview": { "status": "pass", "reviewedAt": "2026-07-30" },
  "status": "published"
}
```

## 质检命令

```bash
npm run inspect:gpx -- /完整路径/route.gpx
npm run validate:route -- /完整路径/route.gpx /完整路径/reference.geojson --threshold=30
```

第二条命令只会通过坐标几何比对；它不替代人工地图截图和实跑复核。
