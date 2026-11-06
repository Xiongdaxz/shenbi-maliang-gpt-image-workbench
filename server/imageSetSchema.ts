import type { Database } from "bun:sqlite";

export function initImageSetSchema(db: Database) {
  db.exec(`
    create table if not exists creative_profiles (
      id text primary key, kind text not null check(kind in ('brand','product')), user_id text not null,
      name text not null, brand_id text not null default '', shared integer not null default 0,
      archived integer not null default 0, revision integer not null default 1,
      details_json text not null, assets_json text not null, variants_json text not null,
      created_at text not null, updated_at text not null
    );
    create index if not exists creative_profiles_owner_kind_time_idx on creative_profiles(user_id,kind,updated_at,id);
    create index if not exists creative_profiles_brand_idx on creative_profiles(brand_id);
    create table if not exists image_job_profile_context (
      job_id text primary key, user_id text not null, snapshot_json text not null, created_at text not null
    );
    create table if not exists creative_session_context (
      session_id text primary key, user_id text not null, selection_json text not null
    );
    create table if not exists image_sets (
      id text primary key, user_id text not null, name text not null, brief text not null,
      common_style text not null, selection_json text not null, asset_ids_json text not null,
      provider_id text not null, model text not null, quality text not null, session_id text not null default '',
      revision integer not null default 1, context_revision integer not null default 1,
      confirmed integer not null default 0, archived integer not null default 0,
      stopped integer not null default 0, finalized integer not null default 0,
      anchor_item_id text not null, anchor_image_id text not null default '', anchor_reference_id text not null default '',
      anchor_revision integer not null default 0, snapshot_json text not null default 'null',
      reference_ids_json text not null default '[]', created_at text not null, updated_at text not null
    );
    create index if not exists image_sets_owner_time_idx on image_sets(user_id,updated_at,id);
    create table if not exists image_set_items (
      id text primary key, set_id text not null, name text not null, purpose text not null,
      copy text not null, size text not null, composition text not null, sort_order integer not null,
      revision integer not null default 1, removed integer not null default 0, selected_image_id text not null default '',
      selected_context_revision integer not null default 0, selected_item_revision integer not null default 0
    );
    create index if not exists image_set_items_set_order_idx on image_set_items(set_id,sort_order);
    create table if not exists image_set_runs (
      id text primary key, set_id text not null, item_id text not null, job_id text not null unique,
      client_request_id text not null, candidate_index integer not null, status text not null,
      context_revision integer not null, item_revision integer not null, snapshot_json text not null,
      error text not null default '', created_at text not null, updated_at text not null,
      unique(set_id,client_request_id,item_id,candidate_index)
    );
    create index if not exists image_set_runs_queue_idx on image_set_runs(status,created_at);
    create index if not exists image_set_runs_item_time_idx on image_set_runs(item_id,created_at,id);
    create table if not exists creative_example_seeds (
      user_id text not null, seed_key text not null, brand_id text not null, product_id text not null,
      set_id text not null, created_at text not null, primary key(user_id,seed_key),
      foreign key(user_id) references users(id) on delete cascade
    );
  `);
  const columns = db.query("pragma table_info(image_set_items)").all() as Array<{ name: string }>;
  if (!columns.some(c => c.name === "removed")) db.run("alter table image_set_items add column removed integer not null default 0");
  for (const table of ["creative_profiles", "image_sets"]) {
    const fields = db.query(`pragma table_info(${table})`).all() as Array<{ name: string }>;
    if (!fields.some(field => field.name === "is_example")) db.run(`alter table ${table} add column is_example integer not null default 0`);
  }
  const setColumns = db.query("pragma table_info(image_sets)").all() as Array<{ name: string }>;
  if (!setColumns.some(c => c.name === "execution_mode")) db.run("alter table image_sets add column execution_mode text not null default 'provider'");
  if (!setColumns.some(c => c.name === "demo_template")) db.run("alter table image_sets add column demo_template text not null default ''");
  const seedColumns = db.query("pragma table_info(creative_example_seeds)").all() as Array<{ name: string }>;
  if (!seedColumns.some(c => c.name === "completion_state")) db.run("alter table creative_example_seeds add column completion_state text not null default ''");
  if (!seedColumns.some(c => c.name === "manifest_json")) db.run("alter table creative_example_seeds add column manifest_json text not null default '{}'");
}
