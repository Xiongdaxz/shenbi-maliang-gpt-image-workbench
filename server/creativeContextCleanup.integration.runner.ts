import assert from "node:assert/strict";
import path from "node:path";
import { createProfileStore } from "./creativeProfiles";

const directory = process.env.GPT_IMAGE_DATA_DIR || "";
assert(path.resolve(directory).startsWith(path.resolve(".tmp/creative-context-cleanup") + path.sep), "Disposable database required");
const { appDb, configDb, run, getOne } = await import("./db");
const { initAppDb, initConfigDb } = await import("./schema");
initAppDb(); initConfigDb();
const { deleteSessionRecords, deleteAllSessionRecords, deleteRequestEmptySessionRecord, deleteCancelledEmptySessionRecord } = await import("./chatStore");
const profiles = createProfileStore(appDb), timestamp = new Date().toISOString();
for (const user of ["owner", "other"]) run(appDb, "insert into users(id,account,username,password_hash,created_at,updated_at) values(?,?,?,?,?,?)", user, user, user, "unused", timestamp, timestamp);
const product = (name: string, shared = false) => profiles.save("owner", "product", { name, shared });
function session(id: string, user = "owner", requestId = id) {
  run(appDb, "insert into sessions(id,user_id,title,client_request_id,created_at,updated_at) values(?,?,?,?,?,?)", id, user, id, requestId, timestamp, timestamp);
}
function link(sessionId: string, profileId: string, user = "owner") {
  run(appDb, "insert into creative_session_context(session_id,user_id,selection_json) values(?,?,?)", sessionId, user, JSON.stringify({ productId: profileId }));
}
const context = (id: string) => getOne<{ selection_json: string }>(appDb, "select selection_json from creative_session_context where session_id=?", id);
const liveSession = (id: string) => getOne(appDb, "select id from sessions where id=?", id);
function job(id: string, sessionId: string, status: string) {
  run(appDb, "insert into image_jobs(id,user_id,session_id,type,status,prompt,provider_id,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)", id, "owner", sessionId, "generation", status, "fixture", "fixture", timestamp, timestamp);
}

const first = product("Single-chat product");
session("single"); link("single", first.id);
assert.throws(() => profiles.remove("owner", first.id, first.revision, "product"), /对话引用/);
assert.equal(await deleteSessionRecords("other", "single"), false);
assert(context("single"), "Another user cannot unlink the owner's profile");
assert.equal(await deleteSessionRecords("owner", "single"), true);
assert.equal(context("single"), null, "Deleting a chat must remove its creative selection");
assert.deepEqual(profiles.remove("owner", first.id, first.revision, "product"), { ok: true });

const shared = product("Shared live reference", true);
session("other-chat", "other"); link("other-chat", shared.id, "other");
run(appDb, "update sessions set archived_at=? where id='other-chat'", timestamp);
assert.throws(() => profiles.remove("owner", shared.id, shared.revision, "product"), /对话引用/, "Archived chats still protect shared records");

const empty = product("Empty request");
session("empty", "owner", "request-empty"); link("empty", empty.id);
assert.equal(deleteRequestEmptySessionRecord("owner", "empty", "wrong-request"), false);
assert.equal(deleteRequestEmptySessionRecord("other", "empty", "request-empty"), false);
assert(context("empty"));
run(appDb, "insert into messages(id,session_id,user_id,role,content,created_at) values('message','empty','owner','user','keep',?)", timestamp);
assert.equal(deleteRequestEmptySessionRecord("owner", "empty", "request-empty"), false);
assert(context("empty"));
run(appDb, "delete from messages where id='message'");
assert.equal(deleteRequestEmptySessionRecord("owner", "empty", "request-empty"), true);
assert.equal(context("empty"), null);

session("cancelled", "owner", "request-cancelled"); link("cancelled", empty.id);
job("cancelled-job", "cancelled", "cancelled"); job("active-job", "cancelled", "running");
assert.equal(deleteCancelledEmptySessionRecord("owner", "cancelled", "request-cancelled"), false);
assert(context("cancelled"));
run(appDb, "delete from image_jobs where id='active-job'");
assert.equal(deleteCancelledEmptySessionRecord("owner", "cancelled", "wrong-request"), false);
assert.equal(deleteCancelledEmptySessionRecord("owner", "cancelled", "request-cancelled"), true);
assert.equal(context("cancelled"), null);

session("rollback", "owner", "request-rollback"); link("rollback", empty.id);
appDb.exec("create trigger reject_fixture_context_delete before delete on creative_session_context when old.session_id='rollback' begin select raise(abort,'fixture cleanup failure'); end");
assert.throws(() => deleteRequestEmptySessionRecord("owner", "rollback", "request-rollback"), /fixture cleanup failure/);
assert(liveSession("rollback"), "Chat removal and selection cleanup must roll back together");
assert(context("rollback"));
appDb.exec("drop trigger reject_fixture_context_delete");
assert.equal(deleteRequestEmptySessionRecord("owner", "rollback", "request-rollback"), true);

const legacy = product("Legacy orphan");
link("missing-chat", legacy.id);
assert.deepEqual(profiles.remove("owner", legacy.id, legacy.revision, "product"), { ok: true }, "Missing chats must not block deletion");
const deleted = product("Legacy soft deletion");
session("soft-deleted"); link("soft-deleted", deleted.id);
run(appDb, "update sessions set deleted_at=? where id='soft-deleted'", timestamp);
assert.deepEqual(profiles.remove("owner", deleted.id, deleted.revision, "product"), { ok: true });

const mismatched = product("Invalid cross-owner context");
session("mismatched-owner"); link("mismatched-owner", mismatched.id, "other");
assert.deepEqual(profiles.remove("owner", mismatched.id, mismatched.revision, "product"), { ok: true });

const frozen = JSON.stringify({ selection: { productId: empty.id }, instruction: "Immutable execution history" });
run(appDb, "insert into image_job_profile_context(job_id,user_id,snapshot_json,created_at) values('history','owner',?,?)", frozen, timestamp);
session("bulk-one"); link("bulk-one", empty.id);
session("bulk-two"); link("bulk-two", empty.id);
const otherContext = context("other-chat")!.selection_json;
const ownerCount = getOne<{ n: number }>(appDb, "select count(*) as n from sessions where user_id='owner'")!.n;
assert.equal(await deleteAllSessionRecords("owner"), ownerCount);
assert.equal(getOne<{ n: number }>(appDb, "select count(*) as n from creative_session_context where user_id='owner'")!.n, 0);
assert.equal(context("other-chat")?.selection_json, otherContext);
assert(liveSession("other-chat"));
assert.equal(getOne<{ snapshot_json: string }>(appDb, "select snapshot_json from image_job_profile_context where job_id='history'")?.snapshot_json, frozen);
assert.throws(() => profiles.remove("owner", shared.id, shared.revision, "product"), /对话引用/);
assert.deepEqual(profiles.remove("owner", empty.id, empty.revision, "product"), { ok: true });

console.log("CREATIVE_CONTEXT_CLEANUP_OK single bulk request cancelled rollback legacy ownership frozen-history");
appDb.close(); configDb.close();
