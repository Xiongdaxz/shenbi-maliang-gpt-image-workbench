export type UserRow = {
  id: string;
  team_id: string | null;
  account: string | null;
  username: string;
  email: string;
  phone: string;
  password_hash: string;
  avatar_path: string;
  avatar_mime_type: string;
  appearance_mode: string;
  disabled: number;
  has_config_access: number;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamRow = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
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

export type BrandingAssetType =
  | "logo"
  | "favicon"
  | "login_title"
  | "login_background_light"
  | "login_background_dark";

export type BrandingAssetSource = "builtin" | "uploaded";

export type BrandingAssetRow = {
  id: string;
  type: BrandingAssetType | string;
  source: BrandingAssetSource | string;
  name: string;
  path: string;
  url: string;
  mime_type: string;
  size: number;
  image_width: number;
  image_height: number;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BrandingSettingsRow = {
  id: string;
  site_name: string;
  active_logo_asset_id: string;
  active_favicon_asset_id: string;
  active_login_title_light_asset_id: string;
  active_login_title_dark_asset_id: string;
  login_background_light_ids_json: string;
  login_background_dark_ids_json: string;
  updated_at: string;
};

export type SearchHistoryRow = {
  id: string;
  user_id: string;
  scope: string;
  keyword: string;
  normalized_keyword: string;
  searched_at: string;
  created_at: string;
};

export type ProviderRow = {
  id: string;
  name: string;
  type: string;
  channel: string;
  enabled: number;
  base_url: string;
  api_key_env: string | null;
  api_key_value: string | null;
  route_mode: string;
  generation_path: string;
  edit_path: string;
  responses_path: string;
  model: string;
  responses_model: string;
  sizes: string;
  qualities: string;
  default_size: string;
  default_quality: string;
  response_image_path: string;
  proxy_enabled: number;
  quota_mode: string;
  fallback_to_conversation: number;
  web_account_id: string;
  web_account_ids: string;
  web_account_mode: string;
  web_cookies: string | null;
  created_at: string;
  updated_at: string;
};

export type RuntimeProviderRow = ProviderRow;

export type CategoryType = "case" | "asset";

export type ImageRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  job_id: string | null;
  path: string;
  prompt: string;
  suggested_case_title: string;
  suggested_case_category_ids_json: string;
  suggested_asset_category_ids_json: string;
  kind: "generation" | "edit";
  size: string;
  quality: string;
  provider_id: string;
  mime_type: string;
  parent_image_id: string | null;
  provider_file_id: string;
  provider_gen_id: string;
  provider_conversation_id: string;
  provider_parent_message_id: string;
  provider_source_account_id: string;
  image_width: number;
  image_height: number;
  image_file_size: number;
  generated_attempt_no: number;
  generated_by_retry: number;
  created_at: string;
};

export type ImageEditSuggestionRow = {
  image_id: string;
  user_id: string;
  suggestions_json: string;
  preference_key: string;
  created_at: string;
  updated_at: string;
};

export type UserPreferencesRow = {
  user_id: string;
  language: string;
  edit_suggestions_enabled: number;
  edit_suggestion_tone: string;
  auto_upload_pasted_assets: number;
  prompt_optimize_styles_json: string;
  prompt_optimize_custom_instruction: string;
  updated_at: string;
};

export type PromptColorSchemeRow = {
  id: string;
  user_id: string;
  builtin_key: string;
  name: string;
  description: string;
  category: string;
  colors_json: string;
  gradients_json: string;
  prompt: string;
  visible: number;
  sort_order: number;
  is_builtin: number;
  created_at: string;
  updated_at: string;
  deleted_at: string;
};

export type AssetSpace = "private" | "shared";
export type AssetUploadMode = AssetSpace | "private_shared";
export type AssetShareStatus = "none" | "pending" | "approved" | "rejected";

export type AssetRow = {
  id: string;
  user_id: string;
  space: AssetSpace;
  shared: number;
  share_status: AssetShareStatus | string;
  share_requested_at: string | null;
  share_reviewed_at: string | null;
  share_reviewed_by: string;
  share_reject_reason: string;
  name: string;
  path: string;
  mime_type: string;
  size: number;
  content_hash: string;
  image_width: number;
  image_height: number;
  created_at: string;
  source_username?: string | null;
};

export type ImageAssetReferenceRow = {
  id: string;
  image_id: string;
  user_id: string;
  source_type: "image" | "asset" | "case" | "case_group" | "message-source-reference" | "" | null;
  source_id: string | null;
  source_asset_id: string | null;
  source_case_item_id: string | null;
  source_name: string;
  path: string;
  mime_type: string;
  size: number;
  image_width: number;
  image_height: number;
  sort_order: number;
  created_at: string;
};

export type MessageSourceReferenceRow = {
  id: string;
  message_id: string;
  job_id: string | null;
  user_id: string;
  source_type: "image" | "asset" | "case" | "case_group";
  source_id: string | null;
  source_case_item_id: string | null;
  source_name: string;
  path: string;
  mime_type: string;
  size: number;
  image_width: number;
  image_height: number;
  sort_order: number;
  created_at: string;
};

export type ImageDerivativeRow = {
  source_type: "image" | "asset" | "image-reference" | "message-source-reference" | "branding";
  source_id: string;
  variant: "thumb" | "preview";
  path: string;
  mime_type: string;
  size: number;
  image_width: number;
  image_height: number;
  created_at: string;
  updated_at: string;
};

export type ImageReferenceSourceAsset = Pick<AssetRow, "id" | "name" | "path" | "mime_type" | "size" | "image_width" | "image_height">;

export type SavedImageFile = {
  path: string;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number;
};

export type ProviderImageContext = {
  fileId: string;
  genId: string;
  conversationId: string;
  parentMessageId: string;
  sourceAccountId: string;
};

export type ProxySettings = {
  enabled: boolean;
  url: string;
  retryCount: number;
  applyChatgptWeb: boolean;
  applyCpa: boolean;
  applyApi: boolean;
  updatedAt: string;
};

export type ImageGenerationSettings = {
  mode: "auto" | "cpa" | "chatgpt_web" | "api";
  resultRetryCount: number | null;
  updatedAt: string;
};

export type DebugSettings = {
  imageEditMask: boolean;
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

export type ProviderRequestLogRow = {
  id: string;
  provider_id: string;
  provider_name: string;
  channel: string;
  route_mode: string;
  operation: string;
  job_id: string;
  attempt_no: number;
  max_attempts: number;
  is_retry: number;
  source_account_id: string;
  user_id: string;
  endpoint: string;
  status_code: number | null;
  duration_ms: number;
  success: number;
  error: string | null;
  response_snapshot: string;
  created_at: string;
};

export type ModelRequestLogRow = {
  id: string;
  purpose: string;
  provider_id: string;
  provider_name: string;
  model: string;
  endpoint: string;
  method: string;
  stream_enabled: number;
  retry_count: number;
  attempt_count: number;
  status_code: number | null;
  duration_ms: number;
  success: number;
  error: string | null;
  user_id: string;
  job_id: string;
  source: string;
  created_at: string;
};

export type ChangelogEntryRow = {
  id: string;
  version: string;
  release_date: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type ImageAccountRow = {
  id: string;
  name: string;
  remote_name: string | null;
  channel_id: string | null;
  email: string;
  account_type: string;
  status: string;
  quota: number;
  used_quota: number;
  usage_success_count: number;
  usage_failure_count: number;
  usage_recent_requests: string;
  local_success_count?: number;
  local_failure_count?: number;
  local_last_request_at?: string | null;
  codex_5h_used_percent: number | null;
  codex_5h_reset_at: string | null;
  codex_week_used_percent: number | null;
  codex_week_reset_at: string | null;
  codex_credits_balance: string | null;
  codex_credits_unlimited: number;
  codex_usage_windows: string;
  codex_usage_updated_at: string | null;
  codex_usage_error: string;
  priority: number;
  access_token: string | null;
  auth_json: string | null;
  auth_info_json: string | null;
  note: string;
  sync_status: string;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CpaRemoteAuthFile = {
  id?: string;
  name?: string;
  label?: string;
  account?: string;
  type?: string;
  provider?: string;
  account_type?: string;
  email?: string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  status_message?: string;
  note?: string;
  priority?: number;
  auth_index?: string;
  source?: string;
  runtime_only?: boolean;
  path?: string;
  access_token?: string;
  success_count?: number;
  failure_count?: number;
  failed_count?: number;
  error_count?: number;
  total_success_count?: number;
  total_failure_count?: number;
  recent_requests?: unknown;
  recent_stats?: unknown;
  usage?: unknown;
  id_token?: {
    plan_type?: string;
    chatgpt_subscription_active_until?: string;
  };
};
