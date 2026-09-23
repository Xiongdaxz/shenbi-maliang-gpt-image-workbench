import type { Hono } from "hono";
import { requireUser } from "./auth";
import { resetSnakeProgress, saveSnakeProgress, snakeProgress } from "./snakeProgress";

type SnakeProgressRouteDependencies = {
  authorize?: (c: Parameters<typeof requireUser>[0]) => Promise<{ id: string } | null>;
  load?: typeof snakeProgress;
  save?: typeof saveSnakeProgress;
  reset?: typeof resetSnakeProgress;
};

export function registerSnakeProgressRoutes(api: Hono, dependencies: SnakeProgressRouteDependencies = {}) {
  const authorize = dependencies.authorize ?? requireUser;
  const load = dependencies.load ?? snakeProgress;
  const save = dependencies.save ?? saveSnakeProgress;
  const reset = dependencies.reset ?? resetSnakeProgress;
  api.get("/snake/progress", async (c) => {
    const user = await authorize(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    c.header("Cache-Control", "private, no-store");
    return c.json(load(user.id));
  });

  api.post("/snake/progress", async (c) => {
    const user = await authorize(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const body = await c.req.json().catch(() => ({}));
    if (body?.expectedUserId !== user.id) return c.json({ error: "账号已切换，请重新打开游戏" }, 409);
    const score = body && typeof body === "object" ? body.score : undefined;
    const revision = body && typeof body === "object" ? body.revision : undefined;
    if (!Number.isSafeInteger(score) || score < 0 || !Number.isSafeInteger(revision) || revision < 0) {
      return c.json({ error: "分数或版本无效" }, 400);
    }
    c.header("Cache-Control", "private, no-store");
    const result = save(user.id, score, revision);
    return result.accepted ? c.json(result.progress) : c.json({ error: "分数已重置，请重新读取", ...result.progress }, 409);
  });

  api.post("/snake/progress/reset", async (c) => {
    const user = await authorize(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const body = await c.req.json().catch(() => ({}));
    if (body?.expectedUserId !== user.id) return c.json({ error: "账号已切换，请重新打开游戏" }, 409);
    c.header("Cache-Control", "private, no-store");
    return c.json(reset(user.id));
  });
}
