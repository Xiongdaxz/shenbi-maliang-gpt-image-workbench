export type PromptColorSchemeColor = {
  id: string;
  name: string;
  role: string;
  hex: string;
};

export type PromptColorSchemeGradient = {
  id: string;
  name: string;
  role: string;
  colors: string[];
};

export type PromptColorScheme = {
  id: string;
  builtinKey?: string;
  name: string;
  description: string;
  category: string;
  colors: PromptColorSchemeColor[];
  gradients: PromptColorSchemeGradient[];
  prompt: string;
  visible: boolean;
  sortOrder: number;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type PromptColorSchemePayload = {
  name: string;
  description?: string;
  category?: string;
  colors?: PromptColorSchemeColor[];
  gradients?: PromptColorSchemeGradient[];
  prompt?: string;
  visible?: boolean;
  sortOrder?: number;
};

export const PROMPT_COLOR_SCHEME_NONE_ID = "none";

export const defaultPromptColorSchemes: Array<PromptColorSchemePayload & { builtinKey: string }> = [
  {
    builtinKey: "image-workplace-poster",
    name: "商务蓝橙",
    description: "适合招聘海报、会议通知、课程宣传和企业活动 KV。",
    category: "职场海报",
    colors: [
      { id: "workplace-trust-blue", name: "可信蓝", role: "主色", hex: "#2563EB" },
      { id: "workplace-energy-orange", name: "活力橙", role: "强调色", hex: "#F97316" },
      { id: "workplace-paper-white", name: "纸张白", role: "背景色", hex: "#F8FAFC" }
    ],
    gradients: [
      { id: "workplace-focus-gradient", name: "会议聚焦", role: "海报背景", colors: ["#F8FAFC", "#DBEAFE", "#F97316"] }
    ],
    prompt: "保持专业、清晰和行动感，标题与关键信息要醒目可读。",
    visible: true,
    sortOrder: 10
  },
  {
    builtinKey: "image-workplace-poster-premium",
    name: "稳重黑金",
    description: "适合高端讲座、年会主视觉、会员权益和商务邀请函。",
    category: "职场海报",
    colors: [
      { id: "workplace-premium-black", name: "曜石黑", role: "主色", hex: "#111827" },
      { id: "workplace-premium-gold", name: "香槟金", role: "点缀色", hex: "#D6B35A" },
      { id: "workplace-premium-ivory", name: "暖象牙", role: "背景色", hex: "#FFF7ED" }
    ],
    gradients: [
      { id: "workplace-premium-gradient", name: "黑金聚光", role: "高级背景", colors: ["#111827", "#3F2E15", "#D6B35A"] }
    ],
    prompt: "营造克制高级和正式感，控制金色面积，避免廉价炫光。",
    visible: true,
    sortOrder: 11
  },
  {
    builtinKey: "image-workplace-poster-event",
    name: "活动红蓝",
    description: "适合活动报名、节日促销、内部动员和倒计时海报。",
    category: "职场海报",
    colors: [
      { id: "workplace-event-red", name: "行动红", role: "强调色", hex: "#DC2626" },
      { id: "workplace-event-blue", name: "秩序蓝", role: "主色", hex: "#1D4ED8" },
      { id: "workplace-event-white", name: "公告白", role: "背景色", hex: "#FFFFFF" }
    ],
    gradients: [
      { id: "workplace-event-gradient", name: "活动动势", role: "活动背景", colors: ["#1D4ED8", "#FFFFFF", "#DC2626"] }
    ],
    prompt: "突出活动感和行动按钮，信息层级清楚，避免过度热闹。",
    visible: true,
    sortOrder: 12
  },
  {
    builtinKey: "image-portrait-photo",
    name: "自然棚拍",
    description: "适合头像、人像写真、证件感肖像和生活方式摄影。",
    category: "人物摄影",
    colors: [
      { id: "portrait-soft-skin", name: "柔光肤", role: "肤色", hex: "#E8C7A8" },
      { id: "portrait-studio-gray", name: "棚拍灰", role: "背景色", hex: "#E5E7EB" },
      { id: "portrait-charcoal", name: "炭灰", role: "服装色", hex: "#374151" }
    ],
    gradients: [
      { id: "portrait-soft-light", name: "柔光棚拍", role: "光线氛围", colors: ["#F8FAFC", "#E8C7A8", "#C08457"] }
    ],
    prompt: "肤色自然健康，光线柔和真实，避免过度磨皮和明显偏色。",
    visible: true,
    sortOrder: 20
  },
  {
    builtinKey: "image-portrait-photo-japanese",
    name: "清透日系",
    description: "适合生活写真、校园人像、清新头像和自然光摄影。",
    category: "人物摄影",
    colors: [
      { id: "portrait-jp-daylight", name: "日光白", role: "背景色", hex: "#F8FAFC" },
      { id: "portrait-jp-sky", name: "浅空蓝", role: "辅助色", hex: "#93C5FD" },
      { id: "portrait-jp-blush", name: "淡腮粉", role: "肤色氛围", hex: "#FBCFE8" }
    ],
    gradients: [
      { id: "portrait-jp-gradient", name: "清透自然光", role: "光线氛围", colors: ["#F8FAFC", "#DBEAFE", "#FBCFE8"] }
    ],
    prompt: "保持空气感和自然光，肤色清透不过曝，背景简洁柔和。",
    visible: true,
    sortOrder: 21
  },
  {
    builtinKey: "image-portrait-photo-film",
    name: "复古胶片",
    description: "适合氛围人像、复古写真、街拍和情绪肖像。",
    category: "人物摄影",
    colors: [
      { id: "portrait-film-brown", name: "胶片棕", role: "主色", hex: "#7C4A2D" },
      { id: "portrait-film-cream", name: "旧相纸", role: "背景色", hex: "#F3E7D0" },
      { id: "portrait-film-olive", name: "暗橄榄", role: "辅助色", hex: "#6B7A45" }
    ],
    gradients: [
      { id: "portrait-film-gradient", name: "旧胶片暖影", role: "胶片氛围", colors: ["#F3E7D0", "#A16207", "#7C4A2D"] }
    ],
    prompt: "加入轻微胶片感和暖调阴影，保留面部细节，避免脏黄。",
    visible: true,
    sortOrder: 22
  },
  {
    builtinKey: "image-ui-design",
    name: "产品界面",
    description: "适合 App 页面、SaaS 后台、数据看板和产品功能展示。",
    category: "UI设计",
    colors: [
      { id: "ui-action-blue", name: "操作蓝", role: "主色", hex: "#2563EB" },
      { id: "ui-canvas-gray", name: "界面浅灰", role: "背景色", hex: "#F8FAFC" },
      { id: "ui-success-green", name: "成功绿", role: "状态色", hex: "#22C55E" }
    ],
    gradients: [
      { id: "ui-product-gradient", name: "产品浅蓝", role: "界面背景", colors: ["#F8FAFC", "#DBEAFE", "#2563EB"] }
    ],
    prompt: "强调界面层级、按钮状态和留白秩序，避免花哨背景干扰 UI 信息。",
    visible: true,
    sortOrder: 30
  },
  {
    builtinKey: "image-ui-design-dark-console",
    name: "深色控制台",
    description: "适合开发者工具、监控大屏、AI 控制台和深色后台界面。",
    category: "UI设计",
    colors: [
      { id: "ui-console-night", name: "控制台黑", role: "背景色", hex: "#0F172A" },
      { id: "ui-console-cyan", name: "指令青", role: "状态色", hex: "#22D3EE" },
      { id: "ui-console-violet", name: "智能紫", role: "点缀色", hex: "#8B5CF6" }
    ],
    gradients: [
      { id: "ui-console-gradient", name: "深色科技面板", role: "界面背景", colors: ["#0F172A", "#1E293B", "#22D3EE"] }
    ],
    prompt: "突出深色界面的专业感和可读性，状态色克制使用。",
    visible: true,
    sortOrder: 31
  },
  {
    builtinKey: "image-ui-design-finance",
    name: "金融数据",
    description: "适合金融 App、交易看板、经营报表和数据分析界面。",
    category: "UI设计",
    colors: [
      { id: "ui-finance-blue", name: "金融蓝", role: "主色", hex: "#1E3A8A" },
      { id: "ui-finance-emerald", name: "增长绿", role: "状态色", hex: "#10B981" },
      { id: "ui-finance-canvas", name: "报表白", role: "背景色", hex: "#F8FAFC" }
    ],
    gradients: [
      { id: "ui-finance-gradient", name: "数据蓝绿", role: "图表背景", colors: ["#F8FAFC", "#BFDBFE", "#10B981"] }
    ],
    prompt: "强调数据可信、图表清晰和风险提示可见，避免娱乐化。",
    visible: true,
    sortOrder: 32
  },
  {
    builtinKey: "image-visual-design",
    name: "品牌主视觉",
    description: "适合品牌 KV、活动主视觉、发布会海报和概念视觉。",
    category: "视觉设计",
    colors: [
      { id: "visual-electric-purple", name: "视觉紫", role: "主色", hex: "#7C3AED" },
      { id: "visual-electric-blue", name: "电光蓝", role: "辅助色", hex: "#0EA5E9" },
      { id: "visual-bright-white", name: "亮白", role: "高光", hex: "#FFFFFF" }
    ],
    gradients: [
      { id: "visual-brand-gradient", name: "蓝紫主视觉", role: "主视觉光效", colors: ["#0EA5E9", "#7C3AED", "#FFFFFF"] }
    ],
    prompt: "画面要有品牌记忆点和视觉冲击，但文字区保持干净可读。",
    visible: true,
    sortOrder: 40
  },
  {
    builtinKey: "image-visual-design-minimal",
    name: "极简高级",
    description: "适合品牌提案、作品集封面、精品海报和高端视觉展示。",
    category: "视觉设计",
    colors: [
      { id: "visual-minimal-black", name: "曜石黑", role: "主色", hex: "#151517" },
      { id: "visual-minimal-pearl", name: "珍珠白", role: "背景色", hex: "#F8F1E7" },
      { id: "visual-minimal-silver", name: "冷银灰", role: "辅助色", hex: "#A8B0BA" }
    ],
    gradients: [
      { id: "visual-minimal-gradient", name: "黑白银灰", role: "高级背景", colors: ["#151517", "#A8B0BA", "#F8F1E7"] }
    ],
    prompt: "使用大留白和克制对比，突出材质、构图和品牌质感。",
    visible: true,
    sortOrder: 41
  },
  {
    builtinKey: "image-visual-design-acid",
    name: "酸性潮流",
    description: "适合音乐节、潮牌、青年活动、实验视觉和展览海报。",
    category: "视觉设计",
    colors: [
      { id: "visual-acid-green", name: "酸性绿", role: "主色", hex: "#A3E635" },
      { id: "visual-acid-pink", name: "热力粉", role: "点缀色", hex: "#EC4899" },
      { id: "visual-acid-purple", name: "深紫底", role: "背景色", hex: "#3B0764" }
    ],
    gradients: [
      { id: "visual-acid-gradient", name: "酸性撞色", role: "潮流背景", colors: ["#3B0764", "#EC4899", "#A3E635"] }
    ],
    prompt: "可以大胆撞色和变形排版，但主体和标题仍要有清晰焦点。",
    visible: true,
    sortOrder: 42
  },
  {
    builtinKey: "image-ecommerce-product",
    name: "干净卖点",
    description: "适合电商主图、产品上新、详情页卖点和促销物料。",
    category: "电商产品",
    colors: [
      { id: "commerce-studio-white", name: "棚拍白", role: "背景色", hex: "#FFFFFF" },
      { id: "commerce-metal-silver", name: "金属银", role: "辅助色", hex: "#A8B0BA" },
      { id: "commerce-sale-red", name: "促销红", role: "强调色", hex: "#EF4444" }
    ],
    gradients: [
      { id: "commerce-clean-stage", name: "干净棚拍", role: "产品背景", colors: ["#FFFFFF", "#E2E8F0", "#A8B0BA"] }
    ],
    prompt: "突出产品材质、轮廓和卖点标签，背景简洁不要抢主体。",
    visible: true,
    sortOrder: 50
  },
  {
    builtinKey: "image-ecommerce-product-luxury",
    name: "奢品黑金",
    description: "适合高端礼盒、数码新品、珠宝香氛和会员权益物料。",
    category: "电商产品",
    colors: [
      { id: "commerce-luxury-black", name: "磨砂黑", role: "背景色", hex: "#111111" },
      { id: "commerce-luxury-gold", name: "奢品金", role: "点缀色", hex: "#D4AF37" },
      { id: "commerce-luxury-ivory", name: "象牙白", role: "辅助色", hex: "#F8F1E7" }
    ],
    gradients: [
      { id: "commerce-luxury-gradient", name: "黑金商品光", role: "产品背景", colors: ["#111111", "#3A2B10", "#D4AF37"] }
    ],
    prompt: "突出高级材质和精致反光，金色少量使用，避免廉价促销感。",
    visible: true,
    sortOrder: 51
  },
  {
    builtinKey: "image-ecommerce-product-baby",
    name: "母婴柔和",
    description: "适合母婴用品、儿童玩具、家清个护和温和型商品展示。",
    category: "电商产品",
    colors: [
      { id: "commerce-baby-blue", name: "婴儿蓝", role: "主色", hex: "#BFDBFE" },
      { id: "commerce-baby-cream", name: "奶油黄", role: "背景色", hex: "#FEF3C7" },
      { id: "commerce-baby-coral", name: "柔珊瑚", role: "点缀色", hex: "#FDA4AF" }
    ],
    gradients: [
      { id: "commerce-baby-gradient", name: "柔和亲子", role: "商品背景", colors: ["#FEF3C7", "#BFDBFE", "#FDA4AF"] }
    ],
    prompt: "强调安全、温和、亲和和干净包装感，避免过强对比。",
    visible: true,
    sortOrder: 52
  },
  {
    builtinKey: "image-social-cover",
    name: "高点击封面",
    description: "适合小红书、公众号、短视频封面、直播预告和活动提醒。",
    category: "社媒封面",
    colors: [
      { id: "social-seeding-red", name: "种草红", role: "主色", hex: "#FF2442" },
      { id: "social-cream-pink", name: "奶油粉", role: "辅助色", hex: "#F9A8D4" },
      { id: "social-title-black", name: "标题黑", role: "文字色", hex: "#111827" }
    ],
    gradients: [
      { id: "social-cover-gradient", name: "红粉封面", role: "封面背景", colors: ["#FFF7F2", "#F9A8D4", "#FF2442"] }
    ],
    prompt: "第一眼要抓人，标题块清楚醒目，避免内容堆满导致缩略图不可读。",
    visible: true,
    sortOrder: 60
  },
  {
    builtinKey: "image-social-cover-knowledge",
    name: "知识干货",
    description: "适合教程封面、清单笔记、方法论卡片和知识分享。",
    category: "社媒封面",
    colors: [
      { id: "social-knowledge-yellow", name: "便签黄", role: "背景色", hex: "#FEF3C7" },
      { id: "social-knowledge-ink", name: "墨黑", role: "文字色", hex: "#111827" },
      { id: "social-knowledge-blue", name: "标记蓝", role: "强调色", hex: "#3B82F6" }
    ],
    gradients: [
      { id: "social-knowledge-gradient", name: "便签重点", role: "封面背景", colors: ["#FEF3C7", "#FFFFFF", "#3B82F6"] }
    ],
    prompt: "标题和要点优先，像清晰笔记一样有重点，避免信息过密。",
    visible: true,
    sortOrder: 61
  },
  {
    builtinKey: "image-social-cover-entertainment",
    name: "潮流娱乐",
    description: "适合娱乐热点、直播切片、音乐内容和潮流话题封面。",
    category: "社媒封面",
    colors: [
      { id: "social-entertain-orange", name: "霓虹橙", role: "主色", hex: "#FB923C" },
      { id: "social-entertain-purple", name: "赛博紫", role: "辅助色", hex: "#A855F7" },
      { id: "social-entertain-night", name: "夜场黑", role: "背景色", hex: "#0B1020" }
    ],
    gradients: [
      { id: "social-entertain-gradient", name: "夜场霓虹", role: "封面背景", colors: ["#0B1020", "#A855F7", "#FB923C"] }
    ],
    prompt: "可以强对比和发光，但人物或主体轮廓必须清楚。",
    visible: true,
    sortOrder: 62
  },
  {
    builtinKey: "image-travel-guide",
    name: "清新路线",
    description: "适合旅行攻略、路线图、城市漫游、景点清单和出游海报。",
    category: "旅游攻略",
    colors: [
      { id: "travel-sea-blue", name: "海风蓝", role: "主色", hex: "#38BDF8" },
      { id: "travel-sand", name: "沙滩米", role: "背景色", hex: "#F6E7C8" },
      { id: "travel-palm-green", name: "棕榈绿", role: "点缀色", hex: "#2E7D5B" }
    ],
    gradients: [
      { id: "travel-route-gradient", name: "海岸晴空", role: "攻略背景", colors: ["#E0F2FE", "#38BDF8", "#F6E7C8"] }
    ],
    prompt: "路线、景点和日期信息要清楚，整体清爽通透，避免颜色杂乱。",
    visible: true,
    sortOrder: 70
  },
  {
    builtinKey: "image-travel-guide-city",
    name: "城市漫游",
    description: "适合城市攻略、周末路线、街区地图和咖啡店打卡。",
    category: "旅游攻略",
    colors: [
      { id: "travel-city-gray", name: "城市灰", role: "辅助色", hex: "#64748B" },
      { id: "travel-city-blue", name: "地图蓝", role: "主色", hex: "#60A5FA" },
      { id: "travel-city-coffee", name: "咖啡棕", role: "点缀色", hex: "#A16207" }
    ],
    gradients: [
      { id: "travel-city-gradient", name: "城市晨光", role: "攻略背景", colors: ["#F8FAFC", "#60A5FA", "#A16207"] }
    ],
    prompt: "突出路线、地标和城市氛围，画面清楚不拥挤。",
    visible: true,
    sortOrder: 71
  },
  {
    builtinKey: "image-travel-guide-camping",
    name: "山野露营",
    description: "适合露营攻略、徒步路线、自然旅行和户外活动海报。",
    category: "旅游攻略",
    colors: [
      { id: "travel-camping-green", name: "森林绿", role: "主色", hex: "#166534" },
      { id: "travel-camping-khaki", name: "帐篷卡其", role: "辅助色", hex: "#D6A85D" },
      { id: "travel-camping-sky", name: "山间蓝", role: "背景色", hex: "#BAE6FD" }
    ],
    gradients: [
      { id: "travel-camping-gradient", name: "山野晴空", role: "自然背景", colors: ["#BAE6FD", "#D6A85D", "#166534"] }
    ],
    prompt: "强调自然、路线和户外装备感，避免颜色过脏或过暗。",
    visible: true,
    sortOrder: 72
  },
  {
    builtinKey: "image-food-poster",
    name: "食欲暖调",
    description: "适合美食海报、菜单设计、探店分享、餐饮推广和新品上市。",
    category: "餐饮美食",
    colors: [
      { id: "food-appetite-orange", name: "食欲橙", role: "主色", hex: "#F97316" },
      { id: "food-cream-yellow", name: "奶油黄", role: "背景色", hex: "#FDE68A" },
      { id: "food-herb-green", name: "香草绿", role: "点缀色", hex: "#65A30D" }
    ],
    gradients: [
      { id: "food-warm-table", name: "暖桌食光", role: "食物氛围", colors: ["#FFF7ED", "#FDE68A", "#F97316"] }
    ],
    prompt: "让食物看起来新鲜、有食欲，保持真实质感和干净餐桌氛围。",
    visible: true,
    sortOrder: 80
  },
  {
    builtinKey: "image-food-poster-coffee",
    name: "咖啡甜品",
    description: "适合咖啡馆、甜品新品、下午茶菜单和烘焙品牌视觉。",
    category: "餐饮美食",
    colors: [
      { id: "food-coffee-brown", name: "咖啡棕", role: "主色", hex: "#7C4A2D" },
      { id: "food-coffee-cream", name: "奶霜米", role: "背景色", hex: "#F8E7C9" },
      { id: "food-coffee-caramel", name: "焦糖橙", role: "点缀色", hex: "#D97706" }
    ],
    gradients: [
      { id: "food-coffee-gradient", name: "焦糖奶霜", role: "甜品氛围", colors: ["#F8E7C9", "#D97706", "#7C4A2D"] }
    ],
    prompt: "突出香气、烘焙质感和温暖店铺氛围，避免油腻厚重。",
    visible: true,
    sortOrder: 81
  },
  {
    builtinKey: "image-food-poster-drink",
    name: "清爽茶饮",
    description: "适合茶饮、果汁、夏日新品、轻食和清爽菜单。",
    category: "餐饮美食",
    colors: [
      { id: "food-drink-matcha", name: "抹茶绿", role: "主色", hex: "#84CC16" },
      { id: "food-drink-ice", name: "冰透蓝", role: "背景色", hex: "#BAE6FD" },
      { id: "food-drink-lemon", name: "柠檬黄", role: "点缀色", hex: "#FDE047" }
    ],
    gradients: [
      { id: "food-drink-gradient", name: "夏日冰饮", role: "清爽背景", colors: ["#BAE6FD", "#84CC16", "#FDE047"] }
    ],
    prompt: "画面清凉透亮，液体和冰块质感要明显，避免颜色浑浊。",
    visible: true,
    sortOrder: 82
  },
  {
    builtinKey: "image-interior-home",
    name: "软装米灰",
    description: "适合室内设计、家居软装、空间改造、民宿和展厅效果图。",
    category: "空间家居",
    colors: [
      { id: "interior-warm-white", name: "米白", role: "背景色", hex: "#F5EFE6" },
      { id: "interior-soft-gray", name: "米灰", role: "主色", hex: "#D6D3CC" },
      { id: "interior-light-wood", name: "浅木色", role: "辅助色", hex: "#C8A27A" }
    ],
    gradients: [
      { id: "interior-soft-gradient", name: "米灰空间", role: "空间基调", colors: ["#F5EFE6", "#D6D3CC", "#C8A27A"] }
    ],
    prompt: "保持低饱和、自然材质和柔和采光，突出空间层次和居住感。",
    visible: true,
    sortOrder: 90
  },
  {
    builtinKey: "image-interior-home-modern",
    name: "现代黑白",
    description: "适合现代公寓、办公空间、展厅、极简家居和建筑室内。",
    category: "空间家居",
    colors: [
      { id: "interior-modern-black", name: "线条黑", role: "主色", hex: "#111827" },
      { id: "interior-modern-white", name: "纯白", role: "背景色", hex: "#FFFFFF" },
      { id: "interior-modern-concrete", name: "混凝土灰", role: "辅助色", hex: "#9CA3AF" }
    ],
    gradients: [
      { id: "interior-modern-gradient", name: "现代灰阶", role: "空间基调", colors: ["#FFFFFF", "#9CA3AF", "#111827"] }
    ],
    prompt: "强调线条、结构和材质对比，保持空间干净有秩序。",
    visible: true,
    sortOrder: 91
  },
  {
    builtinKey: "image-interior-home-wood",
    name: "奶油原木",
    description: "适合奶油风家居、亲子空间、民宿软装和温暖生活场景。",
    category: "空间家居",
    colors: [
      { id: "interior-wood-cream", name: "奶油白", role: "背景色", hex: "#F5EFE6" },
      { id: "interior-wood-natural", name: "原木色", role: "主色", hex: "#C8A27A" },
      { id: "interior-wood-olive", name: "软橄榄", role: "点缀色", hex: "#8A9A5B" }
    ],
    gradients: [
      { id: "interior-wood-gradient", name: "奶油木纹", role: "空间基调", colors: ["#F5EFE6", "#C8A27A", "#8A9A5B"] }
    ],
    prompt: "保持温暖、柔软和自然木质感，避免画面发黄或过度滤镜。",
    visible: true,
    sortOrder: 92
  },
  {
    builtinKey: "image-cinema-game",
    name: "电影能量",
    description: "适合电影海报、游戏角色、剧情氛围和视觉大片。",
    category: "影视游戏",
    colors: [
      { id: "cinema-deep-blue", name: "电影深蓝", role: "主色", hex: "#0F172A" },
      { id: "cinema-tungsten-orange", name: "钨丝橙", role: "辅助光", hex: "#F59E0B" },
      { id: "cinema-energy-purple", name: "能量紫", role: "光效", hex: "#8B5CF6" }
    ],
    gradients: [
      { id: "cinema-game-gradient", name: "电影能量光", role: "主视觉光效", colors: ["#0F172A", "#8B5CF6", "#F59E0B"] }
    ],
    prompt: "强调冷暖对比、戏剧光影和角色张力，避免画面灰暗糊成一片。",
    visible: true,
    sortOrder: 100
  },
  {
    builtinKey: "image-cinema-game-cyber",
    name: "赛博霓虹",
    description: "适合科幻角色、未来城市、机甲装备和游戏技能特效。",
    category: "影视游戏",
    colors: [
      { id: "cinema-cyber-cyan", name: "赛博青", role: "光效", hex: "#00E5FF" },
      { id: "cinema-cyber-purple", name: "霓虹紫", role: "辅助色", hex: "#A855F7" },
      { id: "cinema-cyber-night", name: "夜幕黑", role: "背景色", hex: "#050816" }
    ],
    gradients: [
      { id: "cinema-cyber-gradient", name: "赛博夜光", role: "主视觉光效", colors: ["#050816", "#A855F7", "#00E5FF"] }
    ],
    prompt: "强调发光边缘、未来材质和速度感，避免霓虹糊成一片。",
    visible: true,
    sortOrder: 101
  },
  {
    builtinKey: "image-cinema-game-fantasy",
    name: "史诗奇幻",
    description: "适合奇幻角色、史诗场景、魔法海报和游戏世界观设定。",
    category: "影视游戏",
    colors: [
      { id: "cinema-fantasy-blue", name: "王国蓝", role: "主色", hex: "#1E3A8A" },
      { id: "cinema-fantasy-gold", name: "魔法金", role: "点缀色", hex: "#FBBF24" },
      { id: "cinema-fantasy-purple", name: "秘境紫", role: "辅助色", hex: "#6D28D9" }
    ],
    gradients: [
      { id: "cinema-fantasy-gradient", name: "史诗魔法光", role: "世界观氛围", colors: ["#1E3A8A", "#6D28D9", "#FBBF24"] }
    ],
    prompt: "强调宏大场景、魔法光效和角色史诗感，保持主体清晰。",
    visible: true,
    sortOrder: 102
  }
];

export function normalizePromptColorSchemeHex(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  const shortMatch = normalized.match(/^#?([0-9A-F]{3})$/);
  if (shortMatch) {
    return `#${shortMatch[1].split("").map((char) => `${char}${char}`).join("")}`;
  }
  const longMatch = normalized.match(/^#?([0-9A-F]{6})$/);
  return longMatch ? `#${longMatch[1]}` : "";
}

function normalizedText(value: unknown, fallback = "", maxLength = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function fallbackId(prefix: string, index: number, value: string) {
  const slug = value
    .toLowerCase()
    .replace(/#[0-9a-f]+/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${slug || index + 1}`;
}

export function sanitizePromptColorSchemeColors(value: unknown): PromptColorSchemeColor[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const record = raw as Record<string, unknown>;
    const hex = normalizePromptColorSchemeHex(record.hex);
    if (!hex) return [];
    const name = normalizedText(record.name, hex, 40);
    return [{
      id: normalizedText(record.id, fallbackId("color", index, `${name}-${hex}`), 80),
      name,
      role: normalizedText(record.role, "颜色", 40),
      hex
    }];
  });
}

export function sanitizePromptColorSchemeGradients(value: unknown): PromptColorSchemeGradient[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const record = raw as Record<string, unknown>;
    const colors = Array.isArray(record.colors)
      ? record.colors.map(normalizePromptColorSchemeHex).filter(Boolean).slice(0, 5)
      : [];
    if (colors.length < 2) return [];
    const name = normalizedText(record.name, colors.join(" -> "), 40);
    return [{
      id: normalizedText(record.id, fallbackId("gradient", index, `${name}-${colors.join("-")}`), 80),
      name,
      role: normalizedText(record.role, "背景色", 40),
      colors
    }];
  });
}

export function promptColorSchemeValueText(scheme: Pick<PromptColorScheme, "colors" | "gradients">) {
  return [
    ...scheme.colors.map((color) => `${color.role || "颜色"}：${color.name} ${color.hex}`),
    ...scheme.gradients.map((gradient) => `${gradient.role || "渐变"}：${gradient.name} ${gradient.colors.join(" -> ")}`)
  ].join("；");
}

export function promptColorSchemeInjectionText(scheme: PromptColorScheme | null | undefined) {
  if (!scheme || scheme.id === PROMPT_COLOR_SCHEME_NONE_ID) return "";
  const valueText = promptColorSchemeValueText(scheme);
  if (!valueText) return "";
  const prompt = scheme.prompt.trim() || "保持整体配色统一，不要与用户已明确指定的颜色冲突。";
  return `色系要求：\n${breakPromptColorSchemeSemicolons(`${valueText}。${prompt.replace(/[。.]?$/, "。")}`)}`;
}

export function promptColorSchemesInjectionText(schemes: PromptColorScheme[]) {
  const items = schemes.flatMap((scheme) => {
    const valueText = promptColorSchemeValueText(scheme);
    if (!valueText) return [];
    const prompt = scheme.prompt.trim() || "保持整体配色统一，不要与用户已明确指定的颜色冲突。";
    return [`${scheme.name}：${valueText}。${prompt.replace(/[。.]?$/, "。")}`];
  });
  return items.length > 0 ? `色系要求：\n${breakPromptColorSchemeSemicolons(items.join("；"))}` : "";
}

export function promptCustomColorSchemeInjectionText(value: unknown) {
  const hex = normalizePromptColorSchemeHex(value);
  return hex ? `色系要求：\n自定义色：${hex}。\n围绕该颜色进行色系搭配，保持整体配色统一。` : "";
}

export function promptCustomColorSchemeHexFromInjection(value: unknown) {
  const match = String(value ?? "").match(/自定义色：\s*(#?[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?)/);
  return normalizePromptColorSchemeHex(match?.[1]);
}

function breakPromptColorSchemeSemicolons(text: string) {
  return text
    .split("；")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("；\n");
}

export function applyPromptColorSchemeInjection(source: string, previousInjection: string, nextInjection: string) {
  const current = String(source ?? "");
  const previous = previousInjection.trim();
  const next = nextInjection.trim();
  let base = current;
  const foundPrevious = Boolean(previous) && base.includes(previous);
  if (foundPrevious) {
    base = base.replace(previous, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (!next) return { prompt: base.trim(), replaced: foundPrevious };
  if (!base.trim()) return { prompt: next, replaced: foundPrevious };
  return { prompt: `${base.trimEnd()}\n\n${next}`, replaced: foundPrevious };
}

export function normalizePromptColorSchemeId(value: unknown, schemes: PromptColorScheme[]) {
  const text = String(value ?? "").trim();
  if (!text || text === PROMPT_COLOR_SCHEME_NONE_ID) return PROMPT_COLOR_SCHEME_NONE_ID;
  return schemes.some((scheme) => scheme.id === text && scheme.visible) ? text : PROMPT_COLOR_SCHEME_NONE_ID;
}

export function normalizePromptColorSchemeIds(value: unknown, schemes: PromptColorScheme[]) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const seen = new Set<string>();
  return source.flatMap((item) => {
    const id = String(item ?? "").trim();
    if (!id || id === PROMPT_COLOR_SCHEME_NONE_ID || seen.has(id)) return [];
    if (!schemes.some((scheme) => scheme.id === id && scheme.visible)) return [];
    seen.add(id);
    return [id];
  });
}

export function promptColorSchemeById(value: unknown, schemes: PromptColorScheme[]) {
  const id = normalizePromptColorSchemeId(value, schemes);
  return id === PROMPT_COLOR_SCHEME_NONE_ID ? null : schemes.find((scheme) => scheme.id === id) ?? null;
}

export function promptColorSchemesByIds(value: unknown, schemes: PromptColorScheme[]) {
  const ids = normalizePromptColorSchemeIds(value, schemes);
  return ids.flatMap((id) => schemes.find((scheme) => scheme.id === id) ?? []);
}
