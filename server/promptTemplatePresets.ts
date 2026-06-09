export type PromptTemplatePreset = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  legacyIcons?: string[];
  legacyDescriptions?: string[];
  legacyComponents?: Array<Record<string, unknown>>;
  components: Array<Record<string, unknown>>;
  rules: Record<string, unknown>;
  output: Record<string, unknown>;
};

function baseRules(type: string, order: string[], labels: Record<string, string>) {
  return {
    prefix: `请根据以下信息创作一张高质量图片。图片类型：${type}。`,
    order,
    labels,
    joiner: "\n",
    suffix: "画面应清晰、主体明确、构图完整，避免文字错乱和低质量细节。"
  };
}

export const promptTemplatePresets: PromptTemplatePreset[] = [
  {
    id: "preset-poster",
    name: "海报",
    description: "适合招聘人事、销售转化、峰会活动、课程公告等通用海报。",
    category: "poster",
    icon: "Frame",
    legacyIcons: ["Tv", "Megaphone"],
    legacyDescriptions: ["适合活动海报、节日海报、商业推广主视觉。"],
    legacyComponents: [
      { id: "section-basic", type: "section", label: "基础信息", sortOrder: 10 },
      { id: "subject", type: "text", label: "海报主题", placeholder: "例如：夏季新品发布", defaultValue: "夏季新品发布会主视觉", required: true, slot: "subject", sortOrder: 20 },
      { id: "audience", type: "text", label: "目标人群", placeholder: "例如：年轻女性、科技爱好者", defaultValue: "18-35 岁关注质感生活和新品体验的年轻用户", slot: "audience", sortOrder: 30 },
      { id: "copy", type: "textarea", label: "核心文案", placeholder: "写入标题、副标题或行动号召", defaultValue: "标题：盛夏焕新计划\n副标题：轻盈质感，开启夏日灵感\n行动号召：立即了解新品", slot: "copy", sortOrder: 40 },
      { id: "style", type: "select", label: "视觉风格", options: ["高级极简", "潮流插画", "赛博科技", "温暖生活方式", "国潮视觉"], defaultValue: "高级极简", slot: "style", sortOrder: 50 },
      { id: "layout", type: "select", label: "版式", options: ["居中主视觉", "左右分栏", "上图下文", "大标题压迫感", "留白高级感"], defaultValue: "居中主视觉", slot: "layout", sortOrder: 60 },
      { id: "reference", type: "image", label: "素材", defaultValue: "可上传品牌素材或同类海报，强调留白、高级感和清爽配色", helpText: "上传素材并填写备注，不做识图。", slot: "reference", sortOrder: 70 }
    ],
    components: [
      { id: "section-basic", type: "section", label: "基础信息", sortOrder: 10 },
      { id: "purpose", type: "select", label: "海报用途", options: ["招聘/人事", "销售/转化", "峰会/活动", "课程/培训", "品牌宣传", "公告通知", "节日/公益"], defaultValue: "峰会/活动", required: true, slot: "purpose", sortOrder: 20 },
      { id: "industry", type: "text", label: "行业/场景", placeholder: "例如：人事招聘、销售冲刺、AI 峰会、门店开业", defaultValue: "AI 行业峰会", slot: "industry", sortOrder: 30 },
      { id: "subject", type: "text", label: "主题/名称", placeholder: "例如：2026 人才招聘季、季度销售冲刺大会、AI 创新峰会", defaultValue: "2026 AI 创新峰会", required: true, slot: "subject", sortOrder: 40 },
      { id: "audience", type: "text", label: "目标受众", placeholder: "例如：求职者、客户、合作伙伴、内部员工", defaultValue: "行业从业者、企业决策者、合作伙伴与潜在客户", slot: "audience", sortOrder: 50 },
      { id: "message", type: "textarea", label: "关键信息", placeholder: "写入标题、副标题、时间地点、福利卖点、议程或行动号召", defaultValue: "主标题：年度增长新起点\n副标题：面向团队、客户与伙伴的重点行动\n关键信息：时间/地点/福利/议程/优惠可按需替换\n行动号召：立即报名/扫码了解/联系负责人", slot: "message", sortOrder: 60 },
      { id: "tone", type: "select", label: "表达调性", options: ["专业可信", "热烈动员", "高端峰会", "年轻活力", "温暖亲和", "强转化促销", "正式公告"], defaultValue: "专业可信", slot: "tone", sortOrder: 70 },
      { id: "visual", type: "select", label: "视觉方向", options: ["现代商务", "品牌极简", "科技未来", "活力插画", "高端质感", "节日氛围", "数据冲击"], defaultValue: "现代商务", slot: "visual", sortOrder: 80 },
      { id: "layout", type: "select", label: "版式/画幅", options: ["竖版主视觉 3:4", "手机长图 9:16", "方形社媒 1:1", "横版会场屏 16:9", "信息分区海报", "大标题留白"], defaultValue: "竖版主视觉 3:4", slot: "layout", sortOrder: 90 },
      { id: "reference", type: "image", label: "素材/规范", defaultValue: "可上传品牌 Logo、人物/产品/会场素材或参考海报；请保持文字层级清楚、可替换、不过度拥挤", helpText: "上传素材并填写备注，不做识图。", slot: "reference", sortOrder: 100 }
    ],
    rules: baseRules("海报", ["purpose", "industry", "subject", "audience", "message", "tone", "visual", "layout", "reference"], {
      purpose: "用途",
      industry: "行业/场景",
      subject: "主题",
      audience: "目标受众",
      message: "关键信息",
      tone: "表达调性",
      visual: "视觉方向",
      layout: "版式/画幅",
      reference: "素材/规范"
    }),
    output: { negativeEnabled: false }
  },
  {
    id: "preset-product-promo",
    name: "产品宣传图",
    description: "适合电商主图、产品卖点图、质感宣传图。",
    category: "product",
    icon: "ShoppingBag",
    legacyIcons: ["Type", "Box", "Package"],
    components: [
      { id: "product", type: "text", label: "产品名称", placeholder: "例如：便携咖啡机", defaultValue: "便携智能咖啡机", required: true, slot: "product", sortOrder: 10 },
      { id: "selling-points", type: "textarea", label: "核心卖点", placeholder: "例如：轻量、快充、静音、金属质感", defaultValue: "一键萃取、轻量便携、低噪运行、快充续航、金属机身", slot: "sellingPoints", sortOrder: 20 },
      { id: "scene", type: "select", label: "使用场景", options: ["室内棚拍", "户外生活方式", "办公桌面", "高端商业空间", "纯色背景"], defaultValue: "室内棚拍", slot: "scene", sortOrder: 30 },
      { id: "material", type: "text", label: "材质/质感", placeholder: "例如：磨砂金属、透明玻璃、柔光塑料", defaultValue: "磨砂银色金属、透明水箱、柔和高光", slot: "material", sortOrder: 40 },
      { id: "color", type: "text", label: "主色调", placeholder: "例如：银灰、象牙白、活力橙", defaultValue: "银灰、象牙白，少量活力橙点缀", slot: "color", sortOrder: 50 },
      { id: "reference", type: "image", label: "产品素材", defaultValue: "可上传产品实拍或竞品素材，突出外观比例和材质细节", slot: "reference", sortOrder: 60 }
    ],
    rules: baseRules("产品宣传图", ["product", "sellingPoints", "scene", "material", "color", "reference"], {
      product: "产品",
      sellingPoints: "卖点",
      scene: "场景",
      material: "材质",
      color: "主色调",
      reference: "素材"
    }),
    output: { negativeEnabled: true }
  },
  {
    id: "preset-video-storyboard",
    name: "宣传片分镜",
    description: "把宣传片需求整理成可用于视频分镜画面的提示词。",
    category: "video",
    icon: "Clapperboard",
    legacyIcons: ["Film", "Video"],
    components: [
      { id: "topic", type: "text", label: "宣传主题", placeholder: "例如：新品发布开场片", defaultValue: "新品发布开场片", required: true, slot: "topic", sortOrder: 10 },
      { id: "duration", type: "select", label: "片段长度", options: ["5 秒", "10 秒", "15 秒", "30 秒"], defaultValue: "10 秒", slot: "duration", sortOrder: 20 },
      { id: "scenes", type: "textarea", label: "关键画面", placeholder: "按顺序写出要出现的镜头", defaultValue: "1. 黑场中出现产品轮廓和光线\n2. 镜头推进展示核心细节\n3. 产品置于生活场景中完成高光展示", slot: "scenes", sortOrder: 30 },
      { id: "shot", type: "select", label: "镜头语言", options: ["电影感推镜", "稳定横移", "快速切换", "俯拍到近景", "特写慢动作"], defaultValue: "电影感推镜", slot: "shot", sortOrder: 40 },
      { id: "mood", type: "text", label: "情绪氛围", placeholder: "例如：振奋、克制、高级、未来感", defaultValue: "克制、高级、振奋，带未来感", slot: "mood", sortOrder: 50 },
      { id: "cta", type: "text", label: "补充要求", placeholder: "例如：强调镜头连贯、节奏变化、电影感光影", defaultValue: "强调镜头连贯、节奏变化、电影感光影", slot: "cta", sortOrder: 60 }
    ],
    rules: baseRules("宣传片分镜", ["topic", "duration", "scenes", "shot", "mood", "cta"], {
      topic: "主题",
      duration: "时长",
      scenes: "关键画面",
      shot: "镜头语言",
      mood: "氛围",
      cta: "补充要求"
    }),
    output: { negativeEnabled: false }
  },
  {
    id: "preset-ui-design",
    name: "UI 设计",
    description: "适合生成 App、后台、落地页或组件视觉方案。",
    category: "ui",
    icon: "Monitor",
    legacyIcons: ["PanelsTopLeft", "LayoutTemplate"],
    components: [
      { id: "product", type: "text", label: "产品/业务", placeholder: "例如：AI 客服后台", defaultValue: "AI 客服运营后台", required: true, slot: "product", sortOrder: 10 },
      { id: "platform", type: "select", label: "平台", options: ["移动 App", "Web 后台", "小程序", "桌面端", "落地页"], defaultValue: "Web 后台", slot: "platform", sortOrder: 20 },
      { id: "screen", type: "text", label: "页面名称", placeholder: "例如：数据看板、订单详情、编辑器", defaultValue: "数据看板", slot: "screen", sortOrder: 30 },
      { id: "components", type: "textarea", label: "关键组件", placeholder: "例如：筛选器、表格、趋势图、操作抽屉", defaultValue: "顶部指标卡、趋势折线图、会话列表、筛选器、右侧详情抽屉", slot: "components", sortOrder: 40 },
      { id: "visual", type: "select", label: "视觉倾向", options: ["专业克制", "轻量清爽", "深色科技", "品牌营销", "高密度工具"], defaultValue: "专业克制", slot: "visual", sortOrder: 50 },
      { id: "brand-color", type: "text", label: "品牌色", placeholder: "例如：黑白灰 + 电光蓝点缀", defaultValue: "黑白灰基础，电光蓝作为关键操作和高亮信息", slot: "brandColor", sortOrder: 60 }
    ],
    rules: baseRules("UI 设计", ["product", "platform", "screen", "components", "visual", "brandColor"], {
      product: "产品",
      platform: "平台",
      screen: "页面",
      components: "关键组件",
      visual: "视觉倾向",
      brandColor: "品牌色"
    }),
    output: { negativeEnabled: true }
  },
  {
    id: "preset-brand-visual",
    name: "品牌主视觉",
    description: "为品牌活动、发布会、官网首屏生成统一视觉方向。",
    category: "brand",
    icon: "ScanEye",
    legacyIcons: ["Palette"],
    components: [
      { id: "brand", type: "text", label: "品牌名称", placeholder: "例如：Nebula Studio", defaultValue: "Nebula Studio", required: true, slot: "brand", sortOrder: 10 },
      { id: "values", type: "textarea", label: "品牌关键词", placeholder: "例如：可信、创新、克制、面向未来", defaultValue: "可信、创新、克制、面向未来，强调专业但不冰冷", slot: "values", sortOrder: 20 },
      { id: "audience", type: "text", label: "受众", placeholder: "例如：企业决策者、年轻创作者", defaultValue: "企业决策者、品牌负责人、内容创作者", slot: "audience", sortOrder: 30 },
      { id: "palette", type: "text", label: "色彩方向", placeholder: "例如：黑白灰，少量金色高光", defaultValue: "黑白灰为主，少量金色和冷蓝色高光", slot: "palette", sortOrder: 40 },
      { id: "symbol", type: "text", label: "视觉符号", placeholder: "例如：光束、几何线框、山脉、星轨", defaultValue: "柔和光束、几何线框、星轨和抽象空间结构", slot: "symbol", sortOrder: 50 }
    ],
    rules: baseRules("品牌主视觉", ["brand", "values", "audience", "palette", "symbol"], {
      brand: "品牌",
      values: "品牌关键词",
      audience: "受众",
      palette: "色彩",
      symbol: "视觉符号"
    }),
    output: { negativeEnabled: false }
  },
  {
    id: "preset-social-post",
    name: "社媒图文",
    description: "适合小红书、朋友圈、公众号封面等社交内容。",
    category: "social",
    icon: "Smartphone",
    legacyIcons: ["Image", "Newspaper"],
    components: [
      { id: "topic", type: "text", label: "内容主题", placeholder: "例如：周末城市露营指南", defaultValue: "周末城市露营指南", required: true, slot: "topic", sortOrder: 10 },
      { id: "platform", type: "select", label: "发布平台", options: ["小红书", "朋友圈", "公众号封面", "Instagram", "微博"], defaultValue: "小红书", slot: "platform", sortOrder: 20 },
      { id: "tone", type: "select", label: "表达语气", options: ["真实生活感", "精致高级", "活泼种草", "专业教程", "情绪大片"], defaultValue: "真实生活感", slot: "tone", sortOrder: 30 },
      { id: "message", type: "textarea", label: "重点信息", placeholder: "写出希望画面传达的 3-5 个信息点", defaultValue: "适合新手的轻量装备、城市周边短途路线、傍晚氛围感照片、舒适不狼狈的穿搭建议", slot: "message", sortOrder: 40 },
      { id: "ratio", type: "select", label: "画幅", options: ["1:1", "3:4", "4:5", "9:16", "16:9"], defaultValue: "3:4", slot: "ratio", sortOrder: 50 },
      { id: "reference", type: "image", label: "素材", defaultValue: "可上传生活方式素材，强调真实、轻松、自然光", slot: "reference", sortOrder: 60 }
    ],
    rules: baseRules("社媒图文", ["topic", "platform", "tone", "message", "ratio", "reference"], {
      topic: "主题",
      platform: "平台",
      tone: "语气",
      message: "重点信息",
      ratio: "画幅",
      reference: "素材"
    }),
    output: { negativeEnabled: false }
  },
  {
    id: "preset-portrait-photo",
    name: "人像写真",
    description: "适合头像写真、商业形象照、社交媒体人像内容。",
    category: "portrait",
    icon: "Camera",
    components: [
      { id: "person", type: "text", label: "人物设定", placeholder: "例如：年轻设计师、东方女性、商务男士", defaultValue: "年轻创意设计师，气质自然自信", required: true, slot: "person", sortOrder: 10 },
      { id: "scene", type: "select", label: "拍摄场景", options: ["城市街头", "自然户外", "室内棚拍", "咖啡馆", "办公室", "纯色背景"], defaultValue: "室内棚拍", slot: "scene", sortOrder: 20 },
      { id: "outfit", type: "text", label: "服装造型", placeholder: "例如：白衬衫、黑色西装、休闲针织", defaultValue: "简洁浅色上衣，干净利落的发型和自然妆容", slot: "outfit", sortOrder: 30 },
      { id: "mood", type: "select", label: "情绪氛围", options: ["温柔自然", "专业自信", "电影感", "清冷高级", "阳光活力"], defaultValue: "专业自信", slot: "mood", sortOrder: 40 },
      { id: "lighting", type: "select", label: "光线", options: ["柔和自然光", "棚拍柔光", "逆光轮廓", "低调暗光", "黄金时刻"], defaultValue: "棚拍柔光", slot: "lighting", sortOrder: 50 },
      { id: "shot", type: "select", label: "景别", options: ["头像特写", "半身像", "全身像", "环境人像", "侧脸特写"], defaultValue: "半身像", slot: "shot", sortOrder: 60 }
    ],
    rules: baseRules("人像写真", ["person", "scene", "outfit", "mood", "lighting", "shot"], {
      person: "人物",
      scene: "场景",
      outfit: "服装造型",
      mood: "氛围",
      lighting: "光线",
      shot: "景别"
    }),
    output: { negativeEnabled: true }
  },
  {
    id: "preset-interior-space",
    name: "空间设计",
    description: "适合室内家装、商业空间、展厅或办公空间效果图。",
    category: "interior",
    icon: "Sofa",
    legacyIcons: ["Building2", "House", "Hotel"],
    components: [
      { id: "space", type: "text", label: "空间类型", placeholder: "例如：客厅、咖啡店、展厅、办公室", defaultValue: "现代客厅空间", required: true, slot: "space", sortOrder: 10 },
      { id: "style", type: "select", label: "设计风格", options: ["现代简约", "侘寂风", "轻奢", "北欧自然", "工业风", "东方美学"], defaultValue: "现代简约", slot: "style", sortOrder: 20 },
      { id: "materials", type: "textarea", label: "材质元素", placeholder: "例如：木饰面、微水泥、金属、玻璃", defaultValue: "浅木饰面、米白软装、局部金属线条、低饱和艺术挂画", slot: "materials", sortOrder: 30 },
      { id: "layout", type: "text", label: "空间布局", placeholder: "例如：开放式、环形动线、落地窗", defaultValue: "开放式布局，宽敞通透，保留充足活动动线", slot: "layout", sortOrder: 40 },
      { id: "lighting", type: "select", label: "灯光", options: ["自然采光", "无主灯", "暖色氛围灯", "商业重点照明", "清晨柔光"], defaultValue: "自然采光", slot: "lighting", sortOrder: 50 },
      { id: "view", type: "select", label: "视角", options: ["广角全景", "正面构图", "角落透视", "俯视布局", "细节特写"], defaultValue: "广角全景", slot: "view", sortOrder: 60 }
    ],
    rules: baseRules("空间设计", ["space", "style", "materials", "layout", "lighting", "view"], {
      space: "空间",
      style: "风格",
      materials: "材质",
      layout: "布局",
      lighting: "灯光",
      view: "视角"
    }),
    output: { negativeEnabled: true }
  },
  {
    id: "preset-food-photo",
    name: "美食摄影",
    description: "适合菜品摄影、饮品海报、菜单宣传和电商餐饮图。",
    category: "food",
    icon: "Utensils",
    components: [
      { id: "dish", type: "text", label: "菜品/饮品", placeholder: "例如：草莓奶油蛋糕、拿铁咖啡、日式拉面", defaultValue: "草莓奶油蛋糕", required: true, slot: "dish", sortOrder: 10 },
      { id: "scene", type: "select", label: "拍摄场景", options: ["餐桌近景", "咖啡馆桌面", "厨房制作", "商业棚拍", "户外野餐"], defaultValue: "餐桌近景", slot: "scene", sortOrder: 20 },
      { id: "style", type: "select", label: "画面风格", options: ["清新明亮", "高级暗调", "日系生活感", "商业精致", "复古胶片"], defaultValue: "清新明亮", slot: "style", sortOrder: 30 },
      { id: "plating", type: "textarea", label: "摆盘细节", placeholder: "写出餐具、配料、装饰和画面重点", defaultValue: "白色陶瓷盘，草莓切面清晰，奶油纹理细腻，旁边搭配银色甜品叉", slot: "plating", sortOrder: 40 },
      { id: "lighting", type: "select", label: "光线", options: ["窗边自然光", "柔和棚拍光", "暖色餐厅光", "低调侧光", "高亮清透"], defaultValue: "窗边自然光", slot: "lighting", sortOrder: 50 },
      { id: "ratio", type: "select", label: "画幅", options: ["1:1", "3:4", "4:5", "16:9"], defaultValue: "4:5", slot: "ratio", sortOrder: 60 }
    ],
    rules: baseRules("美食摄影", ["dish", "scene", "style", "plating", "lighting", "ratio"], {
      dish: "菜品",
      scene: "场景",
      style: "风格",
      plating: "摆盘",
      lighting: "光线",
      ratio: "画幅"
    }),
    output: { negativeEnabled: true }
  },
  {
    id: "preset-game-character",
    name: "游戏角色",
    description: "适合游戏角色设定、皮肤概念、立绘和卡牌视觉。",
    category: "game",
    icon: "Gamepad2",
    components: [
      { id: "role", type: "text", label: "角色身份", placeholder: "例如：未来女战士、森林法师、赛博刺客", defaultValue: "赛博城市中的年轻赏金猎人", required: true, slot: "role", sortOrder: 10 },
      { id: "world", type: "select", label: "世界观", options: ["赛博朋克", "奇幻大陆", "末日废土", "东方玄幻", "蒸汽朋克", "现代都市"], defaultValue: "赛博朋克", slot: "world", sortOrder: 20 },
      { id: "outfit", type: "textarea", label: "服装装备", placeholder: "写出服装、武器、道具和标志性细节", defaultValue: "黑色机能外套、发光护目镜、轻型机械臂、腰间短刃和能量手枪", slot: "outfit", sortOrder: 30 },
      { id: "pose", type: "select", label: "姿态", options: ["站立正面", "动态奔跑", "战斗准备", "半身立绘", "回头凝视"], defaultValue: "战斗准备", slot: "pose", sortOrder: 40 },
      { id: "style", type: "select", label: "美术风格", options: ["3A 游戏概念", "二次元立绘", "暗黑写实", "潮流卡牌", "像素风"], defaultValue: "3A 游戏概念", slot: "style", sortOrder: 50 },
      { id: "details", type: "text", label: "补充亮点", placeholder: "例如：霓虹背光、雨夜街道、能量特效", defaultValue: "雨夜霓虹街道背景，蓝紫色能量光效，角色轮廓清晰", slot: "details", sortOrder: 60 }
    ],
    rules: baseRules("游戏角色", ["role", "world", "outfit", "pose", "style", "details"], {
      role: "角色",
      world: "世界观",
      outfit: "服装装备",
      pose: "姿态",
      style: "美术风格",
      details: "亮点"
    }),
    output: { negativeEnabled: true }
  }
];

const promptTemplatePresetOrderIds = [
  "preset-poster",
  "preset-product-promo",
  "preset-ui-design",
  "preset-brand-visual",
  "preset-social-post",
  "preset-portrait-photo",
  "preset-food-photo",
  "preset-video-storyboard",
  "preset-interior-space",
  "preset-game-character"
];

const promptTemplatePresetOrderIdSet = new Set(promptTemplatePresetOrderIds);

export const orderedPromptTemplatePresets: PromptTemplatePreset[] = [
  ...promptTemplatePresetOrderIds
    .map((id) => promptTemplatePresets.find((template) => template.id === id))
    .filter((template): template is PromptTemplatePreset => Boolean(template)),
  ...promptTemplatePresets.filter((template) => !promptTemplatePresetOrderIdSet.has(template.id))
];
