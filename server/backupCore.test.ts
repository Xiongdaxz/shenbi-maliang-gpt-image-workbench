import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { referencedLegacyFilePaths } from "./backupCore";

function createAppDb() {
  const db = new Database(":memory:");
  db.exec(`
    create table images (path text);
    create table assets (path text);
    create table image_asset_references (path text);
    create table message_source_references (path text);
    create table users (avatar_path text);
    create table user_avatar_history (path text);
  `);
  return db;
}

function createConfigDb() {
  const db = new Database(":memory:");
  db.exec(`
    create table branding_assets (path text);
    create table image_task_sounds (path text);
  `);
  return db;
}

describe("backup referenced files", () => {
  test("includes managed prompt sounds and rejects secure or unsafe paths", () => {
    const appDb = createAppDb();
    const configDb = createConfigDb();
    try {
      appDb.query("insert into images (path) values (?)").run("files/images/image-1.png");
      configDb.query("insert into branding_assets (path) values (?)").run("files/branding/logo.png");
      const insertSound = configDb.query("insert into image_task_sounds (path) values (?)");
      insertSound.run("files/image-task-sounds/sound-1.mp3");
      insertSound.run("files/secure/image-task-sounds/legacy.enc");
      insertSound.run("files/image-task-sounds/../../outside.mp3");
      insertSound.run("other/sound.mp3");

      expect(referencedLegacyFilePaths(appDb, configDb)).toEqual([
        "files/branding/logo.png",
        "files/image-task-sounds/sound-1.mp3",
        "files/images/image-1.png"
      ]);
    } finally {
      appDb.close();
      configDb.close();
    }
  });
});
