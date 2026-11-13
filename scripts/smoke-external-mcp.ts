import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Hono } from "hono";
import { APP_COOKIE } from "../server/constants";

const workspace = path.resolve(process.cwd());
const smokeRoot = path.resolve(workspace, "tmp", `mcp-smoke-${randomUUID().replaceAll("-", "")}`);
const relativeSmokeRoot = path.relative(workspace, smokeRoot);
if (!relativeSmokeRoot || relativeSmokeRoot.startsWith("..") || path.isAbsolute(relativeSmokeRoot)) {
  throw new Error("Refusing to use a smoke-test directory outside the workspace");
}

function toolResultJson(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((item) => item.type === "text")?.text ?? "";
  const start = text.indexOf("{");
  if (start < 0) throw new Error("MCP tool result did not contain JSON text");
  return JSON.parse(text.slice(start)) as Record<string, unknown>;
}

await mkdir(smokeRoot, { recursive: true });
Bun.env.GPT_IMAGE_DATA_DIR = path.join(smokeRoot, "data");
Bun.env.GPT_IMAGE_APP_DB_PATH = ":memory:";
Bun.env.GPT_IMAGE_CONFIG_DB_PATH = ":memory:";
Bun.env.APP_PUBLIC_URL = "https://maliang-smoke.example";
Bun.env.MALIANG_PUBLIC_BASE_URL = "";

const [{ appDb, configDb }, { initAppDb, initConfigDb, seedProvider }, oauthModule, mcpModule, distributionModule] = await Promise.all([
  import("../server/db"),
  import("../server/schema"),
  import("../server/externalMcpOAuth"),
  import("../server/externalMcpServer"),
  import("../server/internalDistributionRoutes")
]);

initAppDb();
initConfigDb();
seedProvider();

const api = new Hono();
const app = new Hono();
const submittedInputs: Array<Record<string, unknown>> = [];
for (const operation of ["generate", "edit"]) {
  api.post(`/images/${operation}`, async (c) => {
    submittedInputs.push(await c.req.json() as Record<string, unknown>);
    return c.json({ sessionId: "smoke-image-session", job: { id: `smoke-${operation}-job`, status: "pending" } }, 202);
  });
}
mcpModule.registerExternalMcpProtocolRoute(api);
oauthModule.registerExternalMcpOAuthRoutes(app, api);
distributionModule.registerInternalDistributionRoutes(app);
app.route("/api", api);

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
const origin = `http://127.0.0.1:${server.port}`;
const endpoint = `${origin}/api/external-mcp/mcp`;
let client: Client | null = null;

