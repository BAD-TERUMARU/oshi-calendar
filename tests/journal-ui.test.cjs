const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { Blob: NodeBlob } = require("node:buffer");
const { JSDOM } = require("jsdom");

require.extensions[".ts"] = require.extensions[".tsx"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText, filename);
};
require.extensions[".css"] = module => { module.exports = {}; };

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://calendar.test/" });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLAnchorElement", "Event", "MouseEvent", "StorageEvent", "BeforeUnloadEvent", "localStorage"]) {
  global[name] = dom.window[name];
}
global.Blob = NodeBlob;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.HTMLAnchorElement.prototype.click = function () {};

const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const { JournalWorkspace } = require("../src/JournalWorkspace.tsx");
const { JOURNAL_STORAGE_KEY } = require("../src/journal.ts");

const nativeSetItem = dom.window.Storage.prototype.setItem;
const nativeWindowSetTimeout = window.setTimeout.bind(window);
let mounted;
let downloadedBlob;

function record(overrides = {}) {
  return {
    id: "manual:first",
    title: "春ツアー",
    artist: "OCHA NORMA",
    date: "2026-05-03",
    session: "昼",
    venue: "日本武道館",
    prefecture: "東京都",
    status: "attended",
    seat: "1階A列",
    notes: "初期メモ",
    rating: 4,
    costs: { ticket: 8500, travel: 1200, other: 0 },
    setlist: ["宇宙規模でダイスキ宣言！"],
    createdAt: "2026-05-03T10:00:00.000Z",
    updatedAt: "2026-05-03T10:00:00.000Z",
    ...overrides,
  };
}

function backup(records) {
  return JSON.stringify({ schemaVersion: 1, records });
}

function button(label) {
  const result = [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label);
  assert.ok(result, `button not found: ${label}`);
  return result;
}

function field(label, selector = "input,textarea,select") {
  const editor = document.querySelector("form[aria-label='現場記録の編集']");
  const owner = [...(editor || document).querySelectorAll("label")].find(node => node.textContent.trim().startsWith(label));
  assert.ok(owner, `label not found: ${label}`);
  const result = owner.querySelector(selector);
  assert.ok(result, `control not found for: ${label}`);
  return result;
}

async function click(node) {
  await act(async () => {
    node.click();
    await Promise.resolve();
  });
}

