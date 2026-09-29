export type SupplementalRouteSpec = {
  cityId: string;
  cityName: string;
  name: string;
  rank: number;
};

// The second group of 50 cities starts with three locally recognisable route
// candidates. Names are publishable discovery data; geometry stays pending
// until an OSM/GPX trace passes the same map-alignment checks as the first 50.
const routeNames: Record<string, { cityName: string; routes: [string, string, string] }> = {
  zhuhai: { cityName: '珠海', routes: ['情侣路海滨跑步线', '野狸岛环岛线', '横琴花海长廊线'] },
  zhongshan: { cityName: '中山', routes: ['岐江公园沿江线', '紫马岭公园环线', '金钟湖绿道线'] },
  huizhou: { cityName: '惠州', routes: ['惠州西湖环湖线', '东江滨水跑步线', '红花湖绿道线'] },
  jiangmen: { cityName: '江门', routes: ['东湖公园环线', '釜山公园滨江线', '圭峰山绿道线'] },
  shantou: { cityName: '汕头', routes: ['海滨长廊跑步线', '东海岸大道滨海线', '中山公园环线'] },
  nantong: { cityName: '南通', routes: ['濠河环线', '滨江公园跑步线', '紫琅湖环湖线'] },
  yangzhou: { cityName: '扬州', routes: ['瘦西湖跑步线', '古运河滨水线', '三湾公园环线'] },
  zhenjiang: { cityName: '镇江', routes: ['金山湖环湖线', '滨江风光带跑步线', '南山绿道线'] },
  yancheng: { cityName: '盐城', routes: ['串场河滨水线', '大洋湾生态跑步线', '聚龙湖环湖线'] },
  xuzhou: { cityName: '徐州', routes: ['云龙湖环湖线', '大龙湖环线', '故黄河滨水线'] },
  huzhou: { cityName: '湖州', routes: ['太湖月亮湾滨水线', '仁皇山公园环线', '西山漾湿地线'] },
  zhoushan: { cityName: '舟山', routes: ['海滨公园跑步线', '东港滨海线', '定海古城环线'] },
  quzhou: { cityName: '衢州', routes: ['信安湖环湖线', '鹿鸣公园环线', '衢江滨水线'] },
  wuhu: { cityName: '芜湖', routes: ['十里江湾跑步线', '镜湖环线', '神山公园环线'] },
  huangshan: { cityName: '黄山', routes: ['新安江滨水线', '屯溪老街滨江线', '黎阳水街跑步线'] },
  ganzhou: { cityName: '赣州', routes: ['章江滨水线', '贡江滨水线', '中央公园环线'] },
  jiujiang: { cityName: '九江', routes: ['八里湖环湖线', '长江江堤跑步线', '南湖公园环线'] },
  shangrao: { cityName: '上饶', routes: ['信江滨水线', '龙潭湖环线', '市民公园跑步线'] },
  zibo: { cityName: '淄博', routes: ['孝妇河湿地线', '齐盛湖环湖线', '人民公园环线'] },
  weihai: { cityName: '威海', routes: ['环海路跑步线', '悦海公园滨海线', '威海公园海岸线'] },
  linyi: { cityName: '临沂', routes: ['沂河滨水线', '祊河绿道线', '五洲湖环湖线'] },
  weifang: { cityName: '潍坊', routes: ['白浪河滨水线', '虞河绿道线', '人民公园环线'] },
  taian: { cityName: '泰安', routes: ['泮河公园跑步线', '天平湖环湖线', '东湖公园环线'] },
  kaifeng: { cityName: '开封', routes: ['大宋御河跑步线', '开封西湖环湖线', '古城墙跑步线'] },
  xuchang: { cityName: '许昌', routes: ['护城河环线', '鹿鸣湖环湖线', '中央公园跑步线'] },
  yichang: { cityName: '宜昌', routes: ['沿江大道跑步线', '滨江公园线', '运河公园绿道线'] },
  xiangyang: { cityName: '襄阳', routes: ['汉江滨水线', '护城河环线', '鱼梁洲跑步线'] },
  jingzhou: { cityName: '荆州', routes: ['古城墙环线', '荆江滨水线', '明月公园环线'] },
  yueyang: { cityName: '岳阳', routes: ['洞庭湖滨水线', '南湖环湖线', '王家河公园线'] },
  zhuzhou: { cityName: '株洲', routes: ['湘江风光带线', '神农湖环湖线', '枫溪港滨水线'] },
  hengyang: { cityName: '衡阳', routes: ['湘江滨水线', '蒸水风光带线', '平湖公园环线'] },
  guilin: { cityName: '桂林', routes: ['两江四湖跑步线', '漓江滨水线', '桂湖环湖线'] },
  liuzhou: { cityName: '柳州', routes: ['柳江环江线', '窑埠古镇滨江线', '马鹿山公园环线'] },
  beihai: { cityName: '北海', routes: ['银滩滨海跑步线', '海景大道滨海线', '冠头岭海岸线'] },
  chongzuo: { cityName: '崇左', routes: ['左江滨水线', '石景林公园环线', '龙峡山绿道线'] },
  baise: { cityName: '百色', routes: ['右江滨水线', '半岛公园环线', '龙景湖环湖线'] },
  mianyang: { cityName: '绵阳', routes: ['涪江滨水线', '安昌江绿道线', '仙海湖环湖线'] },
  leshan: { cityName: '乐山', routes: ['岷江滨水线', '大渡河滨水线', '嘉州绿心环线'] },
  deyang: { cityName: '德阳', routes: ['旌湖两岸跑步线', '绵远河滨水线', '东湖山公园环线'] },
  nanchong: { cityName: '南充', routes: ['嘉陵江滨水线', '西河绿道线', '北湖公园环线'] },
  zunyi: { cityName: '遵义', routes: ['湘江河滨水线', '新蒲湿地跑步线', '凤凰山公园环线'] },
  dali: { cityName: '大理', routes: ['洱海生态廊道线', '才村码头滨水线', '洱海公园环线'] },
  lijiang: { cityName: '丽江', routes: ['清溪水库环线', '黑龙潭公园环线', '丽江古城跑步线'] },
  xishuangbanna: { cityName: '西双版纳', routes: ['澜沧江滨水线', '泼水广场跑步线', '曼听公园环线'] },
  qinhuangdao: { cityName: '秦皇岛', routes: ['金梦海湾滨海线', '汤河公园绿道线', '海港滨海跑步线'] },
  tangshan: { cityName: '唐山', routes: ['南湖公园环线', '环城水系跑步线', '青龙湖环湖线'] },
  baoding: { cityName: '保定', routes: ['环城水系跑步线', '东湖环湖线', '黄花沟公园线'] },
  datong: { cityName: '大同', routes: ['御河滨水线', '文瀛湖环湖线', '古城墙跑步线'] },
  ordos: { cityName: '鄂尔多斯', routes: ['乌兰木伦湖环线', '康巴什景观河线', '母亲公园环线'] },
  kashgar: { cityName: '喀什', routes: ['东湖公园环线', '人民公园跑步线', '喀什古城环线'] },
};

export const supplementalRouteSpecs: SupplementalRouteSpec[] = Object.entries(routeNames)
  .flatMap(([cityId, value]) => value.routes.map((name, index) => ({
    cityId,
    cityName: value.cityName,
    name,
    rank: index + 1,
  })));
