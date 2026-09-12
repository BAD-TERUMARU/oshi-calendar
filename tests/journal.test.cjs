const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
let journal = {};
try { journal = require('../src/journal.ts'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const fixture = (changes = {}) => ({
  id: 'show-1', title: '秋ツアー', artist: 'モーニング娘。', date: '2026-09-05', session: '昼', venue: '会場A', prefecture: '東京都',
  status: 'attended', seat: '', notes: '楽しかった', rating: 5, costs: { ticket: 9000, travel: 1000, other: 500 },
  setlist: ['夕暮れは雨上がり', 'Hand made CITY', '夕暮れは雨上がり'], createdAt: '2026-09-05T09:00:00.000Z', updatedAt: '2026-09-05T09:00:00.000Z', ...changes,
});

test('attended totals exclude planned/skipped records and preserve zero spending', () => {
  assert.equal(typeof journal.summarizeJournal, 'function');
  const result = journal.summarizeJournal([fixture(), fixture({id:'show-2',status:'planned'}), fixture({id:'show-3',status:'skipped'}), fixture({id:'show-4',venue:'会場B',date:'2026-10-01',costs:{ticket:0,travel:0,other:0},setlist:[]})]);
  assert.equal(result.performances,2); assert.equal(result.venues,2); assert.equal(result.spending,10500); assert.equal(result.uniqueSongs,2);
  assert.deepEqual(result.byMonth,[{label:'2026-09',count:1},{label:'2026-10',count:1}]);
});
test('Morning Musume journal records share one artist across year labels and calendar imports', () => {
  const parsed=journal.parseJournal(journal.serializeJournal([fixture(),fixture({id:'old',artist:"モーニング娘。'25"}),fixture({id:'new',artist:'モーニング娘。’26'})]));
  assert.deepEqual(journal.summarizeJournal(parsed).byArtist,[{label:'モーニング娘。',count:3}]);
  const imported=journal.recordFromEntry({key:'a',event:{id:'a',artist:'morning',title:'ライブ',startDate:'2026-09-12',eventType:'concert'}});
  assert.equal(imported.artist,'モーニング娘。');
});
test('song ranks count each attended performance once and show its earliest and latest date', () => {
  assert.equal(typeof journal.rankSongs, 'function');
  const result = journal.rankSongs([fixture(), fixture({id:'show-2',date:'2026-09-06',setlist:['  Ｈａｎｄ   made CITY  ']}), fixture({id:'show-3',status:'planned',setlist:['別の曲']})]);
  assert.equal(result.length,2); assert.equal(result[0].title,'Hand made CITY'); assert.equal(result[0].count,2);
  assert.equal(result[0].firstDate,'2026-09-05'); assert.equal(result[0].lastDate,'2026-09-06');
  assert.deepEqual(result[0].recordIds,['show-1','show-2']);
});
test('selected sessions create stable separate records and survive later event title changes', () => {
  assert.equal(typeof journal.recordFromEntry, 'function');
  const event = {id:'tour',artist:'morning',title:'正式ツアー名',shortTitle:'略称',startDate:'2026-09-05',venue:'会場A',prefecture:'東京都',eventType:'concert'};
  const first=journal.recordFromEntry({key:'tour::day',event,date:'2026-09-06',session:{id:'day',label:'昼'}},'2026-09-12T00:00:00.000Z');
  const second=journal.recordFromEntry({key:'tour::night',event,date:'2026-09-06',session:{id:'night',label:'夜'}},'2026-09-12T00:00:00.000Z');
  event.title='変更後'; assert.equal(first.title,'正式ツアー名'); assert.equal(first.date,'2026-09-06'); assert.notEqual(first.id,second.id); assert.equal(first.status,'planned');
  const result=journal.mergeJournal([first],[first,second]); assert.equal(result.records.length,2); assert.equal(result.added,1); assert.equal(result.skipped,1);
});
test('backup round trip keeps notes and rejects a malformed batch atomically', () => {
  assert.equal(typeof journal.parseJournal, 'function');
  const original=[fixture({notes:'改行\n「記録」',setlist:['a,b','<script>']})];
  assert.deepEqual(journal.parseJournal(journal.serializeJournal(original)),original);
  const parse=(records)=>journal.parseJournal(JSON.stringify({schemaVersion:1,records}));
  for(const bad of [fixture({date:'2026-02-30'}),fixture({costs:{ticket:-1,travel:0,other:0}}),fixture({status:'unknown'}),fixture({rating:7}),fixture({setlist:[{}]})]) assert.throws(()=>parse([fixture(),{...bad,id:'bad'}]));
  assert.throws(()=>parse([fixture(),fixture()])); assert.throws(()=>journal.parseJournal('{broken'));
  assert.throws(()=>journal.parseJournal(JSON.stringify({schemaVersion:2,records:[]})));
});
test('import keeps existing content when IDs collide instead of overwriting memories', () => {
  assert.equal(typeof journal.mergeJournal, 'function');
  const existing=fixture({notes:'自分の新しい感想'});
  const result=journal.mergeJournal([existing],[fixture({notes:'古いバックアップ'})]);
  assert.equal(result.records[0].notes,'自分の新しい感想'); assert.equal(result.added,0); assert.equal(result.skipped,1);
});
test('blank titles and decimal yen are rejected, while leap days are accepted', () => {
  assert.equal(typeof journal.validateRecord, 'function');
  assert.doesNotThrow(()=>journal.validateRecord(fixture({date:'2024-02-29'})));
  assert.throws(()=>journal.validateRecord(fixture({title:'  '})));
  assert.throws(()=>journal.validateRecord(fixture({costs:{ticket:1.5,travel:0,other:0}})));
  assert.throws(()=>journal.validateRecord(fixture({createdAt:'not a date'})));
});
