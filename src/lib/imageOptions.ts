export type SizeOption = {
  value: string;
  label: string;
  ratio: string;
  previewRatio?: string;
  description: string;
};

export type QualityOption = {
  value: string;
  label: string;
  description: string;
};

const DEFAULT_REQUEST_SIZE = "auto";

const BASE_SIZE_OPTIONS: SizeOption[] = [
  { value: "1024x1024", label: "方形", ratio: "1:1", previewRatio: "1 / 1", description: "头像、产品图、通用配图" },
  { value: "1536x2048", label: "竖版", ratio: "3:4", previewRatio: "3 / 4", description: "海报、人物、封面" },
  { value: "1152x2048", label: "故事", ratio: "9:16", previewRatio: "9 / 16", description: "手机故事、短视频封面" },
  { value: "2048x1536", label: "横屏", ratio: "4:3", previewRatio: "4 / 3", description: "插画、横向构图" },
  { value: "2048x1152", label: "宽屏", ratio: "16:9", previewRatio: "16 / 9", description: "大屏横幅、演示封面" }
];

const QUALITY_LABELS: Record<string, string> = {
  auto: "自动",
  low: "低",
  medium: "中",
  high: "高"
};

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function sizeOptionFromValue(value: string): SizeOption {
  const preset = BASE_SIZE_OPTIONS.find((item) => item.value === value);
  if (preset) return preset;
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return { value, label: value, ratio: value, description: "自定义尺寸" };
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  return {
    value,
    label: width === height ? "方形" : width > height ? "横图" : "竖图",
    ratio,
    previewRatio: `${width} / ${height}`,
    description: value
  };
}

export function buildSizeOptions() {
  return BASE_SIZE_OPTIONS;
}

export function requestSizeFromSelection(value: string) {
  return value.trim() || DEFAULT_REQUEST_SIZE;
}

export function buildQualityOptions(configuredQualities: string[]): QualityOption[] {
  return unique(["low", "medium", "high", ...configuredQualities])
    .map((item) => item.trim())
    .filter((item) => item.toLowerCase() !== "auto")
    .map((value) => ({
      value,
      label: QUALITY_LABELS[value] ?? value,
      description: value
    }));
}
