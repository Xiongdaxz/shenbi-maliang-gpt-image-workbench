import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import sharp from "sharp";
import { configDb, getOne, run } from "./db";
import { initAppDb, initConfigDb, seedProvider } from "./schema";
import { CodexCredentialStore, initCodexCredentialSchema } from "./codexCredentials";
import { CODEX_CLIENT_ID, CODEX_ISSUER, CodexAuthError, CodexOAuthProtocol, newCodexAuthorization, parseCodexCallback, type CodexGrant } from "./codexOAuthProtocol";
import { CodexOAuthSessions } from "./codexOAuth";
import { registerCodexOAuthRoutes } from "./codexOAuthRoutes";
import { CONFIG_COOKIE } from "./constants";
import { toImageAccount } from "./serializers";
import type { ImageAccountRow, ProviderRow } from "./types";
import { now } from "./utils";
import { callProviderChain, preferredDefaultImageModel, providersForImageModel, refreshImageAccountUsages } from "./providerRuntime";
import { writeProviderModelCatalogCache } from "./providerModelCache";
import { fetchProviderModelCatalog } from "./providerModels";
import { effectiveImageAccountStatus, setImageAccountEnabled } from "./imageAccountStatus";
import { saveProviderImagesWithRetry } from "./imageRoutes";
import { saveGlobalSwitch } from "./globalSwitches";
import { ImageRequestError, ImageResultSaveError } from "./imageRequestErrors";
import { absoluteDataPath, DATA_DIR } from "./paths";
import { secureImagePath } from "./secureFiles";
import { DEFAULT_GENERATION_IMAGE_MODEL } from "../src/lib/imageModels";
import { providerImageDownload } from "./providerHttp";

initAppDb(); initConfigDb(); seedProvider();
const keyFile = Bun.env.GPT_IMAGE_CODEX_KEY_PATH!;
const store = new CodexCredentialStore(configDb, keyFile);
const grant = (id: string, lifetime = 3600000): CodexGrant => ({
  identity: { issuer: CODEX_ISSUER, subject: `user-${id}`, accountId: `workspace-${id}`, email: `${id}@example.com`, planType: "plus" },
  tokens: { accessToken: `secret-access-${id}`, refreshToken: `secret-refresh-${id}`, idToken: `secret-id-${id}`, expiresAt: new Date(Date.now()+lifetime).toISOString() }
});
let checks = 0;
async function check(name: string, operation: () => unknown | Promise<unknown>) { await operation(); checks++; console.log(`ok ${name}`); }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
if (process.argv[2] === "restart") {
  const row = getOne<ImageAccountRow>(configDb, "select * from image_accounts where name = 'persisted-codex-fixture'")!;
  assert.ok(row); assert.equal((await store.fresh(row.id)).tokens.accessToken, "secret-access-persisted");
  assert.equal(toImageAccount(row).enabled, false);
  console.log("CODEX_BINDING_OK restart"); process.exit(0);
}

