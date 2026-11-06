import type { Database } from "bun:sqlite";
import type { ImageAccountRow } from "./types";
import { getOne, run, tableColumnExists } from "./db";
import { normalizeImageAccountStatus, now } from "./utils";

export function initImageAccountStatusSchema(db: Database) {
  if (!tableColumnExists(db, "image_accounts", "local_enabled")) db.run("alter table image_accounts add column local_enabled integer");
}

export function effectiveImageAccountStatus(account: Pick<ImageAccountRow, "status" | "local_enabled">) {
  const status = normalizeImageAccountStatus(account.status);
  if (account.local_enabled === 0) return "disabled";
  return account.local_enabled === 1 && status === "disabled" ? "normal" : status;
}

export function setImageAccountEnabled(db: Database, id: string, enabled: boolean) {
  run(db, "update image_accounts set local_enabled = ?, updated_at = ? where id = ?", enabled ? 1 : 0, now(), id);
  return getOne<ImageAccountRow>(db, "select * from image_accounts where id = ?", id);
}
