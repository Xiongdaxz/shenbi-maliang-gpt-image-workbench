import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, WheelEvent as ReactWheelEvent } from "react";
import { ArrowRight, PartyPopper, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { cx } from "../lib/cx";
import { visibleCaseStyleNames } from "../lib/caseMaterials";
import { defaultCaseItems } from "../lib/defaultCases";
import { getTimeGreeting } from "../lib/timeGreeting";
import type { CaseCategory, User } from "../types";
import { ProjectLogo } from "./ProjectLogo";

const STARTER_HEADLINE_IDEAS = [
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

type StarterCaseItem = CaseCategory["items"][number];
const STARTER_CASE_IMAGE_LIMIT = 10;
const STARTER_HEADLINE_ROTATE_INTERVAL_MS = 12000;

function shuffleCopy<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function pickStarterCaseImages(caseCategories: CaseCategory[]): StarterCaseItem[] {
  const candidates = shuffleCopy(
    caseCategories.flatMap((category) =>
      category.items
        .filter((item) => item.imageUrl)
        .map((item) => ({
          item,
          styleId: category.id
        }))
    )
  );
  const selected: StarterCaseItem[] = [];
  const selectedStyleIds = new Set<string>();
  const selectedGroupIds = new Set<string>();
  const addCandidate = (candidate: (typeof candidates)[number]) => {
    selected.push(candidate.item);
    [candidate.styleId, ...candidate.item.categoryIds].filter(Boolean).forEach((styleId) => selectedStyleIds.add(styleId));
    selectedGroupIds.add(candidate.item.groupId || candidate.item.id);
  };

  for (const candidate of candidates) {
    if (selected.length >= STARTER_CASE_IMAGE_LIMIT) break;
    const groupId = candidate.item.groupId || candidate.item.id;
    if (selectedStyleIds.has(candidate.styleId) || selectedGroupIds.has(groupId)) continue;
    addCandidate(candidate);
  }

  for (const candidate of candidates) {
    if (selected.length >= STARTER_CASE_IMAGE_LIMIT) break;
    const groupId = candidate.item.groupId || candidate.item.id;
    if (selectedGroupIds.has(groupId)) continue;
    addCandidate(candidate);
  }

  return selected;
}

function fillStarterCaseImages(caseCategories: CaseCategory[], includeDefaultCases: boolean): StarterCaseItem[] {
  const selected = pickStarterCaseImages(caseCategories);
  if (!includeDefaultCases || selected.length >= STARTER_CASE_IMAGE_LIMIT) return selected;
  const selectedIds = new Set(selected.map((item) => item.groupId || item.id));
  const fallbackItems = shuffleCopy(defaultCaseItems()).filter((item) => !selectedIds.has(item.groupId || item.id));
  return [...selected, ...fallbackItems.slice(0, STARTER_CASE_IMAGE_LIMIT - selected.length)];
}

function starterCasePoolCount(caseCategories: CaseCategory[]) {
  const groupIds = new Set<string>();
  for (const category of caseCategories) {
    for (const item of category.items) {
      if (!item.imageUrl) continue;
      groupIds.add(item.groupId || item.id);
    }
  }
  return groupIds.size;
}

function handleStarterCaseWheel(event: ReactWheelEvent<HTMLDivElement>) {
  const element = event.currentTarget;
  if (element.scrollWidth <= element.clientWidth) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return;
  const atStart = element.scrollLeft <= 0;
  const atEnd = Math.ceil(element.scrollLeft + element.clientWidth) >= element.scrollWidth;
  if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;
  event.preventDefault();
  event.stopPropagation();
  element.scrollBy({ left: delta, behavior: "auto" });
}

function handleStarterTagWheel(event: ReactWheelEvent<HTMLDivElement>) {
  const element = event.currentTarget;
  if (element.scrollWidth <= element.clientWidth) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return;
  const atStart = element.scrollLeft <= 0;
  const atEnd = Math.ceil(element.scrollLeft + element.clientWidth) >= element.scrollWidth;
  if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;
  event.preventDefault();
  event.stopPropagation();
  element.scrollBy({ left: delta, behavior: "auto" });
}

export function PromptStarter({
  caseCategories,
  caseCategoriesLoaded = false,
  onOpenIntro,
  onUseHeadlinePrompt,
  user,
  onPickPrompt
}: {
  caseCategories: CaseCategory[];
  caseCategoriesLoaded?: boolean;
  onOpenIntro?: () => void;
  onUseHeadlinePrompt?: (prompt: string) => void;
  user: User;
  onPickPrompt: (item: StarterCaseItem) => void;
}) {
  const [caseBatchSeed, setCaseBatchSeed] = useState(0);
  const [dailyHeadlineIdeas, setDailyHeadlineIdeas] = useState<string[]>([]);
  const [headlineIdeaIndex, setHeadlineIdeaIndex] = useState(() => Math.floor(Math.random() * STARTER_HEADLINE_IDEAS.length));
  useEffect(() => {
    let cancelled = false;
    api.starterCopiesToday()
      .then((data) => {
        if (cancelled) return;
        const copies = Array.isArray(data.copies)
          ? data.copies.map((item) => String(item ?? "").trim()).filter(Boolean)
          : [];
        setDailyHeadlineIdeas(copies);
      })
      .catch(() => {
        if (!cancelled) setDailyHeadlineIdeas([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const headlineIdeas = useMemo(() => {
    return dailyHeadlineIdeas.length > 0 ? dailyHeadlineIdeas : STARTER_HEADLINE_IDEAS;
  }, [dailyHeadlineIdeas]);
  useEffect(() => {
    setHeadlineIdeaIndex(Math.floor(Math.random() * Math.max(headlineIdeas.length, 1)));
  }, [headlineIdeas]);
  const headlineParts = useMemo(() => {
    const displayName = user.username?.trim() || user.account?.trim();
    const greeting = getTimeGreeting();
    const idea = headlineIdeas[headlineIdeaIndex % headlineIdeas.length] || STARTER_HEADLINE_IDEAS[0];
    return {
      prefix: `${displayName ? `${displayName}，` : ""}${greeting}，`,
      idea
    };
  }, [headlineIdeaIndex, headlineIdeas, user.account, user.username]);
  const headline = `${headlineParts.prefix}${headlineParts.idea}`;
  const headlinePrefixChars = useMemo(() => Array.from(headlineParts.prefix), [headlineParts.prefix]);
  const headlineIdeaChars = useMemo(() => Array.from(headlineParts.idea), [headlineParts.idea]);
  const realCasePoolCount = useMemo(() => starterCasePoolCount(caseCategories), [caseCategories]);
  const includeDefaultCases = caseCategoriesLoaded && realCasePoolCount < STARTER_CASE_IMAGE_LIMIT;
  const caseImages = useMemo(() => {
    return fillStarterCaseImages(caseCategories, includeDefaultCases);
  }, [caseBatchSeed, caseCategories, includeDefaultCases]);
  const casePoolCount = includeDefaultCases ? STARTER_CASE_IMAGE_LIMIT : realCasePoolCount;
  const caseImageIds = useMemo(() => caseImages.map((item) => item.id).join("\u0000"), [caseImages]);
  const caseScrollRef = useRef<HTMLDivElement | null>(null);
  const logoMotionFrameRef = useRef<number | null>(null);
  const [caseScrollHint, setCaseScrollHint] = useState({ overflow: false, atEnd: true });
  const [isLogoMotionPlaying, setIsLogoMotionPlaying] = useState(true);
  const refreshCaseImages = useCallback((behavior: ScrollBehavior = "smooth") => {
    caseScrollRef.current?.scrollTo({ left: 0, behavior });
    setCaseBatchSeed((value) => value + 1);
  }, []);
  const playLogoMotion = () => {
    if (logoMotionFrameRef.current !== null) {
      cancelAnimationFrame(logoMotionFrameRef.current);
    }
    setIsLogoMotionPlaying(false);
    logoMotionFrameRef.current = requestAnimationFrame(() => {
      logoMotionFrameRef.current = requestAnimationFrame(() => {
        setIsLogoMotionPlaying(true);
        logoMotionFrameRef.current = null;
      });
    });
  };
  const advanceStarterCases = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const element = caseScrollRef.current;
      const strip = element?.querySelector<HTMLElement>(".starter-case-strip");
      const firstCard = strip?.querySelector<HTMLElement>(".starter-case-thumb, .starter-case-more");
      if (!element || !strip || !firstCard) return;
      const overflow = element.scrollWidth - element.clientWidth > 1;
      const endCard = element.querySelector<HTMLElement>(".starter-case-more");
      const elementRect = element.getBoundingClientRect();
      const endCardRect = endCard?.getBoundingClientRect();
      const endCardVisible = Boolean(endCardRect && endCardRect.left < elementRect.right - 24);
      const atEnd = !overflow || endCardVisible || Math.ceil(element.scrollLeft + element.clientWidth) >= element.scrollWidth - 1;
      if (atEnd) {
        if (casePoolCount > 1) refreshCaseImages(behavior);
        return;
      }
      const stripStyle = window.getComputedStyle(strip);
      const gap = Number.parseFloat(stripStyle.columnGap || stripStyle.gap || "0") || 0;
      element.scrollBy({ left: (firstCard.getBoundingClientRect().width + gap) * 4, behavior });
    },
    [casePoolCount, refreshCaseImages]
  );
  const scrollStarterCasesNext = () => {
    advanceStarterCases("smooth");
  };

  useEffect(() => {
    const hasHeadlineRotation = headlineIdeas.length > 1;
    const hasCaseRotation = casePoolCount > 1 && caseImages.length > 0;
    if (!hasHeadlineRotation && !hasCaseRotation) return;
    const timer = window.setInterval(() => {
      if (hasHeadlineRotation) {
        setHeadlineIdeaIndex((value) => (value + 1) % headlineIdeas.length);
      }
      if (hasCaseRotation) {
        advanceStarterCases("smooth");
      }
    }, STARTER_HEADLINE_ROTATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [advanceStarterCases, caseImages.length, casePoolCount, headlineIdeas.length]);

  useLayoutEffect(() => {
    const element = caseScrollRef.current;
    if (!element) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const overflow = element.scrollWidth - element.clientWidth > 1;
        const endCard = element.querySelector<HTMLElement>(".starter-case-more");
        const elementRect = element.getBoundingClientRect();
        const endCardRect = endCard?.getBoundingClientRect();
        const endCardVisible = Boolean(endCardRect && endCardRect.left < elementRect.right - 24);
        const atEnd = !overflow || endCardVisible || Math.ceil(element.scrollLeft + element.clientWidth) >= element.scrollWidth - 1;
        setCaseScrollHint((value) => (value.overflow === overflow && value.atEnd === atEnd ? value : { overflow, atEnd }));
      });
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(element);
    Array.from(element.children).forEach((child) => resizeObserver.observe(child));
    element.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      element.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [caseImageIds]);

  useLayoutEffect(() => {
    return () => {
      if (logoMotionFrameRef.current !== null) {
        cancelAnimationFrame(logoMotionFrameRef.current);
      }
    };
  }, []);

  return (
    <div className="starter">
      <h2 className="starter-title" aria-label={headline}>
        <button
          className={cx("starter-logo", isLogoMotionPlaying && "is-playing")}
          type="button"
          aria-label="放大工作台 logo"
          onClick={playLogoMotion}
          onAnimationEnd={() => setIsLogoMotionPlaying(false)}
        >
          <ProjectLogo className="starter-logo-image" alt="" />
        </button>
        <span className="starter-title-text">
          {headlinePrefixChars.map((char, index) => (
            <span key={`${char}-${index}`} style={{ animationDelay: `${index * 34}ms` }}>
              {char === " " ? "\u00a0" : char}
            </span>
          ))}
          {onUseHeadlinePrompt ? (
            <button
              className="starter-title-prompt"
              type="button"
              onClick={() => onUseHeadlinePrompt(headlineParts.idea)}
              aria-label={`使用文案：${headlineParts.idea}`}
              title="使用这条文案"
            >
              {headlineIdeaChars.map((char, index) => (
                <span key={`${char}-${index}`} style={{ animationDelay: `${(headlinePrefixChars.length + index) * 34}ms` }}>
                  {char === " " ? "\u00a0" : char}
                </span>
              ))}
            </button>
          ) : (
            headlineIdeaChars.map((char, index) => (
              <span key={`${char}-${index}`} style={{ animationDelay: `${(headlinePrefixChars.length + index) * 34}ms` }}>
                {char === " " ? "\u00a0" : char}
              </span>
            ))
          )}
        </span>
      </h2>
      {caseImages.length > 0 ? (
        <div className={cx("starter-case-window", caseScrollHint.overflow && !caseScrollHint.atEnd && "has-scroll-hint")}>
          <div className="starter-case-scroll-area">
            <div className="starter-case-scroll" ref={caseScrollRef} onWheelCapture={handleStarterCaseWheel}>
              <div className="starter-case-strip">
                {caseImages.map((item, index) => {
                  const styleNames = visibleCaseStyleNames(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="starter-case-thumb"
                      style={
                        {
                          "--starter-card-delay": `${index * 95 + 340}ms`
                        } as CSSProperties
                      }
                      aria-label={item.title}
                      onClick={() => onPickPrompt(item)}
                    >
                      <img src={item.imageThumbnailUrl ?? item.imagePreviewUrl ?? item.imageUrl} alt={item.title} />
                      <div className="starter-case-meta">
                        <span className="starter-case-thumb-prompt">{item.prompt}</span>
                        {styleNames.length > 0 ? (
                          <div className="starter-case-style-tags" onWheelCapture={handleStarterTagWheel}>
                            {styleNames.map((name) => (
                              <span key={`${item.id}-${name}`}>{name}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
                <Link
                  className="starter-case-more"
                  to="/cases"
                  style={
                    {
                      "--starter-card-delay": `${caseImages.length * 95 + 340}ms`
                    } as CSSProperties
                  }
                >
                  <span>去灵感空间看看</span>
                  <ArrowRight size={18} />
                </Link>
              </div>
            </div>
            <button className="starter-case-scroll-hint" type="button" onClick={scrollStarterCasesNext} aria-label="查看更多灵感">
              <ArrowRight size={18} />
            </button>
          </div>
          {casePoolCount > 1 || onOpenIntro ? (
            <div className="starter-case-actions">
              {casePoolCount > 1 ? (
                <button className="starter-case-refresh" type="button" onClick={() => refreshCaseImages()}>
                  <RefreshCw size={15} />
                  <span>换一组</span>
                </button>
              ) : null}
              {onOpenIntro ? (
                <button className="starter-case-refresh" type="button" onClick={onOpenIntro} aria-label="功能介绍" title="功能介绍">
                  <PartyPopper size={15} />
                  <span>功能介绍</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