await check("schema is additive and idempotent", () => { initCodexCredentialSchema(configDb); initCodexCredentialSchema(configDb); });
await check("PKCE and per-session entropy", () => {
  const first = newCodexAuthorization("http://127.0.0.1:1455/auth/callback");
  const second = newCodexAuthorization("http://127.0.0.1:1455/auth/callback"); const url = new URL(first.url);
  assert.notEqual(first.state, second.state); assert.notEqual(first.verifier, second.verifier); assert.notEqual(first.nonce, second.nonce);
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(first.verifier).digest("base64url"));
  assert.equal(url.searchParams.get("client_id"), CODEX_CLIENT_ID); assert.equal(url.searchParams.get("nonce"), first.nonce);
});
await check("callback validation rejects external URLs, duplicates and other sessions", () => {
  const uri = "http://127.0.0.1:1455/auth/callback";
  for (const bad of ["https://evil.example/?code=c&state=s", `${uri}?code=c&state=other`, `${uri}?code=c&code=d&state=s`, `${uri}?code=c&state=s&state=s`, `${uri}?state=s`, `${uri}?code=c&state=s#leak`, "not-a-url"]) {
    assert.throws(() => parseCodexCallback(bad, uri, "s"));
  }
  assert.equal(parseCodexCallback(`${uri}?error=access_denied&state=s`, uri, "s").error, true);
});

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({format:"jwk"}), kid:"fixture-key", alg:"RS256", use:"sig" };
function jwt(overrides: Record<string, unknown> = {}, signingKey = pair.privateKey) {
  const header = Buffer.from(JSON.stringify({alg:"RS256",kid:"fixture-key"})).toString("base64url");
  const claims = { iss:CODEX_ISSUER, aud:CODEX_CLIENT_ID, sub:"verified-user", email:"verified@example.com", nonce:"expected-nonce", exp:Math.floor(Date.now()/1000)+3600,
    "https://api.openai.com/auth":{chatgpt_account_id:"verified-workspace",chatgpt_plan_type:"plus"}, ...overrides };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.${sign("RSA-SHA256",Buffer.from(`${header}.${payload}`),signingKey).toString("base64url")}`;
}
const signed = jwt();
const calls: Array<{url:string;init:RequestInit}> = [];
const protocol = new CodexOAuthProtocol(async (url, init) => {
  calls.push({url,init});
  if (url.endsWith("jwks.json")) return Response.json({keys:[jwk]});
  return Response.json({access_token:"fixture-access",refresh_token:"fixture-refresh",id_token:signed,expires_in:3600});
});
await check("signed ID token verifies issuer, audience, nonce and workspace", async () => {
  assert.equal((await protocol.validateIdentity(signed,"expected-nonce")).accountId,"verified-workspace");
  for (const token of [jwt({aud:"someone-else"}), jwt({azp:"someone-else"}), jwt({iss:"https://evil.example"}), jwt({exp:1}), jwt({nonce:"bad"}), jwt({"https://api.openai.com/auth":{}}), jwt({}, generateKeyPairSync("rsa",{modulusLength:2048}).privateKey)]) {
    await assert.rejects(protocol.validateIdentity(token,"expected-nonce"), /身份校验失败/);
  }
});
await check("code exchange and refresh use separate native encodings with rotating tokens", async () => {
  const result = await protocol.exchange("fixture-code","fixture-verifier","http://127.0.0.1:1455/auth/callback","expected-nonce");
  const exchange = calls.find(call => call.init.method === "POST")!;
  assert.equal(exchange.url,`${CODEX_ISSUER}/oauth/token`); assert.ok(exchange.init.body instanceof URLSearchParams);
  assert.equal((exchange.init.body as URLSearchParams).get("code_verifier"),"fixture-verifier");
  await protocol.refresh(result);
  const refresh = calls.at(-1)!; assert.equal(JSON.parse(String(refresh.init.body)).refresh_token,"fixture-refresh");
  assert.equal((refresh.init.headers as Record<string,string>)["Content-Type"],"application/json");
});
await check("token error text does not echo server secrets", async () => {
  const broken = new CodexOAuthProtocol(async () => Response.json({error:"invalid_grant",error_description:"secret-code-and-token"},{status:400}));
  await assert.rejects(broken.exchange("c","v","u","n"), error => error instanceof CodexAuthError && error.permanent && !error.message.includes("secret"));
});

await check("encrypted credential record and serializer contain no plaintext tokens", async () => {
  const input = grant("encrypted"); const saved = store.save(input);
  const raw = getOne<Record<string,unknown>>(configDb,"select * from image_account_credentials where account_id = ?",saved.accountId)!;
  assert.ok(!JSON.stringify(raw).includes("secret-")); assert.equal(readFileSync(keyFile).length,32);
  const account = getOne<ImageAccountRow>(configDb,"select * from image_accounts where id = ?",saved.accountId)!;
  assert.equal(account.access_token,null); assert.equal(account.auth_json,null); assert.equal(account.auth_info_json,null);
  assert.ok(!JSON.stringify(toImageAccount(account,true)).includes("secret-"));
  assert.equal((await store.fresh(saved.accountId)).tokens.accessToken,input.tokens.accessToken);
  assert.equal((await store.fresh(saved.accountId)).clientId,CODEX_CLIENT_ID);
});
await check("reauthorization deduplicates stable identity and preserves metadata, stats and disabled flag", () => {
  const saved = store.save(grant("same")); run(configDb,"update image_accounts set priority=7,note='keep',status='disabled',usage_success_count=9 where id=?",saved.accountId);
  assert.equal(store.save(grant("same")).accountId,saved.accountId);
  const row = getOne<ImageAccountRow>(configDb,"select * from image_accounts where id=?",saved.accountId)!;
  assert.equal(row.priority,7); assert.equal(row.note,"keep"); assert.equal(row.status,"disabled"); assert.equal(row.usage_success_count,9);
  assert.throws(()=>store.save(grant("different"),saved.accountId),/身份不一致/);
});
await check("same email does not merge distinct workspaces", () => {
  const left=grant("left"), right=grant("right"); right.identity.email=left.identity.email; right.identity.subject=left.identity.subject;
  assert.notEqual(store.save(left).accountId,store.save(right).accountId);
});
await check("local account switch preserves credentials, operational state and reauthorization state", async () => {
  const saved=store.save(grant("enabled-switch"));
  run(configDb,"update image_accounts set status='limited',auth_status='reauth_required' where id=?",saved.accountId);
  const disabled=setImageAccountEnabled(configDb,saved.accountId,false)!;
  assert.equal(toImageAccount(disabled).enabled,false);assert.equal(effectiveImageAccountStatus(disabled),"disabled");
  assert.equal(disabled.status,"limited");assert.equal(disabled.auth_status,"reauth_required");
  const enabled=setImageAccountEnabled(configDb,saved.accountId,true)!;
  assert.equal(toImageAccount(enabled).enabled,true);assert.equal(effectiveImageAccountStatus(enabled),"limited");
  assert.equal(enabled.auth_status,"reauth_required");assert.ok(store.identity(saved.accountId));
  assert.equal(setImageAccountEnabled(configDb,"missing-account",false),null);
});
await check("credentials can be explicitly attached to the existing direct image pool", () => {
  const provider = getOne<ProviderRow>(configDb,"select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const saved = store.save(grant("pool"),"",provider.id);
  assert.equal(saved.appendedToProvider,true);
  assert.ok(JSON.parse(getOne<ProviderRow>(configDb,"select * from provider_configs where id=?",provider.id)!.web_account_ids).includes(saved.accountId));
  assert.throws(()=>store.save(grant("pool-invalid"),"","not-a-provider"),/有效/);
});
await check("existing account usage path resolves encrypted tokens without CPA", async () => {
  const saved=store.save(grant("usage-pool"));const originalFetch=globalThis.fetch;const endpoints:string[]=[];
  globalThis.fetch=(async (input: RequestInfo | URL, init?: RequestInit)=>{
    const url=String(input);endpoints.push(url);
    assert.ok(url.startsWith("https://chatgpt.com/backend-api/") && /\/(wham|codex)\/usage$/.test(url));
    assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer secret-access-usage-pool");
    assert.equal(init?.redirect, "error");
    return Response.json({plan_type:"plus",rate_limit:{primary_window:{used_percent:25,reset_at:Math.floor(Date.now()/1000)+3600,limit_window_seconds:604800}}});
  }) as typeof fetch;
  try {
    setImageAccountEnabled(configDb,saved.accountId,false);
    const result=await refreshImageAccountUsages(saved.accountId);assert.equal(result.updated,1);assert.ok(endpoints.length>0);
    const disabled=getOne<ImageAccountRow>(configDb,"select * from image_accounts where id=?",saved.accountId)!;
    assert.equal(toImageAccount(disabled).enabled,false);assert.equal(effectiveImageAccountStatus(disabled),"disabled");
    assert.equal(toImageAccount(setImageAccountEnabled(configDb,saved.accountId,true)!).enabled,true);
  }
  finally {globalThis.fetch=originalFetch;}
});
await check("bound account image mode uses native Images without a Responses planner or complexity", async () => {
  const saved=store.save(grant("native-images"));
  const configured=getOne<ProviderRow>(configDb,"select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider={...configured,route_mode:"images_api",quota_mode:"codex_first",base_url:"https://chatgpt.com/backend-api",web_account_ids:JSON.stringify([saved.accountId])};
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async (input:RequestInfo | URL,init?:RequestInit)=>{
    calls++;assert.equal(String(input),"https://chatgpt.com/backend-api/codex/images/generations");
    const headers=new Headers(init?.headers);assert.equal(headers.get("authorization"),"Bearer secret-access-native-images");
    assert.equal(headers.get("chatgpt-account-id"),"workspace-native-images");assert.equal(headers.get("accept"),"application/json");
    const body=JSON.parse(String(init?.body));assert.equal(body.model,"gpt-image-2.5-sunburst");assert.equal(body.quality,"auto");
    assert.equal(body.tools,undefined);assert.equal(body.reasoning,undefined);assert.equal(body.complexity,undefined);
    return Response.json({created:1,quality:"low",data:[{b64_json:"fixture-image",generation_id:"gen-native"}]});
  }) as typeof fetch;
  try {
    const result=await callProviderChain([provider],"generation",{prompt:"fixture",model:"gpt-image-2.5-sunburst",quality:"auto",size:"auto",n:1});
    assert.equal(calls,1);assert.equal(result.execution.actualRouteMode,"chatgpt_web_codex_images_api");
    assert.equal(result.execution.actualLanguageModel,"");assert.equal(result.execution.actualModel,"chatgpt-codex-auto");
    assert.equal(result.execution.requestedModel,"gpt-image-2.5-sunburst");assert.equal(result.execution.actualQuality,"low");
    const response=result.responseJson as {data:Array<{source_account_id:string;gen_id:string}>};
    assert.equal(response.data[0].source_account_id,saved.accountId);assert.equal(response.data[0].gen_id,"gen-native");
  } finally {globalThis.fetch=originalFetch;}
});
await check("CPA image options survive the complete account-pool route", async () => {
  const saved=store.save(grant("cpa-options"));
  const configured=getOne<ProviderRow>(configDb,"select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider={...configured,route_mode:"images_api",quota_mode:"codex_only",base_url:"https://chatgpt.com/backend-api/codex",web_account_ids:JSON.stringify([saved.accountId])};
  const originalFetch=globalThis.fetch;const requests:Array<{url:string;body:Record<string,unknown>}>=[];
  globalThis.fetch=(async(input:RequestInfo | URL,init?:RequestInit)=>{
    requests.push({url:String(input),body:JSON.parse(String(init?.body))});
    const headers=new Headers(init?.headers);assert.ok(headers.get("session-id"));assert.ok(headers.get("x-client-request-id"));assert.equal(headers.get("cookie"),null);
    return Response.json({created:1,quality:"max",data:[{b64_json:"fixture-image"}]});
  }) as typeof fetch;
  try {
    await callProviderChain([provider],"generation",{prompt:"fixture",model:"gpt-image-2.5-sunburst",quality:"xhigh",output_format:"jpeg",output_compression:70,moderation:"low",background:"opaque"});
    assert.equal(requests[0].url,"https://chatgpt.com/backend-api/codex/images/generations");assert.equal(requests[0].body.quality,"xhigh");assert.equal(requests[0].body.output_format,"jpeg");assert.equal(requests[0].body.output_compression,70);
    await callProviderChain([provider],"edit",{prompt:"fixture",model:"gpt-image-2.5-flare",images:[{file_id:"file-source"}],mask:"data:image/png;base64,mask",quality:"max",input_fidelity:"high",output_format:"webp",output_compression:0,background:"opaque"});
    assert.equal(requests[1].url,"https://chatgpt.com/backend-api/codex/images/edits");assert.equal(requests[1].body.quality,"max");assert.equal(requests[1].body.input_fidelity,"high");assert.equal(requests[1].body.output_format,"webp");assert.equal(requests[1].body.output_compression,0);
    assert.deepEqual(requests[1].body.mask,{image_url:"data:image/png;base64,mask"});assert.deepEqual(requests[1].body.images,[{file_id:"file-source"}]);
    assert.equal(requests.length,2);
  } finally {globalThis.fetch=originalFetch;}
});
await check("native parameter rejection bypasses configured automatic result retries", async () => {
  const saved=store.save(grant("no-validation-replay"));
  const configured=getOne<ProviderRow>(configDb,"select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider={...configured,route_mode:"images_api",quota_mode:"codex_only",base_url:"https://chatgpt.com/backend-api",web_account_ids:JSON.stringify([saved.accountId])};
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++;return Response.json({error:{code:"invalid_value",message:"Unsupported image parameter"}},{status:400});}) as unknown as typeof fetch;
  try {
    await assert.rejects(saveProviderImagesWithRetry({providers:[provider],mode:"generation",requestPayload:{prompt:"fixture",model:"gpt-image-2.5-sunburst",quality:"auto"},userId:"fixture",sessionId:null,retryCount:2}),error=>error instanceof ImageRequestError && !error.retryable && error.message.includes("Unsupported image parameter"));
    assert.equal(calls,1);
  } finally {globalThis.fetch=originalFetch;}
});
await check("a lost native image response is not replayed by proxy or result retry layers", async () => {
  const saved=store.save(grant("no-network-replay"));
  const configured=getOne<ProviderRow>(configDb,"select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider={...configured,proxy_enabled:1,route_mode:"images_api",quota_mode:"codex_only",base_url:"https://chatgpt.com/backend-api",web_account_ids:JSON.stringify([saved.accountId])};
  run(configDb,"update proxy_settings set url='http://127.0.0.1:9',retry_count=3,apply_chatgpt_web=1");saveGlobalSwitch("proxy_service",true);
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async(_input:RequestInfo | URL,init?:RequestInit)=>{calls++;assert.equal((init as RequestInit & {proxy?:string}).proxy,"http://127.0.0.1:9");throw new Error("fixture connection lost");}) as unknown as typeof fetch;
  try {
    await assert.rejects(saveProviderImagesWithRetry({providers:[provider,{...provider,id:"fallback-fixture",channel:"api"}],mode:"generation",requestPayload:{prompt:"fixture",model:"gpt-image-2.5-sunburst",quality:"auto"},userId:"fixture",sessionId:null,retryCount:2}),/确认任务结果/);
    assert.equal(calls,1);
  } finally {globalThis.fetch=originalFetch;saveGlobalSwitch("proxy_service",false);}
});
await check("same-origin CPA and API image downloads preserve authentication", async () => {
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='cpa' limit 1")!;
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; key: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "manual");
    requests.push({ url: String(input), key: new Headers(init?.headers).get("authorization") });
    return new Response("fixture-image");
  }) as typeof fetch;
  try {
    for (const [channel, origin] of [["cpa", "http://127.0.0.1:8317"], ["api", "https://fixture-api.invalid"]]) {
      await providerImageDownload({ ...configured, channel, base_url: origin, api_key_env: "", api_key_value: "fixture-download-key" }, origin + "/returned.png");
    }
    assert.deepEqual(requests.map(request => request.key), ["Bearer fixture-download-key", "Bearer fixture-download-key"]);
  } finally { globalThis.fetch = originalFetch; }
});
await check("foreign image origins never receive provider keys, cookies or account identifiers", async () => {
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider = { ...configured, base_url: "https://fixture-provider.invalid", api_key_env: "", api_key_value: "fixture-download-key", web_cookies: "fixture-cookie=value", web_account_id: "fixture-account-id" };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests++;
    assert.deepEqual([...new Headers(init?.headers)], [["accept", "image/*"]]);
    assert.equal(init?.redirect, "manual"); assert.equal(init?.credentials, "omit");
    return new Response("fixture-image");
  }) as typeof fetch;
  try {
    for (const origin of ["https://fixture-cdn.invalid", "https://fixture-provider.invalid:8443", "http://fixture-provider.invalid", "https://sub.fixture-provider.invalid"]) {
      await providerImageDownload(provider, origin + "/returned.png?signature=fixture");
    }
    assert.equal(requests, 4);
  } finally { globalThis.fetch = originalFetch; }
});
await check("real HTTP redirects preserve same-origin auth and remove cross-origin credentials", async () => {
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const headersSeen: Array<{ source: string; auth: string | null; cookie: string | null; account: string | null }> = [];
  const observe = (source: string, request: Request) => headersSeen.push({ source, auth: request.headers.get("authorization"), cookie: request.headers.get("cookie"), account: request.headers.get("chatgpt-account-id") });
  const asset = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { observe("asset", request); return new Response("fixture-image"); } });
  const source = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    observe("provider", request);
    return Response.redirect(new URL(request.url).pathname === "/start" ? new URL("/redirect", request.url) : `http://127.0.0.1:${asset.port}/returned.png?signature=fixture`, 302);
  } });
  try {
    const base = `http://127.0.0.1:${source.port}`;
    const response = await providerImageDownload({ ...configured, proxy_enabled: 0, base_url: base, api_key_env: "", api_key_value: "fixture-download-key", web_cookies: "fixture-cookie=value", web_account_id: "fixture-account-id" }, base + "/start");
    assert.equal(await response.text(), "fixture-image");
    assert.deepEqual(headersSeen, [
      { source: "provider", auth: "Bearer fixture-download-key", cookie: "fixture-cookie=value", account: "fixture-account-id" },
      { source: "provider", auth: "Bearer fixture-download-key", cookie: "fixture-cookie=value", account: "fixture-account-id" },
      { source: "asset", auth: null, cookie: null, account: null }
    ]);
  } finally { await source.stop(true); await asset.stop(true); }
});
await check("image downloads reject credential URLs, unsafe redirects and redirect loops", async () => {
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='cpa' limit 1")!;
  const provider = { ...configured, base_url: "https://fixture-provider.invalid", api_key_env: "", api_key_value: "fixture-download-key" };
  const originalFetch = globalThis.fetch;
  let requests = 0, location = "file:///fixture.png";
  globalThis.fetch = (async () => { requests++; return new Response(null, { status: 302, headers: { location } }); }) as unknown as typeof fetch;
  try {
    await assert.rejects(providerImageDownload(provider, "https://fixture-user:fixture-pass@fixture-provider.invalid/returned.png"), /不含登录信息/);
    assert.equal(requests, 0);
    await assert.rejects(providerImageDownload(provider, provider.base_url + "/returned.png"), /HTTP 或 HTTPS/);
    assert.equal(requests, 1);
    location = "https://fixture-user:fixture-pass@fixture-provider.invalid/returned.png";
    await assert.rejects(providerImageDownload(provider, provider.base_url + "/returned.png"), /不含登录信息/);
    assert.equal(requests, 2);
    requests = 0; location = "/loop";
    await assert.rejects(providerImageDownload(provider, provider.base_url + "/returned.png"), /重定向次数过多/);
    assert.equal(requests, 6);
  } finally { globalThis.fetch = originalFetch; }
});
await check("API image result downloads persist cross-origin images without sharing the channel key", async () => {
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='cpa' limit 1")!;
  const provider = { ...configured, channel: "api", base_url: "https://fixture-api.invalid", route_mode: "images_api", api_key_env: "", api_key_value: "fixture-download-key" };
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#19334c" } }).png().toBuffer();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; auth: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization") });
    if (init?.method === "POST") return Response.json({ data: [{ url: "https://fixture-asset.invalid/returned.png" }] });
    assert.equal(String(input), "https://fixture-asset.invalid/returned.png");
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  try {
    const result = await saveProviderImagesWithRetry({ providers: [provider], mode: "generation", requestPayload: { prompt: "fixture", model: "gpt-image-2.5-sunburst" }, userId: "cross-origin-download-fixture", sessionId: null, retryCount: 0 });
    assert.equal(result.savedImages.length, 1);
    assert.deepEqual(requests, [{ method: "POST", auth: "Bearer fixture-download-key" }, { method: "GET", auth: null }]);
  } finally { globalThis.fetch = originalFetch; }
});
await check("a returned image is downloaded again without resubmitting generation", async () => {
  const saved = store.save(grant("retry-image-save"));
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider = { ...configured, route_mode: "images_api", quota_mode: "codex_only", base_url: "https://chatgpt.com/backend-api", web_account_ids: JSON.stringify([saved.accountId]) };
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#19334c" } }).png().toBuffer();
  const originalFetch = globalThis.fetch;
  let submitted = 0, downloads = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      submitted++;
      assert.equal(String(input), "https://chatgpt.com/backend-api/codex/images/generations");
      return Response.json({ data: [{ url: "https://fixture-image.invalid/returned.png" }] });
    }
    assert.equal(String(input), "https://fixture-image.invalid/returned.png");
    downloads++;
    return downloads === 1 ? new Response("temporary image download failure", { status: 503 })
      : new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
  }) as typeof fetch;
  try {
    const result = await saveProviderImagesWithRetry({ providers: [provider], mode: "generation", requestPayload: { prompt: "fixture", model: "gpt-image-2.6-sunburst" }, userId: "retry-image-save-fixture", sessionId: null, retryCount: 1 });
    assert.equal(submitted, 1); assert.equal(downloads, 2);
    assert.equal(result.attemptNo, 1); assert.equal(result.savedImages.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});
