import type { CaseCategory } from "../types";
import { publicAssetPath } from "./publicAssets";

export const DEFAULT_CASE_ITEM_ID_PREFIX = "default-case-";

const DEFAULT_CASE_CREATED_AT = "2026-06-10T00:00:00.000Z";
const DEFAULT_CASE_IMAGE_SIZE = 640;

type DefaultCaseSeed = {
  slug: string;
  title: string;
  categoryName: string;
  prompt: string;
  image: string;
  imageFileSize: number;
};

const DEFAULT_CASE_SEEDS: DefaultCaseSeed[] = [
  {
    slug: "product-showcase",
    title: "天然护肤品电商主图",
    categoryName: "商品图",
    prompt: "为一套天然护肤品生成电商主图，奶油色丝绸背景，磨砂玻璃瓶和金属盖，加入少量植物点缀，高级柔光，画面干净。",
    image: "product-showcase.webp",
    imageFileSize: 18148
  },
  {
    slug: "travel-guide",
    title: "海岛旅行攻略视觉",
    categoryName: "旅行攻略",
    prompt: "生成一张海岛旅行攻略长图主视觉，包含手绘路线地图、海岸、相机、饮品和热带植物，明亮夏日色彩。",
    image: "travel-guide.webp",
    imageFileSize: 64936
  },
  {
    slug: "event-poster",
    title: "科技发布会主舞台",
    categoryName: "活动海报",
    prompt: "设计一张科技发布会主舞台海报，深色空间、蓝紫霓虹灯、几何大屏和观众剪影，电影感灯光。",
    image: "event-poster.webp",
    imageFileSize: 29120
  },
  {
    slug: "interior-design",
    title: "自然风客厅效果图",
    categoryName: "空间设计",
    prompt: "生成一张现代自然风客厅效果图，奶油沙发、木质书架、绿植、暖阳窗光，舒适高级。",
    image: "interior-design.webp",
    imageFileSize: 56630
  },
  {
    slug: "food-photography",
    title: "高级餐厅菜品海报",
    categoryName: "美食摄影",
    prompt: "拍摄一张高级餐厅菜品海报，黑色餐盘、煎鱼、青菜、酱汁光泽和热气，浅景深美食摄影。",
    image: "food-photography.webp",
    imageFileSize: 76994
  },
  {
    slug: "brand-identity",
    title: "极简品牌视觉样机",
    categoryName: "品牌视觉",
    prompt: "设计一套极简品牌视觉样机，抽象几何标志压印在包装、名片和门店圆形招牌上，米白和橄榄绿配色。",
    image: "brand-identity.webp",
    imageFileSize: 28206
  },
  {
    slug: "cinematic-portrait",
    title: "电影感职业人像",
    categoryName: "人像摄影",
    prompt: "生成一张电影感职业人像，人物穿米色西装，侧窗暖光，浅景深，表情自信自然，杂志摄影质感。",
    image: "cinematic-portrait.webp",
    imageFileSize: 26890
  },
  {
    slug: "pet-portrait",
    title: "宠物生活写真",
    categoryName: "宠物写真",
    prompt: "拍一张宠物生活写真，橘猫和小狗坐在柔软毯子上，背景有绿植和晨光，温暖可爱，高级摄影。",
    image: "pet-portrait.webp",
    imageFileSize: 58842
  },
  {
    slug: "festival-visual",
    title: "现代国潮节日主视觉",
    categoryName: "节日视觉",
    prompt: "生成一张现代国潮节日主视觉，红灯笼、绸带、剪纸纹样、梅花和金色器物，暗调高级灯光。",
    image: "festival-visual.webp",
    imageFileSize: 54394
  },
  {
    slug: "storybook-illustration",
    title: "儿童绘本森林场景",
    categoryName: "绘本插画",
    prompt: "绘制一张儿童绘本森林场景，发光蘑菇、木屋、小溪、萤火虫和树上的猫头鹰，温柔水彩质感。",
    image: "storybook-illustration.webp",
    imageFileSize: 118180
  }
];

export const DEFAULT_CASE_ITEMS: CaseCategory["items"] = DEFAULT_CASE_SEEDS.map((seed) => {
  const id = `${DEFAULT_CASE_ITEM_ID_PREFIX}${seed.slug}`;
  const categoryId = `${DEFAULT_CASE_ITEM_ID_PREFIX}category-${seed.slug}`;
  const imageUrl = publicAssetPath(`/image/default-cases/${seed.image}`);
  return {
    id,
    title: seed.title,
    prompt: seed.prompt,
    imageUrl,
    imageOriginalUrl: imageUrl,
    imagePreviewUrl: imageUrl,
    imageThumbnailUrl: imageUrl,
    downloadSourceType: null,
    downloadSourceId: null,
    createdAt: DEFAULT_CASE_CREATED_AT,
    imageWidth: DEFAULT_CASE_IMAGE_SIZE,
    imageHeight: DEFAULT_CASE_IMAGE_SIZE,
    imageFileSize: seed.imageFileSize,
    useCount: 0,
    favoriteCount: 0,
    favorited: false,
    sourceUsername: "系统示例",
    canDelete: false,
    groupId: id,
    categoryIds: [categoryId],
    categoryNames: [seed.categoryName],
    includeReferences: false,
    reviewStatus: "approved",
    reviewRequestedAt: "",
    reviewedAt: DEFAULT_CASE_CREATED_AT,
    rejectReason: "",
    images: [],
    imageCount: 1,
    coverImageId: id,
    referenceImages: []
  };
});

export function defaultCaseItems(limit = DEFAULT_CASE_ITEMS.length) {
  return DEFAULT_CASE_ITEMS.slice(0, limit);
}

export function isDefaultCaseItemId(id: string) {
  return id.startsWith(DEFAULT_CASE_ITEM_ID_PREFIX);
}
