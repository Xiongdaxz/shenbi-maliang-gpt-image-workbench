import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Image, Images, Layers3, LifeBuoy, Search, Settings2, Sparkles, WandSparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { MarkdownView } from "../components/MarkdownView";
import { PageHeader } from "../components/PageHeader";
import { useI18n, type Translate, type TranslationParams } from "../i18n";
import { helpCenterOverrides } from "../i18n/messages/helpCenterOverrides";
import { helpCenterPrimaryOverrides } from "../i18n/messages/helpCenterPrimaryOverrides";
import { toTraditionalChinese } from "../i18n/messages/zh-TW";
import { publicAssetPath } from "../lib/publicAssets";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  HELP_POPULAR_ARTICLE_IDS,
  helpArticleById,
  helpCategoryById,
  type HelpCategory,
  type HelpArticleVisual,
  type HelpCategoryId
} from "../lib/helpCenter";

const CATEGORY_ICONS: Record<HelpCategory["icon"], LucideIcon> = {
  sparkles: Sparkles,
  wand: WandSparkles,
  layers: Layers3,
  images: Images,
  settings: Settings2,
  "life-buoy": LifeBuoy
};

const HELP_BRAND_LOGO = publicAssetPath("/image/logo-small.webp");
const HELP_MALIANG_AVATAR = publicAssetPath("/image/leaderboard/heading-maliang.webp?v=1");
const HELP_MALIANG_HERO = publicAssetPath("/image/help/maliang-help-hero-v2.webp");
const HELP_CENTER_TRADITIONAL_MESSAGES = Object.fromEntries(
  Object.entries(helpCenterPrimaryOverrides["zh-CN"]).map(([key, value]) => [key, toTraditionalChinese(value)])
) as typeof helpCenterPrimaryOverrides["zh-CN"];

function formatHelpMessage(message: string, params?: TranslationParams) {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? placeholder : String(value);
  });
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

interface HelpMenuIndicatorMetrics {
  height: number;
  top: number;
  visible: boolean;
}

