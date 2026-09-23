import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerSnakeProgressRoutes } from "./snakeProgressRoutes";

describe("snake progress routes", () => {
  test("rejects delayed writes and resets after the signed-in account changes", async () => {
    const app = new Hono();
    let saves = 0;
    let resets = 0;
    registerSnakeProgressRoutes(app, {
      authorize: async () => ({ id: "current-user" }),
      load: () => ({ score: 0, revision: 0 }),
      save: () => {
        saves += 1;
        return { accepted: true, progress: { score: 4, revision: 0 } };
      },
      reset: () => {
        resets += 1;
        return { score: 0, revision: 1 };
      }
    });
    const post = (path: string, body: object) => app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    expect((await post("/snake/progress", { expectedUserId: "previous-user", score: 4, revision: 0 })).status).toBe(409);
    expect((await post("/snake/progress/reset", { expectedUserId: "previous-user" })).status).toBe(409);
    expect(saves).toBe(0);
    expect(resets).toBe(0);

    expect((await post("/snake/progress", { expectedUserId: "current-user", score: 4, revision: 0 })).status).toBe(200);
    expect((await post("/snake/progress/reset", { expectedUserId: "current-user" })).status).toBe(200);
    expect(saves).toBe(1);
    expect(resets).toBe(1);
  });
});
