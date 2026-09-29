# 跑城移动端

这是可运行在 iOS 与 Android 的 Expo / React Native 应用版本，而不是网页套壳。

## 运行

```bash
cd /Users/pandychen/.codex/.chatgpt-projects/g-p-6a6aaac805c8819189a7e88784f244f9/mobile
npm start
```

基础界面仍可通过 Expo Go 查看。Apple 健康属于 iOS 原生能力，必须安装跑城开发版或正式版；连接 iPhone 后执行 `npm run ios -- --device` 生成并安装开发版。

## 当前能力

- 50 个核心城市的搜索与切换
- 50 个城市各 10 条路线，共 500 条公开 OSM 路线轨迹
- F 型纵向路线选择、原生地图轨迹与起点标记
- 跑前信息卡片
- 本地导入个人跑步记录，并在推荐路线中标记“跑过”
- Apple 健康跑步记录自动增量同步，支持手机和 Apple Watch 的运动轨迹
- 识别 Garmin Connect 写入 Apple 健康的跑步摘要并标注 Garmin 来源
- 本次会话内收藏
- 跳转高德地图起点

当前路线库恢复自上一版本实际运行过的 Metro 缓存，保持 WGS-84 地图轨迹与高德 GCJ-02 起点转换分离。地图内显示不等于已经实跑通过；正式发布前仍须逐条完成 iOS、Android 和现场复核。

## 本地迁移咕咚跑步记录

迁移工具只在本机运行。账号和密码由用户在终端中临时输入，密码不会显示、不会进入命令历史，授权令牌不会被打印或保存。个人跑步记录写入 `private-data/codoon/`，该目录已被 Git 忽略。

先抽取最近 3 条跑步记录做轨迹检查：

```bash
cd /Users/pandychen/.codex/.chatgpt-projects/g-p-6a6aaac805c8819189a7e88784f244f9/mobile
npm run codoon:check
```

检查 `private-data/codoon/records.json` 和 `private-data/codoon/gpx/` 后，再导出全部跑步记录：

```bash
npm run codoon:export
```

导出完成后，将记录和轨迹整理为一个可由手机 App 选择的文件：

```bash
npm run codoon:build-import
```

生成文件为 `private-data/codoon/run-city-codoon-import.json`。通过隔空投送或“文件”App传到 iPhone，然后进入跑城的“我的 → 跑步记录”选择该文件。导入后数据只保存在手机本地。

生成文件时会同步比较个人轨迹与上海 10 条推荐路线。判定采用“单次跑步覆盖推荐路线”的方式：个人轨迹在约 50 米范围内覆盖推荐路线至少 20%，路线列表和详情才会显示“跑过”及重合比例。仅经过路线起点不会被标记。

工具使用咕咚的非官方接口，仅适合本人账户的一次性历史数据迁移。登录可能使咕咚 App 的现有登录状态失效；接口也可能随服务端更新而不可用。

## Apple 健康与 Garmin 自动同步

进入“我的 → Apple 健康 / Garmin”，点击“连接”并允许读取“训练”和“训练路线”。首次连接会同步历史跑步记录；以后 App 启动、回到前台或 HealthKit 收到新训练时会按锚点自动增量同步，记录只保存在 iPhone 的跑城沙盒中。

Apple Watch 和支持写入训练路线的手机 App 可以同步 GPS 轨迹。Garmin Connect 可以把训练、距离和时长写入 Apple 健康，但 Garmin 官方明确说明不会写入关联 GPS 轨迹，因此这些记录可能显示“无轨迹”。要自动取得 Garmin 的 GPX/FIT 并参与路线匹配，需要申请并获批 Garmin Connect Developer Program 的 Activity API。

该能力使用原生 HealthKit，不能在 Expo Go 中测试。iOS 工程由 Expo 配置自动加入 HealthKit 和后台交付 capability；本机首次编译前还需要安装 CocoaPods 并完成 Pods 安装。

## 路线库扩展

100 个中国大陆核心城市记录在 `src/data/coreCities.ts`：前 50 城为 500 条完整路线，新增 50 城先提供 150 条候选路线。候选路线在公开 OSM/GPX 轨迹通过地图对齐检查前，不绘制示例轨迹，也不开放起点导航。来源许可、GPX 导入、坐标系和地图对齐要求见 `store/route-production-spec.md`。

```bash
npm run build:app-routes
npm run validate:route -- /完整路径/route.gpx /完整路径/reference.geojson --threshold=30
```
