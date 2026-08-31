import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { events } from "./data/events";
import type { ArtistId, CalendarEvent, EventType } from "./types";

const ARTISTS: Record<ArtistId, { label: string; color: string; soft: string; mark: string }> = {
  ocha: { label: "OCHA NORMA", color: "#16a34a", soft: "#eaf8ef", mark: "O" },
  morning: { label: "モーニング娘。'26", color: "#2563eb", soft: "#ebf2ff", mark: "M" },
  karin: { label: "宮本佳林", color: "#9333ea", soft: "#f5edff", mark: "K" },
};

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  concert: "コンサート",
  festival: "フェス",
  fc: "FCイベント",
  birthday: "BDイベント",
  release: "リリースイベント",
  individual: "個別イベント",
  stage: "舞台",
  online: "オンラインイベント",
  other: "その他",
};

const EVENT_FILTER_ORDER: EventType[] = [
  "concert",
  "festival",
  "stage",
  "online",
  "birthday",
  "individual",
  "fc",
  "release",
  "other",
];

const EVENT_FILTER_LABELS: Record<EventType, string> = {
  concert: "ライブ",
  festival: "フェス",
  fc: "FCイベント",
  birthday: "BDイベント",
  release: "リリース",
  individual: "個別イベント",
  stage: "ステージ",
  online: "オンライン",
  other: "その他",
};

const INITIAL_EVENT_TYPES: Record<EventType, boolean> = {
  concert: true,
  festival: true,
  fc: true,
  birthday: true,
  release: true,
  individual: true,
  stage: true,
  online: true,
  other: true,
};

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
const JAPANESE_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "元日",
  "2026-01-12": "成人の日",
  "2026-02-11": "建国記念の日",
  "2026-02-23": "天皇誕生日",
  "2026-03-20": "春分の日",
  "2026-04-29": "昭和の日",
  "2026-05-03": "憲法記念日",
  "2026-05-04": "みどりの日",
  "2026-05-05": "こどもの日",
  "2026-05-06": "休日（振替休日）",
  "2026-07-20": "海の日",
  "2026-08-11": "山の日",
  "2026-09-21": "敬老の日",
  "2026-09-22": "休日（国民の休日）",
  "2026-09-23": "秋分の日",
  "2026-10-12": "スポーツの日",
  "2026-11-03": "文化の日",
  "2026-11-23": "勤労感謝の日",
};
const INITIAL_MONTH = new Date(2026, 8, 1);
const INITIAL_DATE = "2026-09-04";
const WANT_TO_GO_STORAGE_KEY = "oshi-calendar-want-to-go";
const EXPORTED_WANT_TO_GO_STORAGE_KEY = "oshi-calendar-exported-want-to-go";

type CalendarExportEntry = {
  key: string;
  event: CalendarEvent;
  session?: NonNullable<CalendarEvent["sessions"]>[number];
  sessionIndex?: number;
};

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getCalendarDays(month: Date) {
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

function isDateInEvent(date: string, event: CalendarEvent) {
  return date >= event.startDate && date <= (event.endDate ?? event.startDate);
}

function formatMonth(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parseIsoDate(value));
}

