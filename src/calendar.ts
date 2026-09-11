import type { CalendarEvent, EventType } from "./types";
import { SNAPSHOT_DATE } from "./data/metadata";
const ARTISTS = { ocha: { label: "OCHA NORMA" }, morning: { label: "モーニング娘。'26" }, karin: { label: "宮本佳林" } };
export type CalendarExportEntry = { key: string; event: CalendarEvent; session?: NonNullable<CalendarEvent["sessions"]>[number]; sessionIndex?: number; date?: string; personalEnd?: string };
export function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(firstDay);
  const mondayBasedDay = (firstDay.getDay() + 6) % 7;
  gridStart.setDate(firstDay.getDate() - mondayBasedDay);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export function isDateInEvent(date: string, event: CalendarEvent) {
  if (event.sessions?.some((session) => session.date)) {
    return event.sessions.some((session) => (session.date ?? event.startDate) === date);
  }
  return date >= event.startDate && date <= (event.endDate ?? event.startDate);
}

export function isWantedOnDate(event: CalendarEvent, selectedKeys: string[], date: string) {
  return getWantToGoEntries([event], selectedKeys).some((entry) => entry.date === date);
}

export function formatMonth(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parseIsoDate(value));
}

export function formatShortDate(value: string) {
  const date = parseIsoDate(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatRange(event: CalendarEvent) {
  return event.endDate
    ? `${formatShortDate(event.startDate)}〜${formatShortDate(event.endDate)}`
    : formatShortDate(event.startDate);
}

export function getSessionSelectionKey(event: CalendarEvent, sessionIndex: number) {
  return `${event.id}::${event.sessions![sessionIndex].id}`;
}

export function getJstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** This is a date-based warning, never a claim that current stock was checked. */
export function getTicketDisplay(event: CalendarEvent, now = new Date()) {
  const today = getJstToday(now);
  const clock = new Date(now.getTime() + 9 * 3600000).toISOString().slice(11, 16);
  const end = event.ticketSalesEndDate;
  const start = event.ticketSalesDate;
  if (end && (today > end || (today === end && event.ticketSalesEndTime && clock >= event.ticketSalesEndTime))) {
    return "記録された受付期間は終了・最新状況は公式へ";
  }
  if (end === today && !event.ticketSalesEndTime) return "受付最終日・締切時刻は公式で確認";
  if (["受付前", "一般発売予定"].includes(event.ticketStatus ?? "") && start && today >= start) {
    return "発売予定日を迎えています・受付状況は要確認";
  }
  return `${event.ticketStatus ?? "未発表"}（確認日時点）`;
}

export function getPeriodDates(event: CalendarEvent) {
  if (!event.endDate || event.sessions?.length) return [];
  const dates: string[] = [];
  for (let date = event.startDate; date <= event.endDate && dates.length < 366; date = getNextIsoDate(date)) dates.push(date);
  return dates;
}

export function getEventSelectionKeys(event: CalendarEvent) {
  return event.sessions?.length
    ? event.sessions.map((_, index) => getSessionSelectionKey(event, index))
    : event.endDate ? getPeriodDates(event).map((date) => `${event.id}::date-${date}`) : [event.id];
}

export type WantToGoMigration = {
  keys: string[];
  changed: boolean;
  migratedEventNames: string[];
};

/**
 * Migrate date-level selections when an event is refined into dated sessions.
 * Older snapshots used `eventId::date-YYYY-MM-DD`; keeping that key would make
 * the user's saved selection disappear after the event gained a timetable.
 */
export function migrateWantToGoKeys(calendarEvents: CalendarEvent[], selectedKeys: string[]): WantToGoMigration {
  const next = new Set<string>();
  const migratedEventNames = new Set<string>();
  const separator = "::date-";

  for (const key of selectedKeys) {
    const separatorIndex = key.lastIndexOf(separator);
    if (separatorIndex < 0) {
      next.add(key);
      continue;
    }

    const eventId = key.slice(0, separatorIndex);
    const date = key.slice(separatorIndex + separator.length);
    const event = calendarEvents.find((candidate) => candidate.id === eventId);
    const sessionKeys = event?.sessions?.flatMap((session, sessionIndex) =>
      (session.date ?? event.startDate) === date ? [getSessionSelectionKey(event, sessionIndex)] : [],
    ) ?? [];

    if (!sessionKeys.length) {
      next.add(key);
      continue;
    }

    sessionKeys.forEach((sessionKey) => next.add(sessionKey));
    if (event) migratedEventNames.add(event.shortTitle);
  }

  const keys = Array.from(next);
  return {
    keys,
    changed: keys.length !== selectedKeys.length || keys.some((key, index) => key !== selectedKeys[index]),
    migratedEventNames: Array.from(migratedEventNames),
  };
}

export function isEventWantToGo(selectedKeys: string[], event: CalendarEvent) {
  if (selectedKeys.includes(event.id)) return true;
  const selectionKeys = getEventSelectionKeys(event);
  return selectionKeys.every((key) => selectedKeys.includes(key));
}

export function isSessionWantToGo(selectedKeys: string[], event: CalendarEvent, sessionIndex: number) {
  return (
    selectedKeys.includes(event.id) ||
    selectedKeys.includes(getSessionSelectionKey(event, sessionIndex))
  );
}

export function getWantToGoEntries(calendarEvents: CalendarEvent[], selectedKeys: string[]) {
  return calendarEvents.flatMap<CalendarExportEntry>((event) => {
    if (event.sessions?.length) {
      const legacyEventSelection = selectedKeys.includes(event.id);
      return event.sessions.flatMap((session, sessionIndex) => {
        const key = getSessionSelectionKey(event, sessionIndex);
        if (!legacyEventSelection && !selectedKeys.includes(key)) return [];
        return [{ key, event, session, sessionIndex, date: session.date ?? event.startDate }];
      });
    }

    // Legacy whole-period selections remain visible but are not silently expanded to every day.
    if (event.endDate) return getPeriodDates(event).flatMap((date) => {
      const key = `${event.id}::date-${date}`;
      return selectedKeys.includes(key) ? [{ key, event, date }] : [];
    });
    return selectedKeys.includes(event.id) ? [{ key: event.id, event, date: event.startDate }] : [];
  });
}

function getNextIsoDate(value: string) {
  const nextDate = parseIsoDate(value);
  nextDate.setDate(nextDate.getDate() + 1);
  return toIsoDate(nextDate);
}

function formatIcsDate(value: string) {
  return value.replace(/-/g, "");
}

function formatIcsTimestamp(value: Date) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function isValidTime(value: string | undefined): value is string {
  if (!value) return false;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function formatIcsLocalDateTime(date: string, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return formatIcsTimestamp(new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`));
}

export function withPersonalEnds(entries: CalendarExportEntry[], ends: Record<string, string>) {
  return entries.map((entry) => ({ ...entry, personalEnd: entry.session?.end ? undefined : ends[entry.key] || undefined }));
}

export function getEntryFingerprint(entry: CalendarExportEntry) {
  // Exact content signature (not a lossy hash): changes need explicit re-export acknowledgement.
  return JSON.stringify([entry.key, entry.date, entry.event.title, entry.event.shortTitle,
    entry.event.venue, entry.event.prefecture, entry.event.eventType, entry.event.officialUrl,
    entry.event.ticketStatus, entry.event.ticketSalesDate, entry.event.ticketSalesEndDate,
    entry.event.ticketSalesEndTime, entry.event.ticketSourceUrl, entry.event.notes,
    entry.session, entry.personalEnd]);
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string) {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = "";
  let byteLength = 0;

  for (const character of line) {
    const characterLength = encoder.encode(character).length;
    const byteLimit = chunks.length ? 74 : 75;

    if (chunk && byteLength + characterLength > byteLimit) {
      chunks.push(chunk);
      chunk = ` ${character}`;
      byteLength = 1 + characterLength;
    } else {
      chunk += character;
      byteLength += characterLength;
    }
  }

  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks.join("\r\n");
}

function formatSessionDetails(
  session: NonNullable<CalendarEvent["sessions"]>[number],
  index: number,
  eventType: EventType,
) {
  const label = session.label ?? `${index + 1}公演`;
  const isPerformance = ["concert", "birthday", "fc", "stage"].includes(eventType);
  const startLabel = isPerformance ? "開演" : "開始";
  const endLabel = isPerformance ? "終演" : "終了";
  const times = [
    session.doors ? `開場 ${session.doors}` : "",
    session.start ? `${startLabel} ${session.start}` : "",
    session.end ? `${endLabel} ${session.end}` : "",
  ]
    .filter(Boolean)
    .join(" / ");
  return [label, times].filter(Boolean).join(" ");
}

function formatIcsDescription(entry: CalendarExportEntry) {
  const { event, session, sessionIndex } = entry;
  const sessionLabel = session
    ? session.label ?? `${(sessionIndex ?? 0) + 1}公演`
    : "";
  const sessionDetails = session
    ? formatSessionDetails(session, sessionIndex ?? 0, event.eventType)
    : event.sessions
      ?.map((eventSession, index) => formatSessionDetails(eventSession, index, event.eventType))
      .join("、");
  const ticketPeriod = event.ticketSalesDate
    ? `${formatShortDate(event.ticketSalesDate)}〜${
        event.ticketSalesEndDate ? formatShortDate(event.ticketSalesEndDate) : ""
      }`
    : "";

  return [
    `正式名称: ${event.title}`,
    `開催日: ${entry.date ?? event.startDate}`,
    event.prefecture ? `場所: ${event.prefecture}` : "",
    event.venue ? `会場: ${event.venue}` : "",
    session ? `選択公演: ${sessionLabel}` : "",
    sessionDetails ? `公演時間: ${sessionDetails}` : "",
    event.ticketStatus ? `チケット: ${getTicketDisplay(event)}` : "",
    event.ticketCheckedAt ?? event.checkedAt
      ? `個別確認日: ${event.ticketCheckedAt ?? event.checkedAt}（最新情報は公式へ）`
      : `個別確認日: 未記録（アプリ更新日: ${SNAPSHOT_DATE}、最新情報は公式へ）`,
    entry.personalEnd ? `自分用の終了予定: ${entry.personalEnd}（公式の終演時刻ではありません）` : "",
    session?.start && !session.end && !entry.personalEnd ? "終了時刻未確認（開始時刻のみ）" : "",
    ticketPeriod ? `受付期間: ${ticketPeriod}` : "",
    event.notes ?? "",
    event.officialUrl ? `公式情報: ${event.officialUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getCalendarEntryUid(entry: CalendarExportEntry) {
  return entry.session ? `${entry.event.id}-${entry.session.id}`
    : entry.event.endDate ? `${entry.event.id}-date-${entry.date}` : entry.event.id;
}

export function buildIcs(entries: CalendarExportEntry[]) {
  const timestamp = formatIcsTimestamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BAD-TERUMARU//Oshi Calendar//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-TIMEZONE:Asia/Tokyo",
    "X-WR-CALNAME:推し活カレンダー（行きたい予定）",
    ...entries.flatMap((entry) => {
      const { event, session } = entry;
      const location = [event.prefecture, event.venue].filter(Boolean).join(" / ");
      const sessionLabel = session
        ? `（${session.label ?? `${(entry.sessionIndex ?? 0) + 1}公演`}）`
        : "";
      const summary = `${ARTISTS[event.artist].label}｜${event.shortTitle}${sessionLabel}`;
      const hasStartTime = isValidTime(session?.start);
      const end = session?.end ?? entry.personalEnd;
      const hasEndTime = hasStartTime && isValidTime(end);
      const date = entry.date ?? session?.date ?? event.startDate;
      if (end && (!hasEndTime || formatIcsLocalDateTime(date, end) <= formatIcsLocalDateTime(date, session!.start!))) {
        throw new Error(`${event.shortTitle}: 終了予定は開始時刻より後の同日内の時刻にしてください。`);
      }
      const eventLines = [
        "BEGIN:VEVENT",
        `UID:${getCalendarEntryUid(entry)}@oshi-calendar.badterumaru.workers.dev`,
        `DTSTAMP:${timestamp}`,
        "SEQUENCE:0",
        hasStartTime
          ? `DTSTART:${formatIcsLocalDateTime(date, session?.start ?? "")}`
          : `DTSTART;VALUE=DATE:${formatIcsDate(date)}`,
        hasEndTime
          ? `DTEND:${formatIcsLocalDateTime(date, end ?? "")}`
          : hasStartTime
            ? ""
            : `DTEND;VALUE=DATE:${formatIcsDate(getNextIsoDate(date))}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        location ? `LOCATION:${escapeIcsText(location)}` : "",
        `DESCRIPTION:${escapeIcsText(formatIcsDescription(entry))}`,
        event.officialUrl ? `URL:${event.officialUrl}` : "",
        hasStartTime ? "TRANSP:OPAQUE" : "TRANSP:TRANSPARENT",
        "END:VEVENT",
      ];
      return eventLines.filter(Boolean);
    }),
    "END:VCALENDAR",
  ];

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
