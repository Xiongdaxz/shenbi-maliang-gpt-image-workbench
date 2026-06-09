export const promptOptimizeStyleGroups = [
  { value: "standard", label: "标准", description: "结构清晰，适合通用生图。" },
  {
    value: "realistic",
    label: "写实",
    description: "强化摄影感、镜头、光线和材质。",
    children: [
      { value: "realistic:portrait-photography", label: "人像摄影", description: "浅景深、肤质、情绪光。" },
      { value: "realistic:commercial-product", label: "商业产品", description: "白底、精准打光、质感呈现。" },
      { value: "realistic:documentary-street", label: "纪实街拍", description: "自然光、抓拍感、颗粒感。" },
      { value: "realistic:landscape-blockbuster", label: "风光大片", description: "黄金时段、广角、壮阔场景。" },
      { value: "realistic:macro-closeup", label: "微距特写", description: "极致细节、焦外虚化。" },
      { value: "realistic:fashion-editorial", label: "时尚大片", description: "高级感、杂志质感。" }
    ]
  },
  {
    value: "cinematic",
    label: "电影",
    description: "强化叙事、色调、镜头语言和情绪。",
    children: [
      { value: "cinematic:hollywood-blockbuster", label: "好莱坞大片", description: "史诗感、强对比、视觉冲击。" },
      { value: "cinematic:cyberpunk", label: "赛博朋克", description: "霓虹、雨夜、未来都市。" },
      { value: "cinematic:film-noir", label: "黑色电影", description: "高反差黑白、阴影、悬疑感。" },
      { value: "cinematic:european-art-house", label: "欧洲文艺", description: "自然光、慢节奏、写实克制。" },
      { value: "cinematic:horror-thriller", label: "恐怖惊悚", description: "阴暗、压抑、诡异氛围。" },
      { value: "cinematic:historical-epic", label: "古装史诗", description: "宏大战争、宫廷、历史质感。" },
      { value: "cinematic:sci-fi-space", label: "科幻太空", description: "宇宙、飞船、未来科技感。" }
    ]
  },
  {
    value: "anime",
    label: "动漫",
    description: "适配二次元、插画和角色画风。",
    children: [
      { value: "anime:ghibli", label: "吉卜力", description: "自然、温暖、手绘水彩感。" },
      { value: "anime:shonen-action", label: "少年热血", description: "动感、夸张动作、爆炸特效。" },
      { value: "anime:shinkai", label: "新海诚", description: "光晕、细腻背景、唯美现实。" },
      { value: "anime:cel-animation", label: "赛璐璐", description: "复古动画平涂风格。" },
      { value: "anime:mecha-battle", label: "机甲战斗", description: "高达/EVA 类硬核机械。" },
      { value: "anime:shojo-dreamy", label: "少女唯美", description: "粉嫩、花卉、梦幻。" },
      { value: "anime:dark-gothic", label: "暗黑哥特", description: "地下城、克苏鲁、恶魔风。" }
    ]
  },
  {
    value: "artistic",
    label: "艺术",
    description: "加入绘画流派、笔触和媒介质感。",
    children: [
      { value: "artistic:classical-oil", label: "油画古典", description: "伦勃朗、文艺复兴光影。" },
      { value: "artistic:watercolor-illustration", label: "水彩插画", description: "透明感、晕染、轻盈。" },
      { value: "artistic:concept-art", label: "概念艺术", description: "游戏、影视概念设计风。" },
      { value: "artistic:pop-art", label: "波普艺术", description: "高饱和、重复图案、安迪沃霍尔。" },
      { value: "artistic:minimalism", label: "极简主义", description: "几何、留白、纯色块。" },
      { value: "artistic:surrealism", label: "超现实主义", description: "达利风、梦境逻辑。" },
      { value: "artistic:pixel-art", label: "像素艺术", description: "8-bit/16-bit 复古游戏感。" }
    ]
  },
  {
    value: "commercial",
    label: "商业",
    description: "更偏营销、海报和转化表达。",
    children: [
      { value: "commercial:ecommerce-product", label: "电商产品", description: "简洁背景、突出卖点。" },
      { value: "commercial:brand-advertising", label: "品牌广告", description: "高端调性、视觉统一。" },
      { value: "commercial:social-media", label: "社交媒体", description: "活泼构图、高饱和抓眼。" },
      { value: "commercial:corporate-promo", label: "企业宣传", description: "专业、可信、大气。" }
    ]
  },
  {
    value: "series",
    label: "组图",
    description: "拆成风格统一、用途明确的一组图片。",
    children: [
      { value: "series:marketing-campaign", label: "营销套图", description: "主视觉、卖点、场景、活动、封面。" },
      { value: "series:ecommerce-detail", label: "电商详情", description: "主图、细节、场景、规格卖点。" },
      { value: "series:social-content", label: "社媒内容", description: "封面、正文配图、步骤对比、结尾图。" },
      { value: "series:brand-visual", label: "品牌延展", description: "KV、海报、Banner、应用场景。" },
      { value: "series:storyboard", label: "故事分镜", description: "同一主体的连续镜头和场景变化。" },
      { value: "series:logo-design", label: "Logo设计", description: "标志方向、图形标、字标、黑白版、应用场景。" }
    ]
  },
  {
    value: "composition",
    label: "构图",
    description: "根据提示词类型自动选择构图手法。",
    children: [
      { value: "composition:rule-of-thirds", label: "三分法", description: "主体落在三分交点，画面均衡。" },
      { value: "composition:center-symmetry", label: "中心对称", description: "主体居中，轴线稳定，秩序感强。" },
      { value: "composition:leading-lines", label: "引导线", description: "线条、道路或光影将视线带向主体。" },
      { value: "composition:frame-within-frame", label: "框中框", description: "门窗、前景或结构形成天然画框。" },
      { value: "composition:diagonal-dynamic", label: "对角线动势", description: "斜线切入，增强速度感和张力。" },
      { value: "composition:negative-space", label: "留白构图", description: "大面积留白，突出主体和情绪。" },
      { value: "composition:foreground-depth", label: "前景层次", description: "前景、中景、背景形成空间纵深。" },
      { value: "composition:golden-spiral", label: "黄金螺旋", description: "螺旋动线组织视觉焦点。" },
      { value: "composition:close-crop", label: "近景裁切", description: "大胆裁切，强化局部细节和冲击。" },
      { value: "composition:flat-lay", label: "平铺俯拍", description: "俯视排列，突出秩序和图案感。" }
    ]
  },
  {
    value: "detailed",
    label: "细节",
    description: "补足镜头、材质、光线和构图。",
    children: [
      { value: "detailed:material-texture", label: "材质纹理", description: "强化布料、金属、皮肤等质感。" },
      { value: "detailed:lighting-enhancement", label: "光影强化", description: "精细光源方向和阴影层次。" },
      { value: "detailed:environment-atmosphere", label: "环境氛围", description: "烟雾、粒子、体积光细节。" }
    ]
  },
  {
    value: "creative",
    label: "创意",
    description: "加强画面想象力和风格表达。",
    children: [
      { value: "creative:surreal-collage", label: "超现实拼贴", description: "打破常规的元素组合。" },
      { value: "creative:double-exposure", label: "双重曝光", description: "影像叠加融合。" },
      { value: "creative:glitch-art", label: "故障艺术", description: "Glitch、数字噪点美学。" },
      { value: "creative:fantasy-world", label: "奇幻世界观", description: "架空世界、异世界构建。" }
    ]
  }
] as const;

