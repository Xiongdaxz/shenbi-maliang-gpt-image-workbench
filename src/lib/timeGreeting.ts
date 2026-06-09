export function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return "上午好";
  if (hour >= 11 && hour < 14) return "中午好";
  if (hour >= 14 && hour < 18) return "下午好";
  if (hour >= 18 && hour < 23) return "晚上好";
  return "夜深了";
}