await check("persistent disk failure after a valid response never replays the POST or falls back", async () => {
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='cpa' limit 1")!;
  const provider = { ...configured, base_url: "https://fixture-cpa.invalid", route_mode: "auto", responses_path: "/v1/responses" };
  const backup = { ...provider, id: "save-fixture-backup", base_url: "https://fixture-backup.invalid", channel: "api" };
  const userId = "persistent-save-error-fixture";
  const blocker = path.dirname(absoluteDataPath(secureImagePath(userId, null, "placeholder")));
  assert.ok(blocker.startsWith(DATA_DIR + path.sep));
  mkdirSync(path.dirname(blocker), { recursive: true });
  writeFileSync(blocker, "fixture obstruction", { flag: "wx" });
  const png = (await sharp({ create: { width: 24, height: 24, channels: 3, background: "#19334c" } }).png().toBuffer()).toString("base64");
  const originalFetch = globalThis.fetch;
  const submitted: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") submitted.push(String(input));
    return Response.json({ data: [{ b64_json: png }] });
  }) as typeof fetch;
  try {
    await assert.rejects(saveProviderImagesWithRetry({ providers: [provider, backup], mode: "generation", requestPayload: { prompt: "fixture", model: "gpt-image-2.5-sunburst" }, userId, sessionId: null, retryCount: 1 }),
      error => error instanceof ImageResultSaveError && !error.retryable && error.haltFallback);
    assert.deepEqual(submitted, ["https://fixture-cpa.invalid/v1/responses"]);
  } finally { globalThis.fetch = originalFetch; unlinkSync(blocker); }
});
await check("a native HTTP success with an unconfirmed result does not replay the generation", async () => {
  const saved = store.save(grant("native-incomplete-result"));
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider = { ...configured, route_mode: "images_api", quota_mode: "codex_only", base_url: "https://chatgpt.com/backend-api", web_account_ids: JSON.stringify([saved.accountId]) };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return Response.json({ data: [] }); }) as unknown as typeof fetch;
  try {
    await assert.rejects(saveProviderImagesWithRetry({ providers: [provider], mode: "generation", requestPayload: { prompt: "fixture", model: "gpt-image-2.6-sunburst" }, userId: "native-incomplete-fixture", sessionId: null, retryCount: 2 }), /确认任务结果/);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});
