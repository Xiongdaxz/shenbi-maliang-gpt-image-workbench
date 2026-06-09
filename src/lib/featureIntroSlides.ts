import type { FeatureIntroSlide } from "../components/FeatureIntroModal";

export const APP_INTRO_SLIDES: FeatureIntroSlide[] = [
  {
    id: "chat",
    title: "对话页面",
    description: [
      "自然语言描述画面，写什么就生成什么。",
      "会思考的 AI 能理解主体、风格、镜头和氛围。",
      "继续追问改细节，持续打磨到满意。"
    ],
    imageSrc: "/image/intro-compose.svg",
    imageAlt: "对话页面示意",
    tags: ["自然语言生图", "会思考的AI", "多轮打磨"],
    accent: "#0f766e"
  },
  {
    id: "editor",
    title: "编辑区域",
    description: ["放大检查、旋转缩放、切换比例，细节能慢慢看。", "想只改一小块时，涂抹选区再说怎么改。", "局部变化更精准，其他地方尽量保持稳定。"],
    imageSrc: "/image/intro-editor.svg",
    imageAlt: "编辑区域示意",
    tags: ["涂抹编辑", "局部重绘", "尺寸改版"],
    accent: "#0284c7"
  },
  {
    id: "cases",
    title: "灵感空间",
    description: [
      "把好看的案例、风格方向和提示词沉淀成共享灵感。",
      "你可以直接借鉴他人的创作思路，快速起步。",
      "也可以把自己的灵感沉淀出来，给他人参考。",
      "灵感共享让团队共创更快，真正做到 1+1>2。"
    ],
    imageSrc: "/image/intro-cases.svg",
    imageAlt: "灵感空间示意",
    tags: ["风格案例", "提示词复用", "一键带入"],
    accent: "#7c3aed"
  },
  {
    id: "assets",
    title: "素材库",
    description: ["个人和共享素材都能放好。", "产品图、头像、背景分类清楚。", "生成和编辑时随取随用。"],
    imageSrc: "/image/intro-assets.svg",
    imageAlt: "素材库示意",
    tags: ["共享素材", "多类型素材选择", "分类管理", "随取随用"],
    accent: "#d97706"
  },
  {
    id: "images",
    title: "我的图片",
    description: ["这里像你的作品墙，所有历史作品都会沉淀下来。", "支持不同展示模式浏览，也能收藏和下载。", "看到旧图有新想法，随时打开继续编辑。"],
    imageSrc: "/image/intro-images.svg",
    imageAlt: "我的图片示意",
    tags: ["我的图片展示模式", "收藏下载", "继续编辑"],
    accent: "#e11d48"
  },
  {
    id: "prompt-templates",
    title: "创作提示词",
    description: [
      "常用场景做成表单，按字段填就能创作。",
      "没头绪时，表单和 AI 会帮你打开思路。",
      "AI 自动优化正向和反向提示词。",
      "表单可分享，中英文与历史版本可复用。"
    ],
    imageSrc: "/image/intro-prompt-templates.svg",
    imageAlt: "创作提示词示意",
    tags: ["表单化创作", "AI辅助起步", "表单分享", "历史复用"],
    accent: "#65a30d"
  },
  {
    id: "chat-manage",
    title: "数据隐私",
    description: ["图片访问、图片存储双加密，内容更安心。", "对话支持归档和删除，历史管理更清晰。", "下载支持多规格，分享和留存更方便。"],
    imageSrc: "/image/intro-chat-manage.svg",
    imageAlt: "数据隐私示意",
    tags: ["数据隐私", "图片加密", "归档删除", "多规格下载"],
    accent: "#6366f1"
  }
];
