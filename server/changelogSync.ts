import { readFile } from "node:fs/promises";
import path from "node:path";
import { configDb, getOne, run } from "./db";
import { ROOT } from "./paths";
import type { ChangelogEntryRow } from "./types";
import { makeId, now } from "./utils";

const CHANGELOG_PATH = path.join(ROOT, "docs", "changelog.md");
const CHANGELOG_HEADING = /^##\s+(.+?)\s+[-–—]\s+(\d{4}-\d{2}-\d{2})\s*$/;
const SECTION_HEADING = /^##\s+/;
const MAX_CHANGELOG_CONTENT_LENGTH = 50000;

export type MarkdownChangelogEntry = {
  version: string;
  date: string;
  content: string;
};

export type ChangelogSyncAction = "create" | "update" | "unchanged";

export type ChangelogSyncPreviewEntry = MarkdownChangelogEntry & {
  action: ChangelogSyncAction;
};

export type ChangelogSyncResult = {
  sourceFound: boolean;
  parsed: number;
  selected: number;
  inserted: number;
  updated: number;
};

export function parseChangelogMarkdown(markdown: string): MarkdownChangelogEntry[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const entries: MarkdownChangelogEntry[] = [];
  const seenVersions = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const match = CHANGELOG_HEADING.exec(lines[index].trim());
    if (!match) continue;

    let end = index + 1;
    while (end < lines.length && !SECTION_HEADING.test(lines[end].trim())) {
      end += 1;
    }

    const version = match[1].trim();
    const content = lines
      .slice(index + 1, end)
      .join("\n")
      .trim()
      .slice(0, MAX_CHANGELOG_CONTENT_LENGTH);

    if (version && content && !seenVersions.has(version)) {
      entries.push({ version, date: match[2], content });
      seenVersions.add(version);
    }

    index = end - 1;
  }

  return entries;
}

async function readMarkdownChangelog() {
  const markdown = await readFile(CHANGELOG_PATH, "utf8").catch(() => null);
  if (markdown === null) {
    return { sourceFound: false, entries: [] as MarkdownChangelogEntry[] };
  }
  return { sourceFound: true, entries: parseChangelogMarkdown(markdown) };
}

export async function previewChangelogSync() {
  const { sourceFound, entries } = await readMarkdownChangelog();
  const previewEntries: ChangelogSyncPreviewEntry[] = entries.map((entry) => {
    const existing = getOne<ChangelogEntryRow>(
      configDb,
      "select release_date, content from changelog_entries where version = ? limit 1",
      entry.version
    );
    const action: ChangelogSyncAction = !existing
      ? "create"
      : existing.release_date !== entry.date || existing.content !== entry.content
        ? "update"
        : "unchanged";
    return { ...entry, action };
  });
  return { sourceFound, entries: previewEntries };
}

export async function syncSelectedChangelogFromMarkdown(selectedVersions: string[]): Promise<ChangelogSyncResult> {
  const { sourceFound, entries } = await readMarkdownChangelog();
  if (!sourceFound) {
    return { sourceFound: false, parsed: 0, selected: 0, inserted: 0, updated: 0 };
  }

  const selected = new Set(selectedVersions.map((version) => version.trim()).filter(Boolean));
  const entriesToSync = entries.filter((entry) => selected.has(entry.version));

  let inserted = 0;
  let updated = 0;

  const sync = configDb.transaction(() => {
    for (const entry of entriesToSync) {
      const existing = getOne<ChangelogEntryRow>(
        configDb,
        "select * from changelog_entries where version = ? limit 1",
        entry.version
      );

      if (!existing) {
        const timestamp = now();
        run(
          configDb,
          `insert into changelog_entries (
            id, version, release_date, content, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?)`,
          makeId("changelog"),
          entry.version,
          entry.date,
          entry.content,
          timestamp,
          timestamp
        );
        inserted += 1;
        continue;
      }

      if (existing.release_date === entry.date && existing.content === entry.content) continue;

      run(
        configDb,
        `update changelog_entries
         set release_date = ?, content = ?, updated_at = ?
         where id = ?`,
        entry.date,
        entry.content,
        now(),
        existing.id
      );
      updated += 1;
    }
  });

  sync();

  const result = { sourceFound: true, parsed: entries.length, selected: entriesToSync.length, inserted, updated };
  if (inserted > 0 || updated > 0) {
    console.info(`[changelog] synced ${entriesToSync.length} Markdown entries: ${inserted} added, ${updated} updated.`);
  }
  return result;
}
