export type RouteCandidate = {
  id: string;
  cityId: 'beijing' | 'shanghai' | 'guangzhou' | 'shenzhen';
  name: string;
  theme: 'park' | 'waterfront' | 'landmark' | 'greenway' | 'night' | 'long';
  targetDistanceKm: number;
  evidenceUrl: string;
  geometrySource: 'osm';
  license: 'ODbL';
  status: 'needs_gpx_match' | 'needs_map_review' | 'geometry_verified_needs_map_review';
};

const sources = {
  beijing: 'https://mp.visitbeijing.com.cn/a1/48AKetvfWqa',
  shanghai: 'https://english.shanghai.gov.cn/en-FitnessWellness/20231216/828b21fb57134560b92db804720670a2.html',
  shanghaiNew: 'https://english.shanghai.gov.cn/en-Fitness/20251204/32500eb3154848cd81cb070058c00f79.html',
  guangzhou: 'https://www.gz.gov.cn/zt/mlxgzjqswy/hyychltx/hdzx/content/post_10367912.html',
  guangzhouErsha: 'https://sthjj.gz.gov.cn/mlzg/sfyb/mlxb/content/post_10055677.html',
  shenzhenDasha: 'https://www.sz.gov.cn/en_szgov/news/infocus/park/csgy/content/post_11054575.html',
  shenzhenTalent: 'https://www.sz.gov.cn/en_szgov/news/infocus/park/szld/content/post_10876592.html',
};

const candidate = (cityId: RouteCandidate['cityId'], id: string, name: string, theme: RouteCandidate['theme'], targetDistanceKm: number, evidenceUrl: string, status: RouteCandidate['status'] = 'needs_gpx_match'): RouteCandidate => ({
  id: `${cityId}-${id}`,
  cityId,
  name,
  theme,
  targetDistanceKm,
  evidenceUrl,
  geometrySource: 'osm',
  license: 'ODbL',
  status,
});

