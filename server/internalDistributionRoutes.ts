import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { ZipArchive } from "archiver";
import type { Context, Hono } from "hono";
import { maliangMcpResourceUrl, maliangPublicBaseUrl, validateMaliangPublicOrigin } from "./externalMcpAuth";
import { ROOT } from "./paths";

const CODEX_MARKETPLACE_PATH = path.join(ROOT, "distribution", "codex-marketplace");
const CODEX_PLUGIN_MCP_CONFIG = "plugins/maliang-image-generator/.mcp.json";
const CODEX_PLUGIN_MANIFEST = "plugins/maliang-image-generator/.codex-plugin/plugin.json";
const CODEX_PLUGIN_HELPER = "plugins/maliang-image-generator/skills/maliang-image-generator/scripts/maliang-helper.mjs";
const CODEX_PLUGIN_LOCAL_MCP = "plugins/maliang-image-generator/mcp/maliang-local-mcp.mjs";
const CODEX_PLUGIN_ARCHIVE_DATE = new Date("2026-01-01T00:00:00.000Z");
const CODEX_PLUGIN_RELEASED_AT = "2026-08-01";
const CODEX_PLUGIN_RELEASE_NOTES = [
  "可信本机与私有局域网 HTTP 开发地址现在可以执行自动更新；公开与生产地址仍强制使用 HTTPS。",
  "Codex 本地附件通过托管的 maliang_local MCP 自动上传，不再由智能体启动额外子进程；浏览器只保留为无可读路径或本地 MCP 未启动时的兜底。",
  "图片上传在解析前限流限长，并校验真实格式、解码结果、尺寸和像素上限。",
  "断开连接后保留设备记录，并允许显式恢复本次断开且仍未过期的凭据；移除才永久删除授权。图片结果链接缩短为 1 小时并跟随授权状态变化。",
  "本地帮助器只访问打包时绑定的马良同源上传与下载路径，拒绝跨源地址。",
  "自动更新只替换专用马良 Marketplace；共享目录会安全拒绝，插件归档按版本并发缓存。",
  "OAuth 与插件自动更新只在安全公开地址上运行，生产环境强制使用 HTTPS。",
  "兼容 MCP 2026-07-28 OAuth 响应中的 iss 与动态注册 application_type，并为 Web 客户端使用标准浏览器回调。",
  "限制匿名动态注册频率、请求体与元数据数量，并自动清理未使用的过期客户端。",
  "限制 Token 与撤销表单大小；重新授权调整权限时立即停用旧令牌，并持续清理过期令牌记录。",
  "OAuth 后首次已授权工具调用会主动要求设备上报；拒绝模板占位符和客户端通用名称，只保存当前智能体读取到的真实主机名。",
  "上传地址通过帮助器标准输入传递，生成结果签名地址通过 Codex 托管的本地 MCP stdio 传递。",
  "图片结果响应禁止缓存；连接撤销或重新授权后，旧链接必须重新经过服务端授权校验。",
  "本地帮助器固定文件大小和输出目录边界，自动更新下载按流量硬限制中止。",
  "Codex 托管的本地 MCP 保存原图到 generated_images 并返回绝对路径；生成结果不再使用浏览器交付。",
  "远程生图与本地保存 MCP 都使用 Codex 批准模式，已授权任务可像内置生图工具一样直接完成生成与内联交付。",
  "生成结果通过受管本地保存或标准资源链接交付，不再返回大体积 base64 图片数据。",
  "本地 MCP 只协商服务器明确支持的协议版本，不再回显未知客户端版本。",
  "用户复制的安装指令继续保持简短，由机器清单指导当前智能体完成安装与验证。"
];
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CODEX_PLUGIN_ARCHIVE_CACHE_LIMIT = 8;
const codexPluginArchiveCache = new Map<string, Promise<{ buffer: Buffer; etag: string; version: string }>>();

export async function readCodexPluginVersion() {
  const manifestPath = path.join(CODEX_MARKETPLACE_PATH, ...CODEX_PLUGIN_MANIFEST.split("/"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version?: unknown };
  const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`神笔马良插件版本无效：${version || "missing"}`);
  }
  return version;
}

function codexPluginArchiveName(version: string) {
  return `maliang-internal-marketplace-${version}.zip`;
}

function codexMcpLoginBehavior() {
  return {
    protocolVersion: 1,
    run: "foreground-streaming",
    command: "codex mcp login maliang",
    keepProcessAlive: true,
    systemBrowserGracePeriodMs: 5000,
    browserOrder: [
      "system-default",
      "codex-in-app-browser",
      "connected-chrome",
      "computer-use",
      "user-clickable-link"
    ],
    sandboxPolicy: "若命令运行环境限制启动 GUI，先申请仅用于本次登录命令和系统浏览器的权限；未获准时直接进入 Codex 内置浏览器兜底，不得宣称浏览器已经打开。",
    fallbackTrigger: "系统浏览器在等待窗口内未出现，且本次仍在运行的登录命令已经输出原始 HTTP(S) 授权地址。",
    fallback: [
      "优先使用 Codex 内置浏览器打开本次登录命令输出的原始授权地址；不可用时依次尝试已连接 Chrome、Computer Use，最后才把原始地址作为可点击链接交给用户",
      "打开兜底浏览器时必须保持同一个 codex mcp login 进程和 loopback 回调监听存活；不得等命令超时后才交付链接",
      "不得自行拼接、改写或复用授权地址；地址中的 client_id、redirect_uri、state 和 PKCE 参数必须来自本次 codex mcp login 输出",
      "若命令没有输出授权地址，保留并报告原始错误；No authorization support detected、动态注册失败、TLS 或元数据错误必须由服务端修复，不能通过切换浏览器绕过"
    ],
    staleAttempt: "登录命令超时、退出或回调监听停止后，本次地址立即视为不可用；结束旧尝试，重新运行命令并只使用新地址。",
    completionGates: [
      "登录命令明确报告成功",
      "codex mcp get maliang --json 仍指向预期 endpoint",
      "当前任务或重启后的新任务已加载全部 requiredTools",
      "当前智能体读取真实主机名并调用 maliang_report_device，返回 reported=true",
      "maliang_account_status 确认账号已授权"
    ]
  };
}

function noIndex(c: Context) {
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
}

function agentInstallInstruction(href: string) {
  return `访问 ${href}，安装神笔马良。`;
}

function agentExecutionPolicy() {
  return {
    owner: "current-ai-agent",
    mode: "execute-installation",
    startImmediatelyAfterReading: true,
    userOnlyActions: [
      "在浏览器输入账号信息并登录",
      "确认 OAuth 授权",
      "确认操作系统或客户端明确要求的权限"
    ],
    required: [
      "读取清单后继续执行当前客户端的真实安装，不停在说明、摘要或配置示例",
      "由智能体定位并修改当前客户端的实际 MCP 或插件配置，再触发客户端重新加载",
      "OAuth 与 MCP initialize 完成后，在同一安装流程中立即读取真实主机名并调用 maliang_report_device；不得等待用户下一条消息",
      "完成 OAuth、工具加载与账号状态验证后再报告安装成功"
    ],
    forbidden: [
      "只读取、复述或展示安装清单",
      "把可由智能体完成的命令、配置编辑或验证步骤交还给用户",
      "用临时 HTTP 或 OAuth 脚本代替当前客户端中的真实安装",
      "仅因安装页可访问、动态注册成功或授权页已打开就报告安装成功"
    ]
  };
}

const DEVICE_HOSTNAME_PLACEHOLDER = "__ACTUAL_DEVICE_HOSTNAME__";
const DEVICE_OS_PLACEHOLDER = "__ACTUAL_DEVICE_OS__";

function fixedDeviceHeadersTemplate() {
  return {
    "X-Maliang-Device-Name": DEVICE_HOSTNAME_PLACEHOLDER,
    "X-Maliang-Device-Os": DEVICE_OS_PLACEHOLDER
  };
}

function fixedDeviceMcpConfigTemplate(endpoint: string) {
  return {
    mcpServers: {
      maliang: {
        url: endpoint,
        headers: fixedDeviceHeadersTemplate()
      }
    }
  };
}

function manualRemoteMcpConfig(endpoint: string) {
  return {
    mcpServers: {
      maliang: {
        url: endpoint
      }
    }
  };
}

