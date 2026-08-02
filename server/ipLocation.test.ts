import { describe, expect, test } from "bun:test";
import { isPublicIpAddress, queryPublicIpLocation } from "./ipLocation";

describe("public IP location", () => {
  test("distinguishes public addresses from local and documentation ranges", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
    expect(isPublicIpAddress("192.168.0.87")).toBe(false);
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("203.0.113.5")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("fd00::1")).toBe(false);
    expect(isPublicIpAddress("2001:db8::1")).toBe(false);
  });

  test("queries a public source IP and formats its region", async () => {
    let requestedUrl = "";
    const result = await queryPublicIpLocation("8.8.8.8", {
      fetcher: async (input) => {
        requestedUrl = String(input);
        return Response.json({
          success: true,
          ip: "8.8.8.8",
          country: "美国",
          region: "加利福尼亚州",
          city: "山景城"
        });
      }
    });
    expect(requestedUrl).toContain("8.8.8.8");
    expect(result).toEqual({ ip: "8.8.8.8", region: "美国 · 加利福尼亚州 · 山景城" });
  });

  test("does not mistake server egress for the user when the transport address is private", async () => {
    let called = false;
    const result = await queryPublicIpLocation("192.168.0.87", {
      fetcher: async () => {
        called = true;
        return Response.json({ success: true, ip: "1.2.3.4", country: "中国", region: "浙江省", city: "杭州" });
      }
    });
    expect(called).toBe(false);
    expect(result).toBeNull();
  });

  test("fails closed for invalid provider responses", async () => {
    expect(await queryPublicIpLocation("8.8.8.8", {
      fetcher: async () => Response.json({ success: false, message: "rate limited" })
    })).toBeNull();
    expect(await queryPublicIpLocation("8.8.8.8", {
      fetcher: async () => Response.json({ success: true, ip: "192.168.1.2" })
    })).toBeNull();
  });
});
