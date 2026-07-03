import type { WorkImage } from "../types";
import type { LocaleCode } from "../i18n/locales";

const ZH_CN_WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const ZH_TW_WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const EN_WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isChineseLocale(locale: LocaleCode) {
  return locale === "zh-CN" || locale === "zh-TW";
}

export function imageTimelineDateParts(value: string, locale: LocaleCode = "zh-CN") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      key: "unknown",
      dateLabel: isChineseLocale(locale) ? "未知日期" : "Unknown date",
      weekdayLabel: locale === "zh-TW" ? "時間未記錄" : isChineseLocale(locale) ? "时间未记录" : "Time not recorded"
    };
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekdayLabels = locale === "zh-TW" ? ZH_TW_WEEKDAY_LABELS : locale === "zh-CN" ? ZH_CN_WEEKDAY_LABELS : EN_WEEKDAY_LABELS;
  return {
    key: `${year}-${month}-${day}`,
    dateLabel: isChineseLocale(locale) ? `${year}年${month}月${day}日` : `${year}/${month}/${day}`,
    weekdayLabel: weekdayLabels[date.getDay()]
  };
}

export function imageCreatedTime(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function groupImagesByTimeline(images: WorkImage[], locale: LocaleCode = "zh-CN") {
  const groups: Array<{ key: string; dateLabel: string; weekdayLabel: string; items: WorkImage[] }> = [];
  const groupIndex = new Map<string, (typeof groups)[number]>();
  for (const image of images) {
    const dateParts = imageTimelineDateParts(image.createdAt, locale);
    const existingGroup = groupIndex.get(dateParts.key);
    if (existingGroup) {
      existingGroup.items.push(image);
      continue;
    }
    const group = { ...dateParts, items: [image] };
    groupIndex.set(dateParts.key, group);
    groups.push(group);
  }
  return groups;
}