function manualRemoteMcpSetup(endpoint: string) {
  return {
    supported: true,
    format: "mcpServers-json",
    configurationScope: "client-convention",
    protocolStandardSchema: false,
    compatibleClients: ["支持 mcpServers 与 Remote HTTP url 的 MCP 客户端"],
    config: manualRemoteMcpConfig(endpoint),
    mergeExistingMcpServers: true,
    oauth: {
      ownedBy: "current-client",
      automaticAfterSave: true,
      credentialsInConfig: false,
      forbiddenFields: ["accessToken", "refreshToken", "tokenEndpoint"]
    },
    deviceIdentity: {
      headersOmittedForDirectPaste: true,
      reason: "安装网页无法安全读取访问者电脑的真实主机名，不能把服务器主机名或模板占位符写入客户端配置",
      completeWith: "OAuth 和工具加载后，由当前智能体调用 maliang_report_device 上报真实主机名"
    },
    steps: [
      "在客户端 MCP 设置中选择手动添加或 JSON 配置",
      "把 config 中的 maliang 合并进现有 mcpServers，保留其他 MCP Server，不用整份 JSON 覆盖现有配置",
      "保存并启用该 MCP Server",
      "让当前客户端使用自己的 Remote MCP OAuth 流程完成浏览器登录、允许授权、Token 交换和 MCP initialize",
      "工具加载后立即调用 maliang_report_device，再调用 maliang_account_status；保持同一安装流程继续运行，不等待用户另发消息；requiredTools 可见且账号有效后才算完成"
    ]
  };
}

function externalMcpDeviceIdentityPolicy() {
  return {
    requiredForEveryClient: true,
    collectBy: "current-ai-agent",
    reportTool: "maliang_report_device",
    reportTiming: {
      trigger: "first-authorized-tool-call-after-mcp-initialize",
      sameAgentTurn: true,
      beforeTools: ["maliang_account_status", "maliang_generate_image", "maliang_edit_image", "maliang_create_image_upload", "maliang_get_image_upload", "maliang_get_image_job"],
      doNotWaitForUserFollowUp: true,
      serverEnforcedWhenUnknown: true,
      repeatPolicy: "once-per-oauth-client-until-device-changes",
      doNotRepeatBeforeEachTaskOrImage: true
    },
    collect: {
      windows: {
        hostname: "[System.Net.Dns]::GetHostName()；为空时再读取 COMPUTERNAME",
        deviceType: "Windows"
      },
      macos: { hostname: "hostname", deviceType: "macOS" },
      linux: { hostname: "hostname", deviceType: "Linux" },
      mobile: { hostname: "读取系统提供的实际设备名称", deviceType: "iOS 或 Android" }
    },
    fixedHeadersTemplate: fixedDeviceHeadersTemplate(),
    templateRules: [
      `写入配置或命令前必须替换 ${DEVICE_HOSTNAME_PLACEHOLDER} 和 ${DEVICE_OS_PLACEHOLDER}`,
      "设备名称必须是当前机器的真实主机名，不得使用操作系统名称、客户端名称、localhost、未知设备或模板占位符",
      "客户端支持固定 HTTP 请求头时同时写入 fixedHeadersTemplate，以便动态注册或首次 MCP 请求提前回填",
      "无论固定请求头是否生效，OAuth 成功且工具加载后都必须调用 maliang_report_device，作为所有客户端统一的最终设备回填与验证步骤"
    ],
    completion: [
      "maliang_report_device 返回 reported=true",
      "maliang_account_status 确认账号已授权",
      "requiredTools 全部可见"
    ]
  };
}

function aiClientInstallLinks(c: Context) {
  const publicBaseUrl = maliangPublicBaseUrl(c);
  return {
    publicBaseUrl,
    install: {
      href: `${publicBaseUrl}/install`,
      instruction: agentInstallInstruction(`${publicBaseUrl}/install`)
    },
    mcp: {
      href: `${publicBaseUrl}/mcp`,
      instruction: agentInstallInstruction(`${publicBaseUrl}/mcp`)
    },
    plugin: {
      href: `${publicBaseUrl}/plugin`,
      instruction: agentInstallInstruction(`${publicBaseUrl}/plugin`)
    }
  };
}

