import type { WorkImage } from "../types";

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function imageTimelineDateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      key: "unknown",
      dateLabel: "未知日期",
      weekdayLabel: "时间未记录"
    };
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    key: `${year}-${month}-${day}`,
    dateLabel: `${year}年${month}月${day}日`,
    weekdayLabel: WEEKDAY_LABELS[date.getDay()]
  };
}

export function imageCreatedTime(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function groupImagesByTimeline(images: WorkImage[]) {
  const groups: Array<{ key: string; dateLabel: string; weekdayLabel: string; items: WorkImage[] }> = [];
  const groupIndex = new Map<string, (typeof groups)[number]>();
  for (const image of images) {
    const dateParts = imageTimelineDateParts(image.createdAt);
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
