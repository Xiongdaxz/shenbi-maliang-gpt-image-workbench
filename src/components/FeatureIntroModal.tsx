import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type WheelEvent as ReactWheelEvent } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Brain,
  Brush,
  Check,
  Crop,
  Download,
  FolderOpen,
  Heart,
  ImagePlus,
  Images,
  Layers,
  Lightbulb,
  Lock,
  MessageSquarePlus,
  MousePointer2,
  Palette,
  Repeat2,
  Shield,
  Share2,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
  type LucideIcon
} from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import { ProjectLogo } from "./ProjectLogo";

export type FeatureIntroTag = {
  id: string;
  label: string;
};

export type FeatureIntroSlide = {
  id: string;
  title: string;
  description: string | string[];
  imageSrc: string;
  imageAlt: string;
  tags: FeatureIntroTag[];
  accent?: string;
};

type FeatureIntroModalProps = {
  open: boolean;
  slides: FeatureIntroSlide[];
  welcomeText?: string;
  finishLabel?: string;
  className?: string;
  onClose: () => void;
};

type SlideDirection = "next" | "prev";
type IntroPhase = "welcome" | "welcomeLeaving" | "slides";

const WHEEL_SLIDE_THRESHOLD = 46;
const WHEEL_SLIDE_COOLDOWN_MS = 560;

const SLIDE_ICON_BY_ID: Record<string, LucideIcon> = {
  assets: FolderOpen,
  cases: Lightbulb,
  chat: MessageSquarePlus,
  "chat-manage": Shield,
  editor: Brush,
  images: Images,
  "prompt-templates": Sparkles
};

const TAG_ICON_BY_ID: Record<string, LucideIcon> = {
  aiAssistedStart: WandSparkles,
  archiveDelete: Archive,
  categoryManage: FolderOpen,
  continueEdit: Brush,
  dataPrivacy: Shield,
  favoriteDownload: Heart,
  formCreation: Layers,
  formSharing: Share2,
  historyReuse: Repeat2,
  imageEncryption: Lock,
  inpaint: WandSparkles,
  iterativeRefinement: Repeat2,
  maskEditing: Brush,
  multiSizeDownload: Download,
  multiTypeAssets: ImagePlus,
  myImagesView: Images,
  naturalLanguage: MessageSquarePlus,
  oneClickUse: MousePointer2,
  promptReuse: Repeat2,
  readyToUse: MousePointer2,
  resize: Crop,
  sharedAssets: FolderOpen,
  smartAi: Brain,
  styleCases: Palette
};

function slideIconFor(id: string) {
  return SLIDE_ICON_BY_ID[id] ?? Sparkles;
}

function tagIconFor(id: string) {
  return TAG_ICON_BY_ID[id] ?? Sparkles;
}

function slideDescriptionItems(description: FeatureIntroSlide["description"]) {
  return Array.isArray(description) ? description : [description];
}

