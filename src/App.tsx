import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { events } from "./data/events";
import type { ArtistId, CalendarEvent, EventType } from "./types";
import { toIsoDate, parseIsoDate, getCalendarDays, isDateInEvent, formatMonth, formatLongDate, formatShortDate, formatRange, getSessionSelectionKey, getEventSelectionKeys, isEventWantToGo, isSessionWantToGo, getWantToGoEntries, buildIcs, getTicketDisplay, getJstToday, getEntryFingerprint, withPersonalEnds, getPeriodDates, type CalendarExportEntry } from "./calendar";
import { JAPANESE_HOLIDAYS } from "./data/holidays";
import { SNAPSHOT_DATE } from "./data/metadata";
import { isWantedOnDate } from "./calendar";

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
const WANT_TO_GO_STORAGE_KEY = "oshi-calendar-want-to-go";
const EXPORTED_WANT_TO_GO_STORAGE_KEY = "oshi-calendar-exported-want-to-go";
const EXPORT_RECORDS_KEY = "oshi-calendar-export-records-v2";
const PERSONAL_ENDS_KEY = "oshi-calendar-personal-ends";
const LAST_EXPORT_KEY = "oshi-calendar-last-export";

function loadStringRecord(key: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === "string"));
  } catch { return {}; }
}

