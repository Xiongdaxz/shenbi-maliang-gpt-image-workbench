import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import {
  enabledImageTaskSoundIds,
  inspectImageTaskSound,
  migrateEncryptedImageTaskSounds,
  migrateLegacyImageTaskSounds,
  registerImageTaskSoundRoutes
} from "./imageTaskSounds";

const temporaryDirectories: string[] = [];
const databases: Database[] = [];

afterEach(async () => {
  while (databases.length) databases.pop()?.close();
  while (temporaryDirectories.length) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function createSoundTable(db: Database) {
  db.exec(`create table image_task_sounds (
    id text primary key,
    name text not null,
    path text not null,
    original_file_name text not null default '',
    mime_type text not null,
    size integer not null default 0,
    sha256 text not null,
    enabled integer not null default 1,
    created_at text not null,
    updated_at text not null
  )`);
  db.exec("create unique index image_task_sounds_sha256_idx on image_task_sounds(sha256) where sha256 <> ''");
}

function fakeMp3() {
  const id3Header = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const frame = Buffer.alloc(417, 0);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat([id3Header, frame, frame]);
}

function fakeWav() {
  const buffer = Buffer.alloc(48, 0);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(40, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44_100, 24);
  buffer.writeUInt32LE(88_200, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(4, 40);
  buffer.set([0xff, 0xfb, 0x90, 0x64], 44);
  return buffer;
}

function fakeOgg() {
  const opusHead = Buffer.from("OpusHead", "ascii");
  const buffer = Buffer.alloc(28 + opusHead.length, 0);
  buffer.write("OggS", 0, "ascii");
  buffer[26] = 1;
  buffer[27] = opusHead.length;
  opusHead.copy(buffer, 28);
  return buffer;
}

function insertSound(db: Database, input: { id: string; enabled?: boolean; buffer?: Buffer }) {
  const buffer = input.buffer ?? Buffer.concat([fakeMp3(), Buffer.from(input.id)]);
  const relativePath = `files/image-task-sounds/${input.id}.mp3`;
  db.query(`insert into image_task_sounds (
    id, name, path, original_file_name, mime_type, size, sha256, enabled, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    input.id,
    input.id,
    relativePath,
    `${input.id}.mp3`,
    "audio/mpeg",
    buffer.length,
    createHash("sha256").update(buffer).digest("hex"),
    input.enabled === false ? 0 : 1,
    "2026-07-24T00:00:00.000Z",
    "2026-07-24T00:00:00.000Z"
  );
  return relativePath;
}

describe("image task sound storage", () => {
  test("recognizes supported audio headers and rejects arbitrary bytes", () => {
    expect(inspectImageTaskSound(fakeMp3())?.mimeType).toBe("audio/mpeg");
    expect(inspectImageTaskSound(fakeWav())?.mimeType).toBe("audio/wav");
    expect(inspectImageTaskSound(fakeOgg())?.mimeType).toBe("audio/ogg");
    expect(inspectImageTaskSound(Buffer.from("ID3 without an MPEG frame"))).toBeNull();
    expect(inspectImageTaskSound(Buffer.from("RIFF0000WAVEfmt "))).toBeNull();
    expect(inspectImageTaskSound(Buffer.from("OggS0000"))).toBeNull();
    expect(inspectImageTaskSound(Buffer.from("not audio"))).toBeNull();
  });

  test("converts encrypted sound records to plain audio without changing administrator settings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gpt-image-sounds-decrypt-"));
    temporaryDirectories.push(root);
    const dataDir = path.join(root, "data");
    const dataPath = (relativePath: string) => path.join(dataDir, relativePath.replaceAll("/", path.sep));
    const encryptedPath = "files/secure/image-task-sounds/maliang-001.gaud";
    const orphanEncryptedPath = "files/secure/image-task-sounds/orphan.gaud";
    const plainPath = "files/image-task-sounds/maliang-001.mp3";
    const buffer = fakeMp3();
    await mkdir(path.dirname(dataPath(encryptedPath)), { recursive: true });
    await writeFile(dataPath(encryptedPath), Buffer.from("encrypted-placeholder"));
    await writeFile(dataPath(orphanEncryptedPath), Buffer.from("orphan-encrypted-placeholder"));
    const db = new Database(":memory:");
    databases.push(db);
    createSoundTable(db);
    db.query(`insert into image_task_sounds (
      id, name, path, original_file_name, mime_type, size, sha256, enabled, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "maliang-001",
      "管理员改名",
      encryptedPath,
      "old.mp3",
      "audio/mpeg",
      10,
      "old-hash",
      0,
      "2026-07-20T00:00:00.000Z",
      "2026-07-21T00:00:00.000Z"
    );
    const writeSoundFile = async (relativePath: string, content: Buffer) => {
      await mkdir(path.dirname(dataPath(relativePath)), { recursive: true });
      await writeFile(dataPath(relativePath), content);
    };

    const first = await migrateEncryptedImageTaskSounds({
      db,
      dataPath,
      readSoundFile: async (relativePath) => {
        expect(relativePath).toBe(encryptedPath);
        return buffer;
      },
      writeSoundFile,
      recordAudit: false
    });
    expect(first).toEqual({ migratedIds: ["maliang-001"], failed: [] });
    expect(await readFile(dataPath(plainPath))).toEqual(buffer);
    expect(await stat(dataPath(encryptedPath)).catch(() => null)).toBeNull();
    expect(await stat(dataPath(orphanEncryptedPath)).catch(() => null)).toBeNull();
    expect(db.query(`select name, path, mime_type as mimeType, size, sha256, enabled,
      created_at as createdAt, updated_at as updatedAt from image_task_sounds where id = ?`).get("maliang-001"))
      .toEqual({
        name: "管理员改名",
        path: plainPath,
        mimeType: "audio/mpeg",
        size: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        enabled: 0,
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z"
      });
    expect(await migrateEncryptedImageTaskSounds({ db, dataPath, writeSoundFile, recordAudit: false }))
      .toEqual({ migratedIds: [], failed: [] });
  });

  test("keeps the encrypted source and database path when plain conversion fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gpt-image-sounds-decrypt-failure-"));
    temporaryDirectories.push(root);
    const dataDir = path.join(root, "data");
    const dataPath = (relativePath: string) => path.join(dataDir, relativePath.replaceAll("/", path.sep));
    const encryptedPath = "files/secure/image-task-sounds/maliang-001.gaud";
    const orphanEncryptedPath = "files/secure/image-task-sounds/orphan.gaud";
    const plainPath = "files/image-task-sounds/maliang-001.mp3";
    await mkdir(path.dirname(dataPath(encryptedPath)), { recursive: true });
    await writeFile(dataPath(encryptedPath), Buffer.from("encrypted-placeholder"));
    await writeFile(dataPath(orphanEncryptedPath), Buffer.from("orphan-encrypted-placeholder"));
    const db = new Database(":memory:");
    databases.push(db);
    createSoundTable(db);
    db.query(`insert into image_task_sounds (
      id, name, path, original_file_name, mime_type, size, sha256, enabled, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "maliang-001", "保留设置", encryptedPath, "old.mp3", "audio/mpeg", 1, "old-hash", 0,
      "2026-07-20T00:00:00.000Z", "2026-07-21T00:00:00.000Z"
    );

    const result = await migrateEncryptedImageTaskSounds({
      db,
      dataPath,
      readSoundFile: async () => fakeMp3(),
      writeSoundFile: async (relativePath, buffer) => {
        await mkdir(path.dirname(dataPath(relativePath)), { recursive: true });
        await writeFile(dataPath(relativePath), buffer);
        throw new Error("simulated plain write failure");
      },
      recordAudit: false
    });
    expect(result.failed).toEqual([{ id: "maliang-001", error: "simulated plain write failure" }]);
    expect((await stat(dataPath(encryptedPath))).isFile()).toBe(true);
    expect(await stat(dataPath(orphanEncryptedPath)).catch(() => null)).toBeNull();
    expect(await stat(dataPath(plainPath)).catch(() => null)).toBeNull();
    expect(db.query("select name, path, enabled from image_task_sounds where id = ?").get("maliang-001"))
      .toEqual({ name: "保留设置", path: encryptedPath, enabled: 0 });
  });

  test("removes the new plain file and keeps the encrypted source when the database update fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gpt-image-sounds-decrypt-db-failure-"));
    temporaryDirectories.push(root);
    const dataDir = path.join(root, "data");
    const dataPath = (relativePath: string) => path.join(dataDir, relativePath.replaceAll("/", path.sep));
    const encryptedPath = "files/secure/image-task-sounds/maliang-001.gaud";
    const plainPath = "files/image-task-sounds/maliang-001.mp3";
    const buffer = fakeMp3();
    const digest = createHash("sha256").update(buffer).digest("hex");
    await mkdir(path.dirname(dataPath(encryptedPath)), { recursive: true });
    await writeFile(dataPath(encryptedPath), Buffer.from("encrypted-placeholder"));
    const db = new Database(":memory:");
    databases.push(db);
    createSoundTable(db);
    db.query(`insert into image_task_sounds (
      id, name, path, original_file_name, mime_type, size, sha256, enabled, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "maliang-001", "待迁移", encryptedPath, "old.mp3", "audio/mpeg", 1, "old-hash", 1,
      "2026-07-20T00:00:00.000Z", "2026-07-21T00:00:00.000Z",
      "duplicate", "重复音频", "files/image-task-sounds/duplicate.mp3", "duplicate.mp3", "audio/mpeg",
      buffer.length, digest, 1, "2026-07-20T00:00:00.000Z", "2026-07-21T00:00:00.000Z"
    );

    const result = await migrateEncryptedImageTaskSounds({
      db,
      dataPath,
      readSoundFile: async () => buffer,
      writeSoundFile: async (relativePath, content) => {
        await mkdir(path.dirname(dataPath(relativePath)), { recursive: true });
        await writeFile(dataPath(relativePath), content);
      },
      recordAudit: false
    });
    expect(result.migratedIds).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect((await stat(dataPath(encryptedPath))).isFile()).toBe(true);
    expect(await stat(dataPath(plainPath)).catch(() => null)).toBeNull();
    expect(db.query("select path, sha256 from image_task_sounds where id = ?").get("maliang-001"))
      .toEqual({ path: encryptedPath, sha256: "old-hash" });
  });

  test("migrates legacy files once, archives originals, and preserves renamed records", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gpt-image-sounds-"));
    temporaryDirectories.push(root);
    const publicDir = path.join(root, "public");
    const distDir = path.join(root, "dist");
    const backupDir = path.join(root, "backup");
    const dataDir = path.join(root, "data");
    const legacyPath = path.join(publicDir, "maliang-001.mp3");
    await mkdir(publicDir, { recursive: true });
    await writeFile(legacyPath, fakeMp3());
    const db = new Database(":memory:");
    databases.push(db);
    createSoundTable(db);
    const dataPath = (relativePath: string) => path.join(dataDir, relativePath.replaceAll("/", path.sep));
    let writeCount = 0;
    const writeSoundFile = async (relativePath: string, buffer: Buffer) => {
      writeCount += 1;
      const target = dataPath(relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
    };

    const first = await migrateLegacyImageTaskSounds({
      db,
      publicLegacyDir: publicDir,
      distLegacyDir: distDir,
      backupDir,
      writeSoundFile,
      dataPath,
      recordAudit: false
    });
    expect(first).toEqual({ migratedIds: ["maliang-001"], failed: [] });
    expect(enabledImageTaskSoundIds(db)).toEqual(["maliang-001"]);
    const row = db.query("select id, name, mime_type as mimeType, size from image_task_sounds").get() as Record<string, unknown>;
    expect(row.id).toBe("maliang-001");
    expect(row.name).toBe("正确提示");
    expect(row.mimeType).toBe("audio/mpeg");
    expect(Number(row.size)).toBe(fakeMp3().length);
    expect(writeCount).toBe(1);
    expect((await stat(path.join(backupDir, "public", "maliang-001.mp3"))).isFile()).toBe(true);
    expect(await stat(legacyPath).catch(() => null)).toBeNull();

    db.query("update image_task_sounds set name = ?, enabled = 0, updated_at = ? where id = ?")
      .run("自定义成功音", "2026-07-24T00:00:00.000Z", "maliang-001");
    await mkdir(publicDir, { recursive: true });
    await writeFile(legacyPath, fakeMp3());
    const second = await migrateLegacyImageTaskSounds({
      db,
      publicLegacyDir: publicDir,
      distLegacyDir: distDir,
      backupDir,
      writeSoundFile,
      dataPath,
      recordAudit: false
    });
    expect(second.failed).toEqual([]);
    expect(db.query("select name, enabled from image_task_sounds where id = ?").get("maliang-001")).toEqual({
      name: "自定义成功音",
      enabled: 0
    });
    expect(db.query("select updated_at as updatedAt from image_task_sounds where id = ?").get("maliang-001"))
      .toEqual({ updatedAt: "2026-07-24T00:00:00.000Z" });
    expect(writeCount).toBe(1);
    expect(await readFile(path.join(backupDir, "public", "maliang-001.mp3"))).toEqual(fakeMp3());
  });

  test("restores a missing managed file without overwriting the administrator name or status", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gpt-image-sounds-restore-"));
    temporaryDirectories.push(root);
    const publicDir = path.join(root, "public");
    const dataDir = path.join(root, "data");
    const dataPath = (relativePath: string) => path.join(dataDir, relativePath.replaceAll("/", path.sep));
    const relativePath = "files/image-task-sounds/maliang-001.mp3";
    const db = new Database(":memory:");
    databases.push(db);
    createSoundTable(db);
    db.query(`insert into image_task_sounds (
      id, name, path, original_file_name, mime_type, size, sha256, enabled, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "maliang-001",
      "管理员改名",
      relativePath,
      "old.mp3",
      "audio/mpeg",
      10,
      "old-hash",
      0,
      "2026-07-20T00:00:00.000Z",
      "2026-07-21T00:00:00.000Z"
    );
    await mkdir(publicDir, { recursive: true });
    await writeFile(path.join(publicDir, "maliang-001.mp3"), fakeMp3());
    const result = await migrateLegacyImageTaskSounds({
      db,
      publicLegacyDir: publicDir,
      distLegacyDir: path.join(root, "dist"),
      backupDir: path.join(root, "backup"),
      dataPath,
      writeSoundFile: async (target, buffer) => {
        await mkdir(path.dirname(dataPath(target)), { recursive: true });
        await writeFile(dataPath(target), buffer);
      },
      recordAudit: false
    });

    expect(result).toEqual({ migratedIds: ["maliang-001"], failed: [] });
    expect(await readFile(dataPath(relativePath))).toEqual(fakeMp3());
    expect(db.query("select name, enabled from image_task_sounds where id = ?").get("maliang-001"))
      .toEqual({ name: "管理员改名", enabled: 0 });
  });

  test("cleans temporary and final files when migration fails before the database record is committed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gpt-image-sounds-failure-"));
    temporaryDirectories.push(root);
    const publicDir = path.join(root, "public");
    const dataDir = path.join(root, "data");
    const dataPath = (relativePath: string) => path.join(dataDir, relativePath.replaceAll("/", path.sep));
    const legacyPath = path.join(publicDir, "maliang-001.mp3");
    const db = new Database(":memory:");
    databases.push(db);
    createSoundTable(db);
    await mkdir(publicDir, { recursive: true });
    await writeFile(legacyPath, fakeMp3());

    const writeFailure = await migrateLegacyImageTaskSounds({
      db,
      publicLegacyDir: publicDir,
      distLegacyDir: path.join(root, "dist"),
      backupDir: path.join(root, "backup"),
      dataPath,
      writeSoundFile: async (target, buffer) => {
        await mkdir(path.dirname(dataPath(target)), { recursive: true });
        await writeFile(dataPath(target), buffer);
        throw new Error("simulated write failure");
      },
      recordAudit: false
    });
    expect(writeFailure.failed).toEqual([{ id: "maliang-001", error: "simulated write failure" }]);
    expect(db.query("select count(*) as total from image_task_sounds").get()).toEqual({ total: 0 });
    expect(await readdir(path.join(dataDir, "files", "image-task-sounds")).catch(() => [])).toEqual([]);
    expect((await stat(legacyPath)).isFile()).toBe(true);

    db.query(`insert into image_task_sounds (
      id, name, path, original_file_name, mime_type, size, sha256, enabled, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "another-sound",
      "重复内容",
      "files/image-task-sounds/another-sound.mp3",
      "duplicate.mp3",
      "audio/mpeg",
      fakeMp3().length,
      createHash("sha256").update(fakeMp3()).digest("hex"),
      1,
      "2026-07-24T00:00:00.000Z",
      "2026-07-24T00:00:00.000Z"
    );
    const databaseFailure = await migrateLegacyImageTaskSounds({
      db,
      publicLegacyDir: publicDir,
      distLegacyDir: path.join(root, "dist"),
      backupDir: path.join(root, "backup"),
      dataPath,
      writeSoundFile: async (target, buffer) => {
        await mkdir(path.dirname(dataPath(target)), { recursive: true });
        await writeFile(dataPath(target), buffer);
      },
      recordAudit: false
    });
    expect(databaseFailure.failed).toHaveLength(1);
    expect(await stat(dataPath("files/image-task-sounds/maliang-001.mp3")).catch(() => null)).toBeNull();
    expect((await stat(legacyPath)).isFile()).toBe(true);
  });

  test("keeps a fresh installation empty when no legacy files exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gpt-image-sounds-empty-"));
    temporaryDirectories.push(root);
    const db = new Database(":memory:");
    databases.push(db);
    createSoundTable(db);
    const result = await migrateLegacyImageTaskSounds({
      db,
      publicLegacyDir: path.join(root, "public"),
      distLegacyDir: path.join(root, "dist"),
      backupDir: path.join(root, "backup"),
      recordAudit: false
    });
    expect(result).toEqual({ migratedIds: [], failed: [] });
    expect(db.query("select count(*) as total from image_task_sounds").get()).toEqual({ total: 0 });
  });
});

