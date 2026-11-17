import type { Database } from "bun:sqlite";

/** Keep registered application identity separate from each user's authorized connection. */
export function initMcpConnectionSchema(db: Database) {
  db.transaction(() => {
    const columns = new Set((db.query("pragma table_info(oauth_grants)").all() as { name: string }[]).map((row) => row.name));
    if (!columns.has("connection_key")) db.run("alter table oauth_grants add column connection_key text not null default ''");
    if (!columns.has("device_name")) db.run("alter table oauth_grants add column device_name text");
    if (!columns.has("device_type")) db.run("alter table oauth_grants add column device_type text");
    db.run(`update oauth_grants set
      device_name = coalesce(device_name, (select device_name from oauth_clients where id = client_id), ''),
      device_type = coalesce(device_type, (select device_type from oauth_clients where id = client_id), '')
      where connection_key = '' and (device_name is null or device_type is null)`);
    db.run("drop index if exists oauth_grants_user_client_idx");
    db.run("create unique index if not exists oauth_grants_user_client_connection_idx on oauth_grants(user_id, client_id, connection_key)");
  })();
}
