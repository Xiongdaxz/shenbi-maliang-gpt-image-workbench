import type { Database } from "bun:sqlite";
import { appDb, getOne, run } from "./db";
import { now } from "./utils";

export type SnakeProgress = { score: number; revision: number };

function progressRow(db: Database, userId: string): SnakeProgress | null {
  return getOne<SnakeProgress>(db, "select score, revision from user_snake_progress where user_id = ?", userId);
}

export function snakeProgressFromDb(db: Database, userId: string): SnakeProgress {
  return progressRow(db, userId) ?? { score: 0, revision: 0 };
}

export function saveSnakeProgressToDb(db: Database, userId: string, score: number, revision: number) {
  run(db, "insert or ignore into user_snake_progress (user_id, score, revision, updated_at) values (?, 0, 0, ?)", userId, now());
  run(
    db,
    `update user_snake_progress
     set score = max(score, ?), updated_at = ?
     where user_id = ? and revision = ?`,
    score,
    now(),
    userId,
    revision
  );
  const progress = snakeProgressFromDb(db, userId);
  return { accepted: progress.revision === revision, progress };
}

export function resetSnakeProgressInDb(db: Database, userId: string): SnakeProgress {
  run(db, "insert or ignore into user_snake_progress (user_id, score, revision, updated_at) values (?, 0, 0, ?)", userId, now());
  run(db, "update user_snake_progress set score = 0, revision = revision + 1, updated_at = ? where user_id = ?", now(), userId);
  return snakeProgressFromDb(db, userId);
}

export const snakeProgress = (userId: string) => snakeProgressFromDb(appDb, userId);
export const saveSnakeProgress = (userId: string, score: number, revision: number) => saveSnakeProgressToDb(appDb, userId, score, revision);
export const resetSnakeProgress = (userId: string) => resetSnakeProgressInDb(appDb, userId);