function formatShortDate(value: string) {
  const date = parseIsoDate(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatRange(event: CalendarEvent) {
  return event.endDate
    ? `${formatShortDate(event.startDate)}〜${formatShortDate(event.endDate)}`
    : formatShortDate(event.startDate);
}

function loadWantToGoIds() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(WANT_TO_GO_STORAGE_KEY);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function loadExportedWantToGoKeys() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(EXPORTED_WANT_TO_GO_STORAGE_KEY);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function getSessionSelectionKey(event: CalendarEvent, sessionIndex: number) {
  return `${event.id}::session-${sessionIndex}`;
}

function getEventSelectionKeys(event: CalendarEvent) {
  return event.sessions?.length
    ? event.sessions.map((_, index) => getSessionSelectionKey(event, index))
    : [event.id];
}

function isEventWantToGo(selectedKeys: string[], event: CalendarEvent) {
  if (selectedKeys.includes(event.id)) return true;
  const selectionKeys = getEventSelectionKeys(event);
  return selectionKeys.every((key) => selectedKeys.includes(key));
}

function isSessionWantToGo(selectedKeys: string[], event: CalendarEvent, sessionIndex: number) {
  return (
    selectedKeys.includes(event.id) ||
    selectedKeys.includes(getSessionSelectionKey(event, sessionIndex))
  );
}

function getWantToGoEntries(calendarEvents: CalendarEvent[], selectedKeys: string[]) {
  return calendarEvents.flatMap<CalendarExportEntry>((event) => {
    if (event.sessions?.length) {
      const legacyEventSelection = selectedKeys.includes(event.id);
      return event.sessions.flatMap((session, sessionIndex) => {
        const key = getSessionSelectionKey(event, sessionIndex);
        if (!legacyEventSelection && !selectedKeys.includes(key)) return [];
        return [{ key, event, session, sessionIndex }];
      });
    }

    return selectedKeys.includes(event.id) ? [{ key: event.id, event }] : [];
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

function isValidTime(value: string | undefined): value is string {
  if (!value) return false;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function formatIcsLocalDateTime(date: string, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return `${formatIcsDate(date)}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}00`;
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
    `開催日: ${formatRange(event)}`,
    event.prefecture ? `場所: ${event.prefecture}` : "",
    event.venue ? `会場: ${event.venue}` : "",
    session ? `選択公演: ${sessionLabel}` : "",
    sessionDetails ? `公演時間: ${sessionDetails}` : "",
    event.ticketStatus ? `チケット: ${event.ticketStatus}` : "",
    ticketPeriod ? `受付期間: ${ticketPeriod}` : "",
    event.notes ?? "",
    event.officialUrl ? `公式情報: ${event.officialUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getCalendarEntryUid(entry: CalendarExportEntry) {
  return entry.sessionIndex === undefined
    ? entry.event.id
    : `${entry.event.id}-session-${entry.sessionIndex}`;
}

function buildIcs(entries: CalendarExportEntry[]) {
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
      const hasEndTime = hasStartTime && isValidTime(session?.end);
      const eventLines = [
        "BEGIN:VEVENT",
        `UID:${getCalendarEntryUid(entry)}@oshi-calendar.badterumaru.workers.dev`,
        `DTSTAMP:${timestamp}`,
        "SEQUENCE:0",
        hasStartTime
          ? `DTSTART;TZID=Asia/Tokyo:${formatIcsLocalDateTime(event.startDate, session?.start ?? "")}`
          : `DTSTART;VALUE=DATE:${formatIcsDate(event.startDate)}`,
        hasEndTime
          ? `DTEND;TZID=Asia/Tokyo:${formatIcsLocalDateTime(event.startDate, session?.end ?? "")}`
          : hasStartTime
            ? ""
            : `DTEND;VALUE=DATE:${formatIcsDate(getNextIsoDate(event.endDate ?? event.startDate))}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        location ? `LOCATION:${escapeIcsText(location)}` : "",
        `DESCRIPTION:${escapeIcsText(formatIcsDescription(entry))}`,
        event.officialUrl ? `URL:${event.officialUrl}` : "",
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      ];
      return eventLines.filter(Boolean);
    }),
    "END:VCALENDAR",
  ];

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function eventStyle(artist: ArtistId) {
  return {
    "--event-color": ARTISTS[artist].color,
    "--event-soft": ARTISTS[artist].soft,
  } as CSSProperties;
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CalendarEvent>;
  return (
    typeof candidate.id === "string" &&
    (candidate.artist === "ocha" || candidate.artist === "morning" || candidate.artist === "karin") &&
    typeof candidate.title === "string" &&
    typeof candidate.startDate === "string" &&
    typeof candidate.eventType === "string" &&
    typeof candidate.ticketStatus === "string"
  );
}

function parseRemoteEvents(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { events?: unknown };
  if (!Array.isArray(candidate.events) || !candidate.events.every(isCalendarEvent)) return null;
  return candidate.events;
}

function App() {
  const [currentMonth, setCurrentMonth] = useState(INITIAL_MONTH);
  const [selectedDate, setSelectedDate] = useState(INITIAL_DATE);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(events);
  const [visibleArtists, setVisibleArtists] = useState<Record<ArtistId, boolean>>({
    ocha: true,
    morning: true,
    karin: true,
  });
  const [visibleEventTypes, setVisibleEventTypes] =
    useState<Record<EventType, boolean>>(INITIAL_EVENT_TYPES);
  const [wantToGoIds, setWantToGoIds] = useState<string[]>(() => loadWantToGoIds());
  const [exportedWantToGoKeys, setExportedWantToGoKeys] = useState<string[]>(() =>
    loadExportedWantToGoKeys(),
  );

  useEffect(() => {
    let isActive = true;

    fetch("/api/events", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        const remoteEvents = parseRemoteEvents(payload);
        if (isActive && remoteEvents?.length) setCalendarEvents(remoteEvents);
      })
      .catch(() => {
        // The bundled snapshot remains available when the API is not deployed yet.
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(WANT_TO_GO_STORAGE_KEY, JSON.stringify(wantToGoIds));
    } catch {
      // Private browsing or storage restrictions should not block the calendar.
    }
  }, [wantToGoIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(
        EXPORTED_WANT_TO_GO_STORAGE_KEY,
        JSON.stringify(exportedWantToGoKeys),
      );
    } catch {
      // Private browsing or storage restrictions should not block the calendar.
    }
  }, [exportedWantToGoKeys]);

  const calendarDays = useMemo(() => getCalendarDays(currentMonth), [currentMonth]);
  const visibleEvents = useMemo(
    () =>
      calendarEvents.filter(
        (event) =>
          (event.artists ?? [event.artist]).some((artist) => visibleArtists[artist]) &&
          visibleEventTypes[event.eventType],
      ),
    [calendarEvents, visibleArtists, visibleEventTypes],
  );
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    calendarDays.forEach((date) => {
      const key = toIsoDate(date);
      map.set(
        key,
        visibleEvents.filter((event) => isDateInEvent(key, event)),
      );
    });
    return map;
  }, [calendarDays, visibleEvents]);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const wantedEntries = useMemo(
    () => getWantToGoEntries(calendarEvents, wantToGoIds),
    [calendarEvents, wantToGoIds],
  );
  const pendingWantedEntries = useMemo(
    () => wantedEntries.filter((entry) => !exportedWantToGoKeys.includes(entry.key)),
    [exportedWantToGoKeys, wantedEntries],
  );

  function changeMonth(offset: number) {
    const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
    setCurrentMonth(nextMonth);
    setSelectedDate(toIsoDate(nextMonth));
  }

  function goToToday() {
    const today = new Date();
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(toIsoDate(today));
  }

  function toggleArtist(artist: ArtistId) {
    setVisibleArtists((current) => ({ ...current, [artist]: !current[artist] }));
  }

  function toggleEventType(eventType: EventType) {
    setVisibleEventTypes((current) => {
      const allSelected = EVENT_FILTER_ORDER.every((type) => current[type]);
      const next = { ...current };

      if (allSelected) {
        (Object.keys(next) as EventType[]).forEach((type) => {
          next[type] = type === eventType;
        });
      } else {
        next[eventType] = !current[eventType];
      }

      return next;
    });
  }

  function toggleWantToGo(eventId: string) {
    const event = calendarEvents.find((candidate) => candidate.id === eventId);
    if (!event) return;

    const selectionKeys = getEventSelectionKeys(event);
    setWantToGoIds((current) => {
      const isSelected = isEventWantToGo(current, event);
      const withoutEvent = current.filter(
        (key) => key !== event.id && !selectionKeys.includes(key),
      );
      return isSelected ? withoutEvent : [...withoutEvent, ...selectionKeys];
    });
  }

  function toggleSessionWantToGo(eventId: string, sessionIndex: number) {
    const event = calendarEvents.find((candidate) => candidate.id === eventId);
    if (!event?.sessions?.[sessionIndex]) return;

    const selectionKey = getSessionSelectionKey(event, sessionIndex);
    const selectionKeys = getEventSelectionKeys(event);
    setWantToGoIds((current) => {
      const next = new Set(current.filter((key) => key !== event.id));
      if (current.includes(event.id)) selectionKeys.forEach((key) => next.add(key));

      if (next.has(selectionKey)) next.delete(selectionKey);
      else next.add(selectionKey);

      return Array.from(next);
    });
  }

  function exportWantToGo() {
    if (!pendingWantedEntries.length) return;

    const blob = new Blob([buildIcs(pendingWantedEntries)], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `oshi-calendar-want-to-go-${toIsoDate(new Date())}.ics`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);

    const exportedKeys = pendingWantedEntries.map((entry) => entry.key);
    setExportedWantToGoKeys((current) => Array.from(new Set([...current, ...exportedKeys])));
  }

  const availableEventTypes = EVENT_FILTER_ORDER.filter((eventType) =>
    calendarEvents.some((event) => event.eventType === eventType),
  );
  const hasAllEventTypes =
    availableEventTypes.length > 0 && availableEventTypes.every((eventType) => visibleEventTypes[eventType]);
  const exportButtonLabel = !wantedEntries.length
    ? "カレンダーへ追加"
    : pendingWantedEntries.length
      ? `カレンダーへ追加（${pendingWantedEntries.length}件）`
      : "書き出し済み";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-lockup">
            <span className="brand-kicker">LIVE & EVENT PLANNER</span>
            <h1>推し活カレンダー</h1>
            <p>3組の予定を、ひとつのカレンダーに。</p>
          </div>
          <div className="header-note" aria-label="2026年8月31日時点の公開情報スナップショット">
            <span className="live-dot" />
            <span>SNAPSHOT 2026.08.31</span>
          </div>
        </div>
      </header>

      <main className="page-content">
        <section className="toolbar" aria-label="カレンダー操作">
          <div className="month-switcher">
            <button className="icon-button" type="button" onClick={() => changeMonth(-1)} aria-label="前月">
              ‹
            </button>
            <h2>{formatMonth(currentMonth)}</h2>
            <button className="icon-button" type="button" onClick={() => changeMonth(1)} aria-label="翌月">
              ›
            </button>
            <button className="today-button" type="button" onClick={goToToday}>
              今日
            </button>
          </div>
          <div className="selection-hint">
            <span className="hint-icon">⌁</span>
            <span>日付を選ぶとイベント詳細が表示されます</span>
          </div>
        </section>

        <section className="filter-bar" aria-label="アーティストで絞り込む">
          <div className="legend-list">
            {(Object.keys(ARTISTS) as ArtistId[]).map((artist) => (
              <span className="legend-item" key={artist}>
                <span className="legend-dot" style={{ backgroundColor: ARTISTS[artist].color }} />
                {ARTISTS[artist].label}
              </span>
            ))}
          </div>
          <div className="filter-list">
            <span className="filter-label">表示：</span>
            {(Object.keys(ARTISTS) as ArtistId[]).map((artist) => (
              <label className="filter-toggle" key={artist} style={eventStyle(artist)}>
                <input
                  type="checkbox"
                  checked={visibleArtists[artist]}
                  onChange={() => toggleArtist(artist)}
                />
                <span className="toggle-box" aria-hidden="true" />
                <span>{ARTISTS[artist].label}</span>
              </label>
            ))}
          </div>
          <div className="type-filter" aria-label="イベント種別で絞り込む">
            <span className="filter-label">種別：</span>
            <div className="type-filter-list">
              <button
                className={`type-filter-button ${hasAllEventTypes ? "is-active" : ""}`}
                type="button"
                onClick={() => setVisibleEventTypes(INITIAL_EVENT_TYPES)}
                aria-pressed={hasAllEventTypes}
              >
                すべて
              </button>
              {availableEventTypes.map((eventType) => (
                <button
                  className={`type-filter-button ${visibleEventTypes[eventType] ? "is-active" : ""}`}
                  key={eventType}
                  type="button"
                  onClick={() => toggleEventType(eventType)}
                  aria-pressed={visibleEventTypes[eventType]}
                >
                  {EVENT_FILTER_LABELS[eventType]}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="workspace-grid">
          <section className="calendar-card" aria-labelledby="calendar-heading">
            <div className="card-heading">
              <div>
                <span className="section-kicker">MONTH VIEW</span>
                <h2 id="calendar-heading">予定を探す</h2>
              </div>
              <div className="calendar-heading-meta">
                <span className="event-count">{visibleEvents.length}件の登録</span>
                <span className="want-to-go-count" aria-live="polite">
                  {wantedEntries.length}件 行きたい
                </span>
                <button
                  className="export-calendar-button"
                  type="button"
                  onClick={exportWantToGo}
                  disabled={!pendingWantedEntries.length}
                  title={
                    !wantedEntries.length
                      ? "詳細画面で「行きたい」を選択してください"
                      : pendingWantedEntries.length
                        ? "未書き出しの予定だけを追加します"
                        : "同じ予定は再度書き出しません。新しい予定を選択してください"
                  }
                >
                  {exportButtonLabel}
                </button>
              </div>
            </div>

            <div className="calendar-grid" role="grid" aria-label={`${formatMonth(currentMonth)}のカレンダー`}>
              {WEEKDAYS.map((weekday, index) => (
                <div
                  className={`weekday weekday-${index}`}
                  key={weekday}
                  role="columnheader"
                >
                  {weekday}
                </div>
              ))}
              {calendarDays.map((date) => {
                const key = toIsoDate(date);
                const dayEvents = eventsByDate.get(key) ?? [];
                const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
                const isSelected = key === selectedDate;
                const holidayName = JAPANESE_HOLIDAYS[key];
                const isHoliday = Boolean(holidayName);
                const weekday = (date.getDay() + 6) % 7;
                return (
                  <button
                    className={`day-cell ${!isCurrentMonth ? "is-outside" : ""} ${
                      isSelected ? "is-selected" : ""
                    } ${isHoliday ? "is-holiday" : ""} ${
                      dayEvents.length ? "has-events" : ""
                    }`}
                    key={key}
                    type="button"
                    role="gridcell"
                    aria-selected={isSelected}
                    aria-label={`${formatLongDate(key)}${holidayName ? `、${holidayName}` : ""}${dayEvents.length ? `、イベント${dayEvents.length}件` : ""}`}
                    title={holidayName ? `${holidayName}（祝日）` : undefined}
                    onClick={() => setSelectedDate(key)}
                  >
                    <span className={`day-number weekday-${weekday}`}>{date.getDate()}</span>
                    <span className="event-stack">
                      {dayEvents.slice(0, 3).map((event) => (
                        <span className="event-chip" key={event.id} style={eventStyle(event.artist)}>
                          <span className="chip-mark">{ARTISTS[event.artist].mark}</span>
                          <span className="chip-title">{event.shortTitle}</span>
                          <span className="chip-location">{event.prefecture ?? event.venue ?? event.shortTitle}</span>
                          {event.endDate && <span className="chip-range">期間</span>}
                        </span>
                      ))}
                      {dayEvents.length > 3 && <span className="more-events">+{dayEvents.length - 3}件</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="calendar-footnote">
              ※ 赤字は日曜・祝日です。期間イベントは開催期間中の日付に表示しています。「行きたい」を選んだ公演だけを、未書き出し分からカレンダーへ追加できます。終了時刻が未確認の公演は開始時刻のみで出力します。
            </p>
          </section>

          <aside className="details-panel" aria-labelledby="details-heading">
            <div className="details-date">
              <span className="section-kicker">SELECTED DATE</span>
              <h2 id="details-heading">{formatLongDate(selectedDate)}</h2>
              <span className="details-count">
                {selectedEvents.length ? `${selectedEvents.length}件のイベント` : "イベントはありません"}
              </span>
            </div>

            {selectedEvents.length ? (
              <div className="detail-cards">
                {selectedEvents.map((event) => (
                  <EventDetailCard
                    event={event}
                    isWanted={isEventWantToGo(wantToGoIds, event)}
                    onToggleWantToGo={toggleWantToGo}
                    isSessionWanted={(sessionIndex) =>
                      isSessionWantToGo(wantToGoIds, event, sessionIndex)
                    }
                    onToggleSessionWantToGo={toggleSessionWantToGo}
                    key={event.id}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-details">
                <span className="empty-calendar-icon">○</span>
                <strong>この日の予定はありません</strong>
                <p>カレンダーから別の日付を選んでください。</p>
              </div>
            )}
          </aside>
        </div>
      </main>

      <footer className="app-footer">
        <span>推し活カレンダー｜非公式ファン作成</span>
        <span>公開情報スナップショット：2026年8月31日時点</span>
        <span>最新情報・受付条件は公式ページをご確認ください</span>
        <p className="app-footer-warning">
          このアプリは公式運営とは関係ありません。掲載情報の利用・転載は各公式サイトの規約・権利条件に従ってください。
        </p>
      </footer>
    </div>
  );
}

function EventDetailCard({
  event,
  isWanted,
  onToggleWantToGo,
  isSessionWanted,
  onToggleSessionWantToGo,
}: {
  event: CalendarEvent;
  isWanted: boolean;
  onToggleWantToGo: (eventId: string) => void;
  isSessionWanted: (sessionIndex: number) => boolean;
  onToggleSessionWantToGo: (eventId: string, sessionIndex: number) => void;
}) {
  const artist = ARTISTS[event.artist];
  const hasMultipleSessions = (event.sessions?.length ?? 0) > 1;
  const isPerformance = ["concert", "birthday", "fc", "stage"].includes(event.eventType);
  const startLabel = isPerformance ? "開演" : "開始";
  const endLabel = isPerformance ? "終演" : "終了";
  return (
    <article className="detail-card" style={eventStyle(event.artist)}>
      <div className="detail-card-topline">
        <div className="detail-card-topline-main">
          <span className="artist-pill">
            <span className="pill-mark">{artist.mark}</span>
            {artist.label}
          </span>
          <span className="event-type">{EVENT_TYPE_LABELS[event.eventType]}</span>
        </div>
        <label className={`want-to-go-toggle ${isWanted ? "is-checked" : ""}`}>
          <input
            type="checkbox"
            checked={isWanted}
            onChange={() => onToggleWantToGo(event.id)}
            aria-label={`${event.shortTitle}${hasMultipleSessions ? "の全公演" : ""}を行きたい`}
          />
          <span className="want-to-go-box" aria-hidden="true" />
          <span>{hasMultipleSessions ? "全公演" : "行きたい"}</span>
        </label>
      </div>
      <h3>{event.title}</h3>
      <div className="detail-period">
        <span className="meta-icon">◷</span>
        <span>{event.endDate ? "開催期間" : "開催日"}</span>
        <strong>{formatRange(event)}</strong>
      </div>

      <div className="detail-meta">
        {(event.venue || event.prefecture) && (
          <div className="meta-row">
            <span className="meta-label">会場</span>
            <span>
              {event.venue}
              {event.prefecture && <small>{event.prefecture}</small>}
            </span>
          </div>
        )}
        {event.performers?.length && (
          <div className="meta-row">
            <span className="meta-label">出演者</span>
            <span>{event.performers.join("、")}</span>
          </div>
        )}
        {event.ticketStatus && (
          <div className="meta-row">
            <span className="meta-label">チケット</span>
            <span className="ticket-status">{event.ticketStatus}</span>
          </div>
        )}
        {event.ticketSalesDate && (
          <div className="meta-row">
            <span className="meta-label">受付期間</span>
            <span>
              {formatShortDate(event.ticketSalesDate)}〜
              {event.ticketSalesEndDate ? formatShortDate(event.ticketSalesEndDate) : ""}
            </span>
          </div>
        )}
      </div>

      {event.sessions?.length && (
        <div className="sessions-block">
          <div className="subheading">
            <div className="subheading-title">
              <span>TIME TABLE</span>
              <strong>公演時間</strong>
            </div>
            {hasMultipleSessions && <span className="session-selection-note">行きたい公演を選択</span>}
          </div>
          <div className="sessions-list">
            {event.sessions.map((session, index) => (
              <div className="session-row" key={`${event.id}-${session.label ?? index}`}>
                {hasMultipleSessions ? (
                  <label className={`session-choice ${isSessionWanted(index) ? "is-checked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={isSessionWanted(index)}
                      onChange={() => onToggleSessionWantToGo(event.id, index)}
                      aria-label={`${event.shortTitle} ${session.label ?? `${index + 1}公演`}を行きたい`}
                    />
                    <span className="session-check-box" aria-hidden="true" />
                    <span className="session-label">{session.label ?? `${index + 1}公演`}</span>
                  </label>
                ) : (
                  <span className="session-label">{session.label ?? `${index + 1}公演`}</span>
                )}
                <span>
                  {session.doors && <>開場 <strong>{session.doors}</strong></>}
                  {session.doors && session.start && <span className="time-separator">/</span>}
                  {session.start && <>{startLabel} <strong>{session.start}</strong></>}
                  {session.end && (session.doors || session.start) && (
                    <span className="time-separator">/</span>
                  )}
                  {session.end && <>{endLabel} <strong>{session.end}</strong></>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-badges">
        {event.fcOnly && <span className="fc-badge">FC限定</span>}
        {event.endDate && <span className="range-badge">期間イベント</span>}
      </div>

      {event.notes && <p className="detail-notes">{event.notes}</p>}
      {event.officialUrl && (
        <a className="official-link" href={event.officialUrl} target="_blank" rel="noreferrer">
          公式情報を見る <span aria-hidden="true">↗</span>
        </a>
      )}
    </article>
  );
}

export default App;
