export type CoreCity = {
  id: string;
  name: string;
  province: string;
  phase: 1 | 2 | 3;
};

// 中国大陆首批 50 个核心城市：覆盖超大城市、区域中心、重点旅游与跑步目的地。
export const coreCities: CoreCity[] = [
  { id: 'beijing', name: '北京', province: '北京市', phase: 1 }, { id: 'shanghai', name: '上海', province: '上海市', phase: 1 },
  { id: 'guangzhou', name: '广州', province: '广东省', phase: 1 }, { id: 'shenzhen', name: '深圳', province: '广东省', phase: 1 },
  { id: 'hangzhou', name: '杭州', province: '浙江省', phase: 1 }, { id: 'nanjing', name: '南京', province: '江苏省', phase: 1 },
  { id: 'suzhou', name: '苏州', province: '江苏省', phase: 1 }, { id: 'chengdu', name: '成都', province: '四川省', phase: 1 },
  { id: 'chongqing', name: '重庆', province: '重庆市', phase: 1 }, { id: 'wuhan', name: '武汉', province: '湖北省', phase: 1 },
  { id: 'xian', name: '西安', province: '陕西省', phase: 1 }, { id: 'qingdao', name: '青岛', province: '山东省', phase: 1 },
  { id: 'xiamen', name: '厦门', province: '福建省', phase: 1 }, { id: 'changsha', name: '长沙', province: '湖南省', phase: 1 },
  { id: 'tianjin', name: '天津', province: '天津市', phase: 1 }, { id: 'dalian', name: '大连', province: '辽宁省', phase: 1 },
  { id: 'ningbo', name: '宁波', province: '浙江省', phase: 2 }, { id: 'wuxi', name: '无锡', province: '江苏省', phase: 2 },
  { id: 'changzhou', name: '常州', province: '江苏省', phase: 2 }, { id: 'dongguan', name: '东莞', province: '广东省', phase: 2 },
  { id: 'foshan', name: '佛山', province: '广东省', phase: 2 }, { id: 'fuzhou', name: '福州', province: '福建省', phase: 2 },
  { id: 'quanzhou', name: '泉州', province: '福建省', phase: 2 }, { id: 'jinan', name: '济南', province: '山东省', phase: 2 },
  { id: 'yantai', name: '烟台', province: '山东省', phase: 2 }, { id: 'zhengzhou', name: '郑州', province: '河南省', phase: 2 },
  { id: 'luoyang', name: '洛阳', province: '河南省', phase: 2 }, { id: 'nanchang', name: '南昌', province: '江西省', phase: 2 },
  { id: 'hefei', name: '合肥', province: '安徽省', phase: 2 }, { id: 'kunming', name: '昆明', province: '云南省', phase: 2 },
  { id: 'guiyang', name: '贵阳', province: '贵州省', phase: 2 }, { id: 'nanning', name: '南宁', province: '广西壮族自治区', phase: 2 },
  { id: 'haikou', name: '海口', province: '海南省', phase: 2 }, { id: 'sanya', name: '三亚', province: '海南省', phase: 2 },
  { id: 'shijiazhuang', name: '石家庄', province: '河北省', phase: 3 }, { id: 'taiyuan', name: '太原', province: '山西省', phase: 3 },
  { id: 'hohhot', name: '呼和浩特', province: '内蒙古自治区', phase: 3 }, { id: 'shenyang', name: '沈阳', province: '辽宁省', phase: 3 },
  { id: 'changchun', name: '长春', province: '吉林省', phase: 3 }, { id: 'harbin', name: '哈尔滨', province: '黑龙江省', phase: 3 },
  { id: 'lanzhou', name: '兰州', province: '甘肃省', phase: 3 }, { id: 'xining', name: '西宁', province: '青海省', phase: 3 },
  { id: 'yinchuan', name: '银川', province: '宁夏回族自治区', phase: 3 }, { id: 'urumqi', name: '乌鲁木齐', province: '新疆维吾尔自治区', phase: 3 },
  { id: 'lhasa', name: '拉萨', province: '西藏自治区', phase: 3 }, { id: 'jiaxing', name: '嘉兴', province: '浙江省', phase: 3 },
  { id: 'shaoxing', name: '绍兴', province: '浙江省', phase: 3 }, { id: 'wenzhou', name: '温州', province: '浙江省', phase: 3 },
  { id: 'jinhua', name: '金华', province: '浙江省', phase: 3 }, { id: 'taizhou', name: '台州', province: '浙江省', phase: 3 },
];
