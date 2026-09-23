import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDirectory = String(Bun.env.GPT_IMAGE_DATA_DIR ?? "").trim()
  ? path.resolve(String(Bun.env.GPT_IMAGE_DATA_DIR).trim())
  : path.join(process.cwd(), "data");
const databasePath = String(Bun.env.GPT_IMAGE_CONFIG_DB_PATH ?? "").trim()
  ? path.resolve(String(Bun.env.GPT_IMAGE_CONFIG_DB_PATH).trim())
  : path.join(dataDirectory, "config.db");

const entries = [
  {
    id: "app-update-preview-v0.1.80",
    version: "v0.1.80",
    releaseDate: "2026-09-22",
    content: `- 新增小马良版本提醒：旧页面检测到服务端新版本时，会在右下角显示友好的更新入口。\n- 更新卡片支持查看本次版本日志，并可一键刷新到最新前端。\n- 优化更新提醒的收起与再次展开体验，未完成刷新前会保留小马良入口。`
  },
  {
    id: "app-update-preview-v0.1.81",
    version: "v0.1.81",
    releaseDate: "2026-09-22",
    content: `- 更新提醒加入更清晰的版本对比和刷新状态反馈。\n- 关于页面现在同时展示客户端版本与服务端版本，方便确认是否已经完成更新。\n- 优化移动端更新卡片的底部展开布局。`
  }
];

export function applyAppUpdatePreviewEntries(db: Database, clear = false) {
  db.exec(`
    create table if not exists changelog_entries (
      id text primary key,
      version text not null unique,
      release_date text not null,
      content text not null,
      created_at text not null,
      updated_at text not null
    )
  `);
  return db.transaction(() => {
    if (clear) {
      const remove = db.query(`
        delete from changelog_entries
        where id = ? and version = ? and release_date = ? and content = ?
      `);
      let removed = 0;
      for (const entry of entries) {
        removed += remove.run(entry.id, entry.version, entry.releaseDate, entry.content).changes;
      }
      return { inserted: 0, skipped: 0, removed };
    }

    const now = new Date().toISOString();
    const existingVersion = db.query("select 1 from changelog_entries where version = ?");
    const insert = db.query(`
      insert into changelog_entries (id, version, release_date, content, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (existingVersion.get(entry.version)) {
        skipped += 1;
      } else {
        insert.run(entry.id, entry.version, entry.releaseDate, entry.content, now, now);
        inserted += 1;
      }
    }
    return { inserted, skipped, removed: 0 };
  })();
}

if (import.meta.main) {
  const clear = Bun.argv.includes("--clear");
  if (clear && !existsSync(databasePath)) {
    console.log(`No app-update preview changelog entries to remove from ${databasePath}`);
  } else {
    const db = new Database(databasePath);
    try {
      const result = applyAppUpdatePreviewEntries(db, clear);
      console.log(`${clear ? "Cleared" : "Seeded"} app-update preview changelog entries in ${databasePath}:`, result);
    } finally {
      db.close();
    }
  }
}