async function enter(control, value) {
  const prototype = control instanceof dom.window.HTMLTextAreaElement
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(control, value);
  await act(async () => {
    control.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function mount(view = "records") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let currentView = view;
  const onChangeView = next => {
    currentView = next;
    root.render(React.createElement(JournalWorkspace, { view: currentView, wantedEntries: [], onChangeView }));
  };
  const renderView = async next => {
    currentView = next;
    await act(async () => {
      root.render(React.createElement(JournalWorkspace, { view: currentView, wantedEntries: [], onChangeView }));
      await Promise.resolve();
    });
  };
  await renderView(view);
  mounted = { root, container, renderView };
  return mounted;
}

test.beforeEach(() => {
  dom.window.Storage.prototype.setItem = nativeSetItem;
  localStorage.clear();
  document.body.replaceChildren();
  window.confirm = () => true;
  downloadedBlob = undefined;
  window.URL.createObjectURL = blob => { downloadedBlob = blob; return "blob:test"; };
  window.URL.revokeObjectURL = () => {};
  window.setTimeout = (callback, delay) => delay === 60000 ? (callback(), 0) : nativeWindowSetTimeout(callback, delay);
  global.URL = window.URL;
  mounted = undefined;
});

test.afterEach(async () => {
  if (mounted) await act(async () => mounted.root.unmount());
  dom.window.Storage.prototype.setItem = nativeSetItem;
  window.setTimeout = nativeWindowSetTimeout;
});

test("new-record draft survives navigation to dashboard and back", async () => {
  const app = await mount();
  await click(button("＋ 現場を記録"));
  await enter(field("公演名"), "まだ保存していない公演");
  await enter(field("感想・メモ", "textarea"), "消えてはいけない下書き");

  await app.renderView("dashboard");
  assert.match(document.querySelector(".journal-workspace h2").textContent, /推し活の振り返り/);
  await app.renderView("records");

  assert.equal(field("公演名").value, "まだ保存していない公演");
  assert.equal(field("感想・メモ", "textarea").value, "消えてはいけない下書き");
});

test("existing-record draft survives navigation to dashboard and back", async () => {
  localStorage.setItem(JOURNAL_STORAGE_KEY, backup([record()]));
  const app = await mount();
  await click(button("記録・セトリを編集"));
  await enter(field("感想・メモ", "textarea"), "編集途中の下書き");

  await app.renderView("dashboard");
  await app.renderView("records");

  assert.equal(field("公演名").value, "春ツアー");
  assert.equal(field("感想・メモ", "textarea").value, "編集途中の下書き");
});

test("cancelled dirty-editor guard prevents switching to a new record", async () => {
  localStorage.setItem(JOURNAL_STORAGE_KEY, backup([record()]));
  await mount();
  await click(button("記録・セトリを編集"));
  await enter(field("感想・メモ", "textarea"), "保存前の変更");
  window.confirm = () => false;

  await click(button("＋ 現場を記録"));

  assert.ok(document.querySelector("form[aria-label='現場記録の編集']"));
  assert.equal(field("公演名").value, "春ツアー");
  assert.equal(field("感想・メモ", "textarea").value, "保存前の変更");
  assert.equal(JSON.parse(localStorage.getItem(JOURNAL_STORAGE_KEY)).records[0].notes, "初期メモ");
});

test("saved record is restored from localStorage after remount", async () => {
  await mount();
  await click(button("＋ 現場を記録"));
  await enter(field("公演名"), "保存される公演");
  await enter(field("アーティスト"), "宮本佳林");
  await enter(field("感想・メモ", "textarea"), "再読込後も残る");
  await enter(field("セットリスト", "textarea"), "氷点下\nバンビーナ・バンビーノ");
  await click(button("記録を保存"));

  const stored = JSON.parse(localStorage.getItem(JOURNAL_STORAGE_KEY));
  assert.equal(stored.records.length, 1);
  assert.deepEqual(stored.records[0].setlist, ["氷点下", "バンビーナ・バンビーノ"]);
  await act(async () => mounted.root.unmount());
  mounted = undefined;
  document.body.replaceChildren();

  await mount();
  assert.match(document.body.textContent, /保存される公演/);
  assert.match(document.body.textContent, /再読込後も残る/);
  await click(button("記録・セトリを編集"));
  assert.equal(field("セットリスト", "textarea").value, "氷点下\nバンビーナ・バンビーノ");
});

test("invalid import is atomic even when an earlier record in the file is valid", async () => {
  const original = backup([record()]);
  localStorage.setItem(JOURNAL_STORAGE_KEY, original);
  await mount();
  const fileInput = document.querySelector("input[aria-label='現場記録JSONファイル']");
  const invalidBatch = {
    schemaVersion: 1,
    records: [record({ id: "manual:valid-new", title: "追加されてはいけない公演" }), { id: "broken" }],
  };
  Object.defineProperty(fileInput, "files", {
    configurable: true,
    value: [{ size: 500, text: async () => JSON.stringify(invalidBatch) }],
  });

  await act(async () => {
    fileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.equal(localStorage.getItem(JOURNAL_STORAGE_KEY), original);
  assert.doesNotMatch(document.body.textContent, /追加されてはいけない公演/);
  assert.match(document.querySelector("[role='status']").textContent, /確認してください/);
});

test("quota failure keeps the record in memory and exports it as a backup", async () => {
  await mount();
  dom.window.Storage.prototype.setItem = function (key, value) {
    if (key === JOURNAL_STORAGE_KEY) throw new dom.window.DOMException("quota", "QuotaExceededError");
    return nativeSetItem.call(this, key, value);
  };
  await click(button("＋ 現場を記録"));
  await enter(field("公演名"), "容量不足でも救える公演");
  await enter(field("アーティスト"), "OCHA NORMA");
  await click(button("記録を保存"));

  assert.equal(localStorage.getItem(JOURNAL_STORAGE_KEY), null);
  assert.match(document.querySelector("[role='alert']").textContent, /端末に保存できませんでした/);
  assert.match(document.body.textContent, /容量不足でも救える公演/);
  await click(button("JSONを書き出す（1件）"));

  assert.ok(downloadedBlob, "backup Blob was not created");
  const exported = JSON.parse(await downloadedBlob.text());
  assert.equal(exported.records[0].title, "容量不足でも救える公演");
});

test("storage event blocks stale writes and reloads the other tab's records", async () => {
  const original = backup([record()]);
  const external = backup([record({ id: "manual:external", title: "別タブで追加した公演" })]);
  localStorage.setItem(JOURNAL_STORAGE_KEY, original);
  await mount();

  localStorage.setItem(JOURNAL_STORAGE_KEY, external);
  await act(async () => {
    window.dispatchEvent(new dom.window.StorageEvent("storage", {
      key: JOURNAL_STORAGE_KEY,
      oldValue: original,
      newValue: external,
      storageArea: localStorage,
      url: window.location.href,
    }));
    await Promise.resolve();
  });

  assert.match(document.querySelector("[role='alert']").textContent, /別のタブ/);
  assert.equal(button("＋ 現場を記録").disabled, true);
  await click(button("保存データを再読み込み"));
  assert.match(document.body.textContent, /別タブで追加した公演/);
  assert.doesNotMatch(document.body.textContent, /春ツアー/);
  assert.equal(button("＋ 現場を記録").disabled, false);
});