describe("image task sound routes", () => {
  test("enforces user/admin access and serves byte ranges", async () => {
    const db = new Database(":memory:");
    databases.push(db);
    createSoundTable(db);
    insertSound(db, { id: "enabled-sound" });
    insertSound(db, { id: "disabled-sound", enabled: false });
    const app = new Hono();
    registerImageTaskSoundRoutes(app, {
      db,
      getCurrentUser: async (c) => c.req.header("x-test-user") ? ({ id: "user_1" } as never) : null,
      configAuthed: (c) => c.req.header("x-test-config") === "1",
      configGuard: (c) => c.req.header("x-test-config") === "1" ? null : c.json({ error: "配置页面未登录" }, 401),
      readSoundFile: async () => fakeMp3(),
      recordAudit: () => undefined
    });

    expect((await app.request("/image-task-sounds")).status).toBe(401);
    const catalogResponse = await app.request("/image-task-sounds", { headers: { "x-test-user": "1" } });
    expect(catalogResponse.status).toBe(200);
    expect((await catalogResponse.json() as { sounds: Array<{ id: string }> }).sounds.map((sound) => sound.id))
      .toEqual(["enabled-sound"]);
    expect((await app.request("/image-task-sounds/enabled-sound/file")).status).toBe(401);
    expect((await app.request("/image-task-sounds/disabled-sound/file", { headers: { "x-test-user": "1" } })).status)
      .toBe(404);
    expect((await app.request("/config/image-task-sounds")).status).toBe(401);

    const rangeResponse = await app.request("/image-task-sounds/disabled-sound/file", {
      headers: { "x-test-config": "1", range: "bytes=3-6" }
    });
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get("content-range")).toBe(`bytes 3-6/${fakeMp3().length}`);
    expect(rangeResponse.headers.get("accept-ranges")).toBe("bytes");
    expect((await rangeResponse.arrayBuffer()).byteLength).toBe(4);
    expect((await app.request("/image-task-sounds/enabled-sound/file", {
      headers: { "x-test-config": "1", range: "bytes=999999-" }
    })).status).toBe(416);
  });

  test("rejects invalid and duplicate uploads and audits CRUD operations", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gpt-image-sound-routes-"));
    temporaryDirectories.push(root);
    const db = new Database(":memory:");
    databases.push(db);
    createSoundTable(db);
    const auditActions: string[] = [];
    const dataPath = (relativePath: string) => path.join(root, relativePath.replaceAll("/", path.sep));
    const app = new Hono();
    registerImageTaskSoundRoutes(app, {
      db,
      getCurrentUser: async () => null,
      configAuthed: (c) => c.req.header("x-test-config") === "1",
      configGuard: (c) => c.req.header("x-test-config") === "1" ? null : c.json({ error: "配置页面未登录" }, 401),
      dataPath,
      writeSoundFile: async (relativePath, buffer) => {
        await mkdir(path.dirname(dataPath(relativePath)), { recursive: true });
        await writeFile(dataPath(relativePath), buffer);
      },
      recordAudit: (action) => auditActions.push(action)
    });
    const adminHeaders = { "x-test-config": "1" };
    const invalidForm = new FormData();
    invalidForm.set("file", new File(["not audio"], "fake.mp3", { type: "audio/mpeg" }));
    expect((await app.request("/config/image-task-sounds", {
      method: "POST",
      headers: adminHeaders,
      body: invalidForm
    })).status).toBe(400);

    const oversizedForm = new FormData();
    oversizedForm.set("file", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.mp3", { type: "audio/mpeg" }));
    expect((await app.request("/config/image-task-sounds", {
      method: "POST",
      headers: adminHeaders,
      body: oversizedForm
    })).status).toBe(400);

    const uploadForm = new FormData();
    uploadForm.set("name", "  自定义提示音  ");
    uploadForm.set("file", new File([fakeMp3()], "custom.mp3", { type: "text/plain" }));
    const uploadResponse = await app.request("/config/image-task-sounds", {
      method: "POST",
      headers: adminHeaders,
      body: uploadForm
    });
    expect(uploadResponse.status).toBe(201);
    const uploaded = (await uploadResponse.json() as { sounds: Array<{ id: string; name: string }> }).sounds[0];
    expect(uploaded.name).toBe("自定义提示音");

    const duplicateForm = new FormData();
    duplicateForm.set("file", new File([fakeMp3()], "same.mp3", { type: "audio/mpeg" }));
    expect((await app.request("/config/image-task-sounds", {
      method: "POST",
      headers: adminHeaders,
      body: duplicateForm
    })).status).toBe(409);

    const patchResponse = await app.request(`/config/image-task-sounds/${uploaded.id}`, {
      method: "PATCH",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "改名后", enabled: false })
    });
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json() as { sounds: Array<{ name: string; enabled: boolean }> }).sounds[0])
      .toMatchObject({ name: "改名后", enabled: false });

    const storedPath = (db.query("select path from image_task_sounds where id = ?").get(uploaded.id) as { path: string }).path;
    expect(storedPath).toMatch(/^files\/image-task-sounds\/sound_[a-zA-Z0-9_-]+\.mp3$/);
    expect((await stat(dataPath(storedPath))).isFile()).toBe(true);
    expect(await readFile(dataPath(storedPath))).toEqual(fakeMp3());
    expect((await app.request(`/config/image-task-sounds/${uploaded.id}`, {
      method: "DELETE",
      headers: adminHeaders
    })).status).toBe(200);
    expect(db.query("select count(*) as total from image_task_sounds").get()).toEqual({ total: 0 });
    expect(await stat(dataPath(storedPath)).catch(() => null)).toBeNull();
    expect(auditActions).toEqual([
      "image_task_sound.upload",
      "image_task_sound.update",
      "image_task_sound.delete"
    ]);
  });
});
