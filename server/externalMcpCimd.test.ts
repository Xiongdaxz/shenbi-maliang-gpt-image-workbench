import { describe, expect, test } from "bun:test";
import { cimdRedirectMatches, parseCimdMetadata, publicCimdAddress, validateCimdUrl } from "./externalMcpCimd";

const clientId = "https://chatgpt.com/oauth/codex/client.json";
const metadata = { client_id: clientId, client_name: "Codex", application_type: "native", token_endpoint_auth_method: "none",
  redirect_uris: ["http://127.0.0.1/callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
describe("Codex CIMD boundary", () => {
  test("accepts trusted documents and permits only loopback port substitution", () => {
    expect(parseCimdMetadata(clientId, metadata).client_id).toBe(clientId);
    expect(validateCimdUrl("https://chatgpt.com/oauth/codex/abc_123/client.json").hostname).toBe("chatgpt.com");
    expect(cimdRedirectMatches(metadata.redirect_uris, "http://127.0.0.1:43123/callback")).toBe(true);
    for (const uri of ["http://localhost:43123/callback", "http://127.0.0.1:43123/callback/wrong", "http://127.0.0.1:43123/callback?q=1", "https://evil.example/callback"]) {
      expect(cimdRedirectMatches(metadata.redirect_uris, uri)).toBe(false);
    }
  });
  test("rejects SSRF destinations, redirects encoded in paths, and substituted client identity", () => {
    for (const url of ["http://chatgpt.com/oauth/codex/client.json", "https://127.0.0.1/client.json", "https://chatgpt.com.evil.example/oauth/codex/client.json", `${clientId}?url=http://localhost`, "https://chatgpt.com/oauth/codex/%2e%2e/client.json"]) {
      expect(() => validateCimdUrl(url)).toThrow();
    }
    expect(() => parseCimdMetadata(clientId, { ...metadata, client_id: "https://evil.example" })).toThrow();
    expect(() => parseCimdMetadata(clientId, { ...metadata, redirect_uris: ["http://127.0.0.1:12/callback"] })).toThrow();
    for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1"]) expect(publicCimdAddress(ip)).toBe(false);
    expect(publicCimdAddress("8.8.8.8")).toBe(true);
    expect(publicCimdAddress("2606:4700::1111")).toBe(true);
  });
});
