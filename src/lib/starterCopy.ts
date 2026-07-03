import type { LocaleCode } from "../i18n";

export const STARTER_HEADLINE_IDEAS_ZH = [
  "给新品首发一点高级感。",
  "把汇报封面做得更有气场。",
  "让商品主图更像精品广告。",
  "把卖点变成一张清晰海报。",
  "给客户拜访做张专业配图。",
  "让活动邀请函更有期待感。",
  "把会议主题做成视觉主图。",
  "给招聘海报加一点亲和力。",
  "把流程说明画得更好懂。",
  "做一张适合发小红书的封面。",
  "把旅行路线变成收藏长图。",
  "给宠物拍一组温暖写真。",
  "把今天的菜品拍出食欲感。",
  "给家居空间换个高级氛围。",
  "画一个适合睡前读的绘本场景。",
  "让节日祝福卡更像精心准备。",
  "给头像换成电影感光影。",
  "把品牌 Logo 放进真实样机。",
  "做一张适合手机锁屏的壁纸。",
  "把社群活动做得更想参加。"
];

export const STARTER_HEADLINE_IDEAS_EN = [
  "Give a product launch a premium look.",
  "Make a report cover feel more confident.",
  "Turn a product hero image into an ad.",
  "Shape your selling points into a clean poster.",
  "Create a professional visual for a client visit.",
  "Make an event invitation feel worth joining.",
  "Turn a meeting theme into a hero visual.",
  "Add a warmer tone to a hiring poster.",
  "Make a process diagram easier to understand.",
  "Design a cover for a social post.",
  "Turn a travel route into a saveable guide.",
  "Create a warm portrait set for a pet.",
  "Make today's dish look more appetizing.",
  "Give a room a more refined atmosphere.",
  "Paint a bedtime storybook scene.",
  "Make a holiday card feel thoughtfully prepared.",
  "Give an avatar cinematic lighting.",
  "Place a brand logo into a realistic mockup.",
  "Create a wallpaper for a phone lock screen.",
  "Make a community event look more inviting."
];

export function isChineseStarterCopyLocale(locale: LocaleCode | string) {
  return String(locale).toLowerCase().startsWith("zh");
}

export function defaultStarterHeadlineIdeas(locale: LocaleCode | string) {
  return isChineseStarterCopyLocale(locale) ? STARTER_HEADLINE_IDEAS_ZH : STARTER_HEADLINE_IDEAS_EN;
}