function useHelpMenuIndicator(activeId: string | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const [metrics, setMetrics] = useState<HelpMenuIndicatorMetrics>({ height: 0, top: 0, visible: false });

  const setActiveItemRef = useCallback((node: HTMLButtonElement | null) => {
    activeItemRef.current = node;
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const activeItem = activeItemRef.current;

    if (!container || !activeItem || !activeId) {
      setMetrics((current) => current.visible ? { ...current, visible: false } : current);
      return;
    }

    const measure = () => {
      const next = {
        height: activeItem.offsetHeight,
        top: activeItem.offsetTop,
        visible: true
      };
      setMetrics((current) => (
        current.height === next.height && current.top === next.top && current.visible
          ? current
          : next
      ));
    };

    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(container);
    resizeObserver?.observe(activeItem);
    window.addEventListener("resize", measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeId]);

  return { activeItemRef: setActiveItemRef, containerRef, metrics };
}

function ArticleVisual({ visual, t }: { visual: HelpArticleVisual; t: (key: string) => string }) {
  return (
    <figure className="help-article-visual">
      <div className="help-article-visual-stage">
        <img src={visual.src} alt={t(visual.altKey)} loading="lazy" />
        {visual.markers.map((marker, index) => (
          <span
            key={`${marker.labelKey}-${index}`}
            className="help-article-visual-marker"
            style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
            aria-hidden="true"
          >
            {index + 1}
          </span>
        ))}
      </div>
      <figcaption>
        <p>{t(visual.captionKey)}</p>
        <ol>
          {visual.markers.map((marker, index) => (
            <li key={`${marker.labelKey}-legend-${index}`}>
              <span aria-hidden="true">{index + 1}</span>
              {t(marker.labelKey)}
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}

export function HelpCenterPage() {
  const { resolvedLanguage, t: baseT } = useI18n();
  const helpMessages = resolvedLanguage === "zh-TW"
    ? HELP_CENTER_TRADITIONAL_MESSAGES
    : resolvedLanguage in helpCenterPrimaryOverrides
      ? helpCenterPrimaryOverrides[resolvedLanguage as keyof typeof helpCenterPrimaryOverrides]
      : resolvedLanguage in helpCenterOverrides
        ? helpCenterOverrides[resolvedLanguage as keyof typeof helpCenterOverrides]
        : null;
  const t: Translate = useCallback((key, params) => {
    const message = helpMessages?.[key];
    return message ? formatHelpMessage(message, params) : baseT(key, params);
  }, [baseT, helpMessages]);
  const [searchParams, setSearchParams] = useSearchParams();
  const articleDetailRef = useRef<HTMLElement | null>(null);
  const rawSearch = (searchParams.get("q") ?? "").slice(0, 120);
  const [searchInput, setSearchInput] = useState(rawSearch);
  const searchComposingRef = useRef(false);
  const searchTerm = normalizeSearchText(rawSearch);
  const articleParam = searchParams.get("article");
  const categoryParam = searchParams.get("category");
  const selectedArticle = helpArticleById(articleParam);
  const invalidArticle = Boolean(articleParam) && !selectedArticle;
  const selectedCategoryId = invalidArticle
    ? null
    : selectedArticle
      ? selectedArticle.categoryId
      : helpCategoryById(categoryParam)?.id ?? null;
  const localizedCategories = useMemo(
    () => HELP_CATEGORIES.map((category) => ({
      ...category,
      label: t(category.labelKey),
      summary: t(category.summaryKey)
    })),
    [t]
  );
  const selectedCategory = localizedCategories.find((category) => category.id === selectedCategoryId) ?? null;
  const localizedArticles = useMemo(
    () => HELP_ARTICLES.map((article) => ({
      ...article,
      title: t(article.titleKey),
      summary: t(article.summaryKey),
      keywords: t(article.keywordsKey),
      body: t(article.bodyKey)
    })),
    [t]
  );
  const visibleArticles = useMemo(() => {
    if (searchTerm) {
      return localizedArticles.filter((article) => {
        const searchSource = `${article.title} ${article.summary} ${article.keywords} ${article.body}`.toLocaleLowerCase();
        return searchSource.includes(searchTerm);
      });
    }
    if (selectedCategory) return localizedArticles.filter((article) => article.categoryId === selectedCategory.id);
    return localizedArticles;
  }, [localizedArticles, searchTerm, selectedCategory]);
  const localizedSelectedArticle = selectedArticle
    ? localizedArticles.find((article) => article.id === selectedArticle.id) ?? null
    : null;
  const activeSelectedArticle = localizedSelectedArticle
    && (!searchTerm || visibleArticles.some((article) => article.id === localizedSelectedArticle.id))
    ? localizedSelectedArticle
    : null;
  const resolvedArticle = activeSelectedArticle ?? (searchTerm ? visibleArticles[0] ?? null : null);
  const resolvedArticleCategory = resolvedArticle
    ? localizedCategories.find((category) => category.id === resolvedArticle.categoryId) ?? null
    : null;
  const categoryArticleCounts = useMemo(
    () => new Map(HELP_CATEGORIES.map((category) => [category.id, HELP_ARTICLES.filter((article) => article.categoryId === category.id).length])),
    []
  );
  const popularArticles = useMemo(
    () => HELP_POPULAR_ARTICLE_IDS
      .map((id) => localizedArticles.find((article) => article.id === id))
      .filter((article): article is NonNullable<typeof article> => Boolean(article)),
    [localizedArticles]
  );
  const showHome = !searchTerm && !selectedCategory && !resolvedArticle;
  const listTitle = searchTerm
    ? t("help.search.results", { count: visibleArticles.length })
    : selectedCategory?.label ?? t("help.allQuestions");
  const questionContentKey = searchTerm ? `search-${searchTerm}` : `category-${selectedCategory?.id ?? "all"}`;
  const categoryIndicator = useHelpMenuIndicator(searchTerm ? null : selectedCategory?.id ?? null);
  const articleIndicator = useHelpMenuIndicator(resolvedArticle ? `${questionContentKey}:${resolvedArticle.id}` : null);

  useEffect(() => {
    if (!activeSelectedArticle) return;
    articleDetailRef.current?.focus({ preventScroll: true });
  }, [activeSelectedArticle?.id]);

  useEffect(() => {
    if (!searchComposingRef.current) setSearchInput(rawSearch);
  }, [rawSearch]);

  const updateParams = (update: (params: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(searchParams);
    update(next);
    setSearchParams(next, { replace });
  };

  const openCategory = (categoryId: HelpCategoryId) => {
    const firstArticle = HELP_ARTICLES.find((article) => article.categoryId === categoryId);
    updateParams((params) => {
      params.set("category", categoryId);
      if (firstArticle) params.set("article", firstArticle.id);
      else params.delete("article");
      params.delete("q");
    });
  };

  const openArticle = (articleId: string, clearSearch = false) => {
    const article = helpArticleById(articleId);
    if (!article) return;
    updateParams((params) => {
      params.set("category", article.categoryId);
      params.set("article", article.id);
      if (clearSearch) params.delete("q");
    });
  };

  const clearArticle = () => {
    updateParams((params) => params.delete("article"));
  };

  const returnHome = () => {
    updateParams((params) => {
      params.delete("category");
      params.delete("article");
      params.delete("q");
    });
  };

  const updateSearch = (value: string) => {
    updateParams((params) => {
      const nextValue = value.slice(0, 120);
      if (nextValue.trim()) params.set("q", nextValue);
      else params.delete("q");
      params.delete("article");
    }, true);
  };

  return (
    <section className="page-section help-center-page">
      <PageHeader
        title={t("help.title")}
        desc={t("help.description")}
        icon={<img className="help-page-brand-logo" src={HELP_BRAND_LOGO} alt="" aria-hidden="true" />}
        actions={(
          <label className="help-search-field">
            <span className="sr-only">{t("help.search.label")}</span>
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => {
                const nextValue = event.currentTarget.value.slice(0, 120);
                setSearchInput(nextValue);
                if (!searchComposingRef.current) updateSearch(nextValue);
              }}
              onCompositionStart={() => {
                searchComposingRef.current = true;
              }}
              onCompositionEnd={(event) => {
                searchComposingRef.current = false;
                const nextValue = event.currentTarget.value.slice(0, 120);
                setSearchInput(nextValue);
                updateSearch(nextValue);
              }}
              placeholder={t("help.search.placeholder")}
              aria-label={t("help.search.label")}
            />
          </label>
        )}
      />

      {showHome ? (
        <div className="help-home">
          <section className="help-home-intro" aria-labelledby="help-home-title">
            <img className="help-home-maliang-art" src={HELP_MALIANG_HERO} alt="" aria-hidden="true" decoding="async" />
            <div className="help-home-intro-copy">
              <span className="help-home-eyebrow">{t("help.eyebrow")}</span>
              <h2 id="help-home-title">{t("help.home.title")}</h2>
              <p>{t("help.home.description")}</p>
            </div>
          </section>

          <section className="help-popular-section" aria-labelledby="help-popular-title">
            <div className="help-section-heading">
              <h2 id="help-popular-title">{t("help.popular.title")}</h2>
              <span>{t("help.popular.description")}</span>
            </div>
            <div className="help-popular-list">
              {popularArticles.map((article) => (
                <button type="button" key={article.id} onClick={() => openArticle(article.id, true)}>
                  <img className="help-popular-card-watermark" src={HELP_BRAND_LOGO} alt="" aria-hidden="true" />
                  <span>{article.title}</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>

          <section className="help-category-grid" aria-label={t("help.categories.label")}>
            {localizedCategories.map((category) => {
              const Icon = CATEGORY_ICONS[category.icon];
              return (
                <button type="button" key={category.id} className="help-category-card" onClick={() => openCategory(category.id)}>
                  <img className="help-category-card-watermark" src={HELP_BRAND_LOGO} alt="" aria-hidden="true" />
                  <span className="help-category-card-icon"><Icon size={21} aria-hidden="true" /></span>
                  <span className="help-category-card-copy">
                    <strong>{category.label}</strong>
                    <small>{category.summary}</small>
                  </span>
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              );
            })}
          </section>
        </div>
      ) : (
        <div className={`help-workspace${activeSelectedArticle ? " has-article" : ""}`}>
          <aside className="help-category-nav" aria-label={t("help.categories.label")}>
            <button type="button" className="help-all-categories" onClick={returnHome} aria-current={!selectedCategory && !searchTerm ? "page" : undefined}>
              <img className="help-all-categories-maliang" src={HELP_MALIANG_AVATAR} alt="" aria-hidden="true" />
              <span>{t("help.allCategories")}</span>
            </button>
            <div className="help-category-nav-list" ref={categoryIndicator.containerRef}>
              <span
                className="help-menu-indicator help-category-menu-indicator"
                style={{
                  height: categoryIndicator.metrics.height,
                  opacity: categoryIndicator.metrics.visible ? 1 : 0,
                  transform: `translate3d(0, ${categoryIndicator.metrics.top}px, 0)`
                }}
                aria-hidden="true"
              />
              {localizedCategories.map((category) => {
                const Icon = CATEGORY_ICONS[category.icon];
                const active = !searchTerm && selectedCategory?.id === category.id;
                return (
                  <button
                    type="button"
                    key={category.id}
                    ref={active ? categoryIndicator.activeItemRef : undefined}
                    className={active ? "active" : undefined}
                    onClick={() => openCategory(category.id)}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{category.label}</span>
                    <small>{categoryArticleCounts.get(category.id)}</small>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="help-question-list" aria-labelledby="help-question-list-title">
            <button type="button" className="help-mobile-back" onClick={returnHome}>
              <ArrowLeft size={16} aria-hidden="true" />
              {t("help.backToHome")}
            </button>
            <div className="help-question-list-content" key={questionContentKey}>
              <header>
                <h2 id="help-question-list-title">{listTitle}</h2>
                <span>{searchTerm ? t("help.search.scopeAll") : selectedCategory?.summary}</span>
              </header>
              {visibleArticles.length > 0 ? (
                <div className="help-question-list-items" ref={articleIndicator.containerRef}>
                  <span
                    className="help-menu-indicator help-question-menu-indicator"
                    style={{
                      height: articleIndicator.metrics.height,
                      opacity: articleIndicator.metrics.visible ? 1 : 0,
                      transform: `translate3d(0, ${articleIndicator.metrics.top}px, 0)`
                    }}
                    aria-hidden="true"
                  />
                  {visibleArticles.map((article) => {
                    const active = resolvedArticle?.id === article.id;
                    const category = localizedCategories.find((item) => item.id === article.categoryId);
                    return (
                      <button
                        type="button"
                        key={article.id}
                        ref={active ? articleIndicator.activeItemRef : undefined}
                        className={active ? "active" : undefined}
                        onClick={() => openArticle(article.id)}
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="help-question-list-copy">
                          <strong>{article.title}</strong>
                          <small>{article.summary}</small>
                          {searchTerm && category ? <em>{category.label}</em> : null}
                        </span>
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="help-empty-state">
                  <Search size={22} aria-hidden="true" />
                  <strong>{t("help.search.emptyTitle")}</strong>
                  <p>{t("help.search.emptyDescription")}</p>
                  <button type="button" onClick={() => updateSearch("")}>{t("help.search.clear")}</button>
                </div>
              )}
            </div>
          </section>

          <article className="help-article-panel" ref={articleDetailRef} tabIndex={-1} aria-labelledby="help-article-title">
            {resolvedArticle ? (
              <>
                <button type="button" className="help-mobile-back" onClick={clearArticle}>
                  <ArrowLeft size={16} aria-hidden="true" />
                  {t("help.backToQuestions")}
                </button>
                <div className="help-article-content" key={resolvedArticle.id}>
                  <header>
                    <span>{resolvedArticleCategory?.label}</span>
                    <h2 id="help-article-title">{resolvedArticle.title}</h2>
                    <p>{resolvedArticle.summary}</p>
                  </header>
                  {resolvedArticle.visual ? <ArticleVisual visual={resolvedArticle.visual} t={t} /> : null}
                  <MarkdownView markdown={resolvedArticle.body} className="help-article-markdown" />
                  {resolvedArticle.action ? (
                    <Link className="primary-btn help-article-action" to={resolvedArticle.action.to}>
                      {t(resolvedArticle.action.labelKey)}
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="help-article-placeholder">
                <Image size={32} aria-hidden="true" />
                <strong>{invalidArticle ? t("help.article.invalid") : t("help.article.selectTitle")}</strong>
                <p>{invalidArticle ? t("help.article.invalidDescription") : t("help.article.selectDescription")}</p>
              </div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
