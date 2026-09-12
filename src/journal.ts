import type { CalendarExportEntry } from "./calendar";

export const JOURNAL_STORAGE_KEY = "oshi-calendar-journal-v1";
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
export type AttendanceStatus = "planned" | "attended" | "skipped";
export type AttendanceRecord = {
  id: string; sourceKey?: string; title: string; artist: string; date: string;
  session: string; venue: string; prefecture: string; status: AttendanceStatus;
  seat: string; notes: string; rating: number;
  costs: { ticket: number; travel: number; other: number };
  setlist: string[]; createdAt: string; updatedAt: string;
};
export type JournalView = "records" | "dashboard" | "songs";
export const STATUS_LABELS: Record<AttendanceStatus, string> = { planned: "参加予定", attended: "参加済み", skipped: "見送り" };
const artistLabels = { ocha: "OCHA NORMA", morning: "モーニング娘。", karin: "宮本佳林" };

/** The group's annual suffix should not split one person's lifetime archive. */
export function normalizeJournalArtist(value: string) {
  return value.split(" / ").map(part => {
    const label = part.normalize("NFKC").trim();
    return /^モーニング娘。[’‘']\d{2}$/.test(label) ? "モーニング娘。" : label;
  }).join(" / ");
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, name: string, max: number, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error(`${name}の内容を確認してください。`);
  return value;
}
export function isJournalDate(value: string) {
  if (!/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateRecord(value: unknown): AttendanceRecord {
  if (!object(value)) throw new Error("現場記録の形式が正しくありません。");
  const date = text(value.date, "日付", 10, true);
  if (!isJournalDate(date)) throw new Error("実在する日付を入力してください（1900〜2199年）。");
  if (!["planned", "attended", "skipped"].includes(String(value.status))) throw new Error("参加状態が正しくありません。");
  if (!Number.isInteger(value.rating) || Number(value.rating) < 0 || Number(value.rating) > 5) throw new Error("評価は未評価または1〜5を指定してください。");
  if (!object(value.costs)) throw new Error("金額の形式が正しくありません。");
  const costs = { ticket: value.costs.ticket, travel: value.costs.travel, other: value.costs.other };
  for (const cost of Object.values(costs)) if (typeof cost !== "number" || !Number.isSafeInteger(cost) || cost < 0 || cost > 100_000_000) throw new Error("金額は0〜100,000,000円の整数で入力してください。");
  if (!Array.isArray(value.setlist) || value.setlist.length > 500) throw new Error("セトリは500曲以内で入力してください。");
  const setlist = value.setlist.map(song => text(song, "曲名", 300, true));
  const createdAt = text(value.createdAt, "作成日時", 40, true);
  const updatedAt = text(value.updatedAt, "更新日時", 40, true);
  if (![createdAt, updatedAt].every(stamp => /^\d{4}-\d{2}-\d{2}T/.test(stamp) && Number.isFinite(Date.parse(stamp)))) throw new Error("記録の日時が正しくありません。");
  return {
    id: text(value.id, "記録ID", 512, true),
    ...(value.sourceKey === undefined ? {} : { sourceKey: text(value.sourceKey, "公演ID", 450, true) }),
    title: text(value.title, "公演名", 300, true), artist: normalizeJournalArtist(text(value.artist, "アーティスト", 120, true)), date,
    session: text(value.session, "公演区分", 80), venue: text(value.venue, "会場", 300), prefecture: text(value.prefecture, "都道府県", 100),
    status: value.status as AttendanceStatus, seat: text(value.seat, "座席", 150), notes: text(value.notes, "感想", 10000),
    rating: value.rating as number, costs: costs as AttendanceRecord["costs"], setlist, createdAt, updatedAt,
  };
}
export function parseJournal(raw: string): AttendanceRecord[] {
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) throw new Error("バックアップは8MB以内のファイルを選んでください。");
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new Error("JSONファイルを読み取れません。元のファイルを確認してください。"); }
  if (!object(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.records)) throw new Error("対応している現場記録バックアップ（バージョン1）ではありません。");
  if (payload.records.length > 10000) throw new Error("記録は10,000件以内にしてください。");
  const records = payload.records.map(validateRecord);
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error("ファイル内に重複した記録IDがあります。取り込みは行っていません。");
  return records;
}
export function serializeJournal(records: AttendanceRecord[]) {
  return JSON.stringify({ schemaVersion: 1, records }, null, 2);
}
export function mergeJournal(existing: AttendanceRecord[], incoming: AttendanceRecord[]) {
  const records = [...existing];
  const ids = new Set(existing.map(record => record.id));
  let added = 0, skipped = 0;
  for (const record of incoming) {
    if (ids.has(record.id)) { skipped++; continue; }
    records.push(validateRecord(record)); ids.add(record.id); added++;
  }
  if (records.length > 10000) throw new Error("記録は10,000件以内にしてください。");
  return { records, added, skipped };
}
export function recordFromEntry(entry: CalendarExportEntry, stamp = new Date().toISOString()): AttendanceRecord {
  return validateRecord({
    id: `calendar:${entry.key}`, sourceKey: entry.key, title: entry.event.title,
    artist: Array.from(new Set([entry.event.artist, ...(entry.event.artists ?? [])])).map(artist => artistLabels[artist]).join(" / "),
    date: entry.date ?? entry.session?.date ?? entry.event.startDate, session: entry.session?.label ?? "",
    venue: entry.event.venue ?? "", prefecture: entry.event.prefecture ?? "", status: "planned", seat: "", notes: "", rating: 0,
    costs: { ticket: 0, travel: 0, other: 0 }, setlist: [], createdAt: stamp, updatedAt: stamp,
  });
}
export function normalizeSongTitle(title: string) {
  return title.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja-JP");
}
export function rankSongs(records: AttendanceRecord[]) {
  const songs = new Map<string, { key: string; title: string; count: number; firstDate: string; lastDate: string; recordIds: string[] }>();
  for (const record of records.filter(record => record.status === "attended").sort((a, b) => a.date.localeCompare(b.date))) {
    const seen = new Set<string>();
    for (const title of record.setlist) {
      const key = normalizeSongTitle(title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const row = songs.get(key);
      if (row) { row.count++; row.lastDate = record.date; row.recordIds.push(record.id); }
      else songs.set(key, { key, title: title.trim(), count: 1, firstDate: record.date, lastDate: record.date, recordIds: [record.id] });
    }
  }
  return [...songs.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "ja"));
}
export function recordCost(record: AttendanceRecord) {
  return record.costs.ticket + record.costs.travel + record.costs.other;
}
export function summarizeJournal(records: AttendanceRecord[]) {
  const attended = records.filter(record => record.status === "attended");
  const byMonth = new Map<string, number>();
  const byArtist = new Map<string, number>();
  for (const record of attended) {
    const month = record.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    byArtist.set(record.artist, (byArtist.get(record.artist) ?? 0) + 1);
  }
  return {
    performances: attended.length,
    venues: new Set(attended.map(record => record.venue.trim()).filter(Boolean)).size,
    spending: attended.reduce((total, record) => total + recordCost(record), 0),
    uniqueSongs: rankSongs(attended).length,
    byMonth: [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count })),
    byArtist: [...byArtist].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).map(([label, count]) => ({ label, count })),
  };
}
