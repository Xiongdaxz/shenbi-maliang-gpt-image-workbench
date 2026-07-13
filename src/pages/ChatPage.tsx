import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { AddAssetFromImageModal } from "../components/AddAssetFromImageModal";
import { CaseMaterialPickerModal } from "../components/CaseMaterialPickerModal";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatMessage, ChatMessageThread } from "../components/chat/ChatMessages";
import { FeatureIntroModal } from "../components/FeatureIntroModal";
import { ImageEditWorkspace } from "../components/ImageEditWorkspace";
import { PromptStarter } from "../components/PromptStarter";
import { RenderingErrorMessage, RenderingMessage } from "../components/RenderingMessage";
import { ScrollJumpButton } from "../components/ScrollJumpButton";
import {
  NEW_SESSION_PENDING_SCOPE,
  createSubmitRequestId,
  sourceReferenceFromAsset,
  sourceReferenceFromCaseMaterial,
  sourceSnapshotFromMessage,
  type SubmitRequest
} from "../lib/chatRequest";
import { MAIN_CHAT_BRANCH_ID, buildChatRenderState, isServerEchoOfPending } from "../lib/chatRender";
import { cx } from "../lib/cx";
import { type AssetUploadMode } from "../lib/assets";
import { getAppIntroSlides } from "../lib/featureIntroSlides";
import { isDefaultCaseItemId } from "../lib/defaultCases";
import { useI18n, type LocaleCode } from "../i18n";
import { requestSizeFromSelection, type SizeOption } from "../lib/imageOptions";
import { normalizePromptColorSchemeIds } from "../lib/promptColorSchemes";
import { normalizePromptOptimizeStyle, sanitizePromptOptimizeStyleGroups } from "../lib/promptOptimizeStyles";
import { getTimeGreetingKey } from "../lib/timeGreeting";
import { workImageFromMessage } from "../lib/workImages";
import { useComposerPasteAsset } from "../hooks/useComposerPasteAsset";
import { useComposerTextareaAutosize } from "../hooks/useComposerTextareaAutosize";
import { useChatScrollJump } from "../hooks/useChatScrollJump";
import { useChatViewState } from "../hooks/useChatViewState";
import { GUIDE_KEYS, useGuideSeen } from "../hooks/useGuideSeen";
import { useImageProviderSelection } from "../hooks/useImageProviderSelection";
import { useImageEditorLauncher } from "../hooks/useImageEditorLauncher";
import { useRunningImageJobRefresh } from "../hooks/useRunningImageJobRefresh";
import { COMPOSER_NEW_DRAFT_SCOPE_KEY, useWorkbench, type ComposerSessionDraft } from "../store/workbench";
import type { AssetItem, CaseCategory, CaseMaterialItem, ChatSession, ImageEditSuggestion, ImageJob, Message, User, WorkImage } from "../types";
import { useToast } from "../ui";

type SessionPage = Awaited<ReturnType<typeof api.sessions>>;
type ActiveSessionPages = InfiniteData<SessionPage, number>;

const SIDEBAR_SESSION_PAGE_SIZE = 30;

type AssetModalTarget =
  | { type: "image"; item: WorkImage }
  | { type: "case"; item: CaseMaterialItem };

const PROMPT_INPUT_OPTIMIZE_STYLE_STORAGE_KEY = "gpt-image.prompt-input-optimize-style";
const MESSAGE_REVEAL_STAGGER_MS = 46;
const MESSAGE_REVEAL_MAX_DELAY_MS = 414;
const EMPTY_PROMPT_COLOR_SCHEMES: [] = [];
const FALLBACK_IMAGE_EDIT_SUGGESTIONS_BY_LOCALE: Record<LocaleCode, Array<Omit<ImageEditSuggestion, "id">>> = {
  "zh-CN": [
    {
      label: "强化视觉焦点",
      prompt: "保留当前主体，选出画面最重要的一个信息或物件，通过位置、光影和留白调整让它更醒目。"
    },
    {
      label: "补真实场景",
      prompt: "保留当前风格，把主体放进更具体的使用场景，加入 1-2 个能说明用途的道具或环境细节。"
    },
    {
      label: "精修关键细节",
      prompt: "保留整体构图，针对最容易出错的文字、边缘、材质或表情做局部精修，让画面更干净可信。"
    }
  ],
  "zh-TW": [
    {
      label: "強化視覺焦點",
      prompt: "保留目前主體，選出畫面最重要的資訊或物件，透過位置、光影和留白讓它更醒目。"
    },
    {
      label: "補真實場景",
      prompt: "保留目前風格，把主體放進更具體的使用場景，加入 1-2 個能說明用途的道具或環境細節。"
    },
    {
      label: "精修關鍵細節",
      prompt: "保留整體構圖，針對最容易出錯的文字、邊緣、材質或表情做局部精修，讓畫面更乾淨可信。"
    }
  ],
  "en-US": [
    {
      label: "Strengthen focal point",
      prompt: "Keep the current subject, choose the most important message or object, and use placement, lighting, and whitespace to make it stand out."
    },
    {
      label: "Add real context",
      prompt: "Keep the current style and place the subject in a more specific use scene with 1-2 props or environmental details."
    },
    {
      label: "Refine key details",
      prompt: "Keep the overall composition and retouch the most fragile text, edges, materials, or expressions so the image feels cleaner and more credible."
    }
  ],
  "ja-JP": [
    {
      label: "焦点を強める",
      prompt: "現在の主体を保ち、最も重要な情報や物を選び、配置、光、余白でより目立つように調整してください。"
    },
    {
      label: "実用場面を足す",
      prompt: "現在のスタイルを保ち、主体をより具体的な使用シーンに置き、用途が伝わる小物や環境要素を 1-2 個追加してください。"
    },
    {
      label: "重要部分を整える",
      prompt: "全体の構図を保ち、文字、輪郭、素材感、表情など崩れやすい部分を局所的に整えて、より自然で信頼感のある画面にしてください。"
    }
  ],
  "ko-KR": [
    {
      label: "시선 중심 강화",
      prompt: "현재 주체는 유지하고 가장 중요한 정보나 오브젝트를 정한 뒤 위치, 조명, 여백으로 더 눈에 띄게 조정하세요."
    },
    {
      label: "실제 사용 장면 추가",
      prompt: "현재 스타일을 유지하면서 주체를 더 구체적인 사용 장면에 배치하고 용도를 설명하는 소품이나 환경 디테일을 1-2개 추가하세요."
    },
    {
      label: "핵심 디테일 보정",
      prompt: "전체 구도는 유지하고 텍스트, 가장자리, 재질, 표정처럼 어색해지기 쉬운 부분을 부분적으로 다듬어 더 깔끔하고 신뢰감 있게 만드세요."
    }
  ],
  "es-ES": [
    {
      label: "Reforzar el foco",
      prompt: "Mantén el sujeto actual, elige el mensaje u objeto más importante y usa posición, luz y espacio para hacerlo más visible."
    },
    {
      label: "Añadir contexto real",
      prompt: "Mantén el estilo actual y coloca el sujeto en una escena de uso más concreta con 1 o 2 accesorios o detalles del entorno."
    },
    {
      label: "Pulir detalles clave",
      prompt: "Mantén la composición general y retoca textos, bordes, materiales o expresiones delicadas para que la imagen se vea más limpia y creíble."
    }
  ],
  "fr-FR": [
    {
      label: "Renforcer le focus",
      prompt: "Gardez le sujet actuel, choisissez le message ou l'objet le plus important, puis utilisez placement, lumière et espace pour le rendre plus visible."
    },
    {
      label: "Ajouter un contexte réel",
      prompt: "Gardez le style actuel et placez le sujet dans une scène d'usage plus précise avec 1 ou 2 accessoires ou détails d'environnement."
    },
    {
      label: "Affiner les détails clés",
      prompt: "Gardez la composition générale et retouchez les textes, contours, matières ou expressions fragiles pour une image plus propre et crédible."
    }
  ],
  "de-DE": [
    {
      label: "Fokus stärken",
      prompt: "Behalte das aktuelle Hauptmotiv bei, wähle die wichtigste Information oder das wichtigste Objekt und betone es durch Position, Licht und Freiraum."
    },
    {
      label: "Realen Kontext ergänzen",
      prompt: "Behalte den aktuellen Stil bei und setze das Motiv in eine konkretere Nutzungsszene mit 1-2 passenden Requisiten oder Umgebungsdetails."
    },
    {
      label: "Kerndetails verfeinern",
      prompt: "Behalte die Gesamtkomposition bei und retuschiere empfindliche Texte, Kanten, Materialien oder Gesichtsausdrücke für ein saubereres, glaubwürdigeres Bild."
    }
  ],
  "pt-BR": [
    {
      label: "Reforçar o foco",
      prompt: "Mantenha o sujeito atual, escolha a mensagem ou objeto mais importante e use posição, luz e respiro para destacá-lo melhor."
    },
    {
      label: "Adicionar contexto real",
      prompt: "Mantenha o estilo atual e coloque o sujeito em uma cena de uso mais concreta com 1 ou 2 acessórios ou detalhes de ambiente."
    },
    {
      label: "Refinar detalhes-chave",
      prompt: "Mantenha a composição geral e retoque textos, bordas, materiais ou expressões frágeis para a imagem ficar mais limpa e confiável."
    }
  ],
  "ru-RU": [
    {
      label: "Усилить фокус",
      prompt: "Сохраните текущий главный объект, выберите самое важное сообщение или деталь и выделите ее композицией, светом и свободным пространством."
    },
    {
      label: "Добавить реальный контекст",
      prompt: "Сохраните текущий стиль и поместите объект в более конкретную сцену использования, добавив 1-2 предмета или детали окружения."
    },
    {
      label: "Уточнить ключевые детали",
      prompt: "Сохраните общую композицию и аккуратно доработайте текст, края, материалы или выражения, чтобы изображение выглядело чище и достовернее."
    }
  ],
  "fa-IR": [
    {
      label: "تقویت نقطه کانونی",
      prompt: "سوژه فعلی را حفظ کنید، مهم ترین پیام یا شیء را انتخاب کنید و با جایگذاری، نور و فضای خالی آن را برجسته تر کنید."
    },
    {
      label: "افزودن زمینه واقعی",
      prompt: "سبک فعلی را حفظ کنید و سوژه را در یک موقعیت کاربردی مشخص تر قرار دهید، همراه با 1 یا 2 وسیله یا جزئیات محیطی."
    },
    {
      label: "اصلاح جزئیات کلیدی",
      prompt: "ترکیب کلی را حفظ کنید و متن، لبه ها، جنس مواد یا حالت چهره را که ممکن است ناهماهنگ باشد اصلاح کنید تا تصویر تمیزتر و قابل اعتمادتر شود."
    }
  ]
};

