export type SnakeScoreMode = "restart" | "keep";

export function normalizeSnakeScoreMode(value: unknown): SnakeScoreMode {
  return value === "restart" ? "restart" : "keep";
}
