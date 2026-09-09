const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Test-only loader; uses the existing TypeScript dependency.
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
};
const c = require('../src/calendar.ts');
const { events } = require('../src/data/events.ts');
const { JAPANESE_HOLIDAYS: holidays } = require('../src/data/holidays.ts');
const fixture = { id: 'example', artist: 'ocha', title: '正式名称', shortTitle: 'テスト', startDate: '2026-09-05', eventType: 'concert', sessions: [
  { id: 'session-0', label: '昼', start: '13:00' }, { id: 'session-1', label: '夜', start: '18:00' },
] };
const unfold = (value) => value.replace(/\r\n /g, '');
const entries = (event = fixture, keys = ['example::session-0']) => c.getWantToGoEntries([event], keys);

test('data IDs unique and dates/times valid', () => {
  assert.equal(new Set(events.map(e => e.id)).size, events.length);
  for (const event of events) {
    assert.equal(c.toIsoDate(c.parseIsoDate(event.startDate)), event.startDate);
    if (event.endDate) assert.ok(event.endDate >= event.startDate);
    assert.equal(new Set(event.sessions?.map(s => s.id)).size, event.sessions?.length ?? 0);
    for (const session of event.sessions ?? []) {
      assert.ok(session.id);
      for (const key of ['start', 'doors', 'end']) if (session[key]) assert.ok(c.isValidTime(session[key]));
      if (session.end) assert.ok(session.end > session.start);
    }
  }
});
test('JST boundary independent of device timezone', () => {
  assert.equal(c.getJstToday(new Date('2026-09-04T14:59:59Z')), '2026-09-04');
  assert.equal(c.getJstToday(new Date('2026-09-04T15:00:00Z')), '2026-09-05');
});
test('date-only ticket deadline warns without asserting live availability', () => {
  const event = { ...fixture, ticketStatus: '受付中', ticketSalesEndDate: '2026-09-04' };
  assert.match(c.getTicketDisplay(event, new Date('2026-09-05T00:00:00+09:00')), /記録された受付期間は終了/);
  assert.match(c.getTicketDisplay(event, new Date('2026-09-04T00:00:00+09:00')), /締切時刻は公式/);
  assert.match(c.getTicketDisplay(event, new Date('2026-09-03T00:00:00+09:00')), /確認日時点/);
});
test('precise deadline and sale date warnings', () => {
  const event = { ...fixture, ticketStatus: '受付中', ticketSalesEndDate: '2026-09-05', ticketSalesEndTime: '12:00' };
  assert.match(c.getTicketDisplay(event, new Date('2026-09-05T12:00:00+09:00')), /終了/);
  assert.doesNotMatch(c.getTicketDisplay(event, new Date('2026-09-05T11:59:00+09:00')), /終了/);
  assert.match(c.getTicketDisplay({ ...fixture, ticketStatus: '一般発売予定', ticketSalesDate: '2026-09-05' }, new Date('2026-09-05T12:00:00+09:00')), /要確認/);
});
test('one show and reordering preserves identity, signature and UID', () => {
  const original = entries(fixture, ['example::session-1']);
  const reordered = entries({ ...fixture, sessions: [...fixture.sessions].reverse() }, ['example::session-1']);
  assert.equal(original.length, 1);
  assert.equal(reordered[0].session.label, '夜');
  assert.equal(c.getEntryFingerprint(original[0]), c.getEntryFingerprint(reordered[0]));
  assert.match(c.buildIcs(reordered), /UID:example-session-1@/);
});
test('legacy event selection expands to actual sessions', () => {
  assert.equal(entries(fixture, ['example']).length, 2);
});
test('legacy selections also survive in the later bundled events', () => {
  const event = events.find(e => e.id === 'karin-kumagaya-2026-10-17');
  const selected = c.getWantToGoEntries([event], [`${event.id}::session-1`]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].session.start, '18:15');
  assert.match(c.buildIcs(selected), /UID:karin-kumagaya-2026-10-17-session-1@/);
});
test('13-15 JST exports UTC block, busy status and personal estimate label', () => {
  const ics = unfold(c.buildIcs(c.withPersonalEnds(entries(), { 'example::session-0': '15:00' })));
  assert.match(ics, /DTSTART:20260905T040000Z/);
  assert.match(ics, /DTEND:20260905T060000Z/);
  assert.match(ics, /TRANSP:OPAQUE/);
  assert.match(ics, /公式の終演時刻ではありません/);
});
test('unknown end remains unknown; official end takes precedence', () => {
  assert.doesNotMatch(c.buildIcs(entries()), /DTEND/);
  const event = { ...fixture, sessions: [{ ...fixture.sessions[0], end: '14:00' }] };
  assert.match(c.buildIcs(c.withPersonalEnds(entries(event), { 'example::session-0': '15:00' })), /DTEND:20260905T050000Z/);
});
test('invalid, equal or earlier personal end blocks export', () => {
  for (const end of ['12:59', '13:00', '25:00']) assert.throws(() => c.buildIcs(c.withPersonalEnds(entries(), { 'example::session-0': end })), /終了予定/);
});
test('changed end or venue changes signature, blank end does not', () => {
  const entry = entries()[0];
  assert.notEqual(c.getEntryFingerprint(entry), c.getEntryFingerprint({ ...entry, personalEnd: '15:00' }));
  assert.notEqual(c.getEntryFingerprint(entry), c.getEntryFingerprint({ ...entry, event: { ...fixture, venue: '新会場' } }));
  assert.equal(c.getEntryFingerprint(entry), c.getEntryFingerprint(c.withPersonalEnds([entry], { [entry.key]: '' })[0]));
});
test('period exports only selected date, not whole span or legacy selection', () => {
  const event = { ...fixture, sessions: undefined, endDate: '2026-09-07' };
  assert.equal(c.getPeriodDates(event).length, 3);
  assert.equal(entries(event, ['example']).length, 0);
  const selected = entries(event, ['example::date-2026-09-06']);
  assert.equal(selected.length, 1);
  assert.match(c.buildIcs(selected), /DTSTART;VALUE=DATE:20260906/);
  assert.match(c.buildIcs(selected), /DTEND;VALUE=DATE:20260907/);
});
test('session-specific actual date used in export', () => {
  const event = { ...fixture, endDate: '2026-09-07', sessions: [{ ...fixture.sessions[0], date: '2026-09-07' }] };
  assert.match(c.buildIcs(entries(event)), /DTSTART:20260907T040000Z/);
});
test('ICS UTF-8 folding and escaping', () => {
  const ics = c.buildIcs(entries({ ...fixture, title: '日本語,;\\\n'.repeat(60) }));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.match(unfold(ics), /日本語\\,\\;/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});
test('Monday start and 2027 substitute holiday', () => {
  const days = c.getCalendarDays(new Date(2026, 8, 1));
  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 1);
  assert.equal(holidays['2027-03-22'], '休日（振替休日）');
});
test('actual expired event no longer presented as currently open', () => {
  assert.match(c.getTicketDisplay(events.find(e => e.id === 'ocha-nanafes-2026'), new Date('2026-09-05T12:00:00+09:00')), /記録された受付期間は終了/);
});
test('wanted-only dates exclude unselected period days and session dates', () => {
  const period = { ...fixture, sessions: undefined, endDate: '2026-09-07' };
  assert.equal(c.isWantedOnDate(period, ['example::date-2026-09-06'], '2026-09-05'), false);
  assert.equal(c.isWantedOnDate(period, ['example::date-2026-09-06'], '2026-09-06'), true);
  const dated = { ...fixture, endDate: '2026-09-07', sessions: [{ ...fixture.sessions[0], date: '2026-09-07' }] };
  assert.equal(c.isDateInEvent('2026-09-06', dated), false);
  assert.equal(c.isDateInEvent('2026-09-07', dated), true);
});