function fallbackImageEditSuggestionsForLocale(locale: LocaleCode): ImageEditSuggestion[] {
  return (FALLBACK_IMAGE_EDIT_SUGGESTIONS_BY_LOCALE[locale] ?? FALLBACK_IMAGE_EDIT_SUGGESTIONS_BY_LOCALE["zh-CN"]).map((item, index) => ({
    id: `fallback-edit-suggestion-${index + 1}`,
    ...item
  }));
}

function messageRevealStyle(index: number): CSSProperties {
  return {
    "--message-enter-delay": `${Math.min(index * MESSAGE_REVEAL_STAGGER_MS, MESSAGE_REVEAL_MAX_DELAY_MS)}ms`
  } as CSSProperties;
}

function ChatMessageSkeleton() {
  return (
    <div className="message-skeleton-list" aria-hidden="true">
      <div className="message-skeleton message-skeleton-user">
        <span className="message-skeleton-line message-skeleton-line-user" />
      </div>
      <div className="message-skeleton message-skeleton-assistant">
        <span className="message-skeleton-line message-skeleton-line-wide" />
        <span className="message-skeleton-line message-skeleton-line-short" />
      </div>
      <div className="message-skeleton message-skeleton-assistant">
        <span className="message-skeleton-image-box" />
      </div>
    </div>
  );
}

function fallbackImageEditSuggestionsForImage(image: WorkImage | null, locale: LocaleCode): ImageEditSuggestion[] {
  if (locale !== "zh-CN") return fallbackImageEditSuggestionsForLocale(locale);
  const promptText = `${image?.originPrompt ?? ""} ${image?.prompt ?? ""}`.replace(/\s+/g, " ").trim();
  const promptLookup = promptText.toLowerCase();
  const pickSubject = () => {
    if (promptLookup.includes("老虎") && promptLookup.includes("小老虎")) return "老虎和小老虎";
    const subjectRules: Array<[string[], string]> = [
      [["老虎"], "老虎"],
      [["狮子"], "狮子"],
      [["熊猫"], "熊猫"],
      [["小猪", "猪"], "小猪"],
      [["猫"], "猫"],
      [["狗"], "狗"],
      [["狐狸"], "狐狸"],
      [["logo", "标志", "商标", "品牌"], "品牌标志"],
      [["人物", "人像", "肖像", "模特", "女孩", "男孩", "女性", "男性", "角色"], "人物主体"],
      [["产品", "商品", "包装", "瓶", "杯", "鞋", "包", "香水", "首饰", "手机"], "产品主体"],
      [["海报", "攻略", "流程图", "信息图", "教程", "路线", "地图", "版式", "封面", "banner"], "版式内容"],
      [["菜", "食物", "餐", "咖啡", "饮品", "甜品", "蛋糕", "水果"], "食物主体"],
      [["风景", "旅行", "城市", "海边", "山", "草原", "森林", "岛", "长城", "建筑"], "景观主体"]
    ];
    const matched = subjectRules.find(([keywords]) => keywords.some((keyword) => promptLookup.includes(keyword.toLowerCase())));
    if (matched) return matched[1];
    return Array.from(
      (promptText.match(/^(.+?)([。！？!?；;.]|$)/)?.[1] ?? promptText)
        .replace(/[，,、：:]\s*$/g, "")
        .trim()
        || "当前主题"
    ).slice(0, 12).join("");
  };
  const subject = pickSubject();
  const match = (keywords: string[]) => keywords.some((keyword) => promptLookup.includes(keyword.toLowerCase()));
  const build = (items: Array<Omit<ImageEditSuggestion, "id">>) =>
    items.slice(0, 3).map((item, index) => ({
      id: `fallback-edit-suggestion-${index + 1}`,
      ...item
    }));

  if (match(["老虎", "狮子", "猫", "狗", "小猪", "猪", "动物", "鸟", "马", "熊猫", "狐狸"])) {
    return build([
      { label: "加入互动动作", prompt: `保留「${subject}」的主体识别，加入一个明确互动动作，例如靠近、回头、奔跑或陪伴，并让动作成为画面焦点。` },
      { label: "加前景环境层", prompt: `保留「${subject}」和当前风格，在前景加入草叶、岩石、雾气或水面反光，形成前中后景层次。` },
      { label: "做竖版电影海报", prompt: `保留「${subject}」主体，改成竖版电影海报构图，上方留片名位置，下方加入小号演职员式文字和戏剧化背景。` }
    ]);
  }

  if (match(["logo", "图标", "标志", "商标", "品牌", "字体设计"])) {
    return build([
      { label: "补品牌应用物料", prompt: `保留「${subject}」标志核心识别，加入名片、纸袋、招牌或包装盒 2-3 个应用物料，统一品牌色。` },
      { label: "优化小尺寸识别", prompt: `保留「${subject}」标志概念，拉开图形和文字间距，减少过细线条，让 64px 小尺寸下轮廓仍清楚。` },
      { label: "做门头样机展示", prompt: `保留「${subject}」标志主体，把它放到店铺门头或墙面发光字样机上，加入真实阴影和材质反射。` }
    ]);
  }

  if (match(["人物", "人像", "肖像", "模特", "女孩", "男孩", "女性", "男性", "角色"])) {
    return build([
      { label: "改成杂志封面", prompt: `保留「${subject}」人物造型，改成杂志封面构图，人物压住部分刊名，侧边加入 3 条短封面标题。` },
      { label: "细化手部表情", prompt: `保留「${subject}」身份和服装，微调眼神、嘴角和手部动作，让情绪更明确，避免手指变形。` },
      { label: "加入角色道具", prompt: `保留「${subject}」人物主体，加入一个能解释角色身份的道具，例如相机、花束、工具或票据，并放在手边或前景。` }
    ]);
  }

  if (match(["产品", "商品", "电商", "包装", "瓶", "杯", "鞋", "包", "香水", "首饰", "手机"])) {
    return build([
      { label: "加三处卖点标注", prompt: `保留「${subject}」产品主体，在产品周围加入 3 个细线标注点，分别指向材质、结构和使用亮点。` },
      { label: "做真实使用场景", prompt: `保留「${subject}」外观，把背景改成真实使用场景，并加入手部、桌面或空间参照来体现尺寸感。` },
      { label: "改电商白底主图", prompt: `保留「${subject}」产品角度，改成白底电商主图，主体占画面 75%，右侧预留 2-3 条卖点文字。` }
    ]);
  }

  if (match(["菜", "食物", "餐", "咖啡", "饮品", "甜品", "蛋糕", "水果"])) {
    return build([
      { label: "加菜名价格区", prompt: `保留「${subject}」食物主体，在左上或右下加入菜名、价格和一句短卖点，文字不要遮挡食物。` },
      { label: "补餐桌道具", prompt: `保留「${subject}」摆盘，在周围加入餐具、桌布、饮品或手部动作，形成真实用餐场景。` },
      { label: "突出食欲局部", prompt: `保留整体构图，放大「${subject}」最诱人的局部，例如切面、汁水、热气或酥脆边缘。` }
    ]);
  }

  if (match(["海报", "攻略", "流程图", "信息图", "教程", "路线", "地图", "版式", "封面", "banner"])) {
    return build([
      { label: "强化第一眼重点", prompt: `保留「${subject}」主题，先突出最想让用户看到的一句话或一个视觉焦点，用留白、大小对比或色块拉开层级。` },
      { label: "删减拥挤信息", prompt: `保留「${subject}」核心内容，弱化重复说明，把次要文字压缩成更短的提示，让主要信息更容易扫读。` },
      { label: "换成使用场景", prompt: `保留「${subject}」原有信息，把画面包装成更明确的使用场景，例如收藏截图、活动预告、社媒封面或店内展示。` }
    ]);
  }

  if (match(["风景", "旅行", "城市", "海边", "山", "草原", "森林", "岛", "长城", "建筑"])) {
    return build([
      { label: "加旅行标题贴纸", prompt: `保留「${subject}」景观主体，在天空或留白处加入目的地标题贴纸、日期和一句短标语。` },
      { label: "补人物尺度参照", prompt: `保留「${subject}」主要景观，在前景加入一个小人物或小队伍作为尺度参照，不要抢走景观主体。` },
      { label: "做明信片边框", prompt: `保留「${subject}」景点识别，加入明信片式白边、邮戳、手写地名和局部小插画。` }
    ]);
  }

  return fallbackImageEditSuggestionsForLocale(locale);
}

