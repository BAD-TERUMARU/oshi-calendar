import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CalendarExportEntry } from "./calendar";
import { getJstToday } from "./calendar";
import { JOURNAL_STORAGE_KEY, MAX_BACKUP_BYTES, STATUS_LABELS, mergeJournal, normalizeSongTitle, parseJournal, rankSongs, recordCost, recordFromEntry, serializeJournal, summarizeJournal, validateRecord } from "./journal";
import type { AttendanceRecord, AttendanceStatus, JournalView } from "./journal";
import "./journal.css";

const yen = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(value);
const errorText = (error: unknown) => error instanceof Error ? error.message : "処理できませんでした。もう一度お試しください。";

function loadJournal() {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(JOURNAL_STORAGE_KEY);
    return { records: raw ? parseJournal(raw) : [], raw, error: "" };
  } catch (error) {
    return { records: [] as AttendanceRecord[], raw, error: errorText(error) };
  }
}

function downloadText(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function blankRecord(): AttendanceRecord {
  const stamp = new Date().toISOString();
  return { id: `manual:${crypto.randomUUID()}`, title: "", artist: "", date: getJstToday(), session: "", venue: "", prefecture: "", status: "attended", seat: "", notes: "", rating: 0, costs: { ticket: 0, travel: 0, other: 0 }, setlist: [], createdAt: stamp, updatedAt: stamp };
}

export function JournalWorkspace({ view, wantedEntries, onChangeView }: { view: JournalView; wantedEntries: CalendarExportEntry[]; onChangeView: (view: JournalView) => void }) {
  const [loaded] = useState(loadJournal);
  const [records, setRecords] = useState(loaded.records);
  const recordsRef = useRef(records);
  const rawRef = useRef(loaded.raw);
  const [loadError, setLoadError] = useState(loaded.error);
  const [recoveryRaw, setRecoveryRaw] = useState(loaded.raw);
  const [message, setMessage] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [conflict, setConflict] = useState(false);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [artist, setArtist] = useState("");
  const [status, setStatus] = useState<AttendanceStatus | "">("");
  const [sourceKeys, setSourceKeys] = useState<string[]>([]);
  const [songQuery, setSongQuery] = useState("");
  const [expandedSong, setExpandedSong] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: StorageEvent) => { if ((event.key === JOURNAL_STORAGE_KEY || event.key === null) && event.newValue !== rawRef.current) setConflict(true); };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    if (dirty || storageWarning) window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, storageWarning]);

  function changeEditor(record: AttendanceRecord | null) {
    if (dirty && !window.confirm("未保存の入力を破棄して、編集する記録を切り替えますか？")) return;
    setDirty(false); setEditing(record ? structuredClone(record) : null);
    if (record) onChangeView("records");
  }

  function persist(next: AttendanceRecord[]) {
    if (loadError) throw new Error("保存済みデータを読み取れないため、上書きを止めています。元データを保存して確認してください。");
    const raw = serializeJournal(next);
    parseJournal(raw);
    // Detect other-tab changes immediately before writing, rather than silently replacing them.
    let current: string | null;
    try { current = localStorage.getItem(JOURNAL_STORAGE_KEY); }
    catch { throw new Error("このブラウザの保存領域にアクセスできません。"); }
    if (current !== rawRef.current) { setConflict(true); throw new Error("別のタブで記録が変わりました。現在の記録をバックアップし、保存データを再読み込みしてください。"); }
    try {
      localStorage.setItem(JOURNAL_STORAGE_KEY, raw); rawRef.current = raw; setStorageWarning("");
    } catch {
      setStorageWarning("画面上の記録は更新しましたが、端末に保存できませんでした。画面を閉じる前にJSONを書き出してください。");
    }
    recordsRef.current = next; setRecords(next);
  }

  function reloadRecords() {
    if ((editing || storageWarning) && !window.confirm("編集中または未保存の内容を閉じて、保存データを読み直しますか？必要な内容は先にJSONへ書き出してください。")) return;
    const next = loadJournal();
    setRecoveryRaw(next.raw);
    if (next.error) { setLoadError(next.error); return; }
    rawRef.current = next.raw; recordsRef.current = next.records; setRecords(next.records);
    setLoadError(""); setConflict(false); setStorageWarning(""); setEditing(null); setDirty(false); setMessage("保存データを読み直しました。");
  }

  const years = [...new Set(records.map(record => record.date.slice(0, 4)))].sort().reverse();
  const artists = [...new Set(records.map(record => record.artist))].sort((a, b) => a.localeCompare(b, "ja"));
  const scoped = useMemo(() => records.filter(record => (!year || record.date.startsWith(year)) && (!artist || record.artist === artist)), [records, year, artist]);
  const filtered = scoped.filter(record => (!status || record.status === status) && (!query || normalizeSongTitle([record.title, record.artist, record.venue, record.notes, ...record.setlist].join(" ")).includes(normalizeSongTitle(query))))
    .sort((a, b) => b.date.localeCompare(a.date) || a.session.localeCompare(b.session, "ja"));
  const summary = useMemo(() => summarizeJournal(scoped), [scoped]);
  const songs = useMemo(() => rankSongs(scoped), [scoped]);
  const visibleSongs = songs.filter(song => song.key.includes(normalizeSongTitle(songQuery)));
  const existingIds = new Set(records.map(record => record.id));
  const selectable = wantedEntries.filter(entry => !existingIds.has(`calendar:${entry.key}`));
  const selectedSources = selectable.filter(entry => sourceKeys.includes(entry.key));
  const upcoming = scoped.filter(record => record.status === "planned" && record.date >= getJstToday()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  function addSelected() {
    try {
      const result = mergeJournal(recordsRef.current, selectedSources.map(entry => recordFromEntry(entry)));
      persist(result.records); setSourceKeys([]); setMessage(`${result.added}公演を参加予定として追加しました。`);
    } catch (error) { setMessage(errorText(error)); }
  }
  function saveRecord(record: AttendanceRecord) {
    const checked = validateRecord({ ...record, updatedAt: new Date().toISOString() });
    const current = recordsRef.current;
    persist(current.some(item => item.id === checked.id) ? current.map(item => item.id === checked.id ? checked : item) : [...current, checked]);
    setEditing(null); setDirty(false); setMessage("現場記録を更新しました。");
  }
  function deleteRecord(record: AttendanceRecord) {
    if (!window.confirm(`「${record.title} ${record.session}」の記録とセトリを削除しますか？`)) return;
    try { persist(recordsRef.current.filter(item => item.id !== record.id)); if (editing?.id === record.id) { setEditing(null); setDirty(false); } setMessage("現場記録を削除しました。"); }
    catch (error) { setMessage(errorText(error)); }
  }
  async function importFile(file: File) {
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("バックアップは8MB以内のファイルを選んでください。");
      const incoming = parseJournal(await file.text());
      const result = mergeJournal(recordsRef.current, incoming);
      if (result.added) persist(result.records);
      setMessage(`${result.added}件を追加しました。同じIDの${result.skipped}件は既存の記録を保持しました。`);
    } catch (error) { setMessage(errorText(error)); }
    finally { if (importRef.current) importRef.current.value = ""; }
  }
  function openRecord(record: AttendanceRecord) {
    if (editing?.id === record.id) { onChangeView("records"); return; }
    changeEditor(record);
  }

  return <section className="journal-workspace" aria-label="自分の推し活記録">
    <div className="journal-heading">
      <div><span className="section-kicker">MY LIVE ARCHIVE</span><h2>{view === "records" ? "現場記録" : view === "dashboard" ? "推し活の振り返り" : "生涯セトリ"}</h2><p>{view === "records" ? "行った日も、これから行く日も。自分の記録を残す。" : view === "dashboard" ? "参加済みの現場から、これまでを振り返る。" : "参加済みの現場で聴いた曲を、公演数で振り返る。"}</p></div>
      <button className="journal-primary" onClick={() => changeEditor(blankRecord())} disabled={Boolean(loadError) || conflict}>＋ 現場を記録</button>
    </div>

    {loadError && <div className="journal-alert" role="alert"><strong>保存データを読み取れません。</strong><p>{loadError} 元の保存データは変更していません。</p>{recoveryRaw && <button onClick={() => downloadText(recoveryRaw, `oshi-journal-original-${getJstToday()}.json`)}>元のデータを書き出す</button>}<button onClick={reloadRecords}>保存データを再読み込み</button></div>}
    {conflict && <div className="journal-alert" role="alert">別のタブで記録が更新されています。上書きする前に、保存データを再読み込みしてください。<button onClick={reloadRecords}>保存データを再読み込み</button></div>}
    {storageWarning && <p className="journal-alert" role="alert">{storageWarning}</p>}
    {message && <p className="journal-message" role="status">{message}</p>}

    <div className="journal-filters">
      <label>年<select value={year} onChange={event => setYear(event.target.value)}><option value="">すべての年</option>{years.map(value => <option key={value} value={value}>{value}年</option>)}</select></label>
      <label>アーティスト<select value={artist} onChange={event => setArtist(event.target.value)}><option value="">すべて</option>{artists.map(value => <option key={value}>{value}</option>)}</select></label>
      {(year || artist) && <button onClick={() => { setYear(""); setArtist(""); }}>絞り込みを解除</button>}
    </div>

    <div hidden={view !== "records"}>
      {editing && <RecordEditor key={editing.id} record={editing} onSave={saveRecord} onCancel={() => changeEditor(null)} onDirtyChange={setDirty} blocked={Boolean(loadError) || conflict} />}
      <details className="journal-import-shows"><summary>カレンダーの「行きたい」から追加 <span>{selectable.length}公演</span></summary>
        {selectable.length ? <><p>追加したい公演を選んでください。昼夜は別の記録になります。</p><div className="journal-source-list">{selectable.map(entry => <label key={entry.key}><input type="checkbox" checked={sourceKeys.includes(entry.key)} onChange={event => setSourceKeys(keys => event.target.checked ? [...keys, entry.key] : keys.filter(key => key !== entry.key))} /><span><strong>{entry.date} {entry.session?.label}</strong>{entry.event.title}<small>{entry.event.venue}</small></span></label>)}</div><button className="journal-primary" disabled={!selectedSources.length || Boolean(loadError) || conflict} onClick={addSelected}>選んだ{selectedSources.length}公演を追加</button></> : <p>カレンダーで「行きたい」を選ぶと、ここから追加できます。登録済みの公演は表示しません。</p>}
      </details>
      <div className="journal-record-controls"><label>記録を検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="公演名・会場・曲名・感想" /></label><label>参加状態<select value={status} onChange={event => setStatus(event.target.value as AttendanceStatus | "")}><option value="">すべて</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span>{filtered.length}件</span></div>
      {!filtered.length && <div className="journal-empty"><strong>{records.length ? "条件に合う記録はありません" : "最初の現場を記録しましょう"}</strong><p>{records.length ? "検索や絞り込みの条件を変えてみてください。" : "過去の現場は「現場を記録」から。これからの予定はカレンダーから追加できます。"}</p></div>}
      <div className="journal-record-grid">{filtered.map(record => <article className="journal-record" key={record.id}>
        <div className="journal-record-date"><time dateTime={record.date}>{record.date.replace(/-/g, ".")}</time><span className={`journal-status is-${record.status}`}>{STATUS_LABELS[record.status]}</span></div>
        <h3>{record.title}</h3><p className="journal-artist">{record.artist}{record.session && ` · ${record.session}`}</p><p>{[record.venue, record.prefecture].filter(Boolean).join(" / ") || "会場未入力"}</p>
        <div className="journal-record-meta"><span>{record.setlist.length}曲 記録</span><span>登録支出 {yen(recordCost(record))}</span>{record.rating > 0 && <span aria-label={`評価5点中${record.rating}点`}>★ {record.rating}</span>}</div>
        {record.notes && <p className="journal-note-preview">{record.notes}</p>}
        <div className="journal-record-actions"><button onClick={() => openRecord(record)}>記録・セトリを編集</button><button className="journal-delete" aria-label={`${record.title} ${record.session}の記録を削除`} onClick={() => deleteRecord(record)} disabled={Boolean(loadError) || conflict}>削除</button></div>
      </article>)}</div>
    </div>

    {view === "dashboard" && <>
      <div className="journal-stats">{[["参加した公演", `${summary.performances}`, "公演"], ["訪れた会場", `${summary.venues}`, "会場"], ["聴いた曲", `${summary.uniqueSongs}`, "曲"], ["登録済みの支出", yen(summary.spending), ""]].map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>)}</div>
      <p className="journal-footnote">集計対象は「参加済み」の記録です。支出は入力した金額の合計、会場は入力した名称で数えます。</p>
      <div className="journal-dashboard-grid"><Distribution title="月ごとの現場" rows={summary.byMonth} /><Distribution title="アーティストごとの現場" rows={summary.byArtist} /></div>
      <section className="journal-panel"><h3>これからの予定</h3>{upcoming.length ? <ul className="journal-upcoming">{upcoming.map(record => <li key={record.id}><time>{record.date}</time><button onClick={() => openRecord(record)}>{record.title}{record.session && ` · ${record.session}`}</button><span>{record.venue}</span></li>)}</ul> : <p>参加予定の記録はありません。</p>}</section>
    </>}

    {view === "songs" && <>
      <div className="journal-song-heading"><label>曲名を検索<input type="search" value={songQuery} onChange={event => setSongQuery(event.target.value)} placeholder="曲名を入力" /></label><span>{visibleSongs.length}曲 / {summary.performances}公演</span></div>
      <p className="journal-footnote">自分で入力したセトリから集計します。同じ公演内の重複曲は1公演として数えます。表記の異なる別バージョンは、曲名を編集してまとめられます。</p>
      {!visibleSongs.length ? <div className="journal-empty"><strong>{songs.length ? "条件に合う曲はありません" : "まだセトリの記録がありません"}</strong><p>「参加済み」の現場に曲名を登録すると表示されます。</p></div> : <ol className="journal-song-list">{visibleSongs.map((song, index) => <li key={song.key}>
        <button className="journal-song-row" aria-expanded={expandedSong === song.key} onClick={() => setExpandedSong(expandedSong === song.key ? "" : song.key)}><span className="journal-song-rank">{index + 1}</span><span><strong>{song.title}</strong><small>初回 {song.firstDate} / 最終 {song.lastDate}</small></span><span className="journal-song-count">{song.count}<small>公演</small></span></button>
        {expandedSong === song.key && <ul className="journal-song-records">{song.recordIds.map(id => { const record = records.find(item => item.id === id)!; return <li key={id}><button onClick={() => openRecord(record)}>{record.date} · {record.title}{record.session && ` · ${record.session}`}</button></li>; })}</ul>}
      </li>)}</ol>}
    </>}

    <details className="journal-backup"><summary>記録のバックアップ・取り込み</summary><p>個人の記録はこのブラウザだけに保存され、サーバーに送信されません。別の端末へ移すときはJSONを書き出して取り込んでください。ブラウザのデータ消去に備えて定期的に保存してください。</p><div><button onClick={() => { try { downloadText(serializeJournal(recordsRef.current), `oshi-journal-${getJstToday()}.json`); setMessage("JSONを書き出しました。端末への保存を確認してください。"); } catch (error) { setMessage(errorText(error)); } }}>JSONを書き出す（{records.length}件）</button><button onClick={() => importRef.current?.click()} disabled={Boolean(loadError) || conflict}>JSONを取り込む</button><input ref={importRef} type="file" accept=".json,application/json" aria-label="現場記録JSONファイル" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></div><p>取り込みは追加のみです。同じIDの記録は上書きしません。座席や感想など、個人情報を含むファイルの共有先は自分で選んでください。</p></details>
  </section>;
}

