import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { imageJobWasCancelled } from "./auditLog";
import { backfillCancelledProviderRequests } from "./schema";

const databases: Database[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function memoryDb() {
  const db = new Database(":memory:");
  databases.push(db);
  return db;
}

describe("provider request cancellation state", () => {
  test("recognizes only jobs with an explicit cancelled status", () => {
    const db = memoryDb();
    db.exec("create table image_jobs (id text primary key, status text not null)");
    db.query("insert into image_jobs values (?, ?), (?, ?)").run("job_cancelled", "cancelled", "job_failed", "failed");

    expect(imageJobWasCancelled(db, "job_cancelled")).toBe(true);
    expect(imageJobWasCancelled(db, "job_failed")).toBe(false);
    expect(imageJobWasCancelled(db, "missing")).toBe(false);
    expect(imageJobWasCancelled(db, "")).toBe(false);
  });

  test("backfills only failed requests belonging to cancelled jobs", () => {
    const jobsDb = memoryDb();
    const logsDb = memoryDb();
    jobsDb.exec("create table image_jobs (id text primary key, status text not null)");
    logsDb.exec("create table provider_request_logs (id text primary key, job_id text not null, success integer not null, cancelled integer not null default 0)");
    jobsDb.query("insert into image_jobs values (?, ?), (?, ?)").run("job_cancelled", "cancelled", "job_failed", "failed");
    logsDb.query("insert into provider_request_logs values (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)").run(
      "cancelled_failure",
      "job_cancelled",
      0,
      0,
      "cancelled_success",
      "job_cancelled",
      1,
      0,
      "ordinary_failure",
      "job_failed",
      0,
      0
    );

    backfillCancelledProviderRequests(jobsDb, logsDb);

    expect(logsDb.query("select id, cancelled from provider_request_logs order by id").all()).toEqual([
      { id: "cancelled_failure", cancelled: 1 },
      { id: "cancelled_success", cancelled: 0 },
      { id: "ordinary_failure", cancelled: 0 }
    ]);
  });
});