function createChatBranchId() {
  return `branch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function submitErrorMessage(error: unknown, fallback = "请求失败") {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  const text = String(error ?? "").trim();
  return text || fallback;
}

function emptyComposerSessionDraft(): ComposerSessionDraft {
  return {
    draftPrompt: "",
    draftCaseUsage: null,
    selectedCaseMaterials: [],
    selectedAssets: [],
    imageCount: 1,
    size: "",
    quality: "",
    promptInputOptimizeStyle: "standard",
    promptColorSchemeIds: [],
    promptColorSchemeId: "",
    promptColorSchemeInjection: "",
    promptTemplate: null
  };
}

function hasComposerDraftContent(draft: Pick<
  ComposerSessionDraft,
  "draftPrompt"
  | "draftCaseUsage"
  | "selectedCaseMaterials"
  | "selectedAssets"
  | "imageCount"
  | "size"
  | "quality"
  | "promptInputOptimizeStyle"
  | "promptColorSchemeIds"
  | "promptColorSchemeId"
  | "promptColorSchemeInjection"
>) {
  return Boolean(
    draft.draftPrompt.trim()
    || draft.draftCaseUsage
    || draft.selectedCaseMaterials.length > 0
    || draft.selectedAssets.length > 0
    || draft.imageCount !== 1
    || draft.size
    || draft.quality
    || draft.promptInputOptimizeStyle !== "standard"
    || draft.promptColorSchemeIds.length > 0
    || draft.promptColorSchemeInjection.trim()
  );
}

function isTemporaryAsset(asset: AssetItem) {
  return asset.temporary === true || Boolean(asset.dataUrl);
}

function persistableAssets(assets: AssetItem[]) {
  return assets.filter((asset) => !isTemporaryAsset(asset));
}

function assetIdsForRequest(assets: AssetItem[]) {
  return persistableAssets(assets).map((asset) => asset.id);
}

function inlineImagesForRequest(assets: AssetItem[]) {
  return assets
    .filter((asset) => isTemporaryAsset(asset) && asset.dataUrl)
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      dataUrl: asset.dataUrl ?? asset.url
    }));
}

function initialPromptInputOptimizeStyleFromBrowser(): ComposerSessionDraft["promptInputOptimizeStyle"] {
  if (typeof window === "undefined") return "standard";
  try {
    return normalizePromptOptimizeStyle(window.localStorage.getItem(PROMPT_INPUT_OPTIMIZE_STYLE_STORAGE_KEY));
  } catch {
    return "standard";
  }
}

export function ChatPage({ user }: { user: User }) {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    draftPrompt,
    draftCaseUsage,
    setDraftPrompt,
    editImage,
    setEditImage,
    editorImageRequest,
    setEditorImageRequest,
    selectedCaseMaterials,
    setSelectedCaseMaterials,
    selectedAssets,
    setSelectedAssets,
    newChatResetKey,
    composerDrafts,
    upsertComposerDraft,
    toggleAsset,
    materialPickerOpen,
    setMaterialPickerOpen,
    setSidebarCollapsed,
    markSessionGenerationRunning,
    markSessionGenerationCompleted,
    clearSessionGenerationStatus,
    newChatPromptOptimizeRequest,
    clearNewChatPromptOptimizeRequest,
    pendingChatSubmit,
    setPendingChatSubmit,
    setPendingChatSubmitScope,
    clearPendingChatSubmitForScopes
  } = useWorkbench();
  const [error, setError] = useState("");
  const pendingUserMessage = pendingChatSubmit?.message ?? null;
  const pendingMode = pendingChatSubmit?.mode ?? "generation";
  const pendingSubmitScope = pendingChatSubmit?.scope ?? null;
  const [submittingScopes, setSubmittingScopes] = useState<string[]>([]);
  const [imageCount, setImageCount] = useState(1);
  const [assetTarget, setAssetTarget] = useState<AssetModalTarget | null>(null);
  const [casePickerOpen, setCasePickerOpen] = useState(false);
  const [chatIntroOpen, setChatIntroOpen] = useState(false);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [starterPromptOptimizeRequest, setStarterPromptOptimizeRequest] = useState<{ id: number; prompt: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptOptimizeCustomInstructionSaveTimerRef = useRef<number | null>(null);
  const pendingSubmitScopeRef = useRef<string | null>(pendingSubmitScope);
  const starterPromptOptimizeRequestIdRef = useRef(0);
  const submitSessionByRequestRef = useRef(new Map<string, string>());
  const retryInFlightJobIdsRef = useRef(new Set<string>());
  const { showToast } = useToast();
  const { resolvedLanguage, t } = useI18n();
  const appIntroGuide = useGuideSeen(GUIDE_KEYS.appIntro);
  const guideDisplayName = user.username?.trim() || user.account?.trim() || t("chat.friend");
  const guideGreeting = t(getTimeGreetingKey());
  const appIntroSlides = useMemo(() => getAppIntroSlides(t), [t]);
  const editSuggestionsEnabled = user.preferences?.editSuggestionsEnabled !== false;
  const editSuggestionTone = user.preferences?.editSuggestionTone ?? "default";
  const autoUploadPastedAssets = user.preferences?.autoUploadPastedAssets !== false;
  const promptOptimizeStyleGroups = useMemo(
    () => sanitizePromptOptimizeStyleGroups(user.preferences?.promptOptimizeStyleGroups),
    [user.preferences?.promptOptimizeStyleGroups]
  );
  const promptOptimizeCustomInstruction = user.preferences?.promptOptimizeCustomInstruction ?? "";

  useEffect(() => {
    document.documentElement.classList.add("chat-page-stable-scrollbar");
    return () => document.documentElement.classList.remove("chat-page-stable-scrollbar");
  }, []);

  const savePromptOptimizeCustomInstruction = useMutation({
    mutationFn: (value: string) => api.saveUserPreferences({ promptOptimizeCustomInstruction: value }),
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], { user: data.user });
    }
  });
  const schedulePromptOptimizeCustomInstructionSave = useCallback((value: string) => {
    if (promptOptimizeCustomInstructionSaveTimerRef.current) {
      window.clearTimeout(promptOptimizeCustomInstructionSaveTimerRef.current);
    }
    promptOptimizeCustomInstructionSaveTimerRef.current = window.setTimeout(() => {
      promptOptimizeCustomInstructionSaveTimerRef.current = null;
      savePromptOptimizeCustomInstruction.mutate(value);
    }, 500);
  }, [savePromptOptimizeCustomInstruction]);

  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const assets = useQuery({ queryKey: ["assets"], queryFn: () => api.assets() });
  const assetCategories = useQuery({ queryKey: ["asset-categories"], queryFn: api.assetCategories, enabled: Boolean(assetTarget) });
  const cases = useQuery({ queryKey: ["cases"], queryFn: () => api.cases() });
  const promptColorSchemes = useQuery({ queryKey: ["prompt-color-schemes"], queryFn: () => api.promptColorSchemes() });
  const messages = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => api.messages(sessionId!),
    enabled: Boolean(sessionId)
  });
  const sessionImageJobs = useQuery({
    queryKey: ["session-image-jobs", sessionId],
    queryFn: () => api.sessionImageJobs(sessionId!, "all"),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => {
      const data = query.state.data as { jobs: ImageJob[] } | undefined;
      return data?.jobs.some((job) => job.status === "running") ? 120000 : false;
    }
  });

  const providerOptions = providers.data?.providers ?? [];
  const assetCategoryList = assetCategories.data?.categories ?? [];
  const { currentProvider, providerId, quality, qualityOptions, setQuality, setSize, size, sizeOptions } = useImageProviderSelection(providerOptions);
  const composerScopeKey = sessionId ? `session:${sessionId}` : COMPOSER_NEW_DRAFT_SCOPE_KEY;
  const composerInstanceKey = sessionId ? composerScopeKey : `${COMPOSER_NEW_DRAFT_SCOPE_KEY}:${newChatResetKey}`;
  const currentComposerDraft = composerDrafts[composerScopeKey] ?? null;
  const currentPromptTemplateDraft = composerDrafts[composerScopeKey]?.promptTemplate ?? null;
  const promptColorSchemeList = promptColorSchemes.data?.schemes ?? EMPTY_PROMPT_COLOR_SCHEMES;
  const currentPromptInputOptimizeStyle = normalizePromptOptimizeStyle(
    currentComposerDraft?.promptInputOptimizeStyle ?? initialPromptInputOptimizeStyleFromBrowser(),
    promptOptimizeStyleGroups
  );
  const currentPromptColorSchemeIds = useMemo(() => (
    promptColorSchemeList.length > 0
      ? normalizePromptColorSchemeIds(currentComposerDraft?.promptColorSchemeIds ?? currentComposerDraft?.promptColorSchemeId, promptColorSchemeList).slice(0, 1)
      : Array.isArray(currentComposerDraft?.promptColorSchemeIds)
        ? currentComposerDraft.promptColorSchemeIds.slice(0, 1)
        : []
  ), [currentComposerDraft?.promptColorSchemeId, currentComposerDraft?.promptColorSchemeIds, promptColorSchemeList]);
  const currentPromptColorSchemeIdsKey = currentPromptColorSchemeIds.join("\u0000");
  const currentPromptColorSchemeInjection = currentComposerDraft?.promptColorSchemeInjection ?? "";
  const restoringComposerDraftScopeRef = useRef<string | null>(null);
  const hasRestoredComposerScopeRef = useRef(false);
  const handlePromptTemplateDraftChange = useCallback((promptTemplate: ComposerSessionDraft["promptTemplate"]) => {
    upsertComposerDraft(composerScopeKey, { promptTemplate });
  }, [composerScopeKey, upsertComposerDraft]);
  const handlePromptInputOptimizeStyleChange = useCallback((promptInputOptimizeStyle: ComposerSessionDraft["promptInputOptimizeStyle"]) => {
    upsertComposerDraft(composerScopeKey, { promptInputOptimizeStyle });
  }, [composerScopeKey, upsertComposerDraft]);
  const handlePromptColorSchemeChange = useCallback((state: { ids: string[]; injection: string; prompt: string }) => {
    setDraftPrompt(state.prompt);
    upsertComposerDraft(composerScopeKey, {
      draftPrompt: state.prompt,
      promptColorSchemeIds: state.ids,
      promptColorSchemeId: state.ids[0] ?? "",
      promptColorSchemeInjection: state.injection
    });
  }, [composerScopeKey, setDraftPrompt, upsertComposerDraft]);
  const resetPromptColorScheme = useCallback(() => {
    upsertComposerDraft(composerScopeKey, {
      promptColorSchemeIds: [],
      promptColorSchemeId: "",
      promptColorSchemeInjection: ""
    });
  }, [composerScopeKey, upsertComposerDraft]);
  const resetPromptInputOptimizeStyle = useCallback(() => {
    handlePromptInputOptimizeStyleChange("standard");
    try {
      window.localStorage.setItem(PROMPT_INPUT_OPTIMIZE_STYLE_STORAGE_KEY, "standard");
    } catch {
      // localStorage can be unavailable in restricted browser modes.
    }
  }, [handlePromptInputOptimizeStyleChange]);

  const refreshSessionsNonCancel = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["sessions"] }, { cancelRefetch: false });
  }, [queryClient]);

  const scheduleSessionTitleRefresh = useCallback(() => {
    const delays = [1600, 5000, 15000];
    for (const delay of delays) {
      window.setTimeout(refreshSessionsNonCancel, delay);
    }
  }, [refreshSessionsNonCancel]);

  const navigateToSessionIfNeeded = useCallback((nextSessionId: string) => {
    const nextPath = `/chat/${nextSessionId}`;
    if (window.location.pathname !== nextPath) navigate(nextPath);
  }, [navigate]);

  const upsertSessionSummary = useCallback((session: ChatSession) => {
    queryClient.setQueryData<{ sessions: ChatSession[] }>(["sessions"], (current) => {
      const sessions = current?.sessions ?? [];
      return { sessions: [session, ...sessions.filter((item) => item.id !== session.id)] };
    });
    queryClient.setQueryData<ActiveSessionPages>(["sessions", "active"], (current) => {
      const firstPage = current?.pages[0] ?? {
        sessions: [],
        pageInfo: {
          limit: SIDEBAR_SESSION_PAGE_SIZE,
          offset: 0,
          total: 0,
          hasMore: false
        }
      };
      const restPages = current?.pages.slice(1) ?? [];
      const existingSessions = current?.pages.flatMap((page) => page.sessions) ?? [];
      const wasPresent = existingSessions.some((item) => item.id === session.id);
      const nextTotal = wasPresent ? firstPage.pageInfo.total : firstPage.pageInfo.total + 1;
      return {
        ...(current ?? {}),
        pages: [
          {
            ...firstPage,
            sessions: [session, ...firstPage.sessions.filter((item) => item.id !== session.id)].slice(0, firstPage.pageInfo.limit),
            pageInfo: { ...firstPage.pageInfo, total: nextTotal, hasMore: firstPage.pageInfo.hasMore || nextTotal > firstPage.pageInfo.limit }
          },
          ...restPages.map((page) => ({
            ...page,
            sessions: page.sessions.filter((item) => item.id !== session.id),
            pageInfo: { ...page.pageInfo, total: wasPresent ? page.pageInfo.total : page.pageInfo.total + 1 }
          }))
        ],
        pageParams: current?.pageParams ?? [0]
      };
    });
  }, [queryClient]);

  const setPendingScope = (scope: string | null) => {
    pendingSubmitScopeRef.current = scope;
    if (scope) {
      setPendingChatSubmitScope(scope);
    } else {
      setPendingChatSubmit(null);
    }
  };

  const addSubmittingScope = (scope: string) => {
    setSubmittingScopes((current) => (current.includes(scope) ? current : [...current, scope]));
  };

  const replaceSubmittingScope = (fromScope: string, toScope: string) => {
    setSubmittingScopes((current) => {
      const next = current.filter((scope) => scope !== fromScope && scope !== toScope);
      return [...next, toScope];
    });
  };

  const removeSubmittingScopes = (scopes: string[]) => {
    const scopeSet = new Set(scopes.filter(Boolean));
    setSubmittingScopes((current) => current.filter((scope) => !scopeSet.has(scope)));
  };

  const clearPendingForScopes = (scopes: string[]) => {
    const scopeSet = new Set(scopes.filter(Boolean));
    const currentScope = pendingSubmitScopeRef.current ?? pendingSubmitScope;
    if (currentScope && scopeSet.has(currentScope)) {
      pendingSubmitScopeRef.current = null;
    }
    clearPendingChatSubmitForScopes(scopes);
  };

  useEffect(() => {
    pendingSubmitScopeRef.current = pendingSubmitScope;
  }, [pendingSubmitScope]);

  const ensureSubmitSession = async (request: SubmitRequest) => {
    if (request.sessionId) {
      submitSessionByRequestRef.current.set(request.clientRequestId, request.sessionId);
      markSessionGenerationRunning(request.sessionId);
      if (pendingSubmitScopeRef.current === request.pendingScope) setPendingScope(request.sessionId);
      return request.sessionId;
    }
    const result = await api.createSession({ prompt: request.prompt });
    submitSessionByRequestRef.current.set(request.clientRequestId, result.session.id);
    replaceSubmittingScope(request.pendingScope, result.session.id);
    if (pendingSubmitScopeRef.current === request.pendingScope) setPendingScope(result.session.id);
    upsertSessionSummary(result.session);
    markSessionGenerationRunning(result.session.id);
    scheduleSessionTitleRefresh();
    navigateToSessionIfNeeded(result.session.id);
    return result.session.id;
  };

  const submit = useMutation({
    mutationFn: async (request: SubmitRequest) => {
      setError("");
      const activeSessionId = await ensureSubmitSession(request);
      const branchFields = {
        ...(request.branchId ? { branchId: request.branchId } : {}),
        ...(request.parentBranchId ? { parentBranchId: request.parentBranchId } : {}),
        ...(request.branchForkMessageId ? { branchForkMessageId: request.branchForkMessageId } : {}),
        ...(request.branchRootMessageId ? { branchRootMessageId: request.branchRootMessageId } : {})
      };
      if (request.mode === "edit") {
        return api.edit({
          sessionId: activeSessionId,
          providerId: request.providerId,
          prompt: request.prompt,
          ...(request.language ? { language: request.language } : {}),
          size: requestSizeFromSelection(request.size ?? ""),
          ...(request.quality ? { quality: request.quality } : {}),
          ...(request.n ? { n: request.n } : {}),
          sourceImageIds: request.sourceImageIds ?? [],
          sourceAssetIds: request.sourceAssetIds ?? [],
          sourceCaseItemIds: request.sourceCaseItemIds ?? [],
          sourceReferenceIds: request.sourceReferenceIds ?? [],
          ...(request.sourceInlineImages?.length ? { sourceInlineImages: request.sourceInlineImages } : {}),
          ...(request.referenceAssetId ? { referenceAssetId: request.referenceAssetId } : {}),
          ...(request.maskDataUrl ? { maskDataUrl: request.maskDataUrl } : {}),
          ...(request.hideReference ? { hideReference: true } : {}),
          ...(request.caseItemId ? { caseItemId: request.caseItemId } : {}),
          ...(request.revisionRootId ? { revisionRootId: request.revisionRootId } : {}),
          ...(request.editedMessageId ? { editedMessageId: request.editedMessageId } : {}),
          ...branchFields
        });
      }
      return api.generate({
        sessionId: activeSessionId,
        providerId: request.providerId,
        prompt: request.prompt,
        ...(request.language ? { language: request.language } : {}),
        size: requestSizeFromSelection(request.size ?? ""),
        ...(request.quality ? { quality: request.quality } : {}),
        ...(request.n ? { n: request.n } : {}),
        ...(request.caseItemId ? { caseItemId: request.caseItemId } : {}),
        ...(request.revisionRootId ? { revisionRootId: request.revisionRootId } : {}),
        ...(request.editedMessageId ? { editedMessageId: request.editedMessageId } : {}),
        ...branchFields
      });
    },
    onSuccess: (result, request) => {
      const completedSessionId = submitSessionByRequestRef.current.get(request.clientRequestId) ?? result.sessionId;
      const returnedJob = result.job ?? null;
      const jobStillRunning = returnedJob?.status === "running";
      submitSessionByRequestRef.current.delete(request.clientRequestId);
      if (request.pendingScope === NEW_SESSION_PENDING_SCOPE) appIntroGuide.markSeen();
      removeSubmittingScopes([request.pendingScope, completedSessionId]);
      if (returnedJob) {
        queryClient.setQueryData<{ jobs: ImageJob[] }>(["session-image-jobs", completedSessionId], (current) => {
          const jobs = current?.jobs ?? [];
          return { jobs: [returnedJob, ...jobs.filter((job) => job.id !== returnedJob.id)] };
        });
      }
      if (jobStillRunning) {
        markSessionGenerationRunning(completedSessionId);
      } else {
        markSessionGenerationCompleted(completedSessionId);
      }
      refreshSessionsNonCancel();
      queryClient.invalidateQueries({ queryKey: ["messages", completedSessionId] });
      queryClient.invalidateQueries({ queryKey: ["session-image-jobs", completedSessionId] });
      if (!jobStillRunning) {
        queryClient.invalidateQueries({ queryKey: ["cases"] });
        queryClient.invalidateQueries({ queryKey: ["images"] });
      }
      const currentRouteScope = sessionId ?? NEW_SESSION_PENDING_SCOPE;
      if (currentRouteScope === request.pendingScope || currentRouteScope === completedSessionId) {
        navigateToSessionIfNeeded(completedSessionId);
      }
    },
    onError: (err, request) => {
      const failedSessionId = submitSessionByRequestRef.current.get(request.clientRequestId);
      submitSessionByRequestRef.current.delete(request.clientRequestId);
      removeSubmittingScopes([request.pendingScope, failedSessionId ?? ""]);
      clearPendingForScopes([request.pendingScope, failedSessionId ?? ""]);
      if (failedSessionId) clearSessionGenerationStatus(failedSessionId);
      if (failedSessionId) {
        refreshSessionsNonCancel();
        if (request.caseItemId) queryClient.invalidateQueries({ queryKey: ["cases"] });
        queryClient.invalidateQueries({ queryKey: ["messages", failedSessionId] });
        queryClient.invalidateQueries({ queryKey: ["session-image-jobs", failedSessionId] });
        if ((sessionId ?? NEW_SESSION_PENDING_SCOPE) === request.pendingScope) navigateToSessionIfNeeded(failedSessionId);
      }
      const currentRouteScope = sessionId ?? NEW_SESSION_PENDING_SCOPE;
      const message = submitErrorMessage(err, t("common.requestFailed"));
      showToast(message, "error");
      if (currentRouteScope === request.pendingScope || currentRouteScope === failedSessionId) {
        setError(message);
      }
    }
  });
  const retryImageJob = useMutation({
    mutationFn: (jobId: string) => api.retryImageJob(jobId),
    onMutate: (jobId) => {
      setError("");
      if (!sessionId) return;
      markSessionGenerationRunning(sessionId);
      queryClient.setQueryData<{ jobs: ImageJob[] }>(["session-image-jobs", sessionId], (current) =>
        current
          ? {
              jobs: current.jobs.map((job) =>
                job.id === jobId
                  ? {
                      ...job,
                      status: "running",
                      error: null,
                      resultImageId: null,
                      updatedAt: new Date().toISOString()
                    }
                  : job
              )
            }
          : current
      );
    },
    onSuccess: (result) => {
      const completedSessionId = result.sessionId || sessionId;
      if (!completedSessionId) return;
      const returnedJob = result.job ?? null;
      if (returnedJob) {
        queryClient.setQueryData<{ jobs: ImageJob[] }>(["session-image-jobs", completedSessionId], (current) => {
          const jobs = current?.jobs ?? [];
          return { jobs: [returnedJob, ...jobs.filter((job) => job.id !== returnedJob.id)] };
        });
      }
      if (returnedJob?.status === "running") {
        markSessionGenerationRunning(completedSessionId);
      } else {
        markSessionGenerationCompleted(completedSessionId);
      }
      refreshSessionsNonCancel();
      queryClient.invalidateQueries({ queryKey: ["session-image-jobs", completedSessionId] });
      if (returnedJob?.status !== "running") {
        queryClient.invalidateQueries({ queryKey: ["images"] });
        queryClient.invalidateQueries({ queryKey: ["messages", completedSessionId] });
      }
    },
    onError: (error) => {
      const message = submitErrorMessage(error, t("toast.retryFailed"));
      if (message.includes("任务正在处理中")) {
        showToast(t("toast.retryInProgress"), "info");
      } else if (message.includes("带遮罩的编辑无法自动重试")) {
        showToast(t("toast.maskRetryUnsupported"), "info");
      } else {
        showToast(message, "error");
      }
      if (!sessionId) return;
      clearSessionGenerationStatus(sessionId);
      refreshSessionsNonCancel();
      queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["session-image-jobs", sessionId] });
    }
  });
  const addAsset = useMutation({
    mutationFn: (payload: { source: AssetModalTarget; name?: string; spaceMode: AssetUploadMode; categoryIds: string[] }) =>
      api.addAssetFromImage({
        ...(payload.source.type === "image" ? { imageId: payload.source.item.id } : { caseItemId: payload.source.item.caseItemId }),
        name: payload.name,
        spaceMode: payload.spaceMode,
        categoryIds: payload.categoryIds
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      setAssetTarget(null);
      if (result.created) {
        showToast(t("toast.assetAdded"));
      } else {
        showToast(result.duplicateScope === "shared" ? t("toast.assetDuplicateShared") : t("toast.assetDuplicatePrivate"), "error");
      }
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.assetAddFailed"), "error");
    }
  });
  const routeSubmitScope = sessionId ?? NEW_SESSION_PENDING_SCOPE;
  const pendingSessionHandoffScope =
    !sessionId
    && pendingSubmitScope
    && pendingSubmitScope !== NEW_SESSION_PENDING_SCOPE
      ? pendingSubmitScope
      : null;
  const currentSubmitScope = pendingSessionHandoffScope ?? routeSubmitScope;
  const currentScopeSubmitting =
    submittingScopes.includes(routeSubmitScope)
    || (pendingSessionHandoffScope ? submittingScopes.includes(pendingSessionHandoffScope) : false);
  const imageJobs = sessionImageJobs.data?.jobs ?? [];
  const runningImageJobs = imageJobs.filter((job) => job.status === "running");
  const failedJobIds = useMemo(() => new Set(imageJobs.filter((job) => job.status === "failed").map((job) => job.id)), [imageJobs]);
  const retryingJobId = retryImageJob.isPending ? retryImageJob.variables ?? "" : "";
  const currentScopeBusy = currentScopeSubmitting || runningImageJobs.length > 0;
  const triggerRetryImageJob = (jobId: string) => {
    const normalizedJobId = jobId.trim();
    if (!normalizedJobId) return;
    if (retryInFlightJobIdsRef.current.has(normalizedJobId)) return;
    retryInFlightJobIdsRef.current.add(normalizedJobId);
    retryImageJob.mutate(normalizedJobId, {
      onSettled: () => {
        retryInFlightJobIdsRef.current.delete(normalizedJobId);
      }
    });
  };
  const { handleComposerPaste } = useComposerPasteAsset({ autoUploadPastedAssets, selectedAssets, setSelectedAssets, showToast });
  const pickCasePrompt = (item: Pick<CaseCategory["items"][number], "id" | "groupId" | "prompt">) => {
    const caseItemId = item.groupId || item.id;
    setDraftPrompt(item.prompt, caseItemId && !isDefaultCaseItemId(caseItemId) ? { caseItemId, prompt: item.prompt } : null);
  };
  const useStarterHeadlinePrompt = useCallback((prompt: string) => {
    if (sessionId) return;
    const nextPrompt = prompt.trim();
    if (!nextPrompt) return;
    setDraftPrompt(nextPrompt, null);
    starterPromptOptimizeRequestIdRef.current += 1;
    setStarterPromptOptimizeRequest({
      id: starterPromptOptimizeRequestIdRef.current,
      prompt: nextPrompt
    });
  }, [sessionId, setDraftPrompt]);
  const handleStarterPromptOptimizeRequestHandled = useCallback((requestId: number) => {
    setStarterPromptOptimizeRequest((current) => (
      current?.id === requestId ? null : current
    ));
  }, []);
  const openAssetModal = (image: WorkImage) => {
    addAsset.reset();
    setAssetTarget({ type: "image", item: image });
  };
  const pickCaseMaterials = (caseMaterials: CaseMaterialItem[]) => {
    setSelectedCaseMaterials(caseMaterials);
    setEditImage(null);
    setCasePickerOpen(false);
    setMaterialPickerOpen(false);
  };

  const submitDraft = () => {
    if (currentScopeBusy || !draftPrompt.trim()) return;
    const prompt = draftPrompt.trim();
    const selectedRequestSize = requestSizeFromSelection(size);
    const caseUsage = draftCaseUsage?.caseItemId ? draftCaseUsage : null;
    const latestAssistantImage = [...visibleBranchMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.imageUrl && message.imageId);
    const continuityImage = latestAssistantImage ? workImageFromMessage(latestAssistantImage) : null;
    const sourceImage = editImage;
    const selectedCaseReferences = selectedCaseMaterials.map(sourceReferenceFromCaseMaterial);
    const hasSelectedCaseMaterials = selectedCaseReferences.length > 0;
    const requestSourceImage = sourceImage ?? (hasSelectedCaseMaterials ? null : continuityImage);
    const useHiddenContinuityImage = !sourceImage && selectedAssets.length === 0 && !hasSelectedCaseMaterials && Boolean(continuityImage);
    const mode: SubmitRequest["mode"] = requestSourceImage || selectedAssets.length > 0 || hasSelectedCaseMaterials ? "edit" : "generation";
    const sourceAsset = selectedAssets[0];
    const sourceAssetIds = assetIdsForRequest(selectedAssets);
    const sourceInlineImages = inlineImagesForRequest(selectedAssets);
    const referenceAsset = persistableAssets(selectedAssets)[0] ?? null;
    const sourceReferenceImages = [...selectedCaseReferences, ...selectedAssets.map(sourceReferenceFromAsset)];
    const primaryMaterialReference = selectedCaseReferences[0] ?? (sourceAsset ? sourceReferenceFromAsset(sourceAsset) : null);
    const selectedCaseItemIds = selectedCaseMaterials.map((item) => item.caseItemId);
    const requestCaseItemId = caseUsage?.caseItemId ?? selectedCaseMaterials[0]?.caseItemId;
    const sourcePreview = sourceImage
      ? {
          imageId: sourceImage.id,
          imageUrl: sourceImage.url,
          imageOriginalUrl: sourceImage.originalUrl || sourceImage.url,
          imagePreviewUrl: sourceImage.previewUrl || sourceImage.url,
          imageThumbnailUrl: sourceImage.thumbnailUrl || sourceImage.previewUrl || sourceImage.url,
          imagePrompt: sourceImage.prompt,
          referenceImageUrl: sourceImage.url,
          referenceImageOriginalUrl: sourceImage.originalUrl || sourceImage.url,
          referenceImagePreviewUrl: sourceImage.previewUrl || sourceImage.url,
          referenceImageThumbnailUrl: sourceImage.thumbnailUrl || sourceImage.previewUrl || sourceImage.url,
          referenceImagePrompt: sourceImage.prompt,
          referenceImageKind: "image" as const,
          referenceImageWidth: sourceImage.imageWidth,
          referenceImageHeight: sourceImage.imageHeight,
          sourceReferenceImages,
          imageKind: sourceImage.kind,
          imageSize: sourceImage.size,
          imageQuality: sourceImage.quality,
          imageProviderId: sourceImage.providerId,
          parentImageId: sourceImage.parentImageId
        }
      : primaryMaterialReference
        ? {
            imageId: null,
            imageUrl: null,
            imagePrompt: null,
            referenceImageUrl: primaryMaterialReference.url,
            referenceImageOriginalUrl: primaryMaterialReference.originalUrl ?? primaryMaterialReference.url,
            referenceImagePreviewUrl: primaryMaterialReference.previewUrl ?? primaryMaterialReference.url,
            referenceImageThumbnailUrl: primaryMaterialReference.thumbnailUrl ?? primaryMaterialReference.previewUrl ?? primaryMaterialReference.url,
            referenceImagePrompt: primaryMaterialReference.name,
            referenceImageKind: "asset" as const,
            referenceImageWidth: primaryMaterialReference.imageWidth,
            referenceImageHeight: primaryMaterialReference.imageHeight,
            sourceReferenceImages,
            imageKind: null,
            imageSize: null,
            imageQuality: null,
            imageProviderId: null,
            parentImageId: null
          }
        : {
            imageId: null,
            imageUrl: null,
            imagePrompt: null,
            referenceImageUrl: null,
            referenceImageOriginalUrl: null,
            referenceImagePreviewUrl: null,
            referenceImageThumbnailUrl: null,
            referenceImagePrompt: null,
            referenceImageKind: null,
            referenceImageWidth: 0,
            referenceImageHeight: 0,
            sourceReferenceImages,
            imageKind: null,
            imageSize: null,
            imageQuality: null,
            imageProviderId: null,
            parentImageId: null
          };
    const clientRequestId = createSubmitRequestId();
    const pendingScope = currentSubmitScope;
    const branchFields = activeChatBranchId !== MAIN_CHAT_BRANCH_ID ? { branchId: activeChatBranchId } : {};
    addSubmittingScope(pendingScope);
    setPendingScope(pendingScope);
    setPendingChatSubmit({
      scope: pendingScope,
      mode,
      message: {
        id: `pending-${Date.now()}`,
        role: "user",
        content: prompt,
        metadata: {
          mode,
          pending: true,
          sourceImageIds: requestSourceImage ? [requestSourceImage.id] : [],
          sourceAssetIds,
          sourceCaseItemIds: selectedCaseItemIds,
          sourceReferenceIds: [],
          ...(selectedCaseReferences.length > 0 ? { sourceCaseReferences: selectedCaseReferences } : {}),
          ...(requestCaseItemId ? { caseItemId: requestCaseItemId } : {}),
          ...(referenceAsset ? { referenceAssetId: referenceAsset.id } : {}),
          ...(useHiddenContinuityImage ? { hideReference: true, autoReference: true } : {}),
          ...branchFields,
          n: imageCount
        },
        createdAt: new Date().toISOString(),
        ...sourcePreview
      }
    });
    setDraftPrompt("");
    setEditImage(null);
    setSelectedAssets([]);
    setSelectedCaseMaterials([]);
    setMaterialPickerOpen(false);
    setSize("");
    resetPromptInputOptimizeStyle();
    resetPromptColorScheme();
    submit.mutate({
      clientRequestId,
      pendingScope,
      mode,
      sessionId,
      providerId,
      prompt,
      language: resolvedLanguage,
      size: selectedRequestSize,
      ...(quality ? { quality } : {}),
      n: imageCount,
      ...(requestCaseItemId ? { caseItemId: requestCaseItemId } : {}),
      ...(requestSourceImage ? { sourceImageIds: [requestSourceImage.id] } : { sourceImageIds: [] }),
      sourceAssetIds,
      sourceCaseItemIds: selectedCaseItemIds,
      sourceReferenceIds: [],
      ...(sourceInlineImages.length > 0 ? { sourceInlineImages } : {}),
      ...(referenceAsset ? { referenceAssetId: referenceAsset.id } : {}),
      ...(useHiddenContinuityImage ? { hideReference: true } : {}),
      ...branchFields
    });
  };

  const serverMessages = messages.data?.messages ?? [];
  const serverRenderState = useMemo(() => buildChatRenderState(serverMessages, activeBranchId), [activeBranchId, serverMessages]);
  const selectedBranchId = activeBranchId ?? serverRenderState.activeBranchId;
  const { currentViewSubmitting, loadingTitle, messageList, visibleLoadingMode, visiblePendingUserMessage } = useChatViewState({
    currentScopeBusy,
    currentScopeSubmitting,
    currentSubmitScope,
    activeBranchId: selectedBranchId,
    pendingMode,
    pendingSubmitScope,
    pendingUserMessage,
    runningImageJobs,
    serverMessages
  });
  const pendingInCurrentScope = pendingSubmitScope === currentSubmitScope;
  const pendingHasServerEcho = Boolean(pendingUserMessage && serverMessages.some((message) => isServerEchoOfPending(message, pendingUserMessage)));
  useEffect(() => {
    if (!pendingHasServerEcho || !pendingSubmitScope) return;
    clearPendingForScopes([pendingSubmitScope]);
  }, [pendingHasServerEcho, pendingSubmitScope]);
  const branchCatalogMessages = useMemo(
    () => [...serverMessages, ...(pendingInCurrentScope && pendingUserMessage && !pendingHasServerEcho ? [pendingUserMessage] : [])],
    [pendingHasServerEcho, pendingInCurrentScope, pendingUserMessage, serverMessages]
  );
  const renderState = useMemo(() => buildChatRenderState(branchCatalogMessages, selectedBranchId), [branchCatalogMessages, selectedBranchId]);
  const renderItems = renderState.items;
  const activeChatBranchId = renderState.activeBranchId;
  const visibleBranchMessages = renderState.visibleMessages;
  const latestVisibleFailedJob = useMemo(() => {
    const visibleJobs = imageJobs.filter((job) => (job.branchId?.trim() || MAIN_CHAT_BRANCH_ID) === activeChatBranchId);
    for (let index = visibleJobs.length - 1; index >= 0; index -= 1) {
      const job = visibleJobs[index];
      if (job.status === "running") continue;
      return job.status === "failed" && job.error?.trim() ? job : null;
    }
    return null;
  }, [activeChatBranchId, imageJobs]);
  const { closeImageEditor, imageEditor, openImageEditor } = useImageEditorLauncher({
    editorImageRequest,
    messageList: visibleBranchMessages,
    setEditorImageRequest,
    setMaterialPickerOpen,
    setSelectedAssets,
    setSidebarCollapsed
  });
  const latestEditSuggestionImage = useMemo(() => {
    if (currentScopeBusy || imageEditor) return null;
    const latestAssistantImage = [...visibleBranchMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.imageUrl && message.imageId);
    return latestAssistantImage ? workImageFromMessage(latestAssistantImage) : null;
  }, [currentScopeBusy, imageEditor, visibleBranchMessages]);
  const latestCompletedImageJobImageId = useMemo(() => {
    if (currentScopeBusy || imageEditor) return "";
    for (let index = imageJobs.length - 1; index >= 0; index -= 1) {
      const job = imageJobs[index];
      if ((job.branchId?.trim() || MAIN_CHAT_BRANCH_ID) !== activeChatBranchId) continue;
      if (job.status === "succeeded" && job.resultImageId?.trim()) return job.resultImageId.trim();
    }
    return "";
  }, [activeChatBranchId, currentScopeBusy, imageEditor, imageJobs]);
  const editSuggestionImageId = latestEditSuggestionImage?.id ?? latestCompletedImageJobImageId;
  const editSuggestionsQuery = useQuery({
    queryKey: ["image-edit-suggestions", editSuggestionImageId, editSuggestionTone, editSuggestionsEnabled, resolvedLanguage],
    queryFn: () => api.imageEditSuggestions(editSuggestionImageId, resolvedLanguage),
    enabled: Boolean(editSuggestionsEnabled && editSuggestionImageId && !currentScopeBusy && !imageEditor),
    staleTime: 5 * 60 * 1000
  });
  const composerEditSuggestions = useMemo(() => {
    if (!editSuggestionsEnabled || !latestEditSuggestionImage || currentScopeBusy || imageEditor) return [];
    const suggestions = editSuggestionsQuery.data?.suggestions?.slice(0, 3) ?? [];
    if (suggestions.length > 0) return suggestions;
    return editSuggestionsQuery.isError ? fallbackImageEditSuggestionsForImage(latestEditSuggestionImage, resolvedLanguage) : [];
  }, [currentScopeBusy, editSuggestionsEnabled, editSuggestionsQuery.data?.suggestions, editSuggestionsQuery.isError, imageEditor, latestEditSuggestionImage, resolvedLanguage]);
  const composerEditSuggestionsLoading = Boolean(
    editSuggestionsEnabled
      && editSuggestionImageId
      && !currentScopeBusy
      && !imageEditor
      && !editSuggestionsQuery.isError
      && (editSuggestionsQuery.isLoading || !latestEditSuggestionImage)
  );
  const showComposerEditSuggestions = composerEditSuggestionsLoading || composerEditSuggestions.length > 0;
  const applyEditSuggestion = useCallback((suggestion: ImageEditSuggestion) => {
    if (!latestEditSuggestionImage || currentScopeBusy) return;
    setEditImage(null);
    setDraftPrompt(suggestion.prompt, null);
    setSelectedAssets([]);
    setSelectedCaseMaterials([]);
    setMaterialPickerOpen(false);
    setCasePickerOpen(false);
    resetPromptInputOptimizeStyle();
    resetPromptColorScheme();
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [
    currentScopeBusy,
    latestEditSuggestionImage,
    resetPromptColorScheme,
    resetPromptInputOptimizeStyle,
    setDraftPrompt,
    setEditImage,
    setMaterialPickerOpen,
    setSelectedAssets,
    setSelectedCaseMaterials
  ]);
  const previousSessionKeyRef = useRef(sessionId ?? "");
  useEffect(() => {
    const sessionKey = sessionId ?? "";
    const sessionChanged = previousSessionKeyRef.current !== sessionKey;
    previousSessionKeyRef.current = sessionKey;
    setActiveBranchId(null);
    setStarterPromptOptimizeRequest(null);
    setError("");
    if (sessionChanged && imageEditor) closeImageEditor({ restoreSidebar: false });
  }, [closeImageEditor, imageEditor, sessionId]);
  useEffect(() => {
    const storedDraft = useWorkbench.getState().composerDrafts[composerScopeKey];
    const draftSelectedAssets = persistableAssets(selectedAssets);
    const handoffDraftFields = {
      draftPrompt,
      draftCaseUsage,
      selectedCaseMaterials,
      selectedAssets: draftSelectedAssets,
      imageCount,
      size,
      quality,
      promptInputOptimizeStyle: currentPromptInputOptimizeStyle,
      promptColorSchemeIds: currentPromptColorSchemeIds,
      promptColorSchemeId: currentPromptColorSchemeIds[0] ?? "",
      promptColorSchemeInjection: currentPromptColorSchemeInjection
    };
    const shouldUseHandoffDraft = !storedDraft
      && !hasRestoredComposerScopeRef.current
      && !sessionId
      && hasComposerDraftContent(handoffDraftFields);
    const nextDraft = storedDraft ?? (shouldUseHandoffDraft
      ? { ...emptyComposerSessionDraft(), ...handoffDraftFields }
      : emptyComposerSessionDraft());

    if (shouldUseHandoffDraft) upsertComposerDraft(composerScopeKey, handoffDraftFields);
    hasRestoredComposerScopeRef.current = true;
    restoringComposerDraftScopeRef.current = composerScopeKey;

    setDraftPrompt(nextDraft.draftPrompt, nextDraft.draftCaseUsage);
    setSelectedCaseMaterials(nextDraft.selectedCaseMaterials);
    setSelectedAssets(persistableAssets(nextDraft.selectedAssets));
    setImageCount(nextDraft.imageCount);
    setSize(nextDraft.size);
    setQuality(nextDraft.quality);
    setMaterialPickerOpen(false);
    setCasePickerOpen(false);
    setError("");
    if (!sessionId) {
      setPendingScope(null);
      if (imageEditor) closeImageEditor();
    }

    const restoreTimer = window.setTimeout(() => {
      if (restoringComposerDraftScopeRef.current === composerScopeKey) {
        restoringComposerDraftScopeRef.current = null;
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [composerInstanceKey]);

  useEffect(() => {
    if (restoringComposerDraftScopeRef.current === composerScopeKey) return;
    upsertComposerDraft(composerScopeKey, {
      draftPrompt,
      draftCaseUsage,
      selectedCaseMaterials,
      selectedAssets: persistableAssets(selectedAssets),
      imageCount,
      size,
      quality,
      promptInputOptimizeStyle: currentPromptInputOptimizeStyle,
      promptColorSchemeIds: currentPromptColorSchemeIds,
      promptColorSchemeId: currentPromptColorSchemeIds[0] ?? "",
      promptColorSchemeInjection: currentPromptColorSchemeInjection
    });
  }, [
    composerScopeKey,
    currentPromptColorSchemeIdsKey,
    currentPromptColorSchemeInjection,
    currentPromptInputOptimizeStyle,
    draftCaseUsage,
    draftPrompt,
    imageCount,
    quality,
    selectedAssets,
    selectedCaseMaterials,
    size,
    upsertComposerDraft
  ]);

  useEffect(() => {
    if (sessionId || !newChatPromptOptimizeRequest) return;
    setStarterPromptOptimizeRequest(newChatPromptOptimizeRequest);
    clearNewChatPromptOptimizeRequest(newChatPromptOptimizeRequest.id);
  }, [clearNewChatPromptOptimizeRequest, newChatPromptOptimizeRequest, sessionId]);

  const sendEditRequest = (
    image: WorkImage,
    prompt: string,
    maskDataUrl?: string,
    requestSize?: string,
    sourceAssetIds: string[] = [],
    sourceCaseItemIds: string[] = []
  ) => {
    const trimmedPrompt = prompt.trim();
    if (currentScopeBusy || !trimmedPrompt) return;
    const effectiveSize = requestSize ?? size;
    const selectedRequestSize = requestSizeFromSelection(effectiveSize);
    const sourceAssetIdSet = new Set(sourceAssetIds);
    const sourceCaseItemIdSet = new Set(sourceCaseItemIds);
    const selectedCaseReferences = selectedCaseMaterials.filter((item) => sourceCaseItemIdSet.has(item.caseItemId)).map(sourceReferenceFromCaseMaterial);
    const sourceReferenceImages = [
      ...selectedCaseReferences,
      ...selectedAssets.filter((asset) => sourceAssetIdSet.has(asset.id)).map(sourceReferenceFromAsset)
    ];
    const clientRequestId = createSubmitRequestId();
    const pendingScope = currentSubmitScope;
    const branchFields = activeChatBranchId !== MAIN_CHAT_BRANCH_ID ? { branchId: activeChatBranchId } : {};
    addSubmittingScope(pendingScope);
    setPendingScope(pendingScope);
    setPendingChatSubmit({
      scope: pendingScope,
      mode: "edit",
      message: {
        id: `pending-${Date.now()}`,
        role: "user",
        content: trimmedPrompt,
        metadata: {
          mode: "edit",
          pending: true,
          sourceImageIds: [image.id],
          sourceAssetIds,
          sourceCaseItemIds,
          ...(selectedCaseReferences.length > 0 ? { sourceCaseReferences: selectedCaseReferences } : {}),
          hasMask: Boolean(maskDataUrl),
          size: selectedRequestSize,
          ...branchFields,
          n: imageCount
        },
        createdAt: new Date().toISOString(),
        imageId: image.id,
        imageUrl: image.url,
        imageOriginalUrl: image.originalUrl || image.url,
        imagePreviewUrl: image.previewUrl || image.url,
        imageThumbnailUrl: image.thumbnailUrl || image.previewUrl || image.url,
        imagePrompt: image.prompt,
        referenceImageUrl: image.url,
        referenceImageOriginalUrl: image.originalUrl || image.url,
        referenceImagePreviewUrl: image.previewUrl || image.url,
        referenceImageThumbnailUrl: image.thumbnailUrl || image.previewUrl || image.url,
        referenceImagePrompt: image.prompt,
        referenceImageKind: "image",
        referenceImageWidth: image.imageWidth,
        referenceImageHeight: image.imageHeight,
        sourceReferenceImages,
        imageKind: image.kind,
        imageSize: image.size,
        imageQuality: image.quality,
        imageProviderId: image.providerId,
        parentImageId: image.parentImageId
      }
    });
    closeImageEditor();
    setDraftPrompt("");
    setEditImage(null);
    setSelectedAssets([]);
    setSelectedCaseMaterials([]);
    setMaterialPickerOpen(false);
    setSize("");
    resetPromptInputOptimizeStyle();
    resetPromptColorScheme();
    submit.mutate({
      clientRequestId,
      pendingScope,
      mode: "edit",
      sessionId,
      providerId,
      prompt: trimmedPrompt,
      language: resolvedLanguage,
      size: selectedRequestSize,
      ...(quality ? { quality } : {}),
      n: imageCount,
      sourceImageIds: [image.id],
      sourceAssetIds,
      sourceCaseItemIds,
      ...(maskDataUrl ? { maskDataUrl } : {}),
      ...branchFields
    });
  };
  const sendAspectRatioEdit = (image: WorkImage, option: SizeOption) => {
    sendEditRequest(image, `将宽高比设为 ${option.ratio}`, undefined, option.value);
  };
  const submitMessageEdit = (payload: {
    rootId: string;
    branchId: string;
    branchForkMessageId: string;
    userMessage: Message;
    assistantMessage: Message | null;
    prompt: string;
  }) => {
    const trimmedPrompt = payload.prompt.trim();
    if (currentScopeBusy || !trimmedPrompt) return;
    const sourceSnapshot = sourceSnapshotFromMessage(payload.userMessage);
    const mode: SubmitRequest["mode"] =
      sourceSnapshot.sourceImageIds.length > 0 ||
      sourceSnapshot.sourceAssetIds.length > 0 ||
      sourceSnapshot.sourceCaseItemIds.length > 0 ||
      sourceSnapshot.sourceReferenceIds.length > 0
        ? "edit"
        : "generation";
    const selectedRequestSize = requestSizeFromSelection(size);
    const hideReference = sourceSnapshot.hideReference && sourceSnapshot.references.length === 0;
    const primaryReference = sourceSnapshot.primaryImageReference;
    const firstMaterialReference = sourceSnapshot.materialReferences[0] ?? null;
    const referenceFields = primaryReference
      ? {
          imageId: sourceSnapshot.sourceImageIds[0] ?? null,
          imageUrl: primaryReference.url,
          imageOriginalUrl: primaryReference.originalUrl ?? primaryReference.url,
          imagePreviewUrl: primaryReference.previewUrl ?? primaryReference.url,
          imageThumbnailUrl: primaryReference.thumbnailUrl ?? primaryReference.previewUrl ?? primaryReference.url,
          imagePrompt: primaryReference.name,
          referenceImageUrl: primaryReference.url,
          referenceImageOriginalUrl: primaryReference.originalUrl ?? primaryReference.url,
          referenceImagePreviewUrl: primaryReference.previewUrl ?? primaryReference.url,
          referenceImageThumbnailUrl: primaryReference.thumbnailUrl ?? primaryReference.previewUrl ?? primaryReference.url,
          referenceImagePrompt: primaryReference.name,
          referenceImageKind: "image" as const,
          referenceImageWidth: primaryReference.imageWidth,
          referenceImageHeight: primaryReference.imageHeight,
          sourceReferenceImages: sourceSnapshot.materialReferences,
          imageKind: payload.userMessage.imageKind,
          imageSize: payload.userMessage.imageSize,
          imageQuality: payload.userMessage.imageQuality,
          imageProviderId: payload.userMessage.imageProviderId,
          parentImageId: payload.userMessage.parentImageId
        }
      : firstMaterialReference
        ? {
            imageId: null,
            imageUrl: null,
            imageOriginalUrl: null,
            imagePreviewUrl: null,
            imageThumbnailUrl: null,
            imagePrompt: null,
            referenceImageUrl: firstMaterialReference.url,
            referenceImageOriginalUrl: firstMaterialReference.originalUrl ?? firstMaterialReference.url,
            referenceImagePreviewUrl: firstMaterialReference.previewUrl ?? firstMaterialReference.url,
            referenceImageThumbnailUrl: firstMaterialReference.thumbnailUrl ?? firstMaterialReference.previewUrl ?? firstMaterialReference.url,
            referenceImagePrompt: firstMaterialReference.name,
            referenceImageKind: "asset" as const,
            referenceImageWidth: firstMaterialReference.imageWidth,
            referenceImageHeight: firstMaterialReference.imageHeight,
            sourceReferenceImages: sourceSnapshot.materialReferences,
            imageKind: null,
            imageSize: null,
            imageQuality: null,
            imageProviderId: null,
            parentImageId: null
          }
        : {
            imageId: null,
            imageUrl: null,
            imageOriginalUrl: null,
            imagePreviewUrl: null,
            imageThumbnailUrl: null,
            imagePrompt: null,
            referenceImageUrl: null,
            referenceImageOriginalUrl: null,
            referenceImagePreviewUrl: null,
            referenceImageThumbnailUrl: null,
            referenceImagePrompt: null,
            referenceImageKind: null,
            referenceImageWidth: 0,
            referenceImageHeight: 0,
            sourceReferenceImages: [],
            imageKind: null,
            imageSize: null,
            imageQuality: null,
            imageProviderId: null,
            parentImageId: null
          };
    const clientRequestId = createSubmitRequestId();
    const pendingScope = currentSubmitScope;
    const branchId = createChatBranchId();
    const branchFields = {
      branchId,
      parentBranchId: payload.branchId || MAIN_CHAT_BRANCH_ID,
      branchForkMessageId: payload.branchForkMessageId || payload.rootId,
      branchRootMessageId: payload.rootId
    };
    addSubmittingScope(pendingScope);
    setActiveBranchId(branchId);
    setPendingScope(pendingScope);
    setPendingChatSubmit({
      scope: pendingScope,
      mode,
      message: {
        id: `pending-${Date.now()}`,
        role: "user",
        content: trimmedPrompt,
        metadata: {
          mode,
          pending: true,
          revisionRootId: payload.rootId,
          editedMessageId: payload.userMessage.id,
          ...branchFields,
          ...(hideReference ? { hideReference: true, autoReference: true } : {}),
          sourceImageIds: sourceSnapshot.sourceImageIds,
          sourceAssetIds: sourceSnapshot.sourceAssetIds,
          sourceCaseItemIds: sourceSnapshot.sourceCaseItemIds,
          sourceReferenceIds: sourceSnapshot.sourceReferenceIds,
          ...(sourceSnapshot.caseReferences.length > 0 ? { sourceCaseReferences: sourceSnapshot.caseReferences } : {}),
          ...(sourceSnapshot.referenceAssetId ? { referenceAssetId: sourceSnapshot.referenceAssetId } : {}),
          n: imageCount
        },
        createdAt: new Date().toISOString(),
        ...referenceFields
      }
    });
    setSize("");
    submit.mutate({
      clientRequestId,
      pendingScope,
      mode,
      sessionId,
      providerId,
      prompt: trimmedPrompt,
      language: resolvedLanguage,
      size: selectedRequestSize,
      ...(quality ? { quality } : {}),
      n: imageCount,
      sourceImageIds: sourceSnapshot.sourceImageIds,
      sourceAssetIds: sourceSnapshot.sourceAssetIds,
      sourceCaseItemIds: sourceSnapshot.sourceCaseItemIds,
      sourceReferenceIds: sourceSnapshot.sourceReferenceIds,
      ...(hideReference ? { hideReference: true } : {}),
      ...(sourceSnapshot.referenceAssetId ? { referenceAssetId: sourceSnapshot.referenceAssetId } : {}),
      revisionRootId: payload.rootId,
      editedMessageId: payload.userMessage.id,
      ...branchFields
    });
  };
  const composerPreviews = [
    ...(editImage
      ? [
          {
            id: `edit-${editImage.id}`,
            url: editImage.thumbnailUrl || editImage.previewUrl || editImage.url,
            previewUrl: editImage.previewUrl || editImage.originalUrl || editImage.url,
            name: t("chat.editor.pendingImage"),
            title: editImage.prompt,
            onRemove: () => setEditImage(null)
          }
        ]
      : []),
    ...selectedCaseMaterials.map((caseMaterial) => ({
      id: `case-${caseMaterial.caseItemId}`,
      url: caseMaterial.thumbnailUrl ?? caseMaterial.previewUrl ?? caseMaterial.url,
      previewUrl: caseMaterial.previewUrl ?? caseMaterial.originalUrl ?? caseMaterial.url,
      name: t("chat.editor.inspirationMaterial"),
      title: caseMaterial.title,
      onRemove: () => setSelectedCaseMaterials(selectedCaseMaterials.filter((item) => item.caseItemId !== caseMaterial.caseItemId))
    })),
    ...selectedAssets.map((asset) => ({
      id: asset.id,
      url: asset.thumbnailUrl ?? asset.previewUrl ?? asset.url,
      previewUrl: asset.previewUrl ?? asset.originalUrl ?? asset.url,
      name: asset.name,
      title: asset.name,
      onRemove: () => setSelectedAssets(selectedAssets.filter((item) => item.id !== asset.id))
    }))
  ];

  useComposerTextareaAutosize({
    draftPrompt,
    previewCount: composerPreviews.length,
    textareaRef
  });

  const showStarter = !sessionId && messageList.length === 0;
  const composerPlaceholder = sessionId || messageList.length > 0 || composerPreviews.length > 0
    ? t("chat.placeholder.continue")
    : t("chat.placeholder.new");
  const branchSwitchOptions = useMemo(() => {
    const switchItem = renderItems.find((item) => item.type === "thread");
    if (
      !switchItem ||
      switchItem.type !== "thread" ||
      switchItem.branchId !== MAIN_CHAT_BRANCH_ID ||
      switchItem.activeVersionIndex === undefined ||
      switchItem.versions.length <= 1
    ) {
      return [];
    }
    return switchItem.versions.map((revision, index) => {
      const titleSeed = revision.user.content.replace(/\s+/g, " ").trim();
      return {
        id: revision.branchId || MAIN_CHAT_BRANCH_ID,
        label: String(index + 1),
        active: index === switchItem.activeVersionIndex,
        title: titleSeed ? titleSeed.slice(0, 48) : t("chat.branchTitle", { index: index + 1 })
      };
    });
  }, [renderItems]);
  const { jumpToLoadingOrScrollEdge, loadingMessageRef, messageEndRef, scrollJump } = useChatScrollJump({
    composerPreviewCount: composerPreviews.length,
    imageEditorOpen: Boolean(imageEditor),
    loadingTitle,
    messageListLength: messageList.length,
    renderItemCount: renderItems.length,
    sessionId,
    showStarter,
    visiblePendingMessageId: visiblePendingUserMessage?.id
  });
  const handleRunningImageJobsSettled = useCallback(() => {
    if (sessionId) clearSessionGenerationStatus(sessionId);
  }, [clearSessionGenerationStatus, sessionId]);

  useRunningImageJobRefresh({
    onRunningJobsSettled: handleRunningImageJobsSettled,
    queryClient,
    runningJobCount: runningImageJobs.length,
    sessionId
  });
  const showMessageSkeleton = Boolean(
    sessionId &&
    messages.isLoading &&
    renderItems.length === 0 &&
    !visibleLoadingMode &&
    !latestVisibleFailedJob &&
    !showStarter
  );

  return (
    <section
      className={cx(
        "chat-page",
        !showStarter && "has-conversation",
        composerPreviews.length > 0 && "has-composer-preview",
        showComposerEditSuggestions && "has-edit-suggestions",
        branchSwitchOptions.length > 1 && "has-branch-switch"
      )}
    >
      {branchSwitchOptions.length > 1 ? (
        <div className="chat-branch-switch" aria-label={t("chat.branchSwitch")}>
          {branchSwitchOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={cx(option.active && "active")}
              onClick={() => setActiveBranchId(option.id)}
              aria-label={t("chat.switchBranch", { label: option.label })}
              aria-pressed={option.active}
              title={option.title}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className={cx("message-area", showStarter && "message-area-empty")}>
        {showStarter ? (
          <PromptStarter
            caseCategories={cases.data?.categories ?? []}
            caseCategoriesLoaded={cases.isSuccess}
            user={user}
            onOpenIntro={() => setChatIntroOpen(true)}
            onUseHeadlinePrompt={useStarterHeadlinePrompt}
            onPickPrompt={pickCasePrompt}
          />
        ) : null}
        {showMessageSkeleton ? <ChatMessageSkeleton /> : null}
        {renderItems.map((item, index) =>
          item.type === "thread" ? (
            <div key={`${item.branchId}:${item.rootId}`} className="message-enter-thread" style={messageRevealStyle(index)}>
              <ChatMessageThread
                rootId={item.rootId}
                versions={item.versions}
                activeVersionIndex={item.activeVersionIndex}
                isSubmitting={currentViewSubmitting}
                onOpenEditor={openImageEditor}
                onAddAsset={openAssetModal}
                failedJobIds={failedJobIds}
                retryingJobId={retryingJobId}
                onRetryJob={(jobId) => {
                  triggerRetryImageJob(jobId);
                }}
                onSelectVersion={
                  item.activeVersionIndex === undefined
                    ? undefined
                    : (revision) => setActiveBranchId(revision.branchId || MAIN_CHAT_BRANCH_ID)
                }
                onSubmitEdit={(payload) =>
                  submitMessageEdit({
                    ...payload,
                    branchId: item.branchId,
                    branchForkMessageId: item.rootId
                  })
                }
              />
            </div>
          ) : (
            <div key={item.message.id} className="message-enter-row" style={messageRevealStyle(index)}>
              <ChatMessage message={item.message} onOpenEditor={openImageEditor} onAddAsset={openAssetModal} />
            </div>
          )
        )}
        {visibleLoadingMode ? (
          <div ref={loadingMessageRef} className="message-enter-row loading-message-anchor" style={messageRevealStyle(renderItems.length)}>
            <RenderingMessage mode={visibleLoadingMode} />
          </div>
        ) : latestVisibleFailedJob ? (
          <div className="message-enter-row" style={messageRevealStyle(renderItems.length)}>
            <RenderingErrorMessage
              mode={latestVisibleFailedJob.type}
              message={latestVisibleFailedJob.error ?? t("chat.failedJob")}
              canRetry={true}
              retrying={retryImageJob.isPending}
              onRetry={() => {
                triggerRetryImageJob(latestVisibleFailedJob.id);
              }}
            />
          </div>
        ) : null}
        <div ref={messageEndRef} className="message-scroll-anchor" aria-hidden="true" />
      </div>
      {imageEditor ? (
        <ImageEditWorkspace
          images={imageEditor.images}
          activeImageId={imageEditor.activeImageId}
          sizeOptions={sizeOptions}
          selectedSize=""
          isSubmitting={currentViewSubmitting}
          assets={assets.data}
          materialPickerOpen={materialPickerOpen}
          onOpenCasePicker={() => {
            setMaterialPickerOpen(false);
            setCasePickerOpen(true);
          }}
          onClose={closeImageEditor}
          onPickSize={sendAspectRatioEdit}
          onToggleMaterialPicker={() => setMaterialPickerOpen(!materialPickerOpen)}
          onSubmitEdit={({ image, prompt, maskDataUrl, sourceAssetIds, sourceCaseItemIds }) =>
            sendEditRequest(
              image,
              prompt,
              maskDataUrl,
              "",
              sourceAssetIds ?? assetIdsForRequest(selectedAssets),
              sourceCaseItemIds ?? selectedCaseMaterials.map((item) => item.caseItemId)
            )
          }
        />
      ) : null}
      <ScrollJumpButton
        scrollJump={scrollJump}
        loading={Boolean(visibleLoadingMode)}
        onClick={jumpToLoadingOrScrollEdge}
        hidden={materialPickerOpen}
      />
      {assetTarget ? (
        <AddAssetFromImageModal
          image={assetTarget.item}
          categories={assetCategoryList}
          pending={addAsset.isPending}
          error={addAsset.error instanceof Error ? addAsset.error : null}
          onClose={() => setAssetTarget(null)}
          onAdd={(payload) => addAsset.mutate({ source: assetTarget, ...payload })}
        />
      ) : null}
      <CaseMaterialPickerModal
        open={casePickerOpen}
        selectedCaseMaterials={selectedCaseMaterials}
        onClose={() => setCasePickerOpen(false)}
        onConfirm={pickCaseMaterials}
      />
      <ChatComposer
        key={composerInstanceKey}
        autoOptimizePromptRequest={sessionId ? null : starterPromptOptimizeRequest}
        assets={assets.data}
        busy={currentScopeBusy}
        composerInstanceKey={composerInstanceKey}
        draftPrompt={draftPrompt}
        draftCaseUsage={draftCaseUsage}
        editSuggestions={composerEditSuggestions}
        editSuggestionsLoading={composerEditSuggestionsLoading}
        error={latestVisibleFailedJob ? "" : error}
        materialPickerOpen={materialPickerOpen && !imageEditor}
        placeholder={composerPlaceholder}
        previews={composerPreviews}
        imageCount={imageCount}
        promptColorSchemes={promptColorSchemeList}
        promptColorSchemeIds={currentPromptColorSchemeIds}
        promptColorSchemeInjection={currentPromptColorSchemeInjection}
        promptInputOptimizeStyle={currentPromptInputOptimizeStyle}
        promptOptimizeCustomInstruction={promptOptimizeCustomInstruction}
        promptOptimizeStyleGroups={promptOptimizeStyleGroups}
        promptTemplateDraft={currentPromptTemplateDraft}
        quality={quality}
        qualityOptions={qualityOptions}
        selectedAssets={selectedAssets}
        selectedCaseMaterials={selectedCaseMaterials}
        size={size}
        sizeOptions={sizeOptions}
        textareaRef={textareaRef}
        onApplyEditSuggestion={applyEditSuggestion}
        onAutoOptimizePromptRequestHandled={handleStarterPromptOptimizeRequestHandled}
        onDraftPromptChange={setDraftPrompt}
        onImageCountChange={setImageCount}
        onPaste={handleComposerPaste}
        onQualityChange={setQuality}
        onSelectedAssetsChange={setSelectedAssets}
        onSelectedCaseMaterialsChange={setSelectedCaseMaterials}
        onSizeChange={setSize}
        onSubmit={submitDraft}
        onToggleAsset={toggleAsset}
        onOpenCasePicker={() => {
          setMaterialPickerOpen(false);
          setCasePickerOpen(true);
        }}
        onPromptColorSchemeChange={handlePromptColorSchemeChange}
        onPromptInputOptimizeStyleChange={handlePromptInputOptimizeStyleChange}
        onPromptOptimizeCustomInstructionChange={schedulePromptOptimizeCustomInstructionSave}
        onPromptTemplateDraftChange={handlePromptTemplateDraftChange}
        onToggleMaterialPicker={() => setMaterialPickerOpen(!materialPickerOpen)}
      />
      <FeatureIntroModal
        open={showStarter && (!appIntroGuide.seen || chatIntroOpen)}
        welcomeText={t("chat.introWelcome", { name: guideDisplayName, greeting: guideGreeting })}
        finishLabel={t("common.startUsing")}
        slides={appIntroSlides}
        onClose={() => {
          appIntroGuide.markSeen();
          setChatIntroOpen(false);
        }}
      />
    </section>
  );
}