export function FeatureIntroModal({
  open,
  slides,
  welcomeText,
  finishLabel,
  className,
  onClose
}: FeatureIntroModalProps) {
  const { t } = useI18n();
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<SlideDirection>("next");
  const [introPhase, setIntroPhase] = useState<IntroPhase>("slides");
  const [typedCount, setTypedCount] = useState(0);
  const [closing, setClosing] = useState(false);
  const [welcomeLogoPosition, setWelcomeLogoPosition] = useState<{ left: number; top: number } | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const welcomeLogoSlotRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const wheelDeltaRef = useRef(0);
  const lastWheelSlideAtRef = useRef(0);
  const trimmedWelcomeText = welcomeText?.trim() ?? "";
  const slide = slides[activeIndex] ?? slides[0];
  const previousSlide = previousIndex === null ? null : slides[previousIndex];
  const isLast = activeIndex >= slides.length - 1;
  const resolvedFinishLabel = finishLabel ?? t("common.startUsing");
  const showWelcome = Boolean(trimmedWelcomeText) && introPhase !== "slides";
  const typedWelcomeText = trimmedWelcomeText.slice(0, typedCount);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    setPreviousIndex(null);
    setDirection("next");
    setTypedCount(0);
    setClosing(false);
    setWelcomeLogoPosition(null);
    setIntroPhase(trimmedWelcomeText ? "welcome" : "slides");
  }, [open, trimmedWelcomeText]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (previousIndex === null) return;
    const timer = window.setTimeout(() => setPreviousIndex(null), 420);
    return () => window.clearTimeout(timer);
  }, [previousIndex]);

  useEffect(() => {
    if (!open || introPhase !== "welcome") return;
    if (!trimmedWelcomeText) {
      setIntroPhase("slides");
      return;
    }
    if (typedCount < trimmedWelcomeText.length) {
      const timer = window.setTimeout(() => {
        setTypedCount((value) => Math.min(trimmedWelcomeText.length, value + 1));
      }, 58);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setIntroPhase("welcomeLeaving"), 760);
    return () => window.clearTimeout(timer);
  }, [introPhase, open, trimmedWelcomeText, typedCount]);

  useEffect(() => {
    if (!open || introPhase !== "welcomeLeaving") return;
    const timer = window.setTimeout(() => setIntroPhase("slides"), 420);
    return () => window.clearTimeout(timer);
  }, [introPhase, open]);

  const goToSlide = useCallback(
    (nextIndex: number) => {
      setActiveIndex((currentIndex) => {
        const boundedIndex = Math.min(Math.max(nextIndex, 0), slides.length - 1);
        if (boundedIndex === currentIndex) return currentIndex;
        setDirection(boundedIndex > currentIndex ? "next" : "prev");
        setPreviousIndex(currentIndex);
        return boundedIndex;
      });
    },
    [slides.length]
  );

  useEffect(() => {
    wheelDeltaRef.current = 0;
  }, [activeIndex, introPhase]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (introPhase !== "slides" || closing || slides.length < 2) return;
      const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!dominantDelta) return;
      const targetIndex = dominantDelta > 0 ? activeIndex + 1 : activeIndex - 1;
      if (targetIndex < 0 || targetIndex >= slides.length) return;

      event.preventDefault();
      event.stopPropagation();

      const now = Date.now();
      if (now - lastWheelSlideAtRef.current < WHEEL_SLIDE_COOLDOWN_MS) return;
      wheelDeltaRef.current += dominantDelta;
      if (Math.abs(wheelDeltaRef.current) < WHEEL_SLIDE_THRESHOLD) return;

      lastWheelSlideAtRef.current = now;
      wheelDeltaRef.current = 0;
      goToSlide(targetIndex);
    },
    [activeIndex, closing, goToSlide, introPhase, slides.length]
  );

  const measureWelcomeLogo = useCallback(() => {
    if (!modalRef.current || !welcomeLogoSlotRef.current) return;
    const modalRect = modalRef.current.getBoundingClientRect();
    const slotRect = welcomeLogoSlotRef.current.getBoundingClientRect();
    setWelcomeLogoPosition({
      left: Math.round(slotRect.left - modalRect.left),
      top: Math.round(slotRect.top - modalRect.top)
    });
  }, []);

  useLayoutEffect(() => {
    if (!open || introPhase !== "welcome") return;
    measureWelcomeLogo();
    const frameId = window.requestAnimationFrame(measureWelcomeLogo);
    window.addEventListener("resize", measureWelcomeLogo);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", measureWelcomeLogo);
    };
  }, [introPhase, measureWelcomeLogo, open, trimmedWelcomeText, typedCount]);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 240);
  }, [closing, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      if (introPhase !== "slides") return;
      if (event.key === "ArrowLeft") goToSlide(activeIndex - 1);
      if (event.key === "ArrowRight") goToSlide(activeIndex + 1);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, goToSlide, introPhase, onClose, open]);

  if (!open || !slide) return null;

  const modalStyle = {
    "--feature-intro-accent": slide.accent ?? "#0f766e",
    ...(welcomeLogoPosition
      ? {
          "--feature-intro-welcome-logo-left": `${welcomeLogoPosition.left}px`,
          "--feature-intro-welcome-logo-top": `${welcomeLogoPosition.top}px`
        }
      : null)
  } as CSSProperties;

  const renderVisualSlide = (item: FeatureIntroSlide, state: "enter" | "exit") => {
    const primaryTag = item.tags[0] ?? null;
    const PrimaryTagIcon = tagIconFor(primaryTag?.id ?? "");
    return (
      <div className="feature-intro-image-frame" data-direction={direction} data-motion={state} key={`${item.id}-${state}`}>
        <img src={item.imageSrc} alt={item.imageAlt} />
        <div className="feature-intro-glass-card primary">
          <PrimaryTagIcon size={17} />
          <span>{primaryTag?.label ?? t("featureIntro.smartCreation")}</span>
        </div>
        <div className="feature-intro-glass-card secondary">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  };

  const renderCopySlide = (item: FeatureIntroSlide, state: "enter" | "exit") => (
    <article className="feature-intro-slide-copy" data-direction={direction} data-motion={state} key={`${item.id}-copy-${state}`}>
      <ol className="feature-intro-description">
        {slideDescriptionItems(item.description).map((description, index) => (
          <li key={`${item.id}-desc-${index}`}>
            <span>{index + 1}</span>
            <p>{description}</p>
          </li>
        ))}
      </ol>
      <div className="feature-intro-tags">
        {item.tags.map((tag) => {
          const TagIcon = tagIconFor(tag.id);
          return (
            <span key={tag.id}>
              <TagIcon size={17} />
              {tag.label}
            </span>
          );
        })}
      </div>
    </article>
  );

  const CurrentSlideIcon = slideIconFor(slide.id);

  return (
    <div className="feature-intro-backdrop" data-state={closing ? "closing" : "open"} role="presentation">
      <section
        ref={modalRef}
        className={cx("feature-intro-modal", "ui-modal-motion", className)}
        data-state={closing ? "closing" : "open"}
        data-phase={introPhase}
        data-placement="center"
        role="dialog"
        aria-modal="true"
        aria-label={t("starter.featureIntro")}
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={handleWheel}
        style={modalStyle}
      >
        <button className="feature-intro-close" type="button" onClick={requestClose} aria-label={t("featureIntro.close")}>
          <X size={18} />
        </button>
        <div className="feature-intro-logo" aria-hidden="true">
          <ProjectLogo className="feature-intro-logo-image" alt="" />
        </div>
        {showWelcome ? (
          <div className="feature-intro-welcome" data-state={introPhase === "welcomeLeaving" ? "leaving" : "typing"}>
            <div className="feature-intro-welcome-text" aria-live="polite">
              <span className="feature-intro-welcome-copy">
                <span className="feature-intro-welcome-live">
                  {typedWelcomeText}
                  <span ref={welcomeLogoSlotRef} className="feature-intro-welcome-logo-slot" aria-hidden="true" />
                </span>
                <span className="feature-intro-welcome-sizer" aria-hidden="true">
                  {trimmedWelcomeText}
                  <span className="feature-intro-welcome-logo-slot" aria-hidden="true" />
                </span>
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="feature-intro-visual">
              <div className="feature-intro-visual-stage">
                {previousSlide ? renderVisualSlide(previousSlide, "exit") : null}
                {renderVisualSlide(slide, "enter")}
              </div>
            </div>
            <div className="feature-intro-copy">
              <div className="feature-intro-current" key={`current-${slide.id}`} data-direction={direction} aria-live="polite">
                <span>{String(activeIndex + 1).padStart(2, "0")}</span>
                <strong>
                  <CurrentSlideIcon size={16} />
                  <span>{slide.title}</span>
                </strong>
                <em>
                  {activeIndex + 1}/{slides.length}
                </em>
              </div>
              <div className="feature-intro-slide-stage">
                {previousSlide ? renderCopySlide(previousSlide, "exit") : null}
                {renderCopySlide(slide, "enter")}
              </div>
              <div className="feature-intro-footer">
                <div className="feature-intro-dots" aria-label={t("featureIntro.currentPage")}>
                  {slides.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className={cx(index === activeIndex && "active")}
                      onClick={() => goToSlide(index)}
                      aria-label={t("featureIntro.switchPage", { page: index + 1 })}
                    />
                  ))}
                </div>
                <div className="feature-intro-actions">
                  <button
                    type="button"
                    className="feature-intro-round"
                    onClick={() => goToSlide(activeIndex - 1)}
                    disabled={activeIndex === 0}
                    aria-label={t("featureIntro.previousPage")}
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <button
                    type="button"
                    className="feature-intro-primary"
                    onClick={() => {
                      if (isLast) {
                        requestClose();
                        return;
                      }
                      goToSlide(activeIndex + 1);
                    }}
                  >
                    {isLast ? (
                      <>
                        <Check size={17} />
                        {resolvedFinishLabel}
                      </>
                    ) : (
                      <>
                        {t("featureIntro.nextPage")}
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
