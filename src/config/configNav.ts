import {
  Activity,
  ArrowDown,
  ArrowUp,
  Archive,
  Bot,
  Bug,
  Check,
  Database,
  Download,
  FolderOpen,
  ImageIcon,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  LogOut,
  Mail,
  Network,
  PanelLeft,
  Pencil,
  ScrollText,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Upload,
  Users,
  WandSparkles
} from "lucide-react";

export const CONFIG_TAB_STORAGE_KEY = "gpt-image.config.activeTab";
export const CONFIG_SIDE_COLLAPSED_STORAGE_KEY = "gpt-image.config.sidebarCollapsed";
export const CONFIG_TAB_VALUES = [
  "statistics",
  "users",
  "teams",
  "assetReviews",
  "caseReviews",
  "imageAccounts",
  "providers",
  "promptOptimizer",
  "safetyReview",
  "smtp",
  "sms",
  "starterCopy",
  "branding",
  "imageMode",
  "cpa",
  "backup",
  "proxy",
  "debug",
  "changelog",
  "modelLogs",
  "requests",
  "audit"
] as const;

export type ConfigTabValue = (typeof CONFIG_TAB_VALUES)[number];
export type ConfigNavCategoryValue = "overview" | "members" | "content" | "generation" | "system";
export type ConfigNavItem = {
  value: ConfigTabValue;
  label: string;
  Icon: typeof Activity;
};

export const CONFIG_NAV_ITEMS: ConfigNavItem[] = [
  { value: "statistics", label: "数据统计", Icon: Activity },
  { value: "users", label: "用户账号", Icon: Users },
  { value: "teams", label: "团队管理", Icon: Shield },
  { value: "assetReviews", label: "素材审核", Icon: FolderOpen },
  { value: "caseReviews", label: "灵感审核", Icon: Lightbulb },
  { value: "imageAccounts", label: "账号池", Icon: ShieldCheck },
  { value: "providers", label: "渠道配置", Icon: KeyRound },
  { value: "promptOptimizer", label: "模型配置", Icon: WandSparkles },
  { value: "safetyReview", label: "安全审核", Icon: ShieldCheck },
  { value: "smtp", label: "邮件配置", Icon: Mail },
  { value: "sms", label: "短信配置", Icon: Smartphone },
  { value: "starterCopy", label: "空白页文案", Icon: Bot },
  { value: "branding", label: "品牌设置", Icon: ImageIcon },
  { value: "imageMode", label: "模式配置", Icon: SlidersHorizontal },
  { value: "cpa", label: "CPA 同步", Icon: RefreshCw },
  { value: "backup", label: "数据备份", Icon: Archive },
  { value: "proxy", label: "代理配置", Icon: Network },
  { value: "debug", label: "调试配置", Icon: Bug },
  { value: "changelog", label: "更新日志", Icon: ScrollText },
  { value: "modelLogs", label: "模型日志", Icon: Bot },
  { value: "requests", label: "请求日志", Icon: Activity },
  { value: "audit", label: "审计", Icon: Database }
];

export const CONFIG_NAV_CATEGORIES: Array<{
  value: ConfigNavCategoryValue;
  label: string;
  items: ConfigTabValue[];
}> = [
  { value: "overview", label: "概览", items: ["statistics"] },
  { value: "members", label: "组织", items: ["users", "teams"] },
  { value: "content", label: "内容", items: ["assetReviews", "caseReviews", "starterCopy", "changelog"] },
  { value: "generation", label: "生成", items: ["imageAccounts", "providers", "promptOptimizer", "safetyReview", "imageMode", "cpa"] },
  { value: "system", label: "系统", items: ["branding", "smtp", "sms", "backup", "proxy", "debug", "modelLogs", "requests", "audit"] }
];

export function isConfigTabValue(value: string | null | undefined): value is ConfigTabValue {
  return Boolean(value) && CONFIG_TAB_VALUES.includes(value as ConfigTabValue);
}

export function configNavItemsForCategory(categoryValue: ConfigNavCategoryValue) {
  const category = CONFIG_NAV_CATEGORIES.find((item) => item.value === categoryValue) ?? CONFIG_NAV_CATEGORIES[0];
  return category.items
    .map((value) => CONFIG_NAV_ITEMS.find((item) => item.value === value))
    .filter((item): item is ConfigNavItem => Boolean(item));
}

export function storedConfigTab(): ConfigTabValue {
  try {
    const value = window.localStorage.getItem(CONFIG_TAB_STORAGE_KEY);
    if (value === "file") return "debug";
    return isConfigTabValue(value) ? value : "statistics";
  } catch {
    return "statistics";
  }
}

export function storedConfigSideCollapsed() {
  try {
    return window.localStorage.getItem(CONFIG_SIDE_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
