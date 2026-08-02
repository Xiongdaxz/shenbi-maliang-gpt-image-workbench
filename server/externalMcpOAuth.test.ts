import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  externalMcpLogicalDeviceId,
  externalMcpClientNeedsDeviceReport,
  isGenericOrPlaceholderExternalMcpDeviceName,
  normalizeExternalMcpDeviceName,
  normalizeExternalMcpDeviceType,
  normalizeExternalMcpClientFamily,
  normalizeUsableExternalMcpDeviceName,
  recordExternalMcpGrantAccess,
  updateExternalMcpClientDevice
} from "./externalMcpAuth";
import {
  classifyExternalMcpRedirectUri,
  cleanupExpiredExternalMcpTokens,
  cleanupOrphanedExternalMcpClients,
  cleanupExpiredIncompleteExternalMcpGrants,
  ExternalMcpRegistrationLimiter,
  externalMcpAuthorizationCodeRedirectUriMatches,
  externalMcpAuthorizationErrorPage,
  externalMcpAuthorizationCallbackMode,
  externalMcpAuthorizationPage,
  externalMcpAuthorizationPageCsp,
  externalMcpAuthorizationRedirectUrl,
  externalMcpAuthorizationSuccessPage,
  externalMcpAuthorizationSuccessPageCsp,
  externalMcpAuthorizationResponseParams,
  externalMcpAuthorizationServerMetadata,
  externalMcpClientSupportsGrant,
  externalMcpConnectionDeviceId,
  enrichExternalMcpAccessLocation,
  getExternalMcpAuthorizationStatus,
  getExternalMcpConnectionRows,
  groupExternalMcpConnectionRows,
  hasCompletedExternalMcpGrant,
  inferExternalMcpDeviceName,
  inferExternalMcpDeviceType,
  inferExternalMcpSoftwareVersion,
  invalidateExternalMcpCredentialsForReauthorization,
  isExternalMcpRedirectUriAllowed,
  isExternalMcpLocalDevice,
  normalizeExternalMcpGrantTypes,
  OAUTH_BROWSER_REDIRECT_STATUS,
  readExternalMcpFormBody,
  readExternalMcpRegistrationBody,
  recordExternalMcpRefreshFailure,
  recordExternalMcpRefreshSuccess,
  removeExternalMcpGrant,
  resolveExternalMcpDeviceName,
  resolveExternalMcpRegistrationDeviceMetadata,
  resolveExternalMcpDeviceType,
  externalMcpRedirectUriDisplay,
  restoreExternalMcpGrant,
  revokeExternalMcpGrant,
  upsertExternalMcpGrantForAuthorization,
  updateExternalMcpGrantLabel
} from "./externalMcpOAuth";

function createConnectionTestDb() {
  const db = new Database(":memory:");
  db.exec("pragma foreign_keys = on");
  db.exec(`
    create table oauth_clients (
      id text primary key,
      application_type text not null default 'native',
      client_name text not null default '',
      client_uri text not null default '',
      software_id text not null default '',
      software_version text not null default '',
      device_name text not null default '',
      device_type text not null default '',
      user_agent text not null default '',
      grant_types_json text not null default '["authorization_code"]',
      created_at text not null default '',
      updated_at text not null default ''
    );
    create table oauth_authorization_requests (
      id text primary key,
      user_id text not null default '',
      client_id text not null,
      expires_at text not null default '9999-12-31T23:59:59.999',
      consumed_at text,
      foreign key (client_id) references oauth_clients(id) on delete cascade
    );
    create table oauth_grants (
      id text primary key,
      user_id text not null,
      client_id text not null,
      scope text not null default '',
      user_label text not null default '',
      last_access_at text,
      last_access_ip text not null default '',
      last_access_public_ip text not null default '',
      last_access_region text not null default '',
      last_access_geo_at text,
      last_user_agent text not null default '',
      last_refresh_at text,
      last_refresh_error text not null default '',
      last_refresh_error_at text,
      credential_version integer not null default 1,
      revoked_at text,
      created_at text not null default '',
      updated_at text not null,
      unique (user_id, client_id),
      foreign key (client_id) references oauth_clients(id) on delete cascade
    );
    create table oauth_access_tokens (
      id text primary key,
      family_id text not null default '',
      grant_id text not null,
      expires_at text not null default '9999-12-31T23:59:59.999',
      revoked_at text,
      foreign key (grant_id) references oauth_grants(id) on delete cascade
    );
    create table oauth_refresh_tokens (
      id text primary key,
      family_id text not null default '',
      parent_token_id text,
      grant_id text not null,
      expires_at text not null default '9999-12-31T23:59:59.999',
      consumed_at text,
      revoked_at text,
      foreign key (parent_token_id) references oauth_refresh_tokens(id),
      foreign key (grant_id) references oauth_grants(id) on delete cascade
    );
    create table oauth_authorization_codes (
      id text primary key,
      request_id text,
      grant_id text not null,
      expires_at text not null,
      consumed_at text,
      created_at text not null default '',
      foreign key (request_id) references oauth_authorization_requests(id) on delete cascade,
      foreign key (grant_id) references oauth_grants(id) on delete cascade
    );
  `);
  return db;
}