export const phase1RouteCandidates: RouteCandidate[] = [
  candidate('beijing', 'olympic-south-5k', '奥森南园智慧跑道', 'park', 5, sources.beijing, 'geometry_verified_needs_map_review'),
  candidate('beijing', 'olympic-10k', '奥森南北园 10K', 'long', 10, sources.beijing),
  candidate('beijing', 'chaoyang-park', '朝阳公园环线', 'park', 6, sources.beijing),
  candidate('beijing', 'forbidden-city-moat', '故宫筒子河环线', 'landmark', 5, sources.beijing),
  candidate('beijing', 'temple-of-heaven', '天坛外坛环线', 'landmark', 5, sources.beijing),
  candidate('beijing', 'summer-palace', '颐和园昆明湖环线', 'waterfront', 8, sources.beijing),
  candidate('beijing', 'yuyuantan', '玉渊潭公园环线', 'park', 5, sources.beijing),
  candidate('beijing', 'kunyu-river', '昆玉河滨水线', 'waterfront', 10, sources.beijing),
  candidate('beijing', 'southeast-moat', '东南二环护城河线', 'greenway', 8, sources.beijing),
  candidate('beijing', 'central-axis-night', '奥林匹克中轴夜跑', 'night', 7, sources.beijing),

  candidate('shanghai', 'century-park', '世纪公园 5K 环线', 'park', 5, sources.shanghaiNew, 'needs_map_review'),
  candidate('shanghai', 'xuhui-riverside', '徐汇滨江往返线', 'waterfront', 7, sources.shanghaiNew),
  candidate('shanghai', 'suzhou-creek', '苏州河城市长跑', 'waterfront', 12, sources.shanghai),
  candidate('shanghai', 'expo-avenue', '世博大道—后滩公园', 'landmark', 7, sources.shanghai),
  candidate('shanghai', 'old-pier', '老码头—外滩南段', 'landmark', 5, sources.shanghai),
  candidate('shanghai', 'zhongshan-park', '中山公园环线', 'park', 4, sources.shanghai),
  candidate('shanghai', 'daning-park', '大宁公园环线', 'park', 5, sources.shanghai),
  candidate('shanghai', 'changfeng-park', '长风公园环湖线', 'park', 5, sources.shanghai),
  candidate('shanghai', 'huangpu-night', '黄浦滨江夜跑', 'night', 8, sources.shanghai),
  candidate('shanghai', 'haiwan-forest', '海湾森林公园绿意线', 'long', 6.5, sources.shanghaiNew),

  candidate('guangzhou', 'ersha-island', '二沙岛环岛碧道', 'waterfront', 7.3, sources.guangzhouErsha),
  candidate('guangzhou', 'tianhe-park', '天河公园绿道', 'park', 5, sources.guangzhou, 'needs_map_review'),
  candidate('guangzhou', 'zhujiang-park', '珠江公园环线', 'park', 4, sources.guangzhou),
  candidate('guangzhou', 'yuexiu-park', '越秀公园山水线', 'landmark', 5, sources.guangzhou),
  candidate('guangzhou', 'dafu-mountain', '大夫山森林公园长跑', 'long', 12, sources.guangzhou),
  candidate('guangzhou', 'haizhu-lake', '海珠湖环湖线', 'waterfront', 6, 'https://sthjj.gz.gov.cn/gkmlpt/content/10/10272/mpost_10272222.html'),
  candidate('guangzhou', 'linjiang-avenue', '临江大道缓跑径', 'waterfront', 8, 'https://www.gz.gov.cn/zwgk/fggw/sfbgtwj/content/mpost_9224696.html'),
  candidate('guangzhou', 'baiyun-luhu', '麓湖—白云山绿意线', 'greenway', 10, 'https://gz.gov.cn/zwgk/fggw/sfbgtwj/content/post_8401222.html'),
  candidate('guangzhou', 'haixin-bridge-night', '海心桥—花城广场夜跑', 'night', 6, sources.guangzhouErsha),
  candidate('guangzhou', 'yuejiang-greenway', '阅江路碧道', 'greenway', 8, 'https://www.gz.gov.cn/zlgz/tsgz/content/post_7281473.html'),

  candidate('shenzhen', 'shenzhen-bay', '深圳湾滨海长廊', 'waterfront', 13, sources.shenzhenDasha),
  candidate('shenzhen', 'talent-park', '人才公园环湖线', 'park', 2.55, sources.shenzhenTalent, 'needs_map_review'),
  candidate('shenzhen', 'dasha-river', '大沙河生态长廊全线', 'long', 13.7, sources.shenzhenDasha),
  candidate('shenzhen', 'dasha-talent-night', '大沙河—人才公园夜跑', 'night', 6.5, sources.shenzhenDasha),
  candidate('shenzhen', 'lianhuashan', '莲花山公园环线', 'park', 5, 'https://zjj.sz.gov.cn/xxgk/gzdt/content/post_12662934.html'),
  candidate('shenzhen', 'xiangmi-park', '香蜜公园绿道', 'park', 5, 'https://zjj.sz.gov.cn/xxgk/gzdt/content/post_12662934.html'),
  candidate('shenzhen', 'qianhai', '前海石公园—桂湾绿道', 'greenway', 8, 'https://pnr.sz.gov.cn/ns/zwdt/content/post_12293562.html'),
  candidate('shenzhen', 'baoan-coast', '宝安中心滨海线', 'waterfront', 10, 'https://cgj.sz.gov.cn/attachment/0/980/980209/9835577.pdf'),
  candidate('shenzhen', 'yantian-coast', '盐田山海栈道', 'landmark', 10, 'https://cgj.sz.gov.cn/attachment/0/980/980209/9835577.pdf'),
  candidate('shenzhen', 'wutong-greenway', '梧桐山绿道挑战线', 'long', 12, 'https://cgj.sz.gov.cn/attachment/0/980/980209/9835577.pdf'),
];