await check("omitted plugin defaults prefer 2.6 only in the selected compatible provider chain", () => {
  const cpa = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='cpa' limit 1")!;
  const api = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='api' limit 1")!;
  const rollback = Symbol("restore test settings");
  try {
    configDb.transaction(() => {
      run(configDb, "update provider_configs set enabled=0");
      run(configDb, "update provider_configs set enabled=1,route_mode='responses',model='gpt-image-2.5-sunburst' where id=?", cpa.id);
      run(configDb, "update provider_configs set enabled=1,route_mode='images_api',base_url='https://api.openai.com' where id=?", api.id);
      run(configDb, "update image_generation_settings set mode='cpa' where id='default'");
      assert.equal(preferredDefaultImageModel(DEFAULT_GENERATION_IMAGE_MODEL), undefined);
      run(configDb, "update image_generation_settings set mode='auto' where id='default'");
      assert.equal(preferredDefaultImageModel(DEFAULT_GENERATION_IMAGE_MODEL), "gpt-image-2.6-sunburst");
      throw rollback;
    })();
  } catch (error) { if (error !== rollback) throw error; }
});
await check("actual image model is reported by the upstream image endpoint or tool only", async () => {
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='api' limit 1")!;
  const direct = { ...configured, route_mode: "images_api", base_url: "https://api.openai.com" };
  const responses = { ...configured, route_mode: "responses", base_url: "https://fixture-api.invalid" };
  const originalFetch = globalThis.fetch;
  let reply: unknown;
  globalThis.fetch = (async () => Response.json(reply)) as unknown as typeof fetch;
  try {
    const payload = { prompt: "fixture", model: "gpt-image-2.6-sunburst" };
    reply = { data: [{ b64_json: "fixture-image" }], image_model_execution: { actualModel: "ignored-private-metadata" } };
    const unknown = await callProviderChain([direct], "generation", payload);
    assert.equal(unknown.execution.requestedModel, payload.model); assert.equal(unknown.execution.actualModel, "");
    reply = { data: [{ b64_json: "fixture-image" }], model: "gpt-image-2.6-flare" };
    assert.equal((await callProviderChain([direct], "generation", payload)).execution.actualModel, "gpt-image-2.6-flare");
    const legacy = { ...payload, model: "gpt-image-2.5-sunburst" };
    const tool = { type: "image_generation_call", status: "completed", result: "fixture-image" };
    reply = { model: "gpt-6-astra", output: [tool] };
    assert.equal((await callProviderChain([responses], "generation", legacy)).execution.actualModel, "");
    reply = { model: "gpt-6-astra", output: [{ ...tool, model: "gpt-image-2.5-flare" }] };
    assert.equal((await callProviderChain([responses], "generation", legacy)).execution.actualModel, "gpt-image-2.5-flare");
  } finally { globalThis.fetch = originalFetch; }
});
await check("2.6 public API generation and edits use Images even in automatic mode", async () => {
  const configured=getOne<ProviderRow>(configDb,"select * from provider_configs where channel='api' limit 1")!;
  const provider={...configured,route_mode:"auto",base_url:"https://api.openai.com/v1",generation_path:"/v1/responses",api_key_env:"",api_key_value:"fixture-api-key"};
  const originalFetch=globalThis.fetch;const sent:Array<{url:string;body:RequestInit["body"]}>=[];
  globalThis.fetch=(async(input:RequestInfo | URL,init?:RequestInit)=>{
    sent.push({url:String(input),body:init?.body});
    return Response.json({data:[{b64_json:"fixture-image"}]});
  }) as typeof fetch;
  try {
    const result=await callProviderChain([provider],"generation",{prompt:"fixture",model:"gpt-image-2.6-sunburst",complexity:"medium",quality:"xhigh"});
    assert.equal(result.execution.actualRouteMode,"images_api");assert.equal(result.execution.requestedModel,"gpt-image-2.6-sunburst");
    assert.equal(sent[0].url,"https://api.openai.com/v1/images/generations");
    const json=JSON.parse(String(sent[0].body));assert.equal(json.model,"gpt-image-2.6-sunburst");assert.equal(json.complexity,"medium");assert.equal(json.quality,"xhigh");
    assert.equal(json.tools,undefined);assert.equal(json.reasoning,undefined);assert.equal(json.response_format,undefined);
    await callProviderChain([provider],"edit",{prompt:"fixture",model:"gpt-image-2.6-flare",complexity:"low",quality:"max",images:["data:image/png;base64,AA=="]});
    assert.equal(sent[1].url,"https://api.openai.com/v1/images/edits");assert.ok(sent[1].body instanceof FormData);
    assert.equal(sent[1].body.get("model"),"gpt-image-2.6-flare");assert.equal(sent[1].body.get("complexity"),"low");assert.equal(sent[1].body.get("quality"),"max");assert.equal(sent[1].body.get("response_format"),null);
    await callProviderChain([{...provider,route_mode:"images_api",generation_path:"/v1/images/generations"}],"generation",{prompt:"fixture",model:"gpt-image-2.5-sunburst",quality:"max",complexity:"medium"});
    const legacy=JSON.parse(String(sent[2].body));assert.equal(legacy.model,"gpt-image-2.5-sunburst");assert.equal(legacy.quality,"max");assert.equal(legacy.complexity,undefined);
  } finally {globalThis.fetch=originalFetch;}
});
await check("2.6 Codex uses the bound account and never the website conversation path", async () => {
  const saved=store.save(grant("native-26"));
  const configured=getOne<ProviderRow>(configDb,"select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider={...configured,route_mode:"images_api",quota_mode:"official_first",base_url:"https://chatgpt.com/backend-api",web_account_ids:JSON.stringify([saved.accountId])};
  const originalFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=(async (input:RequestInfo | URL,init?:RequestInit)=>{
    requests++;assert.equal(String(input),"https://chatgpt.com/backend-api/codex/images/generations");
    const json=JSON.parse(String(init?.body));assert.equal(json.model,"gpt-image-2.6-flare");assert.equal(json.complexity,"high");assert.equal(json.quality,"max");assert.equal(json.reasoning,undefined);
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer secret-access-native-26");
    assert.equal(init?.redirect, "error");
    return Response.json({data:[{b64_json:"fixture-image"}]});
  }) as typeof fetch;
  try {
    const result=await callProviderChain([provider],"generation",{prompt:"fixture",model:"gpt-image-2.6-flare",complexity:"high",quality:"max"});
    assert.equal(requests,1);assert.equal(result.execution.actualRouteMode,"chatgpt_web_codex_images_api");assert.equal(result.execution.actualModel,"chatgpt-codex-auto");
    await assert.rejects(callProviderChain([{...provider,quota_mode:"official_only"}],"generation",{prompt:"fixture",model:"gpt-image-2.6-flare"}),/图片直连/);
    await assert.rejects(callProviderChain([{...provider,route_mode:"responses"}],"generation",{prompt:"fixture",model:"gpt-image-2.6-flare"}),/图片直连/);
    assert.equal(requests,1);
  } finally {globalThis.fetch=originalFetch;}
});
await check("bound OAuth rejects non-official final image and Responses URLs before fetch", async () => {
  const saved = store.save(grant("oauth-destination"));
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider = { ...configured, route_mode: "images_api", quota_mode: "codex_only", base_url: "https://chatgpt.com/backend-api", web_account_ids: JSON.stringify([saved.accountId]) };
  const generation = { prompt: "fixture", model: "gpt-image-2.6-sunburst" };
  const denied = /OAuth 凭据仅允许发往 https:\/\/chatgpt\.com/;
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => { requests++; throw new Error("Unexpected outbound request"); }) as unknown as typeof fetch;
  try {
    for (const base_url of ["https://chatgpt.com.fixture.invalid/backend-api", "http://chatgpt.com/backend-api", "https://chatgpt.com:444/backend-api", "https://fixture@chatgpt.com/backend-api"]) {
      await assert.rejects(callProviderChain([{ ...provider, base_url }], "generation", generation), denied);
    }
    await assert.rejects(callProviderChain([{ ...provider, base_url: "https://fixture.invalid/backend-api" }], "edit", { ...generation, images: ["data:image/png;base64,AA=="] }), denied);
    await assert.rejects(callProviderChain([{ ...provider, route_mode: "responses", responses_path: "https://fixture.invalid/codex/responses" }], "generation", { prompt: "fixture", model: "gpt-image-2" }), denied);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});
await check("catalog fetch limits bound OAuth without changing CPA or compatible API requests", async () => {
  const configured = getOne<ProviderRow>(configDb, "select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider = { ...configured, api_key_env: "", api_key_value: "fixture-bound-oauth", base_url: "https://chatgpt.com/backend-api" };
  const originalFetch = globalThis.fetch;
  const sent: Array<{ origin: string; path: string; auth: string | null; redirect: RequestRedirect | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    sent.push({ origin: url.origin, path: url.pathname, auth: new Headers(init?.headers).get("authorization"), redirect: init?.redirect });
    return Response.json({ models: [{ slug: "gpt-6-astra" }] });
  }) as typeof fetch;
  try {
    await assert.rejects(fetchProviderModelCatalog({ ...provider, base_url: "https://fixture.invalid/backend-api" }, { boundCodexOAuth: true }), /OAuth 凭据仅允许发往/);
    assert.equal(sent.length, 0);
    await fetchProviderModelCatalog(provider, { boundCodexOAuth: true });
    await fetchProviderModelCatalog({ ...provider, channel: "cpa", api_key_value: "fixture-cpa-key", base_url: "http://fixture-cpa.invalid", responses_path: "/v1/responses" });
    await fetchProviderModelCatalog({ ...provider, channel: "api", api_key_value: "fixture-api-key", base_url: "https://fixture-api.invalid", responses_path: "/v1/responses" });
    assert.deepEqual(sent, [
      { origin: "https://chatgpt.com", path: "/backend-api/codex/models", auth: "Bearer fixture-bound-oauth", redirect: "error" },
      { origin: "http://fixture-cpa.invalid", path: "/v1/models", auth: "Bearer fixture-cpa-key", redirect: undefined },
      { origin: "https://fixture-api.invalid", path: "/v1/models", auth: "Bearer fixture-api-key", redirect: undefined }
    ]);
  } finally { globalThis.fetch = originalFetch; }
});
await check("2.6 auto routing skips old CPA and uses CPA Images when the exact model is advertised", async () => {
  const configured=getOne<ProviderRow>(configDb,"select * from provider_configs where channel='cpa' limit 1")!;
  const cpa={...configured,route_mode:"auto",base_url:"http://fixture-cpa.invalid",generation_path:"/v1/images/generations",api_key_env:"",api_key_value:"fixture-cpa-key"};
  const api={...cpa,id:"fixture-api-26",channel:"api",base_url:"https://api.openai.com"};
  const model="gpt-image-2.6-flare";
  assert.deepEqual(providersForImageModel([cpa,api],model),[api]);
  assert.throws(()=>providersForImageModel([cpa],model),/刷新模型列表/);
  writeProviderModelCatalogCache(configDb,cpa,{endpoint:"http://fixture-cpa.invalid/v1/models",durationMs:1,models:[model],imageModels:[model],responsesModels:[]});
  assert.deepEqual(providersForImageModel([cpa,api],model),[cpa,api]);
  assert.throws(()=>providersForImageModel([cpa],"gpt-image-2.6-sunburst"),/刷新模型列表/);
  const originalFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=(async(input:RequestInfo | URL,init?:RequestInit)=>{
    requests++;assert.equal(String(input),"http://fixture-cpa.invalid/v1/images/generations");
    const body=JSON.parse(String(init?.body));assert.equal(body.model,model);assert.equal(body.complexity,"low");assert.equal(body.tools,undefined);
    return Response.json({data:[{b64_json:"fixture-image"}]});
  }) as typeof fetch;
  try {await callProviderChain([cpa],"generation",{prompt:"fixture",model,complexity:"low"});assert.equal(requests,1);}
  finally {globalThis.fetch=originalFetch;}
});
await check("explicit Responses selection retains its separate route", async () => {
  const saved=store.save(grant("explicit-responses"));
  const configured=getOne<ProviderRow>(configDb,"select * from provider_configs where channel='chatgpt_web' limit 1")!;
  const provider={...configured,route_mode:"responses",quota_mode:"codex_only",base_url:"https://chatgpt.com/backend-api",responses_path:"/codex/responses",web_account_ids:JSON.stringify([saved.accountId])};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(async(input:RequestInfo | URL,init?:RequestInit)=>{
    assert.equal(String(input),"https://chatgpt.com/backend-api/codex/responses");
    assert.equal(init?.redirect,"error");
    assert.ok(Array.isArray(JSON.parse(String(init?.body)).tools));
    return Response.json({output:[{type:"image_generation_call",status:"completed",result:"fixture-image"}]});
  }) as typeof fetch;
  try {assert.equal((await callProviderChain([provider],"generation",{prompt:"fixture",model:"gpt-image-2",quality:"auto"})).execution.actualRouteMode,"chatgpt_web_codex_responses");}
  finally {globalThis.fetch=originalFetch;}
});
await check("single-flight refresh replaces the entire rotating token set", async () => {
  let count=0; const initial=grant("single",1000); const next=grant("single"); next.tokens.accessToken="rotated-access";next.tokens.refreshToken="rotated-refresh";
  const saved=store.save(initial); const freshStore = new CodexCredentialStore(configDb,keyFile,async()=>{count++;await sleep(30);return next;});
  const results=await Promise.all(Array.from({length:12},()=>freshStore.fresh(saved.accountId)));
  assert.equal(count,1);assert.ok(results.every(result=>result.tokens.refreshToken==="rotated-refresh"));
  assert.equal((await new CodexCredentialStore(configDb,keyFile).fresh(saved.accountId)).tokens.accessToken,"rotated-access");
});
await check("database refresh lock serializes two service instances", async () => {
  const saved=store.save(grant("cross-process",1000));let count=0;
  const refresh=async()=>{count++;await sleep(40);return grant("cross-process");};
  const first=new CodexCredentialStore(configDb,keyFile,refresh),second=new CodexCredentialStore(configDb,keyFile,refresh);
  await Promise.all([first.fresh(saved.accountId),second.fresh(saved.accountId)]);assert.equal(count,1);
});
await check("in-flight refresh cannot overwrite a newer reauthorization", async () => {
  const saved=store.save(grant("cas",1000));let resolve!: (value:CodexGrant)=>void;
  const freshStore=new CodexCredentialStore(configDb,keyFile,()=>new Promise(done=>{resolve=done;}));
  const pending=freshStore.fresh(saved.accountId); const replacement=grant("cas");replacement.tokens.accessToken="new-login";
  store.save(replacement,saved.accountId);resolve(grant("cas"));
  assert.equal((await pending).tokens.accessToken,"new-login");
});
await check("temporary refresh failure keeps credentials and backs off", async () => {
  const saved=store.save(grant("network",60000));let count=0;
  const freshStore=new CodexCredentialStore(configDb,keyFile,async()=>{count++;throw new Error("secret network content");});
  assert.equal((await freshStore.fresh(saved.accountId)).tokens.accessToken,"secret-access-network");
  await freshStore.fresh(saved.accountId);assert.equal(count,1);
  assert.equal(getOne<ImageAccountRow>(configDb,"select * from image_accounts where id=?",saved.accountId)!.auth_status,"authorized");
});
await check("permanent refresh failure requires reauthorization without plaintext leakage", async () => {
  const saved=store.save(grant("revoked",1000));
  const freshStore=new CodexCredentialStore(configDb,keyFile,async()=>{throw new CodexAuthError("revoked",true);});
  await assert.rejects(freshStore.fresh(saved.accountId),/重新授权/);
  assert.equal(getOne<ImageAccountRow>(configDb,"select * from image_accounts where id=?",saved.accountId)!.auth_status,"reauth_required");
  await assert.rejects(freshStore.fresh(saved.accountId),/重新授权/);
});
await check("lost encryption key is never silently regenerated", async () => {
  const saved=store.save(grant("missing-key")); renameSync(keyFile,`${keyFile}.held`);
  try { await assert.rejects(store.fresh(saved.accountId),/密钥不可用/); assert.throws(()=>store.save(grant("no-new-key")),/密钥不可用/); }
  finally { renameSync(`${keyFile}.held`,keyFile); }
});

const savedResult = {accountId:"fixture-account",updated:false,appendedToProvider:false};
function callback(session:ReturnType<CodexOAuthSessions["create"]>, state?:string) {return `${session.redirectUri}?code=fixture-code&state=${state || new URL(session.authUrl).searchParams.get("state")}`;}
await check("session ownership, invalid callback preservation and duplicate callback idempotency", async () => {
  let exchanges=0,saves=0; const manager=new CodexOAuthSessions({listen:false,exchange:async()=>{exchanges++;await sleep(10);return grant("session");},save:()=>{saves++;return savedResult;}});
  const session=manager.create("owner");assert.equal(manager.create("owner").id,session.id);
  assert.throws(()=>manager.get("other",session.id));await assert.rejects(manager.submit("owner",session.id,callback(session,"wrong")));
  assert.equal(manager.get("owner",session.id).status,"waiting");
  const results=await Promise.all([manager.submit("owner",session.id,callback(session)),manager.submit("owner",session.id,callback(session))]);
  assert.ok(results.every(result=>result.status==="succeeded"));assert.equal(exchanges,1);assert.equal(saves,1);
  await manager.submit("owner",session.id,callback(session));assert.equal(exchanges,1);manager.stop();
});
await check("cancelled and expired sessions cannot save credentials", async () => {
  let saved=0;const manager=new CodexOAuthSessions({listen:false,ttlMs:5,save:()=>{saved++;return savedResult;}});
  const cancelled=manager.create("cancel");manager.cancel("cancel",cancelled.id);
  await assert.rejects(manager.submit("cancel",cancelled.id,callback(cancelled)));
  const expired=manager.create("expire");await sleep(10);assert.equal(manager.get("expire",expired.id).status,"expired");
  await assert.rejects(manager.submit("expire",expired.id,callback(expired)));assert.equal(saved,0);manager.stop();
});
await check("saving can be retried without redeeming a one-time code twice", async () => {
  let exchanges=0,saves=0;const manager=new CodexOAuthSessions({listen:false,exchange:async()=>{exchanges++;return grant("save-retry");},save:()=>{if(++saves===1)throw new Error("disk");return savedResult;}});
  const session=manager.create("owner");assert.equal((await manager.submit("owner",session.id,callback(session))).status,"save_failed");
  assert.equal((await manager.submit("owner",session.id,"")).status,"succeeded");assert.equal(exchanges,1);assert.equal(saves,2);manager.stop();
});
await check("logout during code exchange prevents account persistence", async () => {
  let active=true,saves=0;let release!:(value:CodexGrant)=>void;
  const manager=new CodexOAuthSessions({listen:false,isOwnerActive:()=>active,exchange:()=>new Promise(resolve=>{release=resolve;}),save:()=>{saves++;return savedResult;}});
  const session=manager.create("owner");const pending=manager.submit("owner",session.id,callback(session));active=false;release(grant("logged-out"));await pending;
  assert.equal(saves,0);assert.throws(()=>manager.get("owner",session.id),/登录已失效/);manager.stop();
});
await check("automatic loopback callback completes without the management cookie", async () => {
  const manager=new CodexOAuthSessions({ports:[0],exchange:async()=>grant("loopback"),save:()=>savedResult});
  try { const session=manager.create("owner");assert.equal(session.autoCallback,true);
    const response=await fetch(callback(session));assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
    assert.equal(manager.get("owner",session.id).status,"succeeded");
    const html=await response.text();assert.ok(!html.includes("secret-"));assert.ok(html.includes("justify-content:center"));
    assert.ok(response.headers.get("content-security-policy")?.includes("style-src 'sha256-"));
  } finally {manager.stop();}
});
await check("management routes require login, enforce origin and isolate owners", async () => {
  const manager=new CodexOAuthSessions({listen:false,exchange:async()=>grant("routes"),save:input=>store.save(input)});
  const api=new Hono();registerCodexOAuthRoutes(api,manager);const app=new Hono();app.route("/api",api);
  for(const id of ["owner-a","owner-b"])run(configDb,"insert into config_auth_sessions(id,expires_at,created_at)values(?,?,?)",id,new Date(Date.now()+3600000).toISOString(),now());
  const request=(url:string,owner="",body?:unknown,origin?:string)=>app.request(`http://localhost/api/config/codex-oauth/${url}`,{method:body===undefined?"GET":"POST",headers:{Cookie:`${CONFIG_COOKIE}=${owner}`,"Content-Type":"application/json",...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await request("sessions","",{})).status,401);
  assert.equal((await request("sessions","owner-a",{},"https://evil.example")).status,403);
  const created=await request("sessions","owner-a",{},"http://localhost");assert.equal(created.status,200);
  const {session}=await created.json() as {session:ReturnType<CodexOAuthSessions["create"]>};
  assert.equal((await request(`sessions/${session.id}`,"owner-b")).status,400);
  const done=await request(`sessions/${session.id}/callback`,"owner-a",{callbackUrl:callback(session)});assert.equal(done.status,200);
  const loaded=await request(`sessions/${session.id}`,"owner-a");const text=await loaded.text();assert.ok(!text.includes("secret-"));assert.ok(text.includes("codex_oauth"));manager.stop();
});
const persisted=store.save(grant("persisted"));run(configDb,"update image_accounts set name='persisted-codex-fixture' where id=?",persisted.accountId);
setImageAccountEnabled(configDb,persisted.accountId,false);
console.log(`CODEX_BINDING_OK ${checks} checks`);
