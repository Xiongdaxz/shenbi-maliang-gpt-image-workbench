import type { AppearanceMode } from "./lib/appearance";
import type { LanguagePreference } from "./i18n";
import type { PromptOptimizeStyleGroup, PromptTemplateOptimizeStyle } from "./lib/promptOptimizeStyles";

export type EditSuggestionTone = "default" | "practical" | "creative" | "detail";

export type UserPreferences = {
  language: LanguagePreference;
  editSuggestionsEnabled: boolean;
  editSuggestionTone: EditSuggestionTone;
  autoUploadPastedAssets: boolean;
  promptOptimizeStyleGroups: PromptOptimizeStyleGroup[];
  promptOptimizeCustomInstruction: string;
};

export type User = {
  id: string;
  account: string;
  username: string;
  email: string;
  phone: string;
  teamId: string;
  teamName?: string;
  avatarUrl?: string;
  appearanceMode: AppearanceMode;
  preferences: UserPreferences;
  hasConfigAccess: boolean;
};

export type Team = {
  id: string;
  name: string;
  description: string;
  userCount: number;
  imageCount: number;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LoginTheme = "light" | "dark";

export type LoginAssets = {
  backgrounds: Record<LoginTheme, string[]>;
  titles: Record<LoginTheme, string>;
  titleFallbacks: string[];
};

export type BrandingAssetType =
  | "logo"
  | "favicon"
  | "login_title"
  | "login_background_light"
  | "login_background_dark";

export type BrandingAssetSource = "builtin" | "uploaded";

export type BrandingAsset = {
  id: string;
  type: BrandingAssetType;
  source: BrandingAssetSource;
  name: string;
  url: string;
  previewUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  size: number;
  imageWidth: number;
  imageHeight: number;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type BrandingSettings = {
  siteName: string;
  activeLogoAssetId: string;
  activeFaviconAssetId: string;
  activeLoginTitleLightAssetId: string;
  activeLoginTitleDarkAssetId: string;
  loginBackgroundLightAssetIds: string[];
  loginBackgroundDarkAssetIds: string[];
  updatedAt: string;
};

export type BrandingDefaults = Omit<BrandingSettings, "siteName" | "updatedAt">;

export type PublicBranding = {
  siteName: string;
  logoUrl: string;
  faviconUrl: string;
  loginAssets: LoginAssets;
};

export type ProviderConfig = {
  id: string;
  name: string;
  type: string;
  channel: "cpa" | "chatgpt_web" | "api";
  enabled: boolean;
  virtual?: boolean;
  baseUrl: string;
  apiKeyEnv: string;
  apiKeyValue: string;
  routeMode: "images_api" | "responses" | "auto";
  generationPath: string;
  editPath: string;
  responsesPath: string;
  model: string;
  responsesModel: string;
  sizes: string[];
  qualities: string[];
  defaultSize: string;
  defaultQuality: string;
  responseImagePath: string;
  proxyEnabled: boolean;
  quotaMode: "codex_first" | "official_first" | "codex_only" | "official_only";
  webAccountId: string;
  webAccountIds: string[];
  webAccountMode: "priority" | "round_robin" | "random";
  webCookies: string;
};

export type PromptOptimizerProvider = {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  endpointPath: string;
  apiKeyEnv: string;
  apiKeyValue: string;
  model: string;
  availableModels: string[];
  availabilityStatus: "unknown" | "normal" | "abnormal";
  availabilityError: string;
  availabilityCheckedAt: string;
  streamEnabled: boolean;
  thinkingEnabled: boolean;
  temperature: number | null;
  maxTokens: number;
  retryCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SafetyReviewFailurePolicy = "allow" | "block";

export type SafetyReviewSettings = {
  enabled: boolean;
  failurePolicy: SafetyReviewFailurePolicy;
  blockMessage: string;
  updatedAt: string;
};

export type SafetyReviewLog = {
  id: string;
  userId: string;
  username: string;
  account: string;
  sessionId: string;
  jobId: string;
  scene: "image_generation" | "image_edit" | string;
  promptExcerpt: string;
  decision: "allow" | "review" | "block" | "";
  riskLevel: "none" | "low" | "medium" | "high" | "";
  categories: string[];
  confidence: number | null;
  reason: string;
  matchedText: string[];
  suggestedAction: "continue" | "manual_review" | "reject" | "";
  action: string;
  providerId: string;
  providerName: string;
  durationMs: number;
  error: string;
  createdAt: string;
};

export type GlobalSwitchType =
  | "self_registration"
  | "asset_review"
  | "case_review"
  | "starter_copy_generation"
  | "prompt_safety_review"
  | "smtp_service"
  | "sms_service"
  | "proxy_service"
  | "cpa_sync"
  | "debug_image_edit_mask";

export type GlobalSwitchSetting = {
  type: GlobalSwitchType;
  enabled: boolean;
  updatedAt: string;
};

export type StarterCopySettings = {
  enabled: boolean;
  copyCount: number;
  updatedAt: string;
};

export type StarterDailyCopy = {
  date: string;
  copies: string[];
  copiesZh?: string[];
  copiesEn?: string[];
  locale?: "zh" | "en";
  source: string;
  generatedAt: string;
  providerName?: string;
  model?: string;
  status?: string;
  error?: string;
  updatedAt?: string;
};

export type RegistrationSettings = {
  enabled: boolean;
  updatedAt: string;
};

export type SmtpSettings = {
  enabled: boolean;
  useProxy: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordSecret: string;
  fromName: string;
  fromEmail: string;
  testRecipientEmail: string;
  updatedAt: string;
};

export type SmsSettings = {
  enabled: boolean;
  provider: "tencent";
  secretId: string;
  secretKeySecret: string;
  region: string;
  smsSdkAppId: string;
  signName: string;
  registerTemplateId: string;
  passwordResetTemplateId: string;
  templateParamOrder: string;
  testPhone: string;
  updatedAt: string;
};

export type BackupSettings = {
  enabled: boolean;
  runTime: string;
  retentionDays: number;
  backupDir: string;
  resolvedBackupDir: string;
  updatedAt: string;
};

export type BackupRun = {
  id: string;
  source: "manual" | "scheduled";
  status: "running" | "succeeded" | "failed" | "deleted";
  backupDir: string;
  resolvedBackupDir: string;
  fileName: string;
  fileSize: number;
  fileCount: number;
  durationMs: number;
  error: string;
  startedAt: string;
  finishedAt: string;
  deletedAt: string;
};

export type ProxyConfig = {
  enabled: boolean;
  url: string;
  retryCount: number;
  applyChatgptWeb: boolean;
  applyCpa: boolean;
  applyApi: boolean;
  updatedAt: string;
};

export type ImageGenerationMode = {
  mode: "auto" | "cpa" | "chatgpt_web" | "api";
  resultRetryCount: number | null;
  updatedAt: string;
};

export type DebugSettings = {
  imageEditMask: boolean;
  updatedAt: string;
};

export type ImageAccount = {
  id: string;
  name: string;
  remoteName: string;
  channelId: string;
  email: string;
  accountType: string;
  status: "normal" | "limited" | "abnormal" | "disabled";
  quota: number;
  usedQuota: number;
  remainingQuota: number;
  usageSuccessCount: number;
  usageFailureCount: number;
  usageRecentRequests: Array<{
    bucket?: string;
    label?: string;
    success?: number;
    failure?: number;
    total?: number;
  }>;
  localSuccessCount: number;
  localFailureCount: number;
  localLastRequestAt: string;
  codex5hUsedPercent: number | null;
  codex5hResetAt: string;
  codexWeekUsedPercent: number | null;
  codexWeekResetAt: string;
  codexCreditsBalance: string;
  codexCreditsUnlimited: boolean;
  codexUsageWindows: Array<{
    label: string;
    usedPercent: number | null;
    resetAt: string;
  }>;
  codexUsageUpdatedAt: string;
  codexUsageError: string;
  priority: number;
  accessToken: string;
  hasAuthJson: boolean;
  authJson: string;
  hasAuthInfoJson: boolean;
  authInfoJson: string;
  note: string;
  syncStatus: string;
  lastRefreshedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ImageAccountImportSource = {
  id?: string;
  name?: string;
  content?: string;
  value?: unknown;
};

export type ImageAccountImportPreviewItem = {
  rowId: string;
  sourceName: string;
  name: string;
  email: string;
  accountType: string;
  accountId: string;
  remoteName: string;
  hasAccessToken: boolean;
  tokenPreview: string;
  duplicateAccountId: string;
  duplicateName: string;
  duplicateReason: string;
  action: "create" | "update" | "skip";
  status: "ready" | "error";
  error: string;
};

export type ImageAccountImportSummary = {
  total: number;
  ready: number;
  create: number;
  update: number;
  skipped: number;
};

export type ImageAccountImportResult = {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  appendedToProvider: boolean;
  message: string;
};

export type ProviderRequestLog = {
  id: string;
  providerId: string;
  providerName: string;
  channel: string;
  routeMode: string;
  operation: string;
  jobId: string;
  attemptNo: number;
  maxAttempts: number;
  isRetry: boolean;
  sourceAccountId: string;
  sourceAccountName: string;
  sourceAccountEmail: string;
  userId: string;
  username: string;
  account: string;
  endpoint: string;
  statusCode: number | null;
  durationMs: number;
  success: boolean;
  error: string;
  responseSnapshot: string;
  createdAt: string;
};

export type ModelRequestLog = {
  id: string;
  purpose: string;
  providerId: string;
  providerName: string;
  model: string;
  endpoint: string;
  method: string;
  streamEnabled: boolean;
  retryCount: number;
  attemptCount: number;
  statusCode: number | null;
  durationMs: number;
  success: boolean;
  error: string;
  userId: string;
  username: string;
  account: string;
  jobId: string;
  source: string;
  createdAt: string;
};

export type StatisticsPreset =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "365d"
  | "month"
  | "year"
  | "lastYear"
  | "custom";

export type StatisticsUserRanking = {
  userId: string;
  username: string;
  account: string;
  teamName: string;
  imageCount: number;
  requestCount: number;
  failureCount: number;
  lastActiveAt: string;
};

export type ConfigStatistics = {
  range: {
    preset: StatisticsPreset;
    startDate: string;
    endDate: string;
    startAt: string;
    endAt: string;
    dayCount: number;
  };
  summary: {
    totalUsers: number;
    enabledUsers: number;
    managerUsers: number;
    totalImages: number;
    generationImages: number;
    editImages: number;
    retryGeneratedImages: number;
    todayImages: number;
    todayGenerationImages: number;
    todayEditImages: number;
    todayRetryGeneratedImages: number;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    retryRequests: number;
    successRate: number;
    averageDurationMs: number;
    totalProviders: number;
    enabledProviders: number;
    availableAccounts: number;
    limitedOrAbnormalAccounts: number;
  };
  trends: Array<{
    date: string;
    label: string;
    generationImages: number;
    editImages: number;
    requestSuccess: number;
    requestFailure: number;
    retryRequests: number;
    averageDurationMs: number;
  }>;
  users: {
    totals: { total: number; enabled: number; disabled: number; managers: number };
    rankings: StatisticsUserRanking[];
    imageRankings: StatisticsUserRanking[];
    requestRankings: StatisticsUserRanking[];
    failureRankings: StatisticsUserRanking[];
  };
  teams: Array<{
    teamId: string;
    teamName: string;
    userCount: number;
    sessionCount: number;
    imageCount: number;
    requestCount: number;
    successCount: number;
    failureCount: number;
    successRate: number;
  }>;
  images: {
    totals: { total: number; generation: number; edit: number; retryGenerated: number };
    byUser: StatisticsUserRanking[];
    byTeam: Array<{ teamId: string; teamName: string; userCount: number; sessionCount: number; imageCount: number; requestCount: number; successRate: number }>;
    byProvider: Array<{ providerId: string; providerName: string; imageCount: number; retryImageCount: number }>;
  };
  providers: {
    totals: { totalRequests: number; successRate: number; averageDurationMs: number; failedRequests: number; retryRequests: number; retrySuccessRequests: number; retryFailureRequests: number; retrySuccessRate: number; autoRetryCount: number; manualRetryCount: number; retrySucceededJobs: number };
    byChannel: Array<{ channel: string; label: string; requestCount: number; successCount: number; failureCount: number; retryRequestCount: number; retrySuccessCount: number; retryFailureCount: number; successRate: number; averageDurationMs: number }>;
    byRoute: Array<{ channel: string; channelLabel: string; routeMode: string; label: string; requestCount: number; successCount: number; failureCount: number; retryRequestCount: number; retrySuccessCount: number; retryFailureCount: number; successRate: number }>;
    byProvider: Array<{ providerId: string; providerName: string; channel: string; requestCount: number; successCount: number; failureCount: number; retryRequestCount: number; retrySuccessCount: number; retryFailureCount: number; successRate: number; averageDurationMs: number; lastError: string }>;
  };
  accounts: {
    totals: { total: number; normal: number; limited: number; abnormal: number; disabled: number };
    statusCounts: Array<{ status: string; label: string; count: number }>;
    rankings: Array<{ accountId: string; name: string; status: string; requestCount: number; successCount: number; failureCount: number; lastRequestAt: string }>;
    latestSyncRun: { status: string; message: string; finishedAt: string } | null;
  };
  failures: {
    total: number;
    failureRate: number;
    groups: Array<{ error: string; count: number; lastAt: string; providerName: string; channel: string; routeMode: string }>;
    recent: Array<{ id: string; createdAt: string; username: string; account: string; providerName: string; channel: string; routeMode: string; sourceAccountName: string; error: string; fullError: string }>;
    byProvider: Array<{ providerId: string; providerName: string; count: number; lastAt: string }>;
    byAccount: Array<{ accountId: string; name: string; count: number; lastAt: string }>;
  };
};

export type ChangelogEntry = {
  id: string;
  version: string;
  date: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatSession = {
  id: string;
  title: string;
  titleStatus: "pending" | "ready" | "manual";
  pinnedAt: string | null;
  archivedAt: string | null;
  runningImageJobCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SearchHistoryScope = "chat" | "cases" | "assets" | "images" | "promptTemplates";

export type SearchHistoryItem = {
  id: string;
  scope: SearchHistoryScope;
  keyword: string;
  searchedAt: string;
  createdAt: string;
};

export type PromptReferenceLink = {
  id: string;
  title: string;
  titleOverride: string;
  url: string;
  thumbnailUrl: string;
  thumbnailUrlOverride: string;
  iconUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptTemplateVisibility = "private" | "shared";

export type PromptTemplateLanguage = "zh" | "en" | "bilingual";

export type PromptTemplateComponentType = "text" | "textarea" | "select" | "image" | "color" | "section";
export type PromptTemplateComponentWidth = "full" | "half";

export type PromptTemplateColorOption = {
  id: string;
  name: string;
  role: string;
  hex: string;
};

export type PromptTemplateGradientOption = {
  id: string;
  name: string;
  role: string;
  colors: string[];
};

export type PromptTemplateComponent = {
  id: string;
  type: PromptTemplateComponentType;
  label: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  defaultValue?: string;
  options?: string[];
  slot?: string;
  icon?: string;
  width?: PromptTemplateComponentWidth;
  multiple?: boolean;
  colorOptions?: PromptTemplateColorOption[];
  gradientOptions?: PromptTemplateGradientOption[];
  allowCustomColor?: boolean;
  sortOrder?: number;
};

export type PromptTemplateRules = {
  prefix?: string;
  suffix?: string;
  negativePrompt?: string;
  joiner?: string;
  order?: string[];
  labels?: Record<string, string>;
};

export type PromptTemplateOutput = {
  negativeEnabled?: boolean;
};

export type PromptTemplate = {
  id: string;
  userId: string;
  ownerName: string;
  visibility: PromptTemplateVisibility;
  name: string;
  description: string;
  category: string;
  icon: string;
  optimizeStyle?: PromptTemplateOptimizeStyle;
  components: PromptTemplateComponent[];
  rules: PromptTemplateRules;
  output: PromptTemplateOutput;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canCopy: boolean;
};

export type PromptTemplateImageFile = {
  id?: string;
  fileName: string;
  size?: number;
  width?: number;
  height?: number;
  previewUrl?: string;
  dataUrl?: string;
  downloadUrl?: string;
  mimeType?: string;
  assetId?: string;
  asset?: AssetItem | null;
  uploaded?: boolean;
};

export type PromptTemplateImageValue = {
  fileName?: string;
  note?: string;
  uploaded?: boolean;
  previewUrl?: string;
  files?: PromptTemplateImageFile[];
};

export type PromptTemplateColorValue = {
  colors?: string[];
  gradients?: string[];
  customColors?: string[];
};

export type PromptTemplateFormValue =
  | string
  | string[]
  | PromptTemplateImageValue
  | PromptTemplateColorValue;

export type PromptTemplateFormValues = Record<string, PromptTemplateFormValue>;

export type PromptTemplateFormDraft = {
  templateId: string;
  formValues: PromptTemplateFormValues;
  updatedAt: string;
};

export type PromptTemplateResult = {
  id: string;
  templateId: string;
  language: PromptTemplateLanguage;
  basePrompt: string;
  basePromptEn?: string;
  optimizedPrompt: string;
  optimizedPrompts?: Partial<Record<"zh" | "en", string>>;
  negativePrompt: string;
  negativePrompts?: Partial<Record<"zh" | "en", string>>;
  providerName: string;
  model: string;
  templateSnapshot: Record<string, unknown>;
  formSnapshot: Record<string, unknown>;
  createdAt: string;
};

export type ImageReferenceItem = {
  id: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceAssetId: string | null;
  sourceCaseItemId?: string | null;
  name: string;
  url: string;
  originalUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  mimeType: string;
  size: number;
  imageWidth: number;
  imageHeight: number;
  createdAt: string;
};

export type ImageDownloadOption = {
  variant: "thumb" | "preview" | "original";
  label: string;
  description: string;
  url: string;
  downloadName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
};

export type CaseGroupImage = {
  id: string;
  sourceType: "image" | "asset" | "url";
  sourceId: string;
  imageUrl: string;
  imageOriginalUrl?: string;
  imagePreviewUrl?: string;
  imageThumbnailUrl?: string;
  downloadSourceType: "image" | "asset" | null;
  downloadSourceId: string | null;
  imageWidth: number;
  imageHeight: number;
  imageFileSize: number;
  isCover: boolean;
  sortOrder: number;
  referenceImages?: ImageReferenceItem[];
};

export type MessageSourceReferenceImage = {
  id: string;
  sourceAssetId: string | null;
  sourceCaseItemId?: string | null;
  sourceReferenceId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  kind: "image" | "asset";
  name: string;
  url: string;
  originalUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  imageWidth: number;
  imageHeight: number;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageId: string | null;
  imageUrl: string | null;
  imageOriginalUrl?: string | null;
  imagePreviewUrl?: string | null;
  imageThumbnailUrl?: string | null;
  imagePrompt: string | null;
  imageOriginPrompt?: string | null;
  referenceImageUrl?: string | null;
  referenceImageOriginalUrl?: string | null;
  referenceImagePreviewUrl?: string | null;
  referenceImageThumbnailUrl?: string | null;
  referenceImagePrompt?: string | null;
  referenceImageKind?: "image" | "asset" | null;
  referenceImageWidth?: number;
  referenceImageHeight?: number;
  sourceReferenceImages?: MessageSourceReferenceImage[];
  imageKind: "generation" | "edit" | null;
  imageSize: string | null;
  imageWidth?: number;
  imageHeight?: number;
  imageFileSize?: number;
  imageQuality: string | null;
  imageProviderId: string | null;
  parentImageId: string | null;
  imageSuggestedCaseTitle?: string | null;
  imageSuggestedCaseCategoryIds?: string[];
  imageSuggestedAssetName?: string | null;
  imageSuggestedAssetCategoryIds?: string[];
  referenceImages?: ImageReferenceItem[];
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WorkImage = {
  id: string;
  sessionId: string | null;
  jobId: string | null;
  url: string;
  originalUrl: string;
  previewUrl: string;
  thumbnailUrl: string;
  prompt: string;
  originPrompt?: string;
  kind: "generation" | "edit";
  size: string;
  imageWidth: number;
  imageHeight: number;
  imageFileSize: number;
  quality: string;
  providerId: string;
  parentImageId: string | null;
  suggestedCaseTitle?: string;
  suggestedCaseCategoryIds?: string[];
  suggestedAssetName?: string;
  suggestedAssetCategoryIds?: string[];
  favoriteCount: number;
  favorited: boolean;
  referenceImages?: ImageReferenceItem[];
  createdAt: string;
};

export type ImageBatchItemResult = {
  imageId: string;
  status: "updated" | "created" | "deleted" | "duplicate" | "not_found" | "failed";
  targetId?: string;
  reason?: string;
};

export type ImageBatchResult = {
  requested: number;
  succeeded: number;
  skipped: number;
  failed: number;
  items: ImageBatchItemResult[];
};

export type ImageDeleteImpact = {
  images: number;
  assets: number;
  caseGroups: number;
  caseItems: number;
  hasAssociated: boolean;
};

export type ImageBatchDeleteResult = ImageBatchResult & {
  impact: ImageDeleteImpact;
  cleanupWarnings: number;
};

export type ImageBatchDownloadVariant = "original" | "preview" | "thumb";

export type ImageBatchDownloadTicket = {
  downloadUrl: string;
  expiresAt: number;
  estimatedBytes: number;
};

export type ImageEditSuggestion = {
  id: string;
  label: string;
  prompt: string;
};

export type ImageJob = {
  id: string;
  type: "generation" | "edit";
  status: "running" | "succeeded" | "failed";
  prompt: string;
  providerId: string;
  error: string | null;
  resultImageId: string | null;
  branchId?: string;
  parentBranchId?: string;
  branchForkMessageId?: string;
  branchRootMessageId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CaseCategory = {
  id: string;
  name: string;
  slug: string;
  items: Array<{
    id: string;
    title: string;
    prompt: string;
    imageUrl: string;
    imageOriginalUrl?: string;
    imagePreviewUrl?: string;
    imageThumbnailUrl?: string;
    downloadSourceType: "image" | "asset" | null;
    downloadSourceId: string | null;
    createdAt: string;
    imageWidth: number;
    imageHeight: number;
    imageFileSize: number;
    useCount: number;
    favoriteCount: number;
    favorited: boolean;
    sourceUsername: string;
    canDelete: boolean;
    groupId: string;
    categoryIds: string[];
    categoryNames: string[];
    includeReferences: boolean;
    reviewStatus: "pending" | "approved" | "rejected";
    reviewRequestedAt: string;
    reviewedAt: string;
    rejectReason: string;
    images?: CaseGroupImage[];
    imageCount?: number;
    coverImageId?: string;
    referenceImages?: ImageReferenceItem[];
  }>;
};

export type CaseMaterialItem = {
  id: string;
  caseItemId: string;
  title: string;
  prompt: string;
  url: string;
  originalUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  imageWidth: number;
  imageHeight: number;
  imageFileSize?: number;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceUsername: string;
  categoryNames: string[];
  createdAt: string;
};

export type AssetItem = {
  id: string;
  space: "private" | "shared";
  name: string;
  url: string;
  originalUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  mimeType: string;
  size: number;
  imageWidth: number;
  imageHeight: number;
  createdAt: string;
  sourceUsername: string;
  canEdit: boolean;
  shared: boolean;
  shareStatus: "none" | "pending" | "approved" | "rejected";
  shareRequestedAt?: string;
  shareReviewedAt?: string;
  shareRejectReason?: string;
  categoryIds: string[];
  categoryNames: string[];
  temporary?: boolean;
  dataUrl?: string;
};