function downloadIcs(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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


function eventStyle(artist: ArtistId) {
  return {
    "--event-color": ARTISTS[artist].color,
    "--event-soft": ARTISTS[artist].soft,
  } as CSSProperties;
}


function App() {
  const [now, setNow] = useState(() => new Date());
  const today = getJstToday(now);
  const [currentMonth, setCurrentMonth] = useState(() => parseIsoDate(getJstToday()));
  const [selectedDate, setSelectedDate] = useState(() => getJstToday());
  const calendarEvents = events;
  const [view, setView] = useState<"month" | "list">("month");
  const [wantedOnly, setWantedOnly] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [personalEnds, setPersonalEnds] = useState(() => loadStringRecord(PERSONAL_ENDS_KEY));
  const [lastExport, setLastExport] = useState(() => loadStringRecord(LAST_EXPORT_KEY));
  const [exportRecords, setExportRecords] = useState(() => {
    const saved = loadStringRecord(EXPORT_RECORDS_KEY);
    const legacy = loadExportedWantToGoKeys();
    for (const entry of getWantToGoEntries(events, legacy)) {
      if (!saved[entry.key]) saved[entry.key] = getEntryFingerprint(entry);
    }
    return saved;
  });
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
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(EXPORT_RECORDS_KEY, JSON.stringify(exportRecords));
      localStorage.setItem(PERSONAL_ENDS_KEY, JSON.stringify(personalEnds));
      localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify(lastExport));
    } catch { setStorageWarning(true); }
  }, [exportRecords, personalEnds, lastExport]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(WANT_TO_GO_STORAGE_KEY, JSON.stringify(wantToGoIds));
    } catch {
      setStorageWarning(true);
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
      setStorageWarning(true);
    }
  }, [exportedWantToGoKeys]);

  const calendarDays = useMemo(() => getCalendarDays(currentMonth), [currentMonth]);
  const visibleEvents = useMemo(
    () =>
      calendarEvents.filter(
        (event) =>
          (event.artists ?? [event.artist]).some((artist) => visibleArtists[artist]) &&
          visibleEventTypes[event.eventType] &&
          (!wantedOnly || wantToGoIds.includes(event.id) || getEventSelectionKeys(event).some((key) => wantToGoIds.includes(key))),
      ),
    [calendarEvents, visibleArtists, visibleEventTypes, wantedOnly, wantToGoIds],
  );
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    calendarDays.forEach((date) => {
      const key = toIsoDate(date);
      map.set(
        key,
        visibleEvents.filter((event) => isDateInEvent(key, event) && (!wantedOnly || isWantedOnDate(event, wantToGoIds, key))),
      );
    });
    return map;
  }, [calendarDays, visibleEvents, wantedOnly, wantToGoIds]);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const wantedEntries = useMemo(
    () => withPersonalEnds(getWantToGoEntries(calendarEvents, wantToGoIds), personalEnds),
    [calendarEvents, wantToGoIds, personalEnds],
  );
  const pendingWantedEntries = useMemo(
    () => wantedEntries.filter((entry) => !exportedWantToGoKeys.includes(entry.key) && !exportRecords[entry.key]),
    [exportedWantToGoKeys, wantedEntries, exportRecords],
  );
  const changedWantedEntries = wantedEntries.filter((entry) => exportRecords[entry.key] && exportRecords[entry.key] !== getEntryFingerprint(entry));
  const monthStart = toIsoDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1));
  const monthEnd = toIsoDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0));
  const monthEvents = visibleEvents.filter((event) => event.startDate <= monthEnd && (event.endDate ?? event.startDate) >= monthStart &&
    (!wantedOnly || wantedEntries.some((entry) => entry.event.id === event.id && entry.date! >= monthStart && entry.date! <= monthEnd)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const legacyPeriods = calendarEvents.filter((event) => event.endDate && !event.sessions?.length && wantToGoIds.includes(event.id));

  function changeMonth(offset: number) {
    const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1);
    setCurrentMonth(nextMonth);
    setSelectedDate(toIsoDate(nextMonth));
  }

  function goToToday() {
    const date = getJstToday();
    setCurrentMonth(parseIsoDate(date));
    setSelectedDate(date);
  }

  function toggleArtist(artist: ArtistId) {
    setVisibleArtists((current) => ({ ...current, [artist]: !current[artist] }));
  }

  function toggleEventType(eventType: EventType) {
    setVisibleEventTypes((current) => {
      const allSelected = availableEventTypes.every((type) => current[type]);
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

  function exportWantToGo(entries: CalendarExportEntry[] = pendingWantedEntries) {
    if (!entries.length) return;
    try {
      if (entries.some((entry) => entry.event.endDate && exportedWantToGoKeys.includes(entry.event.id)) && !window.confirm("以前、期間全体を書き出したイベントが含まれます。カレンダー側の重複を確認してから取り込んでください。書き出しますか？")) return;
      const content = buildIcs(entries);
      const filename = `oshi-calendar-${getJstToday()}-${Date.now()}.ics`;
      downloadIcs(content, filename);
      setLastExport({ content, filename });
      setExportRecords((current) => ({ ...current, ...Object.fromEntries(entries.map((entry) => [entry.key, getEntryFingerprint(entry)])) }));
      setExportedWantToGoKeys((current) => Array.from(new Set([...current, ...entries.map((entry) => entry.key)])));
      setExportMessage("ファイルを書き出しました。保存や取り込みに失敗した場合は「直前のファイルを再保存」を使ってください。");
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "書き出しに失敗しました。"); }
  }

  function resetWantToGo() {
    if (!wantToGoIds.length) return;
    if (!window.confirm("「行きたい」をすべて解除しますか？出力履歴は残ります。外部カレンダーの予定は削除されません。")) return;
    setWantToGoIds([]);
  }

  function clearExportHistory() {
    if (!window.confirm("出力履歴と再保存用ファイルを消去しますか？再度取り込むと予定が重複する可能性があります。外部カレンダーの予定は削除されません。")) return;
    setExportedWantToGoKeys([]);
    setExportRecords({});
    setLastExport({});
    setExportMessage("出力履歴を消去しました。外部カレンダーの予定は変更していません。");
  }

  function togglePeriodDate(event: CalendarEvent, date: string) {
    const key = `${event.id}::date-${date}`;
    setWantToGoIds((current) => {
      const withoutLegacy = current.filter((value) => value !== event.id);
      return withoutLegacy.includes(key) ? withoutLegacy.filter((value) => value !== key) : [...withoutLegacy, key];
    });
  }

  const availableEventTypes = EVENT_FILTER_ORDER.filter((eventType) =>
    calendarEvents.some((event) => event.eventType === eventType),
  );
  const hasAllEventTypes =
    availableEventTypes.length > 0 && availableEventTypes.every((eventType) => visibleEventTypes[eventType]);
  const exportButtonLabel = !wantedEntries.length
    ? "新規分をICS出力"
    : pendingWantedEntries.length
      ? `新規分をICS出力（${pendingWantedEntries.length}件）`
      : "新規の出力対象なし";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-lockup">
            <span className="brand-kicker">LIVE & EVENT PLANNER</span>
            <h1>推し活カレンダー</h1>
            <p>3組の予定を、ひとつのカレンダーに。</p>
          </div>
          <div className="header-note" aria-label={`${SNAPSHOT_DATE}時点の公開情報スナップショット`}>
            <span className="live-dot" />
            <span>SNAPSHOT {SNAPSHOT_DATE.replace(/-/g, ".")}</span>
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
                <span className="event-count">今月{monthEvents.length}件 / 全{calendarEvents.length}件</span>
                <span className="want-to-go-count" aria-live="polite">
                  {wantedEntries.length}件 行きたい
                </span>
                <button
                  className="export-calendar-button"
                  type="button"
                  onClick={() => exportWantToGo()}
                  disabled={!pendingWantedEntries.length}
                  title={
                    !wantedEntries.length
                      ? "詳細画面で「行きたい」を選択してください"
                      : pendingWantedEntries.length
                        ? "未書き出しの予定だけを追加します"
                        : "再ダウンロードは「出力・保存の管理」から行えます"
                  }
                >
                  {exportButtonLabel}
                </button>
                <button
                  className="reset-want-to-go-button"
                  type="button"
                  onClick={resetWantToGo}
                  disabled={!wantToGoIds.length}
                  title="出力履歴は残して、行きたいの選択を解除します"
                >
                  行きたいを全解除
                </button>
              </div>
            </div>

            <div className="view-controls" aria-label="表示方法">
              <button type="button" className={`type-filter-button ${view === "month" ? "is-active" : ""}`} aria-pressed={view === "month"} onClick={() => setView("month")}>月間</button>
              <button type="button" className={`type-filter-button ${view === "list" ? "is-active" : ""}`} aria-pressed={view === "list"} onClick={() => setView("list")}>一覧</button>
              <label><input type="checkbox" checked={wantedOnly} onChange={(event) => setWantedOnly(event.target.checked)} /> 行きたいだけ</label>
            </div>
            {storageWarning && <p className="notice" role="alert">このブラウザに保存できません。選択・出力履歴は画面を閉じると失われる可能性があります。</p>}
            {legacyPeriods.length > 0 && <p className="notice">以前選択した期間イベント（{legacyPeriods.map((event) => event.shortTitle).join("、")}）は、詳細から参加日を選び直してください。期間全体を自動では出力しません。</p>}
            {exportMessage && <p className="notice" role="status">{exportMessage}</p>}
            <details className="export-management">
              <summary>出力・保存の管理</summary>
              <p>ICSの書き出しは、カレンダーへの登録完了を意味しません。再取り込みによる重複は、カレンダーアプリによって防げない場合があります。</p>
              <button type="button" disabled={!lastExport.content || !lastExport.filename} onClick={() => {
                try { downloadIcs(lastExport.content, lastExport.filename); setExportMessage("直前と同じファイルを再保存しました。すでに取り込み済みなら再度取り込まないでください。"); }
                catch { setExportMessage("再保存に失敗しました。ブラウザの保存設定を確認してください。"); }
              }}>直前のファイルを再保存</button>
              {changedWantedEntries.length > 0 && <button type="button" onClick={() => {
                if (window.confirm("時刻・会場などを変更した予定を書き出します。自動同期ではありません。外部カレンダーの既存予定を確認・修正してから取り込んでください。")) exportWantToGo(changedWantedEntries);
              }}>変更した予定を再出力（{changedWantedEntries.length}件）</button>}
              <button type="button" disabled={!exportedWantToGoKeys.length && !Object.keys(exportRecords).length && !lastExport.content} onClick={clearExportHistory}>出力履歴を消去</button>
              <p>選択・自分用の終了予定・出力履歴はこのブラウザだけに保存されます。全解除しても外部カレンダーの予定は削除されません。</p>
            </details>

            {view === "month" ? <div className="calendar-grid" role="group" aria-label={`${formatMonth(currentMonth)}のカレンダー`}>
              {WEEKDAYS.map((weekday, index) => (
                <div
                  className={`weekday weekday-${index}`}
                  key={weekday}
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
                    aria-pressed={isSelected}
                    aria-current={key === today ? "date" : undefined}
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
            </div> : <div className="event-list" aria-label="今月のイベント一覧">
              {monthEvents.length ? monthEvents.map((event) => <button type="button" className="event-list-item" style={eventStyle(event.artist)} key={event.id}
                onClick={() => {
                  const wantedDate = wantedEntries.find((entry) => entry.event.id === event.id && entry.date! >= monthStart && entry.date! <= monthEnd)?.date;
                  setSelectedDate(wantedOnly && wantedDate ? wantedDate : event.startDate < monthStart ? monthStart : event.startDate);
                  document.getElementById("details-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}>
                <span className="list-location">{event.prefecture ?? "場所未確認"}</span>
                <strong>{event.shortTitle}</strong>
                <span>{wantedOnly ? wantedEntries.filter((entry) => entry.event.id === event.id && entry.date! >= monthStart && entry.date! <= monthEnd).map((entry) =>
                  `${formatShortDate(entry.date!)} ${entry.session?.start ?? "終日"}${entry.session?.end || entry.personalEnd ? `〜${entry.session?.end ?? entry.personalEnd}${entry.personalEnd ? "（自分用）" : ""}` : ""}`).join(" / ")
                  : `${formatRange(event)} · ${event.sessions?.map((session) => `${session.date ? `${formatShortDate(session.date)} ` : ""}${session.start ?? "時刻未確認"}`).join(" / ") ?? "時刻は詳細・公式へ"}`}</span>
                <small>{ARTISTS[event.artist].label} · {event.venue ?? "会場未確認"}</small>
              </button>) : <p className="notice">この月・条件に合う登録情報はありません。未掲載の予定は公式サイトをご確認ください。</p>}
            </div>}
            <p className="calendar-footnote">
              ※ 赤字は日曜・祝日です（祝日対応：2026〜2027年）。期間表示は各日の開催を保証しません。情報は{SNAPSHOT_DATE}時点の記録で、自動更新ではありません。終了未確認の公演は自分用の終了予定を設定できます。
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
                    personalEnds={personalEnds}
                    onPersonalEndChange={(key, value) => setPersonalEnds((current) => ({ ...current, [key]: value }))}
                    selectedKeys={wantToGoIds}
                    onTogglePeriodDate={togglePeriodDate}
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
        <span>公開情報スナップショット：{SNAPSHOT_DATE}時点</span>
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
  personalEnds,
  onPersonalEndChange,
  selectedKeys,
  onTogglePeriodDate,
}: {
  event: CalendarEvent;
  isWanted: boolean;
  onToggleWantToGo: (eventId: string) => void;
  isSessionWanted: (sessionIndex: number) => boolean;
  onToggleSessionWantToGo: (eventId: string, sessionIndex: number) => void;
  personalEnds: Record<string, string>;
  onPersonalEndChange: (key: string, value: string) => void;
  selectedKeys: string[];
  onTogglePeriodDate: (event: CalendarEvent, date: string) => void;
}) {
  const artist = ARTISTS[event.artist];
  const hasMultipleSessions = (event.sessions?.length ?? 0) > 1;
  const isPerformance = ["concert", "birthday", "fc", "stage"].includes(event.eventType);
  const startLabel = isPerformance ? "開演" : "開始";
  const endLabel = isPerformance ? "終演" : "終了";
  const periodDates = getPeriodDates(event);
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
        {!periodDates.length && <label className={`want-to-go-toggle ${isWanted ? "is-checked" : ""}`}>
          <input
            type="checkbox"
            checked={isWanted}
            onChange={() => onToggleWantToGo(event.id)}
            aria-label={`${event.shortTitle}${hasMultipleSessions ? "の全公演" : ""}を行きたい`}
          />
          <span className="want-to-go-box" aria-hidden="true" />
          <span>{hasMultipleSessions ? "全公演" : "行きたい"}</span>
        </label>}
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
            <span className="ticket-status">{getTicketDisplay(event)}</span>
          </div>
        )}
        {event.ticketSalesDate && (
          <div className="meta-row">
            <span className="meta-label">受付期間</span>
            <span>
              {formatShortDate(event.ticketSalesDate)}〜
              {event.ticketSalesEndDate ? `${formatShortDate(event.ticketSalesEndDate)} ${event.ticketSalesEndTime ?? "（締切時刻は公式へ）"}` : ""}
            </span>
          </div>
        )}
      </div>

      <p className="checked-at">情報確認日：{event.ticketCheckedAt ?? event.checkedAt ?? SNAPSHOT_DATE}。最新状況は公式ページをご確認ください。</p>
      {periodDates.length > 0 && <div className="period-choices">
        <strong>参加日を選択</strong>
        <p>休演日・出演日・公演時間は公式で確認してください。選んだ日だけを終日予定として出力します。</p>
        <div>{periodDates.map((date) => <label key={date}>
          <input type="checkbox" checked={selectedKeys.includes(`${event.id}::date-${date}`)} onChange={() => onTogglePeriodDate(event, date)} /> {formatShortDate(date)}
        </label>)}</div>
      </div>}

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
              <div className="session-row" key={`${event.id}-${session.id}`}>
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
                  {session.date && <strong>{formatShortDate(session.date)} </strong>}
                  {session.doors && <>開場 <strong>{session.doors}</strong></>}
                  {session.doors && session.start && <span className="time-separator">/</span>}
                  {session.start && <>{startLabel} <strong>{session.start}</strong></>}
                  {session.end && (session.doors || session.start) && (
                    <span className="time-separator">/</span>
                  )}
                  {session.end && <>{endLabel} <strong>{session.end}</strong></>}
                </span>
                {session.start && !session.end && <label className="personal-end">
                  <span>自分用の終了予定（公式未確認）</span>
                  <input type="time" value={personalEnds[getSessionSelectionKey(event, index)] ?? ""}
                    aria-label={`${event.shortTitle} ${session.label ?? `${index + 1}公演`} 自分用の終了予定`}
                    onChange={(input) => onPersonalEndChange(getSessionSelectionKey(event, index), input.target.value)} />
                  {personalEnds[getSessionSelectionKey(event, index)] && <button type="button" onClick={() => onPersonalEndChange(getSessionSelectionKey(event, index), "")}>クリア</button>}
                  <small>空欄なら開始時刻のみ。同日内で開始より後を指定。</small>
                </label>}
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
