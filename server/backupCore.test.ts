import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { referencedLegacyFilePaths, secureBackupFileEntries } from "./backupCore";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

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

  test("backs up referenced encrypted prompt sounds while excluding orphan remnants", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gpt-image-backup-secure-"));
    temporaryDirectories.push(root);
    const secureDir = path.join(root, "data", "files", "secure");
    const backupDir = path.join(root, "backups");
    const configDb = createConfigDb();
    await mkdir(path.join(secureDir, "image-task-sounds"), { recursive: true });
    await writeFile(path.join(secureDir, "account-secret.bin"), "account-secret");
    await writeFile(path.join(secureDir, "image-task-sounds", "referenced.gaud"), "referenced-sound");
    await writeFile(path.join(secureDir, "image-task-sounds", "orphan.gaud"), "orphan-sound");
    configDb.query("insert into image_task_sounds (path) values (?)")
      .run("files/secure/image-task-sounds/referenced.gaud");

    try {
      const entries = await secureBackupFileEntries(backupDir, secureDir, configDb);
      expect(entries.map((entry) => entry.archivePath)).toEqual([
        "files/secure/account-secret.bin",
        "files/secure/image-task-sounds/referenced.gaud"
      ]);
    } finally {
      configDb.close();
    }
  });
});
