import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, WheelEvent as ReactWheelEvent } from "react";
import { ArrowRight, PartyPopper, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import { defaultCaseItems } from "../lib/defaultCases";
import { defaultStarterHeadlineIdeas, isChineseStarterCopyLocale } from "../lib/starterCopy";
import { getTimeGreetingKey } from "../lib/timeGreeting";
import type { CaseCategory, User } from "../types";
import { ProjectLogo } from "./ProjectLogo";

type StarterCaseItem = CaseCategory["items"][number];
const STARTER_CASE_IMAGE_LIMIT = 10;
const STARTER_HEADLINE_ROTATE_INTERVAL_MS = 12000;
const STARTER_IMAGE_READY_TIMEOUT_MS = 3_000;

function preloadStarterImage(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, STARTER_IMAGE_READY_TIMEOUT_MS);
    image.onload = () => {
      if (typeof image.decode !== "function") {
        finish();
        return;
      }
      void image.decode().catch(() => undefined).then(finish);
    };
    image.onerror = finish;
    image.src = src;
  });
}

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

export function PromptStarter({
  caseCategories,
  caseCategoriesLoaded = false,
  dailyHeadlineIdeas: dailyHeadlineIdeaInput,
  headlineIdeasLoaded = false,
  onOpenIntro,
  onRefreshCases,
  onUseHeadlinePrompt,
  user,
  onPickPrompt
}: {
  caseCategories: CaseCategory[];
  caseCategoriesLoaded?: boolean;
  dailyHeadlineIdeas?: string[];
  headlineIdeasLoaded?: boolean;
  onOpenIntro?: () => void;
  onRefreshCases?: () => Promise<unknown> | void;
  onUseHeadlinePrompt?: (prompt: string) => void;
  user: User;
  onPickPrompt: (item: StarterCaseItem) => void;
}) {
  const [caseBatchSeed, setCaseBatchSeed] = useState(0);
  const { t, resolvedLanguage } = useI18n();
  const fallbackHeadlineIdeas = useMemo(() => defaultStarterHeadlineIdeas(resolvedLanguage), [resolvedLanguage]);
  const dailyHeadlineIdeas = useMemo(
    () => Array.isArray(dailyHeadlineIdeaInput)
      ? dailyHeadlineIdeaInput.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
    [dailyHeadlineIdeaInput]
  );
  const [headlineIdeaIndex, setHeadlineIdeaIndex] = useState(() => Math.floor(Math.random() * fallbackHeadlineIdeas.length));
  const headlineIdeas = useMemo(() => {
    return dailyHeadlineIdeas.length > 0 ? dailyHeadlineIdeas : fallbackHeadlineIdeas;
  }, [dailyHeadlineIdeas, fallbackHeadlineIdeas]);
  useEffect(() => {
    setHeadlineIdeaIndex(Math.floor(Math.random() * Math.max(headlineIdeas.length, 1)));
  }, [headlineIdeas]);
  const headlineParts = useMemo(() => {
    const displayName = user.username?.trim() || user.account?.trim();
    const greeting = t(getTimeGreetingKey());
    const idea = headlineIdeas[headlineIdeaIndex % headlineIdeas.length] || fallbackHeadlineIdeas[0] || "";
    const isChinese = isChineseStarterCopyLocale(resolvedLanguage);
    return {
      prefix: isChinese
        ? `${displayName ? `${displayName}，` : ""}${greeting}，`
        : `${displayName ? `${displayName}, ` : ""}${greeting}, `,
      idea
    };
  }, [fallbackHeadlineIdeas, headlineIdeaIndex, headlineIdeas, resolvedLanguage, t, user.account, user.username]);
  const headline = `${headlineParts.prefix}${headlineParts.idea}`;
  const headlinePrefixChars = useMemo(() => Array.from(headlineParts.prefix), [headlineParts.prefix]);
  const headlineIdeaChars = useMemo(() => Array.from(headlineParts.idea), [headlineParts.idea]);
  const realCasePoolCount = useMemo(() => starterCasePoolCount(caseCategories), [caseCategories]);
  const includeDefaultCases = caseCategoriesLoaded && realCasePoolCount < STARTER_CASE_IMAGE_LIMIT;
  const candidateCaseImages = useMemo(() => {
    return fillStarterCaseImages(caseCategories, includeDefaultCases);
  }, [caseBatchSeed, caseCategories, includeDefaultCases]);
  const casePoolCount = includeDefaultCases ? STARTER_CASE_IMAGE_LIMIT : realCasePoolCount;
  const caseImageSources = useMemo(
    () => candidateCaseImages
      .map((item) => item.imageThumbnailUrl ?? item.imagePreviewUrl ?? item.imageUrl)
      .filter((src): src is string => Boolean(src)),
    [candidateCaseImages]
  );
  const caseImageLoadKey = useMemo(() => caseImageSources.join("\u0000"), [caseImageSources]);
  const [caseImages, setCaseImages] = useState<StarterCaseItem[]>([]);
  const caseImageIds = useMemo(() => caseImages.map((item) => item.id).join("\u0000"), [caseImages]);
  const [readyCaseImageKey, setReadyCaseImageKey] = useState("");
  const [initialContentReady, setInitialContentReady] = useState(false);
  const caseScrollRef = useRef<HTMLDivElement | null>(null);
  const logoMotionFrameRef = useRef<number | null>(null);
  const caseRefreshPromiseRef = useRef<Promise<unknown> | null>(null);
  const mountedRef = useRef(true);
  const [caseScrollHint, setCaseScrollHint] = useState({ overflow: false, atEnd: true });
  const [isLogoMotionPlaying, setIsLogoMotionPlaying] = useState(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!caseCategoriesLoaded) return;
    let cancelled = false;
    if (caseImageSources.length === 0) {
      setCaseImages(candidateCaseImages);
      setReadyCaseImageKey(caseImageLoadKey);
      return;
    }
    void Promise.all(caseImageSources.map(preloadStarterImage)).then(() => {
      if (cancelled) return;
      setCaseImages(candidateCaseImages);
      setReadyCaseImageKey(caseImageLoadKey);
    });
    return () => {
      cancelled = true;
    };
  }, [candidateCaseImages, caseCategoriesLoaded, caseImageLoadKey, caseImageSources]);
  const caseImagesReady = caseCategoriesLoaded && readyCaseImageKey === caseImageLoadKey;
  useEffect(() => {
    if (!initialContentReady && headlineIdeasLoaded && caseImagesReady) setInitialContentReady(true);
  }, [caseImagesReady, headlineIdeasLoaded, initialContentReady]);
  const refreshCaseImages = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (caseRefreshPromiseRef.current) return;
    caseScrollRef.current?.scrollTo({ left: 0, behavior });
    if (!onRefreshCases) {
      setCaseBatchSeed((value) => value + 1);
      return;
    }
    try {
      const result = onRefreshCases();
      if (!result || typeof result.then !== "function") {
        setCaseBatchSeed((value) => value + 1);
        return;
      }
      const request = Promise.resolve(result);
      caseRefreshPromiseRef.current = request;
      void request
        .catch(() => {
          if (mountedRef.current) setCaseBatchSeed((value) => value + 1);
        })
        .finally(() => {
          if (caseRefreshPromiseRef.current === request) caseRefreshPromiseRef.current = null;
        });
    } catch {
      setCaseBatchSeed((value) => value + 1);
    }
  }, [onRefreshCases]);
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
    const appShell = element.closest<HTMLElement>(".app-shell");
    let frame = 0;
    const sidebarMoving = () => Boolean(
      appShell?.classList.contains("sidebar-motion-collapsing")
      || appShell?.classList.contains("sidebar-motion-expanding")
    );
    const sync = () => {
      if (sidebarMoving()) {
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
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
    const shellObserver = appShell ? new MutationObserver(sync) : null;
    if (appShell) shellObserver?.observe(appShell, { attributes: true, attributeFilter: ["class"] });

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      shellObserver?.disconnect();
      element.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [caseImageIds, initialContentReady]);

  useLayoutEffect(() => {
    return () => {
      if (logoMotionFrameRef.current !== null) {
        cancelAnimationFrame(logoMotionFrameRef.current);
      }
    };
  }, []);

  if (!initialContentReady) {
    return (
      <div className="starter starter-loading" aria-busy="true">
        <div className="starter-loading-title" aria-hidden="true">
          <span className="starter-loading-logo" />
          <span className="starter-loading-headline" />
        </div>
        <div className="starter-loading-cases" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => <span className="starter-loading-case" key={index} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="starter">
      <h2 className="starter-title" aria-label={headline}>
        <button
          className={cx("starter-logo", isLogoMotionPlaying && "is-playing")}
          type="button"
          aria-label={t("starter.logoMotion")}
          onClick={playLogoMotion}
          onAnimationEnd={() => setIsLogoMotionPlaying(false)}
        >
          <ProjectLogo className="starter-logo-image" alt="" />
        </button>
        <span className="starter-title-text">
          {headlinePrefixChars.map((char, index) => (
            <span key={`${char}-${index}`} style={{ animationDelay: `${index * 22}ms` }}>
              {char === " " ? "\u00a0" : char}
            </span>
          ))}
          {onUseHeadlinePrompt ? (
            <button
              className="starter-title-prompt"
              type="button"
              onClick={() => onUseHeadlinePrompt(headlineParts.idea)}
              aria-label={t("starter.useCopy", { text: headlineParts.idea })}
              title={t("starter.useThisCopy")}
            >
              {headlineIdeaChars.map((char, index) => (
                <span key={`${char}-${index}`} style={{ animationDelay: `${(headlinePrefixChars.length + index) * 22}ms` }}>
                  {char === " " ? "\u00a0" : char}
                </span>
              ))}
            </button>
          ) : (
            headlineIdeaChars.map((char, index) => (
              <span key={`${char}-${index}`} style={{ animationDelay: `${(headlinePrefixChars.length + index) * 22}ms` }}>
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
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="starter-case-thumb"
                      style={
                        {
                          "--starter-card-delay": `${index * 42}ms`
                        } as CSSProperties
                      }
                      aria-label={item.title}
                      onClick={() => onPickPrompt(item)}
                    >
                      <img src={item.imageThumbnailUrl ?? item.imagePreviewUrl ?? item.imageUrl} alt={item.title} />
                    </button>
                  );
                })}
                <Link
                  className="starter-case-more"
                  to="/cases"
                  style={
                    {
                      "--starter-card-delay": `${caseImages.length * 42}ms`
                    } as CSSProperties
                  }
                >
                  <span>{t("starter.openInspiration")}</span>
                  <ArrowRight size={18} />
                </Link>
              </div>
            </div>
            <button className="starter-case-scroll-hint" type="button" onClick={scrollStarterCasesNext} aria-label={t("starter.moreInspiration")}>
              <ArrowRight size={18} />
            </button>
          </div>
          {casePoolCount > 1 || onOpenIntro ? (
            <div className="starter-case-actions">
              {casePoolCount > 1 ? (
                <button
                  className="starter-case-refresh"
                  type="button"
                  onClick={() => {
                    refreshCaseImages();
                  }}
                >
                  <RefreshCw size={15} />
                  <span>{t("starter.refreshGroup")}</span>
                </button>
              ) : null}
              {onOpenIntro ? (
                <button className="starter-case-refresh" type="button" onClick={onOpenIntro} aria-label={t("starter.featureIntro")} title={t("starter.featureIntro")}>
                  <PartyPopper size={15} />
                  <span>{t("starter.featureIntro")}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
