import { describe, expect, test } from "bun:test";
import { buildMaliangImageJobResult, DEVICE_REPORT_REQUIRED_MESSAGE, externalMcpInternalApiUrl } from "./externalMcpServer";

describe("external MCP internal image requests", () => {
  test("requires the current agent to report an unknown device without waiting for another message", () => {
    expect(DEVICE_REPORT_REQUIRED_MESSAGE).toContain("maliang_report_device");
    expect(DEVICE_REPORT_REQUIRED_MESSAGE).toContain("reported=true");
    expect(DEVICE_REPORT_REQUIRED_MESSAGE).toContain("不得等待用户下一条消息");
    expect(DEVICE_REPORT_REQUIRED_MESSAGE).toContain("重试刚才的工具");
  });

  test("preserves the OAuth resource origin for image routes", () => {
    const resource = "http://192.168.0.87:8787/api/external-mcp/mcp";

    expect(externalMcpInternalApiUrl(resource, "/images/generate")).toBe(
      "http://192.168.0.87:8787/images/generate"
    );
    expect(externalMcpInternalApiUrl(resource, "/image-jobs/job_test")).toBe(
      "http://192.168.0.87:8787/image-jobs/job_test"
    );
  });

  test("returns a compact resource link without base64 image data for a completed job", async () => {
    const result = await buildMaliangImageJobResult(
      {
        jobId: "job_test",
        status: "succeeded",
        imageIds: ["img_test"]
      },
      [{ id: "img_test", path: "secure/test.gimg", mime_type: "image/png" }],
      [{
        imageId: "img_test",
        downloadUrl: "https://maliang.example/mcp/image-result/token_test",
        previewUrl: "https://maliang.example/mcp/image-result/token_test",
        expiresAt: "2026-08-28T08:00:00.000Z"
      }]
    );

    const instruction = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(instruction).toContain("不返回 base64 图片数据");
    expect(instruction).toContain("resource_link");
    expect(instruction).toContain("客户端");
    expect(instruction).toContain("本地持久化");
    expect(instruction).toContain("downloadUrl");
    expect(instruction).toContain("不要回显到对话正文、日志或长期存储");
    expect(instruction).toContain("图片交付未完成");
    expect(instruction).not.toContain("打开原始下载地址");
    expect(instruction).toContain("不要只回复 jobId");
    expect(instruction).not.toContain("Codex");
    expect(instruction).not.toContain("functions.exec");
    expect(instruction).not.toContain(".ts");
    expect(instruction).not.toContain("![");
    expect(instruction).not.toContain("https://maliang.example");
    expect(result.content[1]).toEqual({
      type: "resource_link",
      uri: "https://maliang.example/mcp/image-result/token_test",
      name: "img_test",
      title: "神笔马良原图 img_test",
      description: "原图下载地址，有效期至 2026-08-28 16:00:00（北京时间）",
      mimeType: "image/png"
    });
    expect(result.content).toHaveLength(2);
    expect(result.content.map((item) => item.type)).toEqual(["text", "resource_link"]);
    expect(JSON.stringify(result.content)).not.toContain('"data"');
    expect(result.structuredContent).toEqual({
      jobId: "job_test",
      status: "succeeded",
      imageIds: ["img_test"],
      imageResults: [{
        imageId: "img_test",
        downloadUrl: "https://maliang.example/mcp/image-result/token_test",
        previewUrl: "https://maliang.example/mcp/image-result/token_test",
        expiresAt: "2026-08-28T08:00:00.000Z"
      }]
    });
  });
});