try {
  const metadataResponse = await fetch(`${origin}/.well-known/oauth-authorization-server`);
  if (!metadataResponse.ok) throw new Error(`OAuth metadata failed: HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json() as {
    issuer?: string;
    authorization_response_iss_parameter_supported?: boolean;
  };
  if (!metadata.issuer) throw new Error("OAuth metadata did not return an issuer");
  if ("authorization_response_iss_parameter_supported" in metadata) {
    throw new Error("OAuth metadata must omit the rmcp 1.8.0-incompatible RFC 9207 support flag");
  }
  const oauthResource = `${metadata.issuer}/api/external-mcp/mcp`;

  const redirectUri = "http://127.0.0.1:43123/callback";

  const registrationResponse = await fetch(`${origin}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      application_type: "native",
      client_name: "Maliang smoke agent",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  if (registrationResponse.status !== 201) {
    throw new Error(`Dynamic registration failed: HTTP ${registrationResponse.status} ${await registrationResponse.text()}`);
  }
  const registration = await registrationResponse.json() as { application_type?: string; client_id?: string };
  const clientId = registration.client_id;
  if (!clientId) throw new Error("Dynamic registration did not return client_id");
  const registeredClient = appDb.query(
    "select application_type, device_name from oauth_clients where id = ?"
  ).get(clientId) as { application_type?: string; device_name?: string } | null;
  if (registeredClient?.application_type !== "native") throw new Error("DCR application_type was not persisted");

  const workBuddyRedirectUri = "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang/oauth/callback";
  const workBuddyRegistrationResponse = await fetch(`${origin}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      application_type: "native",
      client_name: "WorkBuddy Connector (custom-mcp:maliang)",
      redirect_uris: [workBuddyRedirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  if (workBuddyRegistrationResponse.status !== 201) {
    throw new Error(`WorkBuddy DCR failed: HTTP ${workBuddyRegistrationResponse.status} ${await workBuddyRegistrationResponse.text()}`);
  }
  const workBuddyRegistration = await workBuddyRegistrationResponse.json() as {
    application_type?: string;
    redirect_uris?: string[];
  };
  if (
    workBuddyRegistration.application_type !== "native"
    || workBuddyRegistration.redirect_uris?.[0] !== workBuddyRedirectUri
  ) throw new Error("WorkBuddy DCR did not preserve its exact native callback");

  const rejectedWorkBuddyWebResponse = await fetch(`${origin}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      application_type: "web",
      client_name: "Invalid WorkBuddy web client",
      redirect_uris: [workBuddyRedirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  const rejectedWorkBuddyWebError = await rejectedWorkBuddyWebResponse.json() as { error?: string };
  if (
    rejectedWorkBuddyWebResponse.status !== 400
    || rejectedWorkBuddyWebError.error !== "invalid_redirect_uri"
  ) throw new Error("WorkBuddy private callbacks were not restricted to native clients");

  const oversizedTokenResponse = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `padding=${"x".repeat(17 * 1024)}`
  });
  const oversizedTokenError = await oversizedTokenResponse.json() as { error?: string };
  if (oversizedTokenResponse.status !== 413 || oversizedTokenError.error !== "invalid_request") {
    throw new Error("OAuth token endpoint did not reject an oversized form body");
  }

  const installResponse = await fetch(`${origin}/install/install.json`);
  const installManifest = await installResponse.json() as {
    execution?: { mode?: string };
    userInstruction?: string;
  };
  const pluginResponse = await fetch(`${origin}/plugin/latest.json`);
  const pluginManifest = await pluginResponse.json() as { version?: string };
  const expectedPluginVersion = await distributionModule.readCodexPluginVersion();

  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const sessionId = randomUUID();
  appDb.transaction(() => {
    appDb.query(
      "insert into users (id, username, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?)"
    ).run("smoke-user", "smoke-user", "unused", createdAt, createdAt);
    appDb.query(
      "insert into user_auth_sessions (id, user_id, expires_at, created_at) values (?, ?, ?, ?)"
    ).run(sessionId, "smoke-user", expiresAt, createdAt);
  })();

  const verifier = randomUUID() + randomUUID();
  const state = randomUUID();
  const authorizationUrl = `${origin}/oauth/authorize`;
  const authorizationParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: oauthResource,
    scope: "profile:read images:generate"
  });
  const browserHeaders = { Cookie: `${APP_COOKIE}=${sessionId}` };
  const consentUrl = authorizationUrl.replace("127.0.0.1", "localhost");
  const loadConsent = async (params: URLSearchParams) => {
    const consent = await fetch(`${consentUrl}?${params}`, { headers: browserHeaders, redirect: "manual" });
    const requestId = (await consent.text()).match(/name="request_id" value="([^"]+)"/)?.[1];
    if (!consent.ok || !requestId) throw new Error("OAuth consent form did not load");
    return requestId;
  };
  const submitConsent = (pageUrl: string, requestId: string, decision: "allow" | "deny") => fetch(pageUrl, {
    method: "POST",
    redirect: "manual",
    headers: browserHeaders,
    body: new URLSearchParams({ request_id: requestId, decision })
  });
  const approved = await submitConsent(consentUrl, await loadConsent(authorizationParams), "allow");
  const location = approved.headers.get("Location");
  if (approved.status !== 303 || !location) throw new Error("OAuth consent did not navigate to the loopback callback");
  if (approved.headers.get("Referrer-Policy") !== "no-referrer" || approved.headers.get("Cache-Control") !== "no-store") {
    throw new Error("OAuth callback response is missing privacy headers");
  }
  const callback = new URL(location);
  const code = callback.searchParams.get("code");
  if (
    `${callback.origin}${callback.pathname}` !== redirectUri || !code
    || callback.searchParams.get("state") !== state || callback.searchParams.get("iss") !== metadata.issuer
  ) throw new Error("OAuth callback did not preserve the registered destination, state and issuer");

  const exchangeCode = (codeVerifier: string, callbackUri: string) => fetch(`${origin}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: callbackUri
    })
  });
  const requireInvalidGrant = async (response: Response) => {
    if (response.status !== 400 || (await response.json() as { error?: string }).error !== "invalid_grant") {
      throw new Error("OAuth token exchange accepted an invalid grant");
    }
  };
  await requireInvalidGrant(await exchangeCode("x".repeat(43), redirectUri));
  await requireInvalidGrant(await exchangeCode(verifier, `${redirectUri}/other`));
  const exchanged = await exchangeCode(verifier, redirectUri);
  const { access_token: token } = await exchanged.json() as { access_token?: string };
  if (!exchanged.ok || !token) throw new Error("OAuth callback code could not be exchanged for an access token");
  await requireInvalidGrant(await exchangeCode(verifier, redirectUri));

  // Different ports still share cookies for the same hostname.
  const sameHostConsent = await fetch(`${authorizationUrl}?${authorizationParams}`, { headers: browserHeaders, redirect: "manual" });
  if (sameHostConsent.status !== 400 || sameHostConsent.headers.has("Location")
    || !(await sameHostConsent.text()).includes("只更换端口无效")) {
    throw new Error("Same-host OAuth request did not explain the hostname conflict");
  }
  const pendingRequest = await loadConsent(authorizationParams);
  const blockedResponses = [
    await submitConsent(authorizationUrl, pendingRequest, "allow"),
    await submitConsent(authorizationUrl, pendingRequest, "deny")
  ];
  for (const blocked of blockedResponses) {
    if (blocked.status !== 400 || blocked.headers.has("Location") || !(await blocked.text()).includes("只更换端口无效")) {
      throw new Error("Same-host OAuth submission should stop before issuing a callback");
    }
  }
  const denied = await submitConsent(consentUrl, pendingRequest, "deny");
  const denialLocation = denied.headers.get("Location");
  const denialParams = denialLocation && new URL(denialLocation).searchParams;
  if (denied.status !== 303 || !denialParams || denialParams.get("error") !== "access_denied"
    || denialParams.get("state") !== state || denialParams.has("code")) throw new Error("OAuth cancellation did not return the expected callback");

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  });
  client = new Client({ name: "maliang-smoke-agent", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  const serverVersion = client.getServerVersion();
  const tools = await client.listTools();
  const deviceName = process.platform === "win32" ? Bun.env.COMPUTERNAME || "" : Bun.env.HOSTNAME || "";
  if (!deviceName) throw new Error("Could not resolve the real device hostname for the smoke test");
  const placeholderReport = await client.callTool({
    name: "maliang_report_device",
    arguments: { deviceName: "__ACTUAL_DEVICE_HOSTNAME__", deviceType: "Windows" }
  });
  if (!placeholderReport.isError) throw new Error("Device reporting accepted a template placeholder");
  const report = await client.callTool({
    name: "maliang_report_device",
    arguments: { deviceName, deviceType: process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux" }
  });
  const account = await client.callTool({ name: "maliang_account_status", arguments: {} });
  const reportData = toolResultJson(report) as { reported?: boolean; deviceName?: string };
  const accountData = toolResultJson(account) as { authenticated?: boolean; user?: { username?: string } };
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  const requiredTools = [
    "maliang_account_status",
    "maliang_create_image_upload",
    "maliang_edit_image",
    "maliang_generate_image",
    "maliang_get_image_job",
    "maliang_get_image_upload",
    "maliang_report_device"
  ];
  if (JSON.stringify(toolNames) !== JSON.stringify(requiredTools)) throw new Error("MCP tool discovery did not match requiredTools");
  if (!reportData?.reported || reportData.deviceName !== deviceName) throw new Error("Device reporting did not persist the real hostname");
  if (!accountData?.authenticated || accountData.user?.username !== "smoke-user") throw new Error("Account status did not resolve the OAuth principal");
  if (registration.application_type !== "native") throw new Error("DCR application_type was not returned");
  if (installManifest.userInstruction !== `访问 ${metadata.issuer}/install，安装神笔马良。`) throw new Error("User installation instruction changed unexpectedly");
  if (installManifest.execution?.mode !== "execute-installation") throw new Error("Agent execution policy is missing");
  if (pluginManifest.version !== expectedPluginVersion) throw new Error("Plugin manifest version does not match plugin.json");
  if (serverVersion?.version !== pluginManifest.version) throw new Error("MCP server version did not match the plugin version source");

  const generated = await client.callTool({ name: "maliang_generate_image", arguments: { prompt: "fixture legacy channel default" } });
  const edited = await client.callTool({ name: "maliang_edit_image", arguments: { prompt: "fixture legacy edit default", imageIds: ["smoke-source-image"] } });
  if (generated.isError || edited.isError || submittedInputs.length !== 2 || submittedInputs.some(input => Object.hasOwn(input, "model"))) {
    throw new Error("Omitted generation/edit model did not preserve the legacy channel default");
  }
  const explicit = await client.callTool({ name: "maliang_generate_image", arguments: { prompt: "fixture explicit model", model: "gpt-image-2.5-sunburst" } });
  if (explicit.isError || submittedInputs.at(-1)?.model !== "gpt-image-2.5-sunburst") throw new Error("An explicit image model was changed");
  configDb.query("update provider_configs set enabled = 1, base_url = 'https://api.openai.com/v1', route_mode = 'images_api' where channel = 'api'").run();
  const compatible = await client.callTool({ name: "maliang_generate_image", arguments: { prompt: "fixture compatible model default" } });
  if (compatible.isError || submittedInputs.at(-1)?.model !== "gpt-image-2.6-sunburst") throw new Error("A compatible channel did not retain the 2.6 Sunburst default");

  console.log(JSON.stringify({
    issuer: metadata.issuer,
    applicationType: registration.application_type,
    workBuddyPrivateCallbackAccepted: workBuddyRegistration.redirect_uris?.[0] === workBuddyRedirectUri,
    workBuddyWebCallbackRejected: rejectedWorkBuddyWebResponse.status === 400,
    loopbackAuthorizationRedirectVerified: true,
    sameHostLoopbackBlocked: true,
    issuerResponseMetadataOmitted: !("authorization_response_iss_parameter_supported" in metadata),
    oversizedTokenBodyRejected: oversizedTokenResponse.status === 413,
    placeholderDeviceRejected: placeholderReport.isError,
    installInstruction: installManifest.userInstruction,
    pluginVersion: pluginManifest.version,
    serverVersion: serverVersion?.version,
    legacyGenerationUsesChannelDefault: true,
    legacyEditUsesChannelDefault: true,
    explicitModelPreserved: true,
    compatibleChannelPrefers26: true,
    tools: toolNames,
    deviceReported: reportData.reported,
    deviceName: reportData.deviceName,
    authenticated: accountData.authenticated,
    account: accountData.user?.username
  }, null, 2));
} finally {
  await client?.close().catch(() => undefined);
  server.stop(true);
  appDb.close();
  configDb.close();
  const cleanupRelative = path.relative(workspace, smokeRoot);
  if (cleanupRelative && !cleanupRelative.startsWith("..") && !path.isAbsolute(cleanupRelative)) {
    await rm(smokeRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
