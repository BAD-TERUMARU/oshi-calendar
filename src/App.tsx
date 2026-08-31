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

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
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
  gridStart.setDate(firstDay.getDate() - firstDay.getDay());

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
    setVisibleEventTypes((current) => ({ ...current, [eventType]: !current[eventType] }));
  }

  const hasAllEventTypes = EVENT_FILTER_ORDER.every((eventType) => visibleEventTypes[eventType]);

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
              {EVENT_FILTER_ORDER.filter((eventType) =>
                calendarEvents.some((event) => event.eventType === eventType),
              ).map((eventType) => (
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
              <span className="event-count">{visibleEvents.length}件の登録</span>
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
                const weekday = date.getDay();
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
            <p className="calendar-footnote">※ 赤字は日曜・祝日です。期間イベントは開催期間中の日付に表示しています</p>
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
                  <EventDetailCard event={event} key={event.id} />
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

function EventDetailCard({ event }: { event: CalendarEvent }) {
  const artist = ARTISTS[event.artist];
  return (
    <article className="detail-card" style={eventStyle(event.artist)}>
      <div className="detail-card-topline">
        <span className="artist-pill">
          <span className="pill-mark">{artist.mark}</span>
          {artist.label}
        </span>
        <span className="event-type">{EVENT_TYPE_LABELS[event.eventType]}</span>
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
            <span>TIME TABLE</span>
            <strong>公演時間</strong>
          </div>
          <div className="sessions-list">
            {event.sessions.map((session, index) => (
              <div className="session-row" key={`${event.id}-${session.label ?? index}`}>
                <span className="session-label">{session.label ?? `${index + 1}公演`}</span>
                <span>
                  {session.doors && <>開場 <strong>{session.doors}</strong></>}
                  {session.doors && session.start && <span className="time-separator">/</span>}
                  {session.start && <>開演 <strong>{session.start}</strong></>}
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