function Distribution({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return <section className="journal-panel"><h3>{title}</h3>{rows.length ? <ul className="journal-distribution">{rows.map(row => <li key={row.label}><span>{row.label}</span><div aria-hidden="true"><i style={{ width: `${row.count / max * 100}%` }} /></div><strong>{row.count}<small>公演</small></strong></li>)}</ul> : <p>参加済みの現場を登録すると表示されます。</p>}</section>;
}

function RecordEditor({ record, onSave, onCancel, onDirtyChange, blocked }: { record: AttendanceRecord; onSave: (record: AttendanceRecord) => void; onCancel: () => void; onDirtyChange: (dirty: boolean) => void; blocked: boolean }) {
  const [draft, setDraft] = useState(() => structuredClone(record));
  const [setlistText, setSetlistText] = useState(record.setlist.join("\n"));
  const [error, setError] = useState("");
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => { firstField.current?.focus(); firstField.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, []);
  useEffect(() => { onDirtyChange(JSON.stringify(draft) !== JSON.stringify(record) || setlistText !== record.setlist.join("\n")); }, [draft, setlistText, record, onDirtyChange]);
  function field<K extends keyof AttendanceRecord>(name: K, value: AttendanceRecord[K]) { setDraft(current => ({ ...current, [name]: value })); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { onSave({ ...draft, title: draft.title.trim(), artist: draft.artist.trim(), venue: draft.venue.trim(), setlist: setlistText.split(/\r?\n/).map(line => line.trim()).filter(Boolean) }); }
    catch (error) { setError(errorText(error)); }
  }
  return <form className="journal-editor" onSubmit={submit} aria-label="現場記録の編集">
    <div className="journal-editor-heading"><h3>現場の記録</h3><button type="button" onClick={onCancel}>編集を閉じる</button></div>
    {error && <p className="journal-alert" role="alert">{error}</p>}
    <div className="journal-form-grid">
      <label className="journal-wide">公演名 <span>必須</span><input ref={firstField} required maxLength={300} value={draft.title} onChange={event => field("title", event.target.value)} /></label>
      <label>アーティスト <span>必須</span><input required maxLength={120} value={draft.artist} list="journal-artists" onChange={event => field("artist", event.target.value)} /><datalist id="journal-artists"><option>モーニング娘。</option><option>OCHA NORMA</option><option>宮本佳林</option></datalist></label>
      <label>参加日 <span>必須</span><input type="date" required min="1900-01-01" max="2199-12-31" value={draft.date} onChange={event => field("date", event.target.value)} /></label>
      <label>公演区分<input maxLength={80} placeholder="昼・夜など" value={draft.session} onChange={event => field("session", event.target.value)} /></label>
      <label>参加状態<select value={draft.status} onChange={event => field("status", event.target.value as AttendanceStatus)}>{Object.entries(STATUS_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>会場<input maxLength={300} value={draft.venue} onChange={event => field("venue", event.target.value)} /></label>
      <label>都道府県<input maxLength={100} value={draft.prefecture} onChange={event => field("prefecture", event.target.value)} /></label>
      <label>座席・整理番号<input maxLength={150} value={draft.seat} onChange={event => field("seat", event.target.value)} /></label>
      <label>自分の満足度<select value={draft.rating} onChange={event => field("rating", Number(event.target.value))}><option value={0}>未評価</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label>
      <fieldset className="journal-wide journal-costs"><legend>登録する支出（円）</legend>{([['ticket', 'チケット'], ['travel', '交通・宿泊'], ['other', 'グッズ・その他']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min={0} max={100000000} step={1} inputMode="numeric" value={draft.costs[key]} onChange={event => field("costs", { ...draft.costs, [key]: event.target.value === "" ? 0 : Number(event.target.value) })} /></label>)}</fieldset>
      <label className="journal-wide">感想・メモ<textarea maxLength={10000} rows={4} value={draft.notes} onChange={event => field("notes", event.target.value)} placeholder="印象に残った場面や、その日の気持ち" /></label>
      <label className="journal-wide">セットリスト<textarea rows={8} value={setlistText} onChange={event => setSetlistText(event.target.value)} placeholder={"夕暮れは雨上がり\nHand made CITY"} /><small>曲名だけを1行に1曲。記録順に保存します。参加済みにすると生涯セトリへ集計されます。</small></label>
    </div><div className="journal-editor-actions"><button className="journal-primary" disabled={blocked}>記録を保存</button><button type="button" onClick={onCancel}>キャンセル</button></div>
  </form>;
}