function mcpInstallManifest(c: Context) {
  const links = aiClientInstallLinks(c);
  const publicBaseUrl = links.publicBaseUrl;
  const endpoint = maliangMcpResourceUrl(c);
  return {
    schemaVersion: 1,
    product: "神笔马良",
    technicalId: "maliang",
    distribution: "internal",
    type: "remote-mcp",
    userInstruction: links.mcp.instruction,
    execution: agentExecutionPolicy(),
    deviceIdentity: externalMcpDeviceIdentityPolicy(),
    endpoint,
    transport: "streamable-http",
    authentication: {
      type: "oauth2",
      discovery: `${publicBaseUrl}/.well-known/oauth-protected-resource/api/external-mcp/mcp`,
      resource: endpoint,
      pkce: "S256",
      credentialsInChat: false
    },
    manualSetup: manualRemoteMcpSetup(endpoint),
    idempotency: [
      "先检查名为 maliang 的 MCP 是否已存在",
      "若已指向同一 endpoint，不重复添加，只验证登录和工具列表",
      "若同名配置指向其他地址，停止并向用户说明冲突，不覆盖其他配置",
      "若 maliang-image-generator Codex 插件已提供 maliang MCP，不再全局重复注册"
    ],
    clients: {
      codex: {
        detect: ["codex mcp get maliang --json", "codex plugin list --json"],
        install: `codex mcp add maliang --url ${endpoint} --oauth-resource ${endpoint}`,
        deviceHeadersConfigTemplate: {
          target: "~/.codex/config.toml 中已创建的 [mcp_servers.maliang]，只合并下列字段",
          env_http_headers: {
            "X-Maliang-Device-Hostname": "HOSTNAME",
            "X-Maliang-Device-Name": "COMPUTERNAME",
            "X-Maliang-Device-Os": "OS",
            "X-Maliang-Device-Ostype": "OSTYPE"
          }
        },
        login: "codex mcp login maliang",
        loginBehavior: codexMcpLoginBehavior(),
        verify: "codex mcp get maliang --json",
        steps: [
          "由当前智能体执行 install，不把命令交还用户；若插件已提供同一 maliang MCP，则复用插件配置而不重复添加",
          "MCP-only 安装时把 deviceHeadersConfigTemplate 合并到同一个 mcp_servers.maliang；不得覆盖其他 Codex 或 MCP 配置",
          "OAuth 和工具加载完成后读取本机真实主机名，调用 maliang_report_device，再调用 maliang_account_status"
        ]
      },
      claudeCode: {
        detect: "claude mcp get maliang",
        install: `claude mcp add --transport http maliang ${endpoint} --header "X-Maliang-Device-Name: ${DEVICE_HOSTNAME_PLACEHOLDER}" --header "X-Maliang-Device-Os: ${DEVICE_OS_PLACEHOLDER}"`,
        installTemplate: `claude mcp add --transport http maliang ${endpoint} --header "X-Maliang-Device-Name: ${DEVICE_HOSTNAME_PLACEHOLDER}" --header "X-Maliang-Device-Os: ${DEVICE_OS_PLACEHOLDER}"`,
        replacePlaceholdersBeforeRun: true,
        login: "由 Claude Code 在首次连接时打开 OAuth 浏览器授权",
        verify: "claude mcp get maliang",
        steps: [
          "由当前 Claude Code 智能体读取真实主机名和操作系统，替换 installTemplate 的全部占位符后直接执行",
          "若同名配置已指向相同 endpoint，则合并设备请求头而不重复添加；若指向其他地址，停止并报告冲突",
          "OAuth 和工具加载完成后调用 maliang_report_device，再调用 maliang_account_status；不得只展示命令或配置"
        ]
      },
      trae: {
        installOwner: "current-ai-agent",
        transport: "streamable-http",
        configContract: {
          remoteHttpFields: ["url", "headers"],
          oauthOwnedBy: "TRAE Work",
          forbiddenCredentialFields: ["accessToken", "refreshToken", "tokenEndpoint"],
          requirement: "OAuth 凭据由 TRAE Work 自己的 Remote MCP OAuth 流程管理，不得写入 MCP 配置文件"
        },
        oauthClientIdentity: {
          expectedClientName: "TRAE Work",
          softwareId: "trae-work",
          allowGeneratedSuffix: false,
          deviceIdentityIsSeparate: true,
          requirements: [
            "使用 TRAE Work 原生 Remote MCP OAuth 注册信息，不得手工调用 /oauth/register",
            "client_name 使用正式产品名称 TRAE Work，不得拼接随机数、时间戳、设备主机名或其他生成后缀",
            "设备主机名只写入 X-Maliang-Device-Name 并通过 maliang_report_device 上报，不得拼进 client_name",
            "若 TRAE Work 原生注册信息与预期不一致，报告实际客户端行为；不得用 PowerShell、Python、curl 或临时脚本重新注册来伪造名称"
          ]
        },
        config: fixedDeviceMcpConfigTemplate(endpoint),
        configTemplate: fixedDeviceMcpConfigTemplate(endpoint),
        replacePlaceholdersBeforeWrite: true,
        activation: {
          preferredManagementEntry: "TRAE Work 设置 > MCP",
          projectConfigCandidate: "<project>/.trae/mcp.json",
          verifyCandidateIsActiveBeforeRelyingOnIt: true,
          preserveExistingMcpServers: true,
          manualJsonPaste: "last-resort-only",
          projectMcp: {
            enableWhenProjectConfigIsUsed: true,
            owner: "current-ai-agent",
            userOnlyWhen: "TRAE Work 显示当前智能体无法代为确认的客户端权限弹窗",
            afterUserConfirmation: "保持当前安装流程继续运行，立即重新加载并验证；不得要求用户另发一条“继续”消息"
          },
          completionGates: [
            "maliang 已出现在 TRAE Work 当前 MCP 列表中",
            "已加载配置中的 endpoint 和设备请求头与本清单一致",
            "TRAE Work 原生 OAuth 已完成 Token 交换与 MCP initialize",
            "requiredTools 均可见，maliang_report_device 返回 reported=true，maliang_account_status 可读取账号"
          ]
        },
        templateValues: {
          actualDeviceHostname: {
            placeholder: DEVICE_HOSTNAME_PLACEHOLDER,
            windows: "使用 [System.Net.Dns]::GetHostName() 读取；为空时再读取 COMPUTERNAME",
            macosLinux: "使用 hostname 读取",
            requirement: "写入配置前替换为当前电脑的真实主机名，不得保留占位符，也不得用 Windows、macOS 或 Linux 代替设备名"
          },
          actualDeviceOs: {
            placeholder: DEVICE_OS_PLACEHOLDER,
            allowedValues: ["Windows", "macOS", "Linux"],
            requirement: "由当前智能体根据正在运行 TRAE Work 的操作系统写入准确值，不得保留占位符"
          }
        },
        steps: [
          "由当前智能体优先定位 TRAE Work 的真实 MCP 管理入口或实际配置文件；<project>/.trae/mcp.json 只是项目配置候选，必须确认当前 TRAE Work 确实加载它，不要只把 configTemplate 展示给用户",
          "使用项目配置时确认并启用项目级 MCP；能由当前智能体操作时直接完成，只有 TRAE Work 明确要求客户端权限确认时才让用户确认，确认后继续同一安装流程，不等待下一条对话",
          "读取当前电脑真实主机名和操作系统，替换全部占位符后，只把 maliang 合并进现有 mcpServers；保留其他 MCP 配置，不以粘贴整份 JSON 覆盖现有配置",
          "保存后让 TRAE Work 重新加载 MCP，先确认 maliang 已出现在当前 MCP 列表，再使用 TRAE Work 自己的 Remote MCP OAuth 流程连接；不得写入 accessToken、refreshToken 或 tokenEndpoint，也不得用 Python、urllib、curl 或临时回调脚本代替真实安装",
          "用户在浏览器完成登录和允许授权后，继续等待 TRAE Work 完成 Token 交换与 MCP initialize",
          "在 TRAE Work 中确认 requiredTools 后立即调用 maliang_report_device，再调用 maliang_account_status；保持当前安装流程继续运行，不等待用户下一条对话；只有工具可见、账号可读且设备名已上报后才报告完成"
        ],
        note: "适用于 TRAE Work。设备名称通过安装智能体写入的固定 MCP 请求头上报；服务端会在动态注册或首次已授权 MCP 请求时保存。"
      },
      workBuddy: {
        installOwner: "current-ai-agent",
        config: fixedDeviceMcpConfigTemplate(endpoint),
        configTemplate: fixedDeviceMcpConfigTemplate(endpoint),
        replacePlaceholdersBeforeWrite: true,
        userConfig: "~/.workbuddy/mcp.json",
        projectConfig: "<project>/.workbuddy/mcp.json",
        steps: [
          "由当前 WorkBuddy 智能体确认版本支持 Remote HTTP 和 OAuth，并选择正在使用的用户或项目配置文件",
          "读取真实主机名和操作系统，替换 configTemplate 占位符后合并 mcp.json；保留其他 mcpServers",
          "重新加载 MCP 并完成 OAuth 后调用 maliang_report_device，再调用 maliang_account_status"
        ],
        note: "若当前版本拒绝 url 或 headers 字段，停止并报告实际版本与错误；不要改写成不安全的共享密钥，也不要把配置步骤交给用户。"
      },
      standard: {
        installOwner: "current-ai-agent",
        config: fixedDeviceMcpConfigTemplate(endpoint),
        configTemplate: fixedDeviceMcpConfigTemplate(endpoint),
        replacePlaceholdersBeforeWrite: true,
        steps: [
          "由当前智能体定位宿主实际使用的标准 MCP 配置位置或管理入口，不停在读取清单或展示示例",
          "读取真实主机名和操作系统，替换 configTemplate 全部占位符并合并实际配置；保留其他 MCP",
          "重新加载、完成 OAuth 和工具发现后调用 maliang_report_device，再调用 maliang_account_status"
        ],
        fallback: "若客户端不支持固定 headers，仍继续完成原生 OAuth，并在工具加载后调用 maliang_report_device；不得因此省略设备名称上报。"
      }
    },
    requiredTools: [
      "maliang_account_status",
      "maliang_report_device",
      "maliang_generate_image",
      "maliang_edit_image",
      "maliang_create_image_upload",
      "maliang_get_image_upload",
      "maliang_get_image_job"
    ],
    completion: "完成 OAuth 后初始化 MCP，由当前智能体调用 maliang_report_device 和 maliang_account_status，并确认 requiredTools 均可见；必要时提示用户重启客户端或新建任务。"
  };
}

