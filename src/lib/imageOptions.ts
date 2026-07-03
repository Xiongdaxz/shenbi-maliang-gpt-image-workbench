export type SizeOption = {
  value: string;
  label: string;
  labelKey?: string;
  ratio: string;
  previewRatio?: string;
  description: string;
  descriptionKey?: string;
};

export type QualityOption = {
  value: string;
  label: string;
  labelKey?: string;
  description: string;
  descriptionKey?: string;
};

const DEFAULT_REQUEST_SIZE = "auto";

const BASE_SIZE_OPTIONS: SizeOption[] = [
  { value: "1024x1024", label: "方形", labelKey: "picker.size.square", ratio: "1:1", previewRatio: "1 / 1", description: "头像、产品图、通用配图", descriptionKey: "picker.size.squareDesc" },
  { value: "1536x2048", label: "竖版", labelKey: "picker.size.portrait", ratio: "3:4", previewRatio: "3 / 4", description: "海报、人物、封面", descriptionKey: "picker.size.portraitDesc" },
  { value: "1152x2048", label: "故事", labelKey: "picker.size.story", ratio: "9:16", previewRatio: "9 / 16", description: "手机故事、短视频封面", descriptionKey: "picker.size.storyDesc" },
  { value: "2048x1536", label: "横屏", labelKey: "picker.size.landscape", ratio: "4:3", previewRatio: "4 / 3", description: "插画、横向构图", descriptionKey: "picker.size.landscapeDesc" },
  { value: "2048x1152", label: "宽屏", labelKey: "picker.size.widescreen", ratio: "16:9", previewRatio: "16 / 9", description: "大屏横幅、演示封面", descriptionKey: "picker.size.widescreenDesc" }
];

const QUALITY_PRESETS: Record<string, { label: string; labelKey: string; descriptionKey: string }> = {
  low: { label: "低", labelKey: "picker.quality.low", descriptionKey: "picker.quality.lowDesc" },
  medium: { label: "中", labelKey: "picker.quality.medium", descriptionKey: "picker.quality.mediumDesc" },
  high: { label: "高", labelKey: "picker.quality.high", descriptionKey: "picker.quality.highDesc" }
};

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function sizeOptionFromValue(value: string): SizeOption {
  const preset = BASE_SIZE_OPTIONS.find((item) => item.value === value);
  if (preset) return preset;
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return { value, label: value, ratio: value, description: "自定义尺寸", descriptionKey: "picker.size.custom" };
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  const labelKey = width === height ? "picker.size.square" : width > height ? "picker.size.landscapeImage" : "picker.size.portraitImage";
  return {
    value,
    label: width === height ? "方形" : width > height ? "横图" : "竖图",
    labelKey,
    ratio,
    previewRatio: `${width} / ${height}`,
    description: value,
    descriptionKey: "picker.size.customDimensions"
  };
}

export function buildSizeOptions(configuredSizes?: string[]) {
  const normalizedSizes = unique((configuredSizes ?? []).map((value) => value.trim()).filter((value) => value !== DEFAULT_REQUEST_SIZE));
  if (normalizedSizes.length === 0) return BASE_SIZE_OPTIONS;
  return normalizedSizes.map(sizeOptionFromValue);
}

export function requestSizeFromSelection(value: string) {
  return value.trim() || DEFAULT_REQUEST_SIZE;
}

export function buildQualityOptions(configuredQualities: string[]): QualityOption[] {
  return unique(["low", "medium", "high", ...configuredQualities])
    .map((item) => item.trim())
    .filter((item) => item.toLowerCase() !== "auto")
    .map((value) => {
      const preset = QUALITY_PRESETS[value.toLowerCase()];
      return {
        value,
        label: preset?.label ?? value,
        labelKey: preset?.labelKey,
        description: value,
        descriptionKey: preset?.descriptionKey ?? "picker.quality.custom"
      };
    });
}
