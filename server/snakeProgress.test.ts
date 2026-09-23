import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { resetSnakeProgressInDb, saveSnakeProgressToDb, snakeProgressFromDb } from "./snakeProgress";

const databases: Database[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function progressDb() {
  const db = new Database(":memory:");
  databases.push(db);
  db.exec(`create table user_snake_progress (
    user_id text primary key,
    score integer not null default 0,
    revision integer not null default 0,
    updated_at text not null
  )`);
  return db;
}

describe("snake score progress", () => {
  test("keeps each user's score and ignores an older in-flight save", () => {
    const db = progressDb();
    expect(snakeProgressFromDb(db, "a")).toEqual({ score: 0, revision: 0 });
    expect(saveSnakeProgressToDb(db, "a", 3, 0)).toEqual({ accepted: true, progress: { score: 3, revision: 0 } });
    expect(saveSnakeProgressToDb(db, "a", 2, 0).progress.score).toBe(3);
    expect(snakeProgressFromDb(db, "b")).toEqual({ score: 0, revision: 0 });

    expect(resetSnakeProgressInDb(db, "a")).toEqual({ score: 0, revision: 1 });
    expect(saveSnakeProgressToDb(db, "a", 4, 0)).toEqual({ accepted: false, progress: { score: 0, revision: 1 } });
    expect(saveSnakeProgressToDb(db, "a", 1, 1)).toEqual({ accepted: true, progress: { score: 1, revision: 1 } });
  });
});
