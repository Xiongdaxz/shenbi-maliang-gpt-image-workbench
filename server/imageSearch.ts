const IMAGE_WEEKDAY_LABELS = [
  ["周日", "週日", "sunday"],
  ["周一", "週一", "monday"],
  ["周二", "週二", "tuesday"],
  ["周三", "週三", "wednesday"],
  ["周四", "週四", "thursday"],
  ["周五", "週五", "friday"],
  ["周六", "週六", "saturday"]
] as const;

export function imageDateSearchConditions(keywordValue: string, createdAtColumn: string) {
  const keyword = keywordValue.trim().toLowerCase();
  const clauses: string[] = [];
  const params: string[] = [];
  if (!keyword) return { clauses, params };

  const weekdays = IMAGE_WEEKDAY_LABELS
    .map((labels, index) => ({ labels, index }))
    .filter(({ labels }) => labels.some((label) => label.includes(keyword) || keyword.includes(label)))
    .map(({ index }) => String(index));
  if (weekdays.length > 0) {
    clauses.push(`strftime('%w', ${createdAtColumn}) in (${weekdays.map(() => "?").join(", ")})`);
    params.push(...weekdays);
  }

  const normalizedDateKeyword = keyword
    .replace("年", "-")
    .replace("月", "-")
    .replaceAll("/", "-")
    .replace(/[日号]/g, "");
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalizedDateKeyword)) {
    const [year, month, day] = normalizedDateKeyword.split("-");
    clauses.push(`${createdAtColumn} like ?`);
    params.push(`%${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}%`);
  }

  return { clauses, params };
}