type PromptOptimizeStyleGroup = typeof promptOptimizeStyleGroups[number];
type PromptOptimizeStyleChild<T> = T extends { readonly children: readonly (infer Child)[] } ? Child : never;

export type PromptTemplateOptimizeStyle =
  | PromptOptimizeStyleGroup["value"]
  | PromptOptimizeStyleChild<PromptOptimizeStyleGroup>["value"];

export type PromptOptimizeStyleOption = {
  value: PromptTemplateOptimizeStyle;
  label: string;
  description: string;
  parentValue?: PromptTemplateOptimizeStyle;
  parentLabel?: string;
};

export const promptOptimizeStyleOptions: PromptOptimizeStyleOption[] = promptOptimizeStyleGroups.flatMap((group) => {
  const parentOption: PromptOptimizeStyleOption = {
    value: group.value,
    label: group.label,
    description: group.description
  };
  const childOptions = "children" in group
    ? group.children.map((child) => ({
        value: child.value,
        label: child.label,
        description: child.description,
        parentValue: group.value,
        parentLabel: group.label
      }))
    : [];
  return [parentOption, ...childOptions];
});

const promptOptimizeStyleValueSet = new Set(promptOptimizeStyleOptions.map((option) => option.value));

export function normalizePromptOptimizeStyle(value: string | null | undefined): PromptTemplateOptimizeStyle {
  const text = String(value ?? "").trim();
  return promptOptimizeStyleValueSet.has(text as PromptTemplateOptimizeStyle) ? (text as PromptTemplateOptimizeStyle) : "standard";
}

export function isPromptOptimizeSeriesStyle(value: string | null | undefined) {
  const normalized = normalizePromptOptimizeStyle(value);
  return normalized === "series" || normalized.startsWith("series:");
}

export function promptOptimizeStyleOption(value: string | null | undefined) {
  const normalized = normalizePromptOptimizeStyle(value);
  return promptOptimizeStyleOptions.find((option) => option.value === normalized) ?? promptOptimizeStyleOptions[0];
}

export function promptOptimizeStyleFullLabel(value: string | null | undefined) {
  const option = promptOptimizeStyleOption(value);
  return option.parentLabel ? `${option.parentLabel} / ${option.label}` : option.label;
}

export function promptOptimizeStyleDefaultPrompt(value: string | null | undefined) {
  const option = promptOptimizeStyleOption(value);
  const description = option.description.replace(/[。.]$/, "");
  const styleName = option.parentLabel ? `${option.parentLabel} / ${option.label}` : option.label;
  if (option.value === "composition") {
    return `请生成一张构图优化的高质量图片，${description}，根据提示词类型自动选择三分法、中心对称、引导线、框中框、留白、前景层次等合适构图手法，主体明确，视觉层级清晰，画面有层次，细节清晰。`;
  }
  if (option.parentValue === "composition") {
    return `请生成一张采用${option.label}构图的高质量图片，${description}，主体明确，视觉层级清晰，画面有层次，细节清晰。`;
  }
  if (option.value === "series") {
    return `请生成一套组图，${description}，保持同一主体、配色、光线、构图语言和视觉调性一致，每张图用途不同，适合连续生成。`;
  }
  if (option.parentValue === "series") {
    return `请生成一组${option.label}组图，${description}，保持同一主体、配色、光线、构图语言和视觉调性一致，每张图用途不同，适合连续生成。`;
  }
  return `请生成一张${styleName}风格的高质量图片，${description}，主体明确，构图完整，画面有层次，细节清晰。`;
}