async function marketplaceFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await marketplaceFiles(path.join(directory, entry.name), relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function runtimeMarketplaceFile(relativePath: string, source: Buffer, publicBaseUrl: string, pluginVersion: string) {
  if (relativePath === CODEX_PLUGIN_MCP_CONFIG) {
    const config = JSON.parse(source.toString("utf8")) as {
      mcpServers?: Record<string, {
        args?: string[];
        command?: string;
        cwd?: string;
        default_tools_approval_mode?: string;
        enabled_tools?: string[];
        env_http_headers?: Record<string, string>;
        oauth_resource?: string;
        required?: boolean;
        url?: string;
      }>;
    };
    const endpoint = `${publicBaseUrl}/api/external-mcp/mcp`;
    const maliang = config.mcpServers?.maliang;
    if (!maliang) throw new Error("神笔马良插件缺少 maliang MCP 配置");
    if (maliang.env_http_headers?.["X-Maliang-Device-Name"] !== "COMPUTERNAME") {
      throw new Error("神笔马良插件缺少 Windows 设备名称请求头配置");
    }
    if (
      maliang.env_http_headers?.["X-Maliang-Device-Os"] !== "OS"
      || maliang.env_http_headers?.["X-Maliang-Device-Ostype"] !== "OSTYPE"
    ) {
      throw new Error("神笔马良插件缺少设备类型请求头配置");
    }
    if (maliang.default_tools_approval_mode !== "approve") {
      throw new Error("神笔马良插件远程 MCP 未启用 Codex 批准模式");
    }
    const local = config.mcpServers?.maliang_local;
    if (
      local?.command !== "node"
      || local.cwd !== "."
      || local.args?.[0] !== "./mcp/maliang-local-mcp.mjs"
      || !local.enabled_tools?.includes("upload_local_image")
      || !local.enabled_tools?.includes("save_image_result")
      || local.default_tools_approval_mode !== "approve"
      || local.required !== false
    ) {
      throw new Error("神笔马良插件缺少 Codex 托管的本地图片上传与保存 MCP");
    }
    maliang.oauth_resource = endpoint;
    maliang.url = endpoint;
    return Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
  }
  if (relativePath === CODEX_PLUGIN_MANIFEST) {
    const manifest = JSON.parse(source.toString("utf8")) as { homepage?: string; version?: string };
    if (manifest.version !== pluginVersion) {
      throw new Error(`神笔马良插件版本不一致：模板为 ${manifest.version ?? "missing"}，读取值为 ${pluginVersion}`);
    }
    manifest.homepage = `${publicBaseUrl}/plugin`;
    return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (relativePath === CODEX_PLUGIN_HELPER) {
    const baseUrl = new URL(publicBaseUrl);
    const allowInsecureLocal = baseUrl.protocol === "http:";
    return Buffer.from(source.toString("utf8")
      .replaceAll("__MALIANG_PUBLIC_BASE_URL__", publicBaseUrl)
      .replaceAll("__MALIANG_ALLOW_INSECURE_LOCAL__", String(allowInsecureLocal)));
  }
  if (relativePath === CODEX_PLUGIN_LOCAL_MCP && source.length === 0) {
    throw new Error("神笔马良插件的本地图片保存 MCP 为空");
  }
  return source;
}

export async function buildCodexPluginArchive(publicBaseUrl: string, expectedVersion?: string) {
  const validatedPublicBaseUrl = validateMaliangPublicOrigin(publicBaseUrl);
  const pluginVersion = await readCodexPluginVersion();
  if (expectedVersion && expectedVersion !== pluginVersion) {
    throw new Error(`神笔马良插件版本在打包期间发生变化：期望 ${expectedVersion}，实际 ${pluginVersion}`);
  }
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const completed = new Promise<void>((resolve, reject) => {
    output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    output.once("end", resolve);
    output.once("error", reject);
    archive.once("error", reject);
  });
  archive.pipe(output);
  for (const relativePath of await marketplaceFiles(CODEX_MARKETPLACE_PATH)) {
    const source = await readFile(path.join(CODEX_MARKETPLACE_PATH, ...relativePath.split("/")));
    archive.append(runtimeMarketplaceFile(relativePath, source, validatedPublicBaseUrl, pluginVersion), {
      name: `codex-marketplace/${relativePath}`,
      date: CODEX_PLUGIN_ARCHIVE_DATE,
      mode: 0o644
    });
  }
  await archive.finalize();
  await completed;
  return Buffer.concat(chunks);
}

export async function cachedCodexPluginArchive(publicBaseUrl: string) {
  const validatedPublicBaseUrl = validateMaliangPublicOrigin(publicBaseUrl);
  const version = await readCodexPluginVersion();
  const key = `${validatedPublicBaseUrl}\u0000${version}`;
  const existing = codexPluginArchiveCache.get(key);
  if (existing) return await existing;
  const promise = buildCodexPluginArchive(validatedPublicBaseUrl, version).then((buffer) => ({
    buffer,
    etag: `"${createHash("sha256").update(buffer).digest("base64url")}"`,
    version
  }));
  codexPluginArchiveCache.set(key, promise);
  if (codexPluginArchiveCache.size > CODEX_PLUGIN_ARCHIVE_CACHE_LIMIT) {
    const oldestKey = codexPluginArchiveCache.keys().next().value as string | undefined;
    if (oldestKey && oldestKey !== key) codexPluginArchiveCache.delete(oldestKey);
  }
  try {
    return await promise;
  } catch (error) {
    if (codexPluginArchiveCache.get(key) === promise) codexPluginArchiveCache.delete(key);
    throw error;
  }
}

async function pluginLatestManifest(c: Context, cachedArchive?: { buffer: Buffer; version: string }) {
  const publicBaseUrl = maliangPublicBaseUrl(c);
  const archive = cachedArchive ?? await cachedCodexPluginArchive(publicBaseUrl);
  const { buffer, version } = archive;
  return {
    schemaVersion: 1,
    product: "神笔马良",
    type: "codex-plugin-marketplace",
    codexOnly: true,
    marketplace: "maliang-internal",
    plugin: "maliang-image-generator",
    version,
    channel: "stable",
    releasedAt: CODEX_PLUGIN_RELEASED_AT,
    releaseNotes: CODEX_PLUGIN_RELEASE_NOTES,
    downloadUrl: `${publicBaseUrl}/plugin/download/latest`,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    size: buffer.length,
    archiveRoot: "codex-marketplace",
    mcpResource: maliangMcpResourceUrl(c),
    authentication: "oauth-on-install",
    update: {
      protocolVersion: 1,
      checkUrl: `${publicBaseUrl}/plugin/latest.json`,
      comparison: "semver",
      installSelector: "maliang-image-generator@maliang-internal",
      strategy: "transactional-local-marketplace-replacement",
      defaultMode: "auto",
      supportedModes: ["auto", "notify", "off"],
      automatic: true,
      requiresUserApproval: false,
      initialHookTrustRequired: true,
      hookBootstrapVersion: "0.3.0",
      legacyVersionsRequireOneManualUpdate: true,
      checkIntervalHours: 24,
      activation: "next-task-or-restart",
      compatibility: "compatible",
      critical: false,
      blockOldVersion: false,
      restartRequired: true,
      failurePolicy: "keep-current-and-continue"
    }
  };
}

async function pluginInstallManifest(c: Context) {
  const latest = await pluginLatestManifest(c);
  const links = aiClientInstallLinks(c);
  return {
    ...latest,
    userInstruction: links.plugin.instruction,
    execution: agentExecutionPolicy(),
    clientGuard: "这是神笔马良的 Codex 专用插件包，仅可安装到 Codex。其他客户端即使拥有自己的插件机制，也不能安装此包；当前请改用 /mcp。",
    prerequisites: [
      "可执行 codex 命令",
      "Node 20+ 用于启动插件内置 maliang_local stdio MCP，并通过同一份 maliang-helper.mjs 上传本地附件、保存生成原图；缺少 Node 时 Remote MCP 核心能力仍可安装，但本地附件只能使用一次性上传页，生成结果不得改用浏览器交付",
      "允许读取用户在 Codex 当前任务中提供的本地附件，并写入用户自己的 Codex 插件配置目录和 Codex generated_images 目录",
      "可在浏览器完成马良 OAuth 登录"
    ],
    durableInstallDirectory: {
      windows: "%LOCALAPPDATA%\\ShenbiMaliang\\codex-marketplace",
      macos: "~/Library/Application Support/ShenbiMaliang/codex-marketplace",
      linux: "~/.local/share/shenbi-maliang/codex-marketplace"
    },
    oauthLogin: codexMcpLoginBehavior(),
    updatePolicy: {
      channel: "stable",
      versionSource: ".codex-plugin/plugin.json",
      defaultMode: "auto",
      supportedModes: ["auto", "notify", "off"],
      trigger: "受信任的插件 PreToolUse Hook 在调用 maliang MCP 工具前触发；24 小时内最多联网检查一次。",
      check: [
        "0.3.0 是首个包含自动更新 Hook 的版本；0.2.x 及更早版本无法自行获得 Hook，发布后必须先完成一次人工更新到 0.3.0 或更高版本",
        "从当前插件 plugin.json 读取已加载版本，从 codex plugin list --json 读取精确 selector 的已安装版本",
        "重新获取 checkUrl，按 SemVer 比较 latest.version 与 installed.version；小于或等于时保持现状，不重复安装",
        "默认 auto：兼容 stable 新版本自动执行；notify 只提示；off 不检查。可通过 PLUGIN_DATA/update-settings.json 或 MALIANG_PLUGIN_UPDATE_MODE 明确覆盖",
        "插件 Hook 第一次安装或定义变化后必须由用户审查并信任；未信任的 Hook 会被 Codex 跳过，不能声称自动更新已经运行"
      ],
      apply: [
        "下载 latest.downloadUrl 并校验 size 与 sha256",
        "解压到 durableInstallDirectory 同级暂存目录，校验 archiveRoot、Marketplace 清单、插件名称和版本、MCP endpoint、Hook/Skill 入口且拒绝符号链接",
        "保留旧目录后原子切换新目录，再执行 codex plugin add maliang-image-generator@maliang-internal --json 刷新安装",
        "不覆盖当前任务已加载的工具；更新在下个任务或重启 Codex 后生效，再验证插件版本、MCP endpoint、requiredTools 和账号状态"
      ],
      rollback: [
        "下载、哈希、解压或清单校验失败时不触碰现有安装",
        "目录切换、插件刷新或 MCP 初始化失败时恢复旧目录，并报告仍在使用的旧版本",
        "普通检查或更新失败时保留当前版本并继续本次马良工具调用；只有清单同时标记 incompatible、critical 和 blockOldVersion 时阻断旧工具",
        "更新不主动清除 OAuth 凭据；仅在新版本返回 Auth required 时发起一次新的 oauthLogin 状态机",
        "成功后保留最近一个旧 Marketplace 备份；下一次兼容更新开始前才清理更早的备份，确保日常调用不为清理额外启动进程"
      ]
    },
    platformCompatibility: {
      shared: [
        "Windows、macOS 和 Linux 使用同一个插件 ZIP、同一个 Remote MCP endpoint 和同一套 OAuth PKCE 流程，不安装平台专属插件变体",
        "所有本地路径先解析成当前操作系统的绝对路径；路径包含空格时必须作为一个完整参数传递",
        "Codex 已暴露本地附件路径时，由 bundled maliang_local.upload_local_image 通过受管 MCP stdio 自动提交到一次性地址，不让用户再次打开页面选图，也不由智能体启动额外子进程",
        "Codex 从插件根目录启动 bundled maliang_local stdio MCP；一次性上传地址只进入 upload_local_image，签名结果地址只进入 save_image_result，都不经过 Shell 参数、临时文件或浏览器",
        "maliang-helper.mjs 仍是上传与原图持久化的唯一权威实现；maliang_local MCP 只负责把两个调用接入 Codex 托管流程，不维护第二份上传或下载实现",
        "生成结果保存失败时报告交付未完成，绝不自动打开 Codex Browser、Chrome、Computer Use 或系统浏览器"
      ],
      windows: [
        "使用 PowerShell 和 %LOCALAPPDATA% 下的 durableInstallDirectory",
        "自动更新 Hook 直接使用 bundled auto-update.ps1；脚本内部读取 24 小时缓存，并由 PowerShell 完成下载、Expand-Archive 和精确 codex plugin add，不依赖 Node 或 Bun",
        "图片默认保存到 %CODEX_HOME%\\generated_images\\maliang；未设置 CODEX_HOME 时使用用户目录下的 .codex",
        "最终 Markdown 图片地址必须把原生 C:\\ 路径规范化为 /C:/ 开头的正斜杠路径，不能直接使用反斜杠路径"
      ],
      macos: [
        "使用当前 POSIX shell；不要照抄 PowerShell、反斜杠路径或 %LOCALAPPDATA%",
        "自动更新 Hook 优先由 Node 20+ 执行 bundled auto-update.mjs，缺少 Node 20+ 时由 Bun 执行过渡兼容的 auto-update.ts，并通过 ditto 解压 ZIP；两者都不存在时安全跳过更新检查，不阻断 Remote MCP",
        "完整引用 ~/Library/Application Support/ShenbiMaliang/codex-marketplace，因为 Application Support 含空格；传给命令前解析为绝对路径",
        "图片默认保存到 ${CODEX_HOME:-$HOME/.codex}/generated_images/maliang；不要通过 xattr 或 Gatekeeper 绕过系统安全检查"
      ],
      linux: [
        "使用当前 POSIX shell 和 ~/.local/share/shenbi-maliang/codex-marketplace",
        "自动更新 Hook 优先由 Node 20+ 执行 bundled auto-update.mjs，缺少 Node 20+ 时由 Bun 执行过渡兼容的 auto-update.ts，并通过 unzip 解压 ZIP；运行时或 unzip 缺失时在触碰当前安装前安全跳过或失败，不阻断 Remote MCP",
        "图片默认保存到 ${CODEX_HOME:-$HOME/.codex}/generated_images/maliang"
      ]
    },
    steps: [
      "运行 codex --version、node --version、bun --version、codex plugin list --json 和 codex plugin marketplace list --json，检查客户端能力、旧插件和旧 Marketplace；Node 20+ 用于 maliang_local 保存 MCP，缺失时记录生成结果本地交付不可用但继续安装 Remote MCP 核心能力",
      "下载 downloadUrl 到临时文件，计算 SHA-256，必须与 sha256 完全一致",
      "解压到 durableInstallDirectory 的同级暂存目录，确认其中存在 .agents/plugins/marketplace.json",
      "把验证后的 codex-marketplace 目录切换到 durableInstallDirectory；只替换神笔马良自己的目录，并保留旧目录直到新安装验证成功；切换失败立即恢复旧目录",
      "若 maliang-internal 尚未登记，执行 codex plugin marketplace add <durableInstallDirectory>；必须把当前平台的绝对目录作为一个完整参数传入，尤其不要拆开 macOS 的 Application Support",
      "执行 codex plugin add maliang-image-generator@maliang-internal",
      "审查并信任插件内置 Hook；CLI 可使用 /hooks 查看。自动更新默认是 auto，但未信任 Hook 时 Codex 会跳过它",
      "插件使用 ON_INSTALL 授权策略，但不要把 Added plugin 当成授权成功；只有本次安装明确报告 OAuth 登录成功时才能跳过，否则前台执行 codex mcp login maliang，并保持命令输出可见直到结束",
      "授权页只需操作一次；首次提交后按钮会锁定并显示处理中，不要刷新、返回或重复点击",
      "严格执行 oauthLogin 状态机：系统浏览器未在等待窗口内出现时，优先用 Codex 内置浏览器打开同一登录进程输出的原始授权地址；保持回调监听存活，不得等命令超时后才交付链接",
      "若没有输出授权地址，停止并报告原始错误；切换 Codex Browser、Chrome 或 Computer Use 不能修复 OAuth 元数据、动态注册或 TLS 故障",
      "验证 codex plugin list --json、codex mcp get maliang --json、bundled maliang_local.upload_local_image 和 maliang_local.save_image_result，然后提示重启 Codex 或新建任务；在新任务读取真实主机名并调用 maliang_report_device，再调用 maliang_account_status，确认设备名、账号授权和图片工具均已就绪",
      "改图时若 Codex 已提供附件绝对路径，把一次性 uploadUrl、uploadId 和附件路径交给 maliang_local.upload_local_image，不要求用户重复上传；生图完成后把 downloadUrl 和 imageId 交给 maliang_local.save_image_result，保存原图后用绝对本地路径直接显示；失败时报告交付未完成，不打开生成结果地址，也不保存 preview 派生图",
      "全部验证成功后清理下载 ZIP 和空暂存目录；保留最近一个旧目录备份直到下一次兼容更新开始前，失败时保留诊断证据并恢复旧目录"
    ],
    legacyMigration: {
      selector: "maliang-image-generator@personal",
      rule: "检测到旧 personal 插件时不得重复安装。先告知用户这是旧的本地 stdio 版本；用户确认迁移后，只移除该精确 selector，再继续安装 maliang-internal。",
      remove: "codex plugin remove maliang-image-generator@personal"
    },
    safety: [
      "当前客户端不是 Codex 时立即停止，不下载 ZIP，不执行任何 codex plugin 命令",
      "不修改或删除其他插件、Marketplace、MCP 配置",
      "不把 ZIP URL 直接传给 codex plugin marketplace add，必须先下载、校验并解压",
      "不要求用户把密码、Token 或授权码粘贴到聊天",
      "不隐藏运行 codex mcp login，不使用会在命令超时后才返回输出的短超时调用，不自行生成或改写 OAuth 授权地址",
      "自动更新 Hook 的网络、文件或 codex plugin add 步骤失败时继续使用当前版本，不把失败误报为已升级；诊断写入 PLUGIN_DATA/auto-update.log",
      "不把插件已添加、浏览器已打开或授权页已显示误报为登录成功；必须以登录命令成功结束和 maliang_account_status 为准",
      "重复执行时复用同一 durableInstallDirectory 和 maliang-internal，不创建重复项"
    ]
  };
}

async function compatibleInstallManifest(c: Context) {
  const links = aiClientInstallLinks(c);
  const endpoint = maliangMcpResourceUrl(c);
  return {
    schemaVersion: 1,
    product: "神笔马良",
    type: "client-compatible-installer",
    userInstruction: links.install.instruction,
    execution: agentExecutionPolicy(),
    manualRemoteMcp: manualRemoteMcpSetup(endpoint),
    rules: [
      "先确认当前正在运行安装任务的 AI 客户端，不以电脑上是否存在 codex 命令作为判断依据",
      "当前客户端是 Codex 时，默认安装 Codex 插件",
      "当前客户端是 Codex，但用户明确要求只安装 MCP 时，仅安装 Remote MCP，不安装插件",
      "当前除 Codex 外没有提供其他客户端的专用插件包，因此其他客户端仅安装 Remote MCP",
      "以后只有在安装清单明确新增当前客户端的专用插件包时，才能改为安装该客户端插件；不得复用 Codex 插件包"
    ],
    choices: {
      codexDefault: {
        install: "codex-plugin",
        manifest: `${links.publicBaseUrl}/plugin/install.json`
      },
      codexMcpOnly: {
        when: "用户明确说明只安装 MCP",
        install: "remote-mcp",
        manifest: `${links.publicBaseUrl}/mcp/install.json`
      },
      otherClients: {
        clients: ["Claude Code", "TRAE Work", "WorkBuddy", "其他 AI 客户端"],
        install: "remote-mcp",
        clientSpecificPluginAvailable: false,
        futurePluginRule: "仅当本安装清单明确提供当前客户端的专用神笔马良插件包时，才安装该客户端插件",
        manifest: `${links.publicBaseUrl}/mcp/install.json`,
        forbidden: "不得把 Codex 插件包安装到其他客户端"
      }
    },
    completion: "按选定分支完成 OAuth 并验证马良图片工具；不得同时重复安装插件内 MCP 和全局 MCP。"
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pageShell(input: {
  eyebrow: string;
  title: string;
  description: string;
  copyText: string;
  manifest: unknown;
  manualMcpConfig?: unknown;
  alternateHref: string;
  kind: "install" | "mcp" | "plugin";
  version?: string;
  sections: string;
}) {
  const manifestJson = JSON.stringify(input.manifest, null, 2).replaceAll("</", "<\\/");
  const manualMcpJson = input.manualMcpConfig === undefined
    ? ""
    : JSON.stringify(input.manualMcpConfig, null, 2);
  const manualMcpSection = manualMcpJson
    ? `<section class="card wide manual-mcp" aria-labelledby="manual-mcp-title"><h2 id="manual-mcp-title">手动添加 MCP Server</h2><p>客户端支持 JSON 配置时，复制下面的内容并粘贴。</p><div class="manual-config"><div class="manual-config-toolbar"><span>MCP Servers JSON</span><button class="manual-copybutton" type="button" data-copy-mcp data-copy-target="manual-mcp-config">复制 JSON</button></div><pre id="manual-mcp-config">${escapeHtml(manualMcpJson)}</pre></div></section>`
    : "";
  const navLink = input.kind === "install" ? "" : '<a href="/install">安装入口</a>';
  const nav = input.kind === "install"
    ? ""
    : `<nav class="nav"><div class="brand"><img src="/image/logo-small.webp" alt=""><span>神笔马良</span></div><div class="navlinks">${navLink}</div></nav>`;
  const eyebrow = input.kind === "install" ? "" : `<span class="eyebrow">${escapeHtml(input.eyebrow)}</span>`;
  const titleLogo = input.kind === "install" ? '<img class="title-logo" src="/image/logo-small.webp" alt="">' : "";
  const versionBadge = input.version ? `<span class="version-badge">v${escapeHtml(input.version)}</span>` : "";
  const protocolPermission = input.kind === "install"
    ? "允许 AI 根据当前客户端安装对应配置"
    : input.kind === "mcp"
      ? "允许 AI 写入当前客户端的 MCP 配置"
      : "允许 AI 下载并写入 Codex 插件文件";
  const protocolFinish = input.kind === "plugin"
    ? "安装完成后，按提示重启 Codex 或新建任务"
    : "安装完成后，按提示重启当前 AI 客户端或新建任务";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)} · 神笔马良</title>
<link rel="icon" type="image/webp" href="/image/logo-small.webp">
<link rel="alternate" type="application/json" href="${escapeHtml(input.alternateHref)}">
<style>
:root{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#292620;background:#faf9f6}*{box-sizing:border-box}body{--install-card-color:#a66b08;margin:0;min-height:100vh;background:#faf9f6}body.is-mcp{--install-card-color:#6d5dfb}.wrap{width:min(1040px,calc(100% - 40px));min-height:100vh;display:flex;flex-direction:column;margin:0 auto}.nav{height:68px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:750}.brand img{width:32px;height:32px;border-radius:9px;object-fit:cover}.navlinks{display:flex;gap:18px}.nav a{color:#6f685c;text-decoration:none;font-size:13px}.nav a:hover{color:#292620}.hero{position:relative;min-height:290px;display:flex;align-items:center;isolation:isolate;overflow:hidden;margin:26px 0 16px;padding:34px;border:1px solid #e6cfaa;border-radius:20px;background:#fff5df;box-shadow:0 16px 42px rgba(166,107,8,.1)}.hero::after{content:"";position:absolute;z-index:1;inset:0;pointer-events:none;background:linear-gradient(90deg,#fffaf0 0%,rgba(255,250,240,.97) 45%,rgba(255,250,240,.72) 66%,rgba(255,250,240,.08) 100%)}.hero-art{position:absolute;z-index:0;inset:0;width:100%;height:100%;object-fit:cover;object-position:right bottom;pointer-events:none}.hero-content{position:relative;z-index:2;width:min(680px,100%)}.eyebrow{display:block;color:color-mix(in srgb,var(--install-card-color) 88%,#292620);font-size:12px;font-weight:750;letter-spacing:.06em}.hero h1{margin:9px 0 8px;font-size:clamp(28px,4vw,36px);line-height:1.2;letter-spacing:-.025em}.hero-content>p{max-width:660px;margin:0;color:#6f685c;font-size:15px;line-height:1.65}.copybox{margin-top:20px;padding:12px;border:1px solid color-mix(in srgb,var(--install-card-color) 20%,#e4e7ec);border-radius:12px;background:rgba(255,255,255,.88)}.copylabel{margin-bottom:7px;color:#756b5c;font-size:12px;font-weight:700}.copyrow{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;gap:8px}.copytext{display:flex;align-items:center;min-height:40px;padding:8px 11px;border-radius:8px;background:rgba(247,244,237,.96);color:#292620;font:650 13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}.copybutton{min-width:72px;border:0;border-radius:8px;padding:0 15px;color:#fff;background:color-mix(in srgb,var(--install-card-color) 88%,#4338ca);font:inherit;font-size:13px;font-weight:700;cursor:pointer}.copybutton:hover{filter:brightness(.92)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:0 0 42px}.card{position:relative;display:grid;align-content:start;min-width:0;overflow:hidden;padding:12px 14px;border:1px solid color-mix(in srgb,var(--install-card-color) 24%,#e4e7ec);border-radius:16px;background:radial-gradient(circle at 100% 0%,color-mix(in srgb,var(--install-card-color) 13%,transparent),transparent 44%),linear-gradient(145deg,#fff,color-mix(in srgb,var(--install-card-color) 4%,#fff))}.card.wide{grid-column:1/-1}.card h2{margin:0 0 8px;font-size:16px}.card p,.card li{margin-top:0;color:#6f685c;font-size:14px;line-height:1.65}.card p:last-child{margin-bottom:0}.card ul,.card ol{margin:8px 0 0;padding-left:20px}.card li+li{margin-top:4px}.protocol{grid-column:1/-1;min-width:0;overflow:hidden;padding:12px 14px;border:1px solid color-mix(in srgb,var(--install-card-color) 24%,#e4e7ec);border-radius:16px;background:radial-gradient(circle at 100% 0%,color-mix(in srgb,var(--install-card-color) 13%,transparent),transparent 44%),linear-gradient(145deg,#fff,color-mix(in srgb,var(--install-card-color) 4%,#fff));color:#6f685c;font-size:13px}.protocol summary{width:max-content;color:#4f493f;font-weight:700;cursor:pointer}.protocol p{margin:9px 0 0}.protocol a{color:#80591e}.protocol pre{max-height:360px;margin:12px 0 0;padding:16px;border:1px solid #e2d7c4;border-radius:10px;background:#f4f0e8;color:#38342d;white-space:pre-wrap;word-break:break-word;overflow:auto;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}.footer{margin-top:auto;padding:22px 0 30px;border-top:1px solid #e9e1d4;color:#8b8377;font-size:12px;text-align:center}@media(max-width:700px){.wrap{width:min(1040px,calc(100% - 28px))}.hero{min-height:0;margin-top:18px;padding:24px}.hero::after{background:linear-gradient(90deg,#fffaf0 0%,rgba(255,250,240,.96) 66%,rgba(255,250,240,.58) 100%)}.copyrow,.grid{grid-template-columns:1fr}.copybutton{min-height:40px}.protocol{grid-column:auto}}
.navlinks{gap:10px}.navlinks a{min-height:38px;display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border:1px solid color-mix(in srgb,var(--install-card-color) 24%,#e4e7ec);border-radius:11px;color:color-mix(in srgb,var(--install-card-color) 82%,#292620);background:linear-gradient(145deg,#fff,color-mix(in srgb,var(--install-card-color) 5%,#fff));box-shadow:0 6px 16px color-mix(in srgb,var(--install-card-color) 10%,transparent);text-decoration:none;font-size:13px;font-weight:700;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.navlinks a:hover,.navlinks a:focus-visible{transform:translateY(-1px);border-color:color-mix(in srgb,var(--install-card-color) 42%,#e4e7ec);color:color-mix(in srgb,var(--install-card-color) 88%,#292620);box-shadow:0 9px 20px color-mix(in srgb,var(--install-card-color) 15%,transparent);outline:none}.title-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:9px 0 8px}.hero .title-row h1{margin:0}.title-logo{width:42px;height:42px;flex:0 0 42px;border-radius:11px;object-fit:cover}.is-install .hero{margin-top:26px}.is-install .title-row{margin-top:0}.version-badge{display:inline-flex;align-items:center;min-height:26px;padding:4px 9px;border:1px solid color-mix(in srgb,var(--install-card-color) 25%,#e4e7ec);border-radius:999px;color:color-mix(in srgb,var(--install-card-color) 88%,#292620);background:color-mix(in srgb,var(--install-card-color) 8%,#fff);font:700 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace}.protocol{padding:0;cursor:pointer}.protocol summary{width:100%;min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 14px;color:#4f493f;list-style:none;cursor:pointer}.protocol summary::-webkit-details-marker{display:none}.protocol summary::after{content:"›";flex:0 0 auto;color:color-mix(in srgb,var(--install-card-color) 78%,#6f685c);font-size:22px;line-height:1;transform:rotate(90deg);transition:transform .18s ease}.protocol[open] summary::after{transform:rotate(-90deg)}.protocol-summary-copy{min-width:0;display:grid;gap:2px}.protocol-summary-copy strong{font-size:13px}.protocol-summary-copy small{color:#82796c;font-size:12px;font-weight:500}.protocol-body{padding:12px 14px 14px;border-top:1px solid color-mix(in srgb,var(--install-card-color) 13%,#e4e7ec);cursor:default}.protocol-body p,.protocol-body li{color:#6f685c;font-size:13px;line-height:1.65}.protocol-body p{margin:0}.protocol-body ol{margin:8px 0 0;padding-left:20px}.protocol-body li+li{margin-top:3px}.protocol-body .protocol-help{margin-top:10px;color:#82796c}.protocol-body a{color:color-mix(in srgb,var(--install-card-color) 82%,#4f493f);font-weight:650;text-decoration:none}.protocol-body a:hover{text-decoration:underline}@media(max-width:700px){.navlinks a{min-height:36px;padding:7px 11px}.title-row{align-items:flex-start;gap:8px}.is-install .title-row{align-items:center}.title-logo{width:36px;height:36px;flex-basis:36px}.version-badge{margin-top:4px}.protocol summary{align-items:flex-start}}
</style>
<style>
:root{--install-bg:#f5f4ed;--install-surface:#faf9f5;--install-surface-soft:#f7f5ee;--install-text:#2b211c;--install-muted:rgba(79,64,54,.72);--install-border:rgba(96,76,64,.18);--install-border-strong:rgba(120,94,78,.34);--install-primary:#c96442;--install-primary-hover:#b85536;--install-primary-text:#fffaf4;--install-shadow:rgba(67,52,43,.14);color:var(--install-text);background:var(--install-bg);color-scheme:light}
body,body.is-mcp{--install-card-color:var(--install-primary);color:var(--install-text);background:var(--install-bg)}
.brand,.nav a,.hero h1,.card h2{color:var(--install-text)}
.nav a:hover{color:var(--install-primary)}
.hero{border-color:color-mix(in srgb,var(--install-primary) 24%,var(--install-border));background:color-mix(in srgb,var(--install-primary) 7%,var(--install-surface));box-shadow:0 16px 42px color-mix(in srgb,var(--install-primary) 11%,transparent)}
.hero::after{background:linear-gradient(90deg,var(--install-surface) 0%,color-mix(in srgb,var(--install-surface) 96%,transparent) 46%,color-mix(in srgb,var(--install-surface) 74%,transparent) 68%,transparent 100%)}
.hero-content>p,.copylabel,.card p,.card li,.protocol,.protocol-body p,.protocol-body li,.protocol-body .protocol-help,.protocol-summary-copy small,.footer{color:var(--install-muted)}
.copybox{border-color:color-mix(in srgb,var(--install-primary) 22%,var(--install-border));background:color-mix(in srgb,var(--install-surface) 92%,transparent)}
.copytext{color:var(--install-text);background:var(--install-surface-soft)}
.copybutton{color:var(--install-primary-text);background:var(--install-primary)}
.copybutton:hover{background:var(--install-primary-hover);filter:none}
.card,.protocol{border-color:color-mix(in srgb,var(--install-primary) 24%,var(--install-border));background:radial-gradient(circle at 100% 0%,color-mix(in srgb,var(--install-primary) 11%,transparent),transparent 44%),linear-gradient(145deg,var(--install-surface),color-mix(in srgb,var(--install-primary) 4%,var(--install-surface)))}
.navlinks a{border-color:color-mix(in srgb,var(--install-primary) 24%,var(--install-border));color:var(--install-primary);background:var(--install-surface);box-shadow:0 6px 16px color-mix(in srgb,var(--install-primary) 10%,transparent)}
.navlinks a:hover,.navlinks a:focus-visible{border-color:color-mix(in srgb,var(--install-primary) 42%,var(--install-border));color:var(--install-primary-hover);box-shadow:0 9px 20px color-mix(in srgb,var(--install-primary) 15%,transparent)}
.version-badge{border-color:color-mix(in srgb,var(--install-primary) 25%,var(--install-border));color:var(--install-primary);background:color-mix(in srgb,var(--install-primary) 8%,var(--install-surface))}
.protocol summary{color:var(--install-text)}
.protocol-body{border-color:color-mix(in srgb,var(--install-primary) 13%,var(--install-border))}
.protocol-body a{color:var(--install-primary)}
.footer{border-color:var(--install-border)}
.manual-mcp{gap:0;padding:18px 20px}.manual-mcp>h2{margin:0;font-size:19px}.manual-mcp>p{margin:12px 0 0}.manual-config{min-width:0;margin-top:14px;overflow:hidden;border:1px solid var(--install-border);border-radius:12px;background:#272522}.manual-config-toolbar{min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px 8px 14px;border-bottom:1px solid rgba(255,255,255,.09);color:rgba(255,255,255,.7);font-size:12px;font-weight:700}.manual-copybutton{min-height:30px;border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:5px 11px;color:#fff;background:rgba(255,255,255,.08);font:inherit;font-size:12px;font-weight:750;cursor:pointer}.manual-copybutton:hover,.manual-copybutton:focus-visible{background:rgba(255,255,255,.15);outline:none}.manual-config pre{max-height:300px;margin:0;padding:16px;color:#f4eee8;background:transparent;white-space:pre;overflow:auto;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}
@media(max-width:700px){.hero::after{background:linear-gradient(90deg,var(--install-surface) 0%,color-mix(in srgb,var(--install-surface) 94%,transparent) 66%,color-mix(in srgb,var(--install-surface) 58%,transparent) 100%)}.manual-mcp{padding:16px}.manual-config-toolbar{align-items:center}.manual-copybutton{min-height:34px}.manual-config pre{padding:14px;font-size:12px}}
</style></head><body class="is-${input.kind}"><div class="wrap">${nav}
<header class="hero"><img class="hero-art" src="/image/help/maliang-help-hero-v2.webp" alt="" aria-hidden="true"><div class="hero-content">${eyebrow}<div class="title-row">${titleLogo}<h1>${escapeHtml(input.title)}</h1>${versionBadge}</div><p>${escapeHtml(input.description)}</p><div class="copybox"><div class="copylabel">安装指令</div><div class="copyrow"><div class="copytext" id="install-copy-text">${escapeHtml(input.copyText)}</div><button class="copybutton" type="button" data-copy-target="install-copy-text">复制</button></div></div></div></header>
<main class="grid">${input.sections}${manualMcpSection}<details class="protocol"><summary><span class="protocol-summary-copy"><strong>查看完整安装说明</strong><small>复制给 AI 后由当前智能体直接执行</small></span></summary><div class="protocol-body"><p>把上方安装指令复制给 AI 后，当前智能体必须继续在正在运行的客户端完成真实安装和验证，不能停在读取、解释或展示配置。安装过程中，你只需要：</p><ol><li>${protocolPermission}</li><li>在浏览器完成神笔马良登录与授权</li><li>${protocolFinish}</li></ol><p class="protocol-help">如果智能体只读取而没有执行，请把安装清单地址 <a href="${escapeHtml(input.alternateHref)}">${escapeHtml(input.alternateHref)}</a> 一并发送，并明确要求它按 execution 规则继续安装。</p></div></details><pre hidden id="ai-install-instructions">${escapeHtml(manifestJson)}</pre></main><footer class="footer">神笔马良内部安装入口 · 账号授权在浏览器中完成</footer></div><script type="application/json" id="maliang-install-manifest">${manifestJson}</script><script>async function copyPageText(text){try{await navigator.clipboard.writeText(text)}catch{const area=document.createElement("textarea");area.value=text;area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();document.execCommand("copy");area.remove()}}document.querySelectorAll("[data-copy-target]").forEach((button)=>{button.addEventListener("click",async()=>{const targetId=button.getAttribute("data-copy-target")??"";const text=document.getElementById(targetId)?.textContent??"";await copyPageText(text);const original=button.textContent??"复制";button.textContent="已复制";window.setTimeout(()=>{button.textContent=original},1600)})});</script></body></html>`;
}

export function registerInternalDistributionRoutes(app: Hono) {
  app.get("/ai-client-install/links.json", (c) => {
    noIndex(c);
    c.header("Cache-Control", "no-store");
    const links = aiClientInstallLinks(c);
    return c.json({ publicBaseUrl: links.publicBaseUrl, install: links.install });
  });

  app.get("/install/install.json", async (c) => {
    noIndex(c);
    c.header("Cache-Control", "no-store");
    try {
      return c.json(await compatibleInstallManifest(c));
    } catch {
      return c.json({ error: "安装清单暂不可用" }, 503);
    }
  });

  app.get("/install", async (c) => {
    noIndex(c);
    c.header("Link", "</install/install.json>; rel=alternate; type=application/json");
    try {
      const manifest = await compatibleInstallManifest(c);
      return c.html(pageShell({
        eyebrow: "AI 客户端安装",
        title: "安装神笔马良插件",
        description: "Codex 默认安装插件，其他客户端当前安装 MCP。",
        copyText: manifest.userInstruction,
        manifest,
        manualMcpConfig: manifest.manualRemoteMcp.config,
        alternateHref: "/install/install.json",
        kind: "install",
        sections: `<section class="card"><h2>Codex</h2><p>默认由当前智能体安装神笔马良 Codex 插件；如果你明确说明“只安装 MCP”，则只配置 MCP。</p></section><section class="card"><h2>其他 AI 客户端</h2><p>Claude Code、TRAE Work、WorkBuddy 和标准 MCP 客户端均由当前智能体直接写入并加载真实配置，不能只读取配置后停止。</p></section>`
      }));
    } catch {
      return c.html(pageShell({
        eyebrow: "AI 客户端安装",
        title: "安装清单暂不可用",
        description: "当前服务器缺少可用的插件分发模板。",
        copyText: aiClientInstallLinks(c).install.instruction,
        manifest: { error: "安装清单暂不可用" },
        alternateHref: "/install/install.json",
        kind: "install",
        sections: "<section class=\"card wide\"><h2>暂不可安装</h2><p>请管理员确认部署内容包含 Codex 插件模板。</p></section>"
      }), 503);
    }
  });

  app.get("/mcp/install.json", (c) => {
    noIndex(c);
    c.header("Cache-Control", "no-store");
    return c.json(mcpInstallManifest(c));
  });

  app.get("/mcp", (c) => {
    noIndex(c);
    c.header("Link", "</mcp/install.json>; rel=alternate; type=application/json");
    const manifest = mcpInstallManifest(c);
    return c.html(pageShell({
      eyebrow: "MCP 安装",
      title: "安装神笔马良 MCP",
      description: "仅安装 Remote MCP，不会下载或安装 Codex 插件。",
      copyText: manifest.userInstruction,
      manifest,
      manualMcpConfig: manifest.manualSetup.config,
      alternateHref: "/mcp/install.json",
      kind: "mcp",
      sections: `<section class="card"><h2>适用客户端</h2><p>Claude Code、TRAE Work、确认支持 Remote HTTP 的 WorkBuddy，以及其他标准 MCP 客户端。</p></section><section class="card"><h2>不会安装</h2><p>不会安装 Codex Marketplace、Codex Skill 或执行任何 codex plugin 命令。</p></section>`
    }));
  });

  app.get("/plugin/latest.json", async (c) => {
    noIndex(c);
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    try {
      return c.json(await pluginLatestManifest(c));
    } catch {
      return c.json({ error: "插件安装包模板不可用" }, 503);
    }
  });

  app.get("/plugin/install.json", async (c) => {
    noIndex(c);
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    try {
      return c.json(await pluginInstallManifest(c));
    } catch {
      return c.json({ error: "插件安装包模板不可用" }, 503);
    }
  });

  app.get("/plugin/download/latest", async (c) => {
    noIndex(c);
    try {
      const archive = await cachedCodexPluginArchive(maliangPublicBaseUrl(c));
      if (c.req.header("if-none-match") === archive.etag) {
        c.header("ETag", archive.etag);
        c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
        return c.body(null, 304);
      }
      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", `attachment; filename="${codexPluginArchiveName(archive.version)}"`);
      c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
      c.header("ETag", archive.etag);
      return c.body(new Uint8Array(archive.buffer));
    } catch {
      return c.json({ error: "插件安装包模板不可用" }, 404);
    }
  });

  app.get("/plugin", async (c) => {
    noIndex(c);
    c.header("Link", "</plugin/install.json>; rel=alternate; type=application/json");
    try {
      const manifest = await pluginInstallManifest(c);
      return c.html(pageShell({
        eyebrow: "CODEX 插件安装",
        title: "安装神笔马良 Codex 插件",
        description: "这是 Codex 专用插件包；其他客户端当前请通过统一入口安装 MCP。",
        copyText: manifest.userInstruction,
        manifest,
        alternateHref: "/plugin/install.json",
        kind: "plugin",
        version: manifest.version,
        sections: `<section class="card"><h2>安装内容</h2><ul><li>神笔马良 Codex 插件与使用技能</li><li>Remote MCP 配置</li><li>文生图、改图和本地图片上传流程</li></ul></section><section class="card"><h2>你需要完成</h2><ol><li>允许 AI 下载并校验内部安装包</li><li>在浏览器登录并授权神笔马良</li><li>按提示重启 Codex 或新建任务</li></ol></section>`
      }));
    } catch {
      return c.html(pageShell({
        eyebrow: "CODEX 插件安装",
        title: "插件暂不可下载",
        description: "当前服务器缺少可用的插件模板。",
        copyText: aiClientInstallLinks(c).plugin.instruction,
        manifest: { error: "插件安装包模板不可用" },
        alternateHref: "/plugin/install.json",
        kind: "plugin",
        sections: "<section class=\"card wide\"><h2>暂不可下载</h2><p>请管理员确认部署内容包含 distribution/codex-marketplace 插件模板。</p></section>"
      }), 503);
    }
  });
}