describe("external MCP authorization page", () => {
  test("executes the dynamically registered grant capabilities", () => {
    expect(normalizeExternalMcpGrantTypes(undefined)).toEqual(["authorization_code"]);
    expect(normalizeExternalMcpGrantTypes(["authorization_code", "refresh_token"]))
      .toEqual(["authorization_code", "refresh_token"]);
    expect(externalMcpClientSupportsGrant('["authorization_code"]', "authorization_code")).toBe(true);
    expect(externalMcpClientSupportsGrant('["authorization_code"]', "refresh_token")).toBe(false);
    expect(externalMcpClientSupportsGrant('["refresh_token"]', "authorization_code")).toBe(false);
  });

  test("clears a stale server-egress IP while retaining the actual private transport IP", async () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query(`insert into oauth_grants (
        id, user_id, client_id, last_access_public_ip, last_access_region, last_access_geo_at, updated_at
      ) values (
        'grant-1', 'user-1', 'client-1', '1.2.3.4', '服务器出口地区', '2026-07-29T10:00:00.000', 'now'
      )`).run();

      const location = await enrichExternalMcpAccessLocation(db, "user-1", {
        client_id: "client-1",
        last_access_at: "2026-07-29T10:00:00.000",
        last_access_ip: "192.168.0.87",
        last_access_public_ip: "1.2.3.4",
        last_access_region: "服务器出口地区",
        last_access_geo_at: "2026-07-29T10:00:00.000"
      });

      expect(location).toEqual({ ip: "192.168.0.87", region: "", status: "private" });
      expect(db.query("select last_access_public_ip, last_access_region, last_access_geo_at from oauth_grants where id = 'grant-1'").get()).toEqual({
        last_access_public_ip: "",
        last_access_region: "",
        last_access_geo_at: null
      });
    } finally {
      db.close();
    }
  });

  test("locks the form after its first submission while preserving the decision", () => {
    const html = externalMcpAuthorizationPage({
      clientName: "Codex <test>",
      callbackOrigin: "http://127.0.0.1:57553",
      userName: "tester",
      requestId: "oauthreq_test",
      scopes: ["profile:read", "images:generate"],
      scriptNonce: "nonce_test"
    });

    expect(html).toContain("Codex &lt;test&gt;");
    expect(html).toContain("动态注册的未验证智能体");
    expect(html).toContain("http://127.0.0.1:57553");
    expect(html).toContain("data-oauth-authorize-form");
    expect(html).toContain("data-oauth-submit-status");
    expect(html).toContain("if (submitted)");
    expect(html).toContain("event.preventDefault()");
    expect(html).toContain("decision.name = submitter.name");
    expect(html).toContain("decision.value = submitter.value");
    expect(html).toContain("button.disabled = true");
    expect(html).toContain("正在完成授权，请勿重复点击、刷新或返回");
    expect(html).toContain('script nonce="nonce_test"');
    expect(html).toContain('src="/image/logo-small.webp"');
    expect(html).toContain('<link rel="icon" type="image/webp" href="/image/logo-small.webp" />');
    expect(html).toContain("读取账号信息");
    expect(html).toContain("使用图片生成与编辑");
    expect(html).toContain('class="permission-icon"');
    expect(html).toContain('<svg viewBox="0 0 24 24">');
    expect(html).not.toContain('<span class="check">✓</span>');
    expect(html).not.toContain("profile:read");
    expect(html).not.toContain("images:generate");
    expect(html).toContain("设置 &gt; 插件");
    expect(html).not.toContain("帮助中心撤销");
  });

  test("allows only the nonce-bearing inline script", () => {
    expect(externalMcpAuthorizationPageCsp("nonce_test", "http://127.0.0.1:57553/callback/test")).toBe(
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-nonce_test'; form-action 'self' http://127.0.0.1:57553; frame-ancestors 'none'; base-uri 'none'"
    );
  });

  test("accepts only WorkBuddy's exact native callback shape", () => {
    const callback = "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang/oauth/callback";
    expect(classifyExternalMcpRedirectUri(callback)).toBe("workbuddy");
    expect(isExternalMcpRedirectUriAllowed(callback, "native")).toBe(true);
    expect(isExternalMcpRedirectUriAllowed(
      "workbuddy://workbuddy/mcp/connector%3Amaliang/oauth/callback",
      "native"
    )).toBe(true);
    expect(isExternalMcpRedirectUriAllowed(
      "workbuddy://workbuddy/mcp/custom-mcp:maliang/oauth/callback",
      "native"
    )).toBe(true);
    expect(isExternalMcpRedirectUriAllowed(callback, "web")).toBe(false);
  });

  test("requires the token exchange to reuse the exact authorized WorkBuddy callback", () => {
    const workBuddyCallback = "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang/oauth/callback";
    expect(externalMcpAuthorizationCodeRedirectUriMatches(workBuddyCallback, workBuddyCallback)).toBe(true);
    expect(externalMcpAuthorizationCodeRedirectUriMatches(
      workBuddyCallback,
      "http://127.0.0.1:62040/oauth/callback"
    )).toBe(false);
    expect(externalMcpAuthorizationCodeRedirectUriMatches(
      workBuddyCallback,
      "workbuddy://workbuddy/mcp/custom-mcp:maliang/oauth/callback"
    )).toBe(false);
  });

  test("rejects private schemes and malformed WorkBuddy callback variants", () => {
    const rejected = [
      "electron://workbuddy/mcp/custom-mcp%3Amaliang/oauth/callback",
      "workbuddy://another-host/mcp/custom-mcp%3Amaliang/oauth/callback",
      "workbuddy://user@workbuddy/mcp/custom-mcp%3Amaliang/oauth/callback",
      "workbuddy://workbuddy:443/mcp/custom-mcp%3Amaliang/oauth/callback",
      "workbuddy://workbuddy/mcp/maliang/oauth/callback",
      "workbuddy://workbuddy/mcp/custom-mcp%3A/oauth/callback",
      "workbuddy://workbuddy/mcp/custom-mcp%3A.maliang/oauth/callback",
      "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang%2Fother/oauth/callback",
      "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang/other/callback",
      "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang/oauth/callback?source=test",
      "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang/oauth/callback#fragment",
      "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang\\oauth\\callback"
    ];
    for (const callback of rejected) {
      expect(isExternalMcpRedirectUriAllowed(callback, "native")).toBe(false);
    }
  });

  test("keeps standard HTTPS and native loopback callbacks compatible", () => {
    expect(classifyExternalMcpRedirectUri("https://agent.example/oauth/callback")).toBe("https");
    expect(classifyExternalMcpRedirectUri("http://127.0.0.1:57553/oauth/callback")).toBe("loopback");
    expect(classifyExternalMcpRedirectUri("http://[::1]:57553/oauth/callback")).toBe("loopback");
    expect(isExternalMcpRedirectUriAllowed("https://agent.example/oauth/callback", "web")).toBe(true);
    expect(isExternalMcpRedirectUriAllowed("http://localhost:57553/oauth/callback", "web")).toBe(false);
    expect(isExternalMcpRedirectUriAllowed("http://192.168.0.2/oauth/callback", "native")).toBe(false);
  });

  test("uses a WorkBuddy scheme CSP source and a readable callback identity", () => {
    const callback = "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang/oauth/callback";
    expect(externalMcpAuthorizationPageCsp("nonce_test", callback)).toBe(
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-nonce_test'; form-action 'self' workbuddy:; frame-ancestors 'none'; base-uri 'none'"
    );
    expect(externalMcpAuthorizationSuccessPageCsp("nonce_test", callback)).toContain("connect-src 'self' workbuddy:");
    expect(externalMcpAuthorizationPageCsp("nonce_test", callback)).not.toContain("null");
    expect(externalMcpRedirectUriDisplay(callback)).toBe("workbuddy://workbuddy");
  });

  test("renders a branded success confirmation with a return action while returning the OAuth callback in the background", () => {
    const html = externalMcpAuthorizationSuccessPage({
      callbackUrl: "http://127.0.0.1:57553/callback/test?code=code_test&state=state_test",
      clientName: "Codex <test>",
      scriptNonce: "success_nonce",
      statusUrl: "/oauth/authorize/status?request_id=oauthreq_test"
    });

    expect(html).toContain("正在完成授权");
    expect(html).toContain("授权成功");
    expect(html).toContain('src="/image/logo-small.webp"');
    expect(html).toContain('<link rel="icon" type="image/webp" href="/image/logo-small.webp" />');
    expect(html).toContain('data-success-card');
    expect(html).toContain('data-callback-url="http://127.0.0.1:57553/callback/test?code=code_test&amp;state=state_test"');
    expect(html).toContain('data-status-url="/oauth/authorize/status?request_id=oauthreq_test"');
    expect(html).toContain('script nonce="success_nonce"');
    expect(html).toContain("fetch(callbackUrl");
    expect(html).toContain('mode: "no-cors"');
    expect(html).toContain("fetch(statusUrl");
    expect(html).toContain('result.status === "succeeded"');
    expect(html).not.toContain(".then(complete");
    expect(html).not.toContain("Codex &lt;test&gt;");
    expect(html).not.toContain("连接已安全建立");
    expect(html).toContain('href="/" data-success-action hidden>返回神笔马良</a>');
    expect(html).toContain("action.hidden = false");
    expect(html).not.toContain("连接完成");
    expect(html).not.toContain("Authorization successful");
    expect(html).not.toContain("请返回 Codex");
  });

  test("uses the Maliang logo and favicon on authorization error pages", () => {
    const html = externalMcpAuthorizationErrorPage("请求 <test> 已失效");

    expect(html).toContain('<link rel="icon" type="image/webp" href="/image/logo-small.webp">');
    expect(html).toContain('<img src="/image/logo-small.webp" alt="">');
    expect(html).toContain("请求 &lt;test&gt; 已失效");
    expect(html).toContain('href="/mcp">返回安装说明</a>');
  });

  test("limits the success page callback connection to the registered loopback origin", () => {
    expect(externalMcpAuthorizationSuccessPageCsp("success_nonce", "http://127.0.0.1:57553/callback/test")).toBe(
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-success_nonce'; connect-src 'self' http://127.0.0.1:57553; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
    );
  });

  test("uses See Other for denied OAuth callback redirects", () => {
    expect(OAUTH_BROWSER_REDIRECT_STATUS).toBe(303);
  });

  test("adds the RFC 9207 issuer without advertising the rmcp 1.8.0-incompatible metadata flag", () => {
    expect(externalMcpAuthorizationResponseParams("https://maliang.example", {
      code: "code_test",
      state: "state_test"
    })).toEqual({
      code: "code_test",
      state: "state_test",
      iss: "https://maliang.example"
    });
    expect(externalMcpAuthorizationResponseParams("https://maliang.example", {
      error: "access_denied"
    })).toEqual({
      error: "access_denied",
      iss: "https://maliang.example"
    });
    const metadata = externalMcpAuthorizationServerMetadata("https://maliang.example");
    expect(metadata.issuer).toBe("https://maliang.example");
    expect(metadata).not.toHaveProperty("authorization_response_iss_parameter_supported");
  });

  test("redirects web and WorkBuddy callbacks while keeping native loopback delivery in the background", () => {
    expect(externalMcpAuthorizationCallbackMode("web")).toBe("redirect");
    expect(externalMcpAuthorizationCallbackMode(" WEB ")).toBe("redirect");
    expect(externalMcpAuthorizationCallbackMode(
      "native",
      "workbuddy://workbuddy/mcp/custom-mcp%3Amaliang/oauth/callback"
    )).toBe("redirect");
    expect(externalMcpAuthorizationCallbackMode("native", "http://127.0.0.1:57553/oauth/callback")).toBe("background");
    expect(externalMcpAuthorizationCallbackMode(" NATIVE ", "http://localhost:57553/oauth/callback")).toBe("background");
    expect(externalMcpAuthorizationCallbackMode("")).toBe("background");
  });

  test("reports authorization success only after the current code is consumed and a token exists", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-status')").run();
      db.query(`insert into oauth_authorization_requests
        (id, user_id, client_id, expires_at)
        values ('request-status', 'user-status', 'client-status', '2026-08-01T00:10:00.000')`).run();

      expect(getExternalMcpAuthorizationStatus(
        db,
        "user-status",
        "request-status",
        "2026-08-01T00:00:00.000"
      )).toBe("pending");
      expect(getExternalMcpAuthorizationStatus(db, "another-user", "request-status")).toBeNull();

      db.query(`insert into oauth_grants (id, user_id, client_id, updated_at)
        values ('grant-status', 'user-status', 'client-status', '2026-08-01T00:00:00.000')`).run();
      db.query(`insert into oauth_authorization_codes
        (id, request_id, grant_id, expires_at, created_at)
        values ('code-status', 'request-status', 'grant-status', '2026-08-01T00:05:00.000', '2026-08-01T00:00:00.000')`).run();

      expect(getExternalMcpAuthorizationStatus(
        db,
        "user-status",
        "request-status",
        "2026-08-01T00:01:00.000"
      )).toBe("pending");
      expect(getExternalMcpAuthorizationStatus(
        db,
        "user-status",
        "request-status",
        "2026-08-01T00:06:00.000"
      )).toBe("expired");

      db.query("update oauth_authorization_codes set consumed_at = '2026-08-01T00:02:00.000' where id = 'code-status'").run();
      expect(getExternalMcpAuthorizationStatus(db, "user-status", "request-status")).toBe("failed");

      db.query("insert into oauth_access_tokens (id, grant_id) values ('access-status', 'grant-status')").run();
      expect(getExternalMcpAuthorizationStatus(db, "user-status", "request-status")).toBe("succeeded");
    } finally {
      db.close();
    }
  });

  test("builds a direct loopback redirect with code, state, and RFC 9207 issuer", () => {
    const callbackUrl = new URL(externalMcpAuthorizationRedirectUrl(
      "http://127.0.0.1:57553/callback/test",
      "http://192.168.0.87:8787",
      { code: "code_test", state: "state_test" }
    ));

    expect(callbackUrl.origin).toBe("http://127.0.0.1:57553");
    expect(callbackUrl.pathname).toBe("/callback/test");
    expect(Object.fromEntries(callbackUrl.searchParams)).toEqual({
      code: "code_test",
      state: "state_test",
      iss: "http://192.168.0.87:8787"
    });
  });

  test("bounds dynamic-registration JSON bodies and per-client request bursts", async () => {
    await expect(readExternalMcpRegistrationBody(new Request("https://maliang.example/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ application_type: "native" })
    }))).resolves.toEqual({ application_type: "native" });
    await expect(readExternalMcpRegistrationBody(new Request("https://maliang.example/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(512) })
    }), 128)).rejects.toThrow("registration_body_too_large");

    const limiter = new ExternalMcpRegistrationLimiter(2, 1_000, 10);
    expect(limiter.consume("192.0.2.1", 1_000)).toBe(0);
    expect(limiter.consume("192.0.2.1", 1_001)).toBe(0);
    expect(limiter.consume("192.0.2.1", 1_002)).toBe(1);
    expect(limiter.consume("192.0.2.1", 2_000)).toBe(0);
  });

  test("bounds and validates public OAuth form bodies before parsing", async () => {
    const validBody = "grant_type=refresh_token&client_id=client-1&refresh_token=token-1";
    await expect(readExternalMcpFormBody(new Request("https://maliang.example/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: validBody
    }))).resolves.toEqual(new URLSearchParams(validBody));
    await expect(readExternalMcpFormBody(new Request("https://maliang.example/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `scope=${"x".repeat(512)}`
    }), 128)).rejects.toThrow("oauth_form_too_large");
    await expect(readExternalMcpFormBody(new Request("https://maliang.example/oauth/token", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: validBody
    }))).rejects.toThrow("oauth_form_content_type");
    await expect(readExternalMcpFormBody(new Request("https://maliang.example/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "client_id=one&client_id=two"
    }))).rejects.toThrow("oauth_form_invalid");
    await expect(readExternalMcpFormBody(new Request("https://maliang.example/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${"x".repeat(513)}`
    }))).rejects.toThrow("oauth_form_invalid");
  });

  test("keeps the device unknown until the client reports an actual hostname", () => {
    expect(inferExternalMcpDeviceName("Codex/1.2.3 (Windows NT 10.0)", "Codex")).toBe("未知设备");
    expect(inferExternalMcpDeviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "Codex")).toBe("未知设备");
    expect(inferExternalMcpDeviceName("codex_cli_rs/0.71.0", "Codex")).toBe("未知设备");
    expect(inferExternalMcpDeviceName("", "Unknown client")).toBe("未知设备");
    expect(resolveExternalMcpDeviceName("Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("未知设备");
    expect(resolveExternalMcpDeviceName("__ACTUAL_DEVICE_HOSTNAME__", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("未知设备");
    expect(resolveExternalMcpDeviceName("DESKTOP-D29ACHK", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("DESKTOP-D29ACHK");
    expect(normalizeExternalMcpDeviceName("  DESKTOP-D29ACHK  ", "fallback-host")).toBe("DESKTOP-D29ACHK");
    expect(normalizeExternalMcpDeviceName("", "studio-mac")).toBe("studio-mac");
    expect(normalizeExternalMcpDeviceName("\r\n", "")).toBe("");
    expect(normalizeUsableExternalMcpDeviceName("__ACTUAL_DEVICE_HOSTNAME__", "fallback-host")).toBe("fallback-host");
    expect(normalizeExternalMcpDeviceType("Windows_NT", "")).toBe("Windows");
    expect(normalizeExternalMcpDeviceType("", "darwin24.0")).toBe("macOS");
    expect(inferExternalMcpDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(resolveExternalMcpDeviceType("", "Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
    expect(inferExternalMcpSoftwareVersion("codex_cli_rs/0.71.0", "Codex")).toBe("0.71.0");
    expect(isExternalMcpLocalDevice("DESKTOP-D29ACHK", ["desktop-d29achk", "fallback-host"])).toBe(true);
    expect(isExternalMcpLocalDevice("未知设备", ["DESKTOP-D29ACHK"])).toBe(false);
    expect(isExternalMcpLocalDevice("OTHER-PC", ["DESKTOP-D29ACHK"])).toBe(false);
    expect(isGenericOrPlaceholderExternalMcpDeviceName("{{device_hostname}}")).toBe(true);
    expect(isGenericOrPlaceholderExternalMcpDeviceName("WORKSTATION-42")).toBe(false);
  });

  test("captures installer-reported device headers during dynamic registration", () => {
    expect(resolveExternalMcpRegistrationDeviceMetadata({
      clientName: "trae-mcp-maliang",
      userAgent: "Python-urllib/3.10",
      requestDeviceName: "TRAE-WORKSTATION",
      requestDeviceType: "Windows"
    })).toEqual({
      deviceName: "TRAE-WORKSTATION",
      deviceType: "Windows"
    });

    expect(resolveExternalMcpRegistrationDeviceMetadata({
      clientName: "trae-mcp-maliang",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      deviceName: "studio-mac",
      requestDeviceName: "fallback-host"
    })).toEqual({
      deviceName: "studio-mac",
      deviceType: "macOS"
    });

    expect(resolveExternalMcpRegistrationDeviceMetadata({
      clientName: "trae-mcp-maliang",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      deviceName: "__ACTUAL_DEVICE_HOSTNAME__",
      requestDeviceName: "TRAE-WORKSTATION"
    })).toEqual({
      deviceName: "TRAE-WORKSTATION",
      deviceType: "Windows"
    });
  });

  test("records token or MCP access metadata immediately", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'before')").run();

      recordExternalMcpGrantAccess(db, {
        grantId: "grant-1",
        clientId: "client-1",
        accessIp: "192.168.0.87",
        accessUserAgent: "codex-mcp-client/0.146.0",
        deviceName: "DESKTOP-D29ACHK",
        deviceType: "Windows",
        timestamp: "2026-07-29T11:34:40.142"
      });

      expect(db.query("select last_access_at, last_access_ip, last_user_agent from oauth_grants where id = 'grant-1'").get()).toEqual({
        last_access_at: "2026-07-29T11:34:40.142",
        last_access_ip: "192.168.0.87",
        last_user_agent: "codex-mcp-client/0.146.0"
      });
      expect(db.query("select device_name, device_type, updated_at from oauth_clients where id = 'client-1'").get()).toEqual({
        device_name: "DESKTOP-D29ACHK",
        device_type: "Windows",
        updated_at: "2026-07-29T11:34:40.142"
      });
      recordExternalMcpGrantAccess(db, {
        grantId: "grant-1",
        clientId: "client-1",
        accessIp: "192.168.0.87",
        accessUserAgent: "codex-mcp-client/0.146.0",
        deviceName: "__ACTUAL_DEVICE_HOSTNAME__",
        deviceType: "Windows",
        timestamp: "2026-07-29T11:35:00.000"
      });
      expect(db.query("select device_name from oauth_clients where id = 'client-1'").get()).toEqual({
        device_name: "DESKTOP-D29ACHK"
      });
    } finally {
      db.close();
    }
  });

  test("lets an authorized client report a real device name after OAuth", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();

      expect(updateExternalMcpClientDevice(db, {
        clientId: "client-1",
        deviceName: "WORKSTATION-42",
        deviceType: "Windows_NT",
        timestamp: "2026-07-30T10:00:00.000"
      })).toEqual({
        deviceName: "WORKSTATION-42",
        deviceType: "Windows",
        updatedAt: "2026-07-30T10:00:00.000"
      });
      expect(db.query("select device_name, device_type from oauth_clients where id = 'client-1'").get()).toEqual({
        device_name: "WORKSTATION-42",
        device_type: "Windows"
      });
      expect(updateExternalMcpClientDevice(db, {
        clientId: "client-1",
        deviceName: "Linux",
        deviceType: "Linux"
      })).toBeNull();
      expect(updateExternalMcpClientDevice(db, {
        clientId: "client-1",
        deviceName: "__ACTUAL_DEVICE_HOSTNAME__",
        deviceType: "Windows"
      })).toBeNull();
    } finally {
      db.close();
    }
  });

  test("requires one device report before ordinary authorized tool use", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      expect(externalMcpClientNeedsDeviceReport(db, "client-1")).toBe(true);

      expect(updateExternalMcpClientDevice(db, {
        clientId: "client-1",
        deviceName: "DESKTOP-D29ACHK",
        deviceType: "Windows"
      })?.deviceName).toBe("DESKTOP-D29ACHK");
      expect(externalMcpClientNeedsDeviceReport(db, "client-1")).toBe(false);
    } finally {
      db.close();
    }
  });

  test("revokes old tokens and codes when reauthorization changes scope", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, scope, updated_at) values ('grant-1', 'user-1', 'client-1', 'profile:read images:generate', 'before')").run();
      db.query("insert into oauth_access_tokens (id, grant_id) values ('access-1', 'grant-1')").run();
      db.query("insert into oauth_refresh_tokens (id, family_id, grant_id) values ('refresh-1', 'family-1', 'grant-1')").run();
      db.query("insert into oauth_authorization_codes (id, grant_id, expires_at) values ('code-1', 'grant-1', '2026-08-01T00:00:00.000')").run();

      expect(invalidateExternalMcpCredentialsForReauthorization(
        db,
        "grant-1",
        "profile:read images:generate",
        "images:generate profile:read",
        "2026-07-30T12:00:00.000"
      )).toBe(false);
      expect(db.query("select revoked_at from oauth_access_tokens where id = 'access-1'").get()).toEqual({ revoked_at: null });
      expect(db.query("select consumed_at from oauth_authorization_codes where id = 'code-1'").get()).toEqual({
        consumed_at: "2026-07-30T12:00:00.000"
      });
      db.query("insert into oauth_authorization_codes (id, grant_id, expires_at) values ('code-2', 'grant-1', '2026-08-01T00:00:00.000')").run();
      expect(invalidateExternalMcpCredentialsForReauthorization(
        db,
        "grant-1",
        "profile:read images:generate",
        "profile:read",
        "2026-07-30T12:01:00.000"
      )).toBe(true);
      expect(db.query("select revoked_at from oauth_access_tokens where id = 'access-1'").get()).toEqual({
        revoked_at: "2026-07-30T12:01:00.000"
      });
      expect(db.query("select revoked_at from oauth_refresh_tokens where id = 'refresh-1'").get()).toEqual({
        revoked_at: "2026-07-30T12:01:00.000"
      });
      expect(db.query("select consumed_at from oauth_authorization_codes where id = 'code-2'").get()).toEqual({
        consumed_at: "2026-07-30T12:01:00.000"
      });
    } finally {
      db.close();
    }
  });

  test("removes expired tokens while preserving an active refresh descendant", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'now')").run();
      db.query("insert into oauth_access_tokens (id, grant_id, expires_at) values ('access-expired', 'grant-1', '2026-07-30T09:00:00.000')").run();
      db.query("insert into oauth_access_tokens (id, grant_id, expires_at) values ('access-active', 'grant-1', '2026-07-30T11:00:00.000')").run();
      db.query("insert into oauth_refresh_tokens (id, family_id, grant_id, expires_at) values ('refresh-parent', 'family-1', 'grant-1', '2026-07-30T09:00:00.000')").run();
      db.query("insert into oauth_refresh_tokens (id, family_id, parent_token_id, grant_id, expires_at) values ('refresh-active', 'family-1', 'refresh-parent', 'grant-1', '2026-08-30T10:00:00.000')").run();
      db.query("insert into oauth_refresh_tokens (id, family_id, grant_id, expires_at) values ('refresh-expired', 'family-2', 'grant-1', '2026-07-29T09:00:00.000')").run();

      expect(cleanupExpiredExternalMcpTokens(db, "2026-07-30T10:00:00.000")).toEqual({
        accessTokens: 1,
        refreshTokens: 2
      });
      expect(db.query("select id from oauth_access_tokens order by id").all()).toEqual([{ id: "access-active" }]);
      expect(db.query("select id, parent_token_id from oauth_refresh_tokens").all()).toEqual([{
        id: "refresh-active",
        parent_token_id: null
      }]);
    } finally {
      db.close();
    }
  });

  test("removes only stale dynamically registered clients that never started authorization", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id, created_at) values ('orphan-old', '2026-07-28T09:00:00.000')").run();
      db.query("insert into oauth_clients (id, created_at) values ('orphan-new', '2026-07-30T09:00:00.000')").run();
      db.query("insert into oauth_clients (id, created_at) values ('with-request', '2026-07-28T09:00:00.000')").run();
      db.query("insert into oauth_clients (id, created_at) values ('with-grant', '2026-07-28T09:00:00.000')").run();
      db.query("insert into oauth_authorization_requests (id, client_id) values ('request-1', 'with-request')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'with-grant', 'now')").run();

      expect(cleanupOrphanedExternalMcpClients(db, "2026-07-29T09:00:00.000")).toBe(1);
      expect(db.query("select id from oauth_clients where id = 'orphan-old'").get()).toBeNull();
      expect(db.query("select id from oauth_clients where id = 'orphan-new'").get()).toEqual({ id: "orphan-new" });
      expect(db.query("select id from oauth_clients where id = 'with-request'").get()).toEqual({ id: "with-request" });
      expect(db.query("select id from oauth_clients where id = 'with-grant'").get()).toEqual({ id: "with-grant" });
    } finally {
      db.close();
    }
  });

  test("hides incomplete grants and deletes them only after their authorization code expires", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query("insert into oauth_clients (id) values ('client-2')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-pending', 'user-1', 'client-1', 'now')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-connected', 'user-1', 'client-2', 'now')").run();
      db.query("insert into oauth_authorization_codes (id, grant_id, expires_at) values ('code-1', 'grant-pending', '2026-07-29T15:05:00.000')").run();
      db.query("insert into oauth_access_tokens (id, grant_id) values ('access-1', 'grant-connected')").run();

      expect(hasCompletedExternalMcpGrant(db, "grant-pending")).toBe(false);
      expect(hasCompletedExternalMcpGrant(db, "grant-connected")).toBe(true);
      cleanupExpiredIncompleteExternalMcpGrants(db, "user-1", "2026-07-29T15:04:59.999");
      expect(db.query("select id from oauth_grants where id = 'grant-pending'").get()).toEqual({ id: "grant-pending" });

      cleanupExpiredIncompleteExternalMcpGrants(db, "user-1", "2026-07-29T15:05:00.000");
      expect(db.query("select id from oauth_grants where id = 'grant-pending'").get()).toBeNull();
      expect(db.query("select id from oauth_grants where id = 'grant-connected'").get()).toEqual({ id: "grant-connected" });
      expect(db.query("select id from oauth_clients where id = 'client-1'").get()).toEqual({ id: "client-1" });
    } finally {
      db.close();
    }
  });

  test("uses one stable logical device id for repeated TRAE or Codex registrations", () => {
    expect(normalizeExternalMcpClientFamily("TRAE Work", "node")).toBe("trae");
    expect(normalizeExternalMcpClientFamily("OpenAI Codex", "codex_cli_rs/0.146.0")).toBe("codex");

    const traeDeviceId = externalMcpLogicalDeviceId({
      clientName: "Trae",
      softwareId: "trae",
      deviceName: "DESKTOP-D29ACHK",
      deviceType: "win32"
    });
    expect(traeDeviceId).toMatch(/^mdevice_[a-f0-9]{32}$/);
    expect(externalMcpLogicalDeviceId({
      clientName: "TRAE Work",
      softwareId: "trae-work",
      deviceName: "desktop-d29achk",
      deviceType: "Windows"
    })).toBe(traeDeviceId);

    const codexDeviceId = externalMcpLogicalDeviceId({
      clientName: "Codex",
      softwareId: "openai-codex",
      deviceName: "DESKTOP-D29ACHK",
      deviceType: "Windows"
    });
    expect(externalMcpLogicalDeviceId({
      clientName: "OpenAI Codex",
      userAgent: "codex_cli_rs/0.146.0",
      deviceName: "desktop-d29achk",
      deviceType: "win32"
    })).toBe(codexDeviceId);
    expect(codexDeviceId).not.toBe(traeDeviceId);
  });

  test("groups repeated OAuth client ids into one connection and prefers an active representative", () => {
    const baseRow = {
      grant_id: "grant-trae-old",
      client_id: "client-trae-old",
      client_name: "Trae",
      client_uri: "",
      software_id: "trae",
      software_version: "1.0.0",
      device_name: "DESKTOP-D29ACHK",
      device_type: "Windows",
      user_agent: "node",
      grant_types_json: '["authorization_code","refresh_token"]',
      scope: "profile:read",
      user_label: "办公室电脑",
      last_access_at: "2026-08-01T09:00:00.000",
      last_access_ip: "192.168.0.10",
      last_access_public_ip: "",
      last_access_region: "",
      last_access_geo_at: null,
      last_user_agent: "node",
      last_refresh_at: null,
      last_refresh_error: "",
      last_refresh_error_at: null,
      revoked_at: "2026-08-01T09:05:00.000" as string | null,
      created_at: "2026-07-30T09:00:00.000",
      updated_at: "2026-08-01T09:05:00.000",
      access_expires_at: null,
      refresh_expires_at: null,
      can_restore: 1
    };
    const activeTraeRow = {
      ...baseRow,
      grant_id: "grant-trae-new",
      client_id: "client-trae-new",
      client_name: "TRAE Work",
      software_id: "trae-work",
      last_access_at: "2026-08-01T08:00:00.000",
      revoked_at: null,
      created_at: "2026-08-01T08:00:00.000",
      updated_at: "2026-08-01T08:00:00.000",
      can_restore: 0
    };
    const codexRow = {
      ...baseRow,
      grant_id: "grant-codex",
      client_id: "client-codex",
      client_name: "Codex",
      software_id: "openai-codex",
      revoked_at: null,
      can_restore: 0
    };

    const groups = groupExternalMcpConnectionRows([baseRow, activeTraeRow, codexRow]);
    expect(groups).toHaveLength(2);
    const traeGroup = groups.find((group) => group.deviceId === externalMcpConnectionDeviceId(baseRow));
    expect(traeGroup?.rows).toHaveLength(2);
    expect(traeGroup?.representative.client_id).toBe("client-trae-new");
    expect(traeGroup?.lastAccessRow.client_id).toBe("client-trae-old");
    expect(traeGroup?.active).toBe(true);
    expect(traeGroup?.createdAt).toBe("2026-07-30T09:00:00.000");
    expect(traeGroup?.refreshCapability).toBe("declared");
  });

  test("reports verified refresh capability and clears an older refresh failure", () => {
    const db = createConnectionTestDb();
    try {
      db.query(`insert into oauth_clients (id, client_name, grant_types_json)
        values ('client-1', 'Codex', '["authorization_code","refresh_token"]')`).run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'before')").run();

      recordExternalMcpRefreshFailure(db, "grant-1", "Refresh Token 无效或已过期", "2026-08-01T08:00:00.000Z");
      let group = groupExternalMcpConnectionRows(getExternalMcpConnectionRows(db, "user-1"))[0];
      expect(group?.refreshCapability).toBe("declared");
      expect(group?.lastRefreshError).toBe("Refresh Token 无效或已过期");

      recordExternalMcpRefreshSuccess(db, "grant-1", "2026-08-01T09:00:00.000Z");
      group = groupExternalMcpConnectionRows(getExternalMcpConnectionRows(db, "user-1"))[0];
      expect(group?.refreshCapability).toBe("verified");
      expect(group?.lastRefreshAt).toBe("2026-08-01T09:00:00.000Z");
      expect(group?.lastRefreshError).toBe("");
      expect(db.query("select last_refresh_error, last_refresh_error_at from oauth_grants where id = 'grant-1'").get())
        .toEqual({ last_refresh_error: "", last_refresh_error_at: null });
    } finally {
      db.close();
    }
  });

  test("reports the current refresh token expiry instead of a consumed ancestor", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id, client_name) values ('client-1', 'Codex')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'before')").run();
      db.query(`insert into oauth_refresh_tokens (id, grant_id, expires_at, consumed_at) values
        ('refresh-consumed', 'grant-1', '2027-01-01T00:00:00.000Z', '2026-08-01T08:00:00.000Z'),
        ('refresh-current', 'grant-1', '2026-11-01T00:00:00.000Z', null)`).run();

      const row = getExternalMcpConnectionRows(db, "user-1")[0];
      expect(row?.refresh_expires_at).toBe("2026-11-01T00:00:00.000Z");
    } finally {
      db.close();
    }
  });

  test("disconnects, restores, labels, and removes every OAuth client in one logical device", () => {
    const db = createConnectionTestDb();
    try {
      db.query(`insert into oauth_clients (
        id, client_name, software_id, device_name, device_type, user_agent
      ) values
        ('client-trae-1', 'Trae', 'trae', 'DESKTOP-D29ACHK', 'Windows', 'node'),
        ('client-trae-2', 'TRAE Work', 'trae-work', 'desktop-d29achk', 'win32', 'node'),
        ('client-codex', 'Codex', 'openai-codex', 'DESKTOP-D29ACHK', 'Windows', 'codex_cli_rs/0.146.0')`).run();
      db.query(`insert into oauth_grants (id, user_id, client_id, updated_at) values
        ('grant-trae-1', 'user-1', 'client-trae-1', 'before'),
        ('grant-trae-2', 'user-1', 'client-trae-2', 'before'),
        ('grant-codex', 'user-1', 'client-codex', 'before')`).run();
      db.query("insert into oauth_access_tokens (id, grant_id, expires_at) values ('access-trae-1', 'grant-trae-1', '2026-08-02T00:00:00.000Z')").run();
      db.query("insert into oauth_access_tokens (id, grant_id, expires_at, revoked_at) values ('access-old', 'grant-trae-1', '2026-08-02T00:00:00.000Z', '2026-07-31T12:00:00.000')").run();
      db.query("insert into oauth_refresh_tokens (id, grant_id, expires_at) values ('refresh-trae-2', 'grant-trae-2', '2026-09-01T00:00:00.000Z')").run();
      db.query("insert into oauth_refresh_tokens (id, grant_id, expires_at, consumed_at) values ('refresh-consumed', 'grant-trae-2', '2026-09-01T00:00:00.000Z', '2026-08-01T08:00:00.000')").run();
      db.query("insert into oauth_access_tokens (id, grant_id, expires_at) values ('access-codex', 'grant-codex', '2026-08-02T00:00:00.000Z')").run();

      const deviceId = externalMcpLogicalDeviceId({
        clientName: "TRAE Work",
        softwareId: "trae-work",
        deviceName: "DESKTOP-D29ACHK",
        deviceType: "Windows"
      });
      expect(revokeExternalMcpGrant(db, "user-1", deviceId, "2026-08-01T09:00:00.000")).toBe(true);
      expect(db.query("select id, revoked_at, credential_version from oauth_grants order by id").all()).toEqual([
        { id: "grant-codex", revoked_at: null, credential_version: 1 },
        { id: "grant-trae-1", revoked_at: "2026-08-01T09:00:00.000", credential_version: 2 },
        { id: "grant-trae-2", revoked_at: "2026-08-01T09:00:00.000", credential_version: 2 }
      ]);
      const listedGroups = groupExternalMcpConnectionRows(getExternalMcpConnectionRows(
        db,
        "user-1",
        "2026-08-01T01:10:00.000Z"
      ));
      expect(listedGroups).toHaveLength(2);
      expect(listedGroups.find((group) => group.deviceId === deviceId)?.canRestore).toBe(true);

      expect(restoreExternalMcpGrant(
        db,
        "user-1",
        deviceId,
        "2026-08-01T09:10:00.000",
        "2026-08-01T01:10:00.000Z"
      )).toBe("restored");
      expect(db.query("select id, revoked_at, credential_version from oauth_grants order by id").all()).toEqual([
        { id: "grant-codex", revoked_at: null, credential_version: 1 },
        { id: "grant-trae-1", revoked_at: null, credential_version: 3 },
        { id: "grant-trae-2", revoked_at: null, credential_version: 3 }
      ]);
      expect(db.query("select revoked_at from oauth_access_tokens where id = 'access-trae-1'").get()).toEqual({ revoked_at: null });
      expect(db.query("select revoked_at from oauth_access_tokens where id = 'access-old'").get()).toEqual({ revoked_at: "2026-07-31T12:00:00.000" });
      expect(db.query("select revoked_at from oauth_refresh_tokens where id = 'refresh-trae-2'").get()).toEqual({ revoked_at: null });
      expect(db.query("select revoked_at from oauth_refresh_tokens where id = 'refresh-consumed'").get()).toEqual({ revoked_at: "2026-08-01T09:00:00.000" });

      expect(updateExternalMcpGrantLabel(db, "user-1", deviceId, "工作电脑", "after")).toBe(true);
      expect(db.query("select distinct user_label from oauth_grants where id like 'grant-trae-%'").all()).toEqual([{ user_label: "工作电脑" }]);
      expect(removeExternalMcpGrant(db, "user-1", deviceId)).toBe(true);
      expect(db.query("select id from oauth_grants order by id").all()).toEqual([{ id: "grant-codex" }]);
      expect(db.query("select id from oauth_clients order by id").all()).toEqual([{ id: "client-codex" }]);
    } finally {
      db.close();
    }
  });

  test("keeps a disconnected device inactive when no eligible credential can be restored", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id, client_name, software_id, device_name, device_type) values ('client-1', 'Codex', 'openai-codex', 'DESKTOP-D29ACHK', 'Windows')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'before')").run();
      db.query("insert into oauth_access_tokens (id, grant_id, expires_at) values ('access-expired', 'grant-1', '2026-08-01T00:00:00.000Z')").run();

      expect(revokeExternalMcpGrant(db, "user-1", "client-1", "2026-08-01T09:00:00.000")).toBe(true);
      expect(restoreExternalMcpGrant(
        db,
        "user-1",
        "client-1",
        "2026-08-01T09:10:00.000",
        "2026-08-01T01:10:00.000Z"
      )).toBe("reauthorize");
      expect(db.query("select revoked_at, credential_version from oauth_grants where id = 'grant-1'").get()).toEqual({
        revoked_at: "2026-08-01T09:00:00.000",
        credential_version: 2
      });
    } finally {
      db.close();
    }
  });

  test("makes a connection inactive without deleting its record", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'before')").run();
      db.query("insert into oauth_access_tokens (id, grant_id) values ('access-1', 'grant-1')").run();
      db.query("insert into oauth_refresh_tokens (id, grant_id) values ('refresh-1', 'grant-1')").run();
      db.query("insert into oauth_authorization_codes (id, grant_id, expires_at) values ('code-1', 'grant-1', '2026-08-01T00:00:00.000')").run();

      expect(revokeExternalMcpGrant(db, "user-1", "client-1", "2026-07-28T18:00:00.000")).toBe(true);
      expect(db.query("select revoked_at, credential_version from oauth_grants where id = 'grant-1'").get()).toEqual({
        revoked_at: "2026-07-28T18:00:00.000",
        credential_version: 2
      });
      expect(db.query("select revoked_at from oauth_access_tokens where id = 'access-1'").get()).toEqual({ revoked_at: "2026-07-28T18:00:00.000" });
      expect(db.query("select revoked_at from oauth_refresh_tokens where id = 'refresh-1'").get()).toEqual({ revoked_at: "2026-07-28T18:00:00.000" });
      expect(db.query("select consumed_at from oauth_authorization_codes where id = 'code-1'").get()).toEqual({ consumed_at: "2026-07-28T18:00:00.000" });
      expect(db.query("select id from oauth_clients where id = 'client-1'").get()).toEqual({ id: "client-1" });
    } finally {
      db.close();
    }
  });

  test("requires reauthorization without reviving revoked credentials", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'before')").run();
      db.query("insert into oauth_access_tokens (id, grant_id, revoked_at) values ('access-old', 'grant-1', '2026-07-28T17:00:00.000')").run();
      db.query("insert into oauth_access_tokens (id, grant_id) values ('access-current', 'grant-1')").run();
      db.query("insert into oauth_refresh_tokens (id, grant_id) values ('refresh-current', 'grant-1')").run();

      expect(revokeExternalMcpGrant(db, "user-1", "client-1", "2026-07-28T18:00:00.000")).toBe(true);
      expect(upsertExternalMcpGrantForAuthorization(db, {
        userId: "user-1",
        clientId: "client-1",
        scope: "profile:read images:generate",
        timestamp: "2026-07-28T18:05:00.000"
      })).toBe("grant-1");
      expect(db.query("select revoked_at, credential_version, updated_at from oauth_grants where id = 'grant-1'").get()).toEqual({
        revoked_at: null,
        credential_version: 3,
        updated_at: "2026-07-28T18:05:00.000"
      });
      expect(db.query("select revoked_at from oauth_access_tokens where id = 'access-current'").get()).toEqual({ revoked_at: "2026-07-28T18:00:00.000" });
      expect(db.query("select revoked_at from oauth_refresh_tokens where id = 'refresh-current'").get()).toEqual({ revoked_at: "2026-07-28T18:00:00.000" });
      expect(db.query("select revoked_at from oauth_access_tokens where id = 'access-old'").get()).toEqual({ revoked_at: "2026-07-28T17:00:00.000" });
    } finally {
      db.close();
    }
  });

  test("keeps reauthorization idempotent for an already active grant", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'before')").run();

      expect(upsertExternalMcpGrantForAuthorization(db, {
        userId: "user-1",
        clientId: "client-1",
        scope: "profile:read",
        timestamp: "2026-07-28T18:05:00.000"
      })).toBe("grant-1");
      expect(db.query("select revoked_at, credential_version, updated_at from oauth_grants where id = 'grant-1'").get()).toEqual({
        revoked_at: null,
        credential_version: 2,
        updated_at: "2026-07-28T18:05:00.000"
      });
    } finally {
      db.close();
    }
  });

  test("updates a connection label only for its owner", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'before')").run();

      expect(updateExternalMcpGrantLabel(db, "user-1", "client-1", "办公室 Windows", "after")).toBe(true);
      expect(db.query("select user_label, updated_at from oauth_grants where id = 'grant-1'").get()).toEqual({
        user_label: "办公室 Windows",
        updated_at: "after"
      });
      expect(updateExternalMcpGrantLabel(db, "user-2", "client-1", "其他设备", "later")).toBe(false);
      expect(db.query("select user_label from oauth_grants where id = 'grant-1'").get()).toEqual({
        user_label: "办公室 Windows"
      });
    } finally {
      db.close();
    }
  });

  test("removes only the selected user's grant and deletes an orphaned client", () => {
    const db = createConnectionTestDb();
    try {
      db.query("insert into oauth_clients (id) values ('client-1')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-1', 'user-1', 'client-1', 'now')").run();
      db.query("insert into oauth_grants (id, user_id, client_id, updated_at) values ('grant-2', 'user-2', 'client-1', 'now')").run();
      db.query("insert into oauth_access_tokens (id, grant_id) values ('access-1', 'grant-1')").run();

      expect(removeExternalMcpGrant(db, "user-1", "client-1")).toBe(true);
      expect(db.query("select id from oauth_grants where id = 'grant-1'").get()).toBeNull();
      expect(db.query("select id from oauth_access_tokens where id = 'access-1'").get()).toBeNull();
      expect(db.query("select id from oauth_clients where id = 'client-1'").get()).toEqual({ id: "client-1" });

      expect(removeExternalMcpGrant(db, "user-2", "client-1")).toBe(true);
      expect(db.query("select id from oauth_clients where id = 'client-1'").get()).toBeNull();
    } finally {
      db.close();
    }
  });
});
