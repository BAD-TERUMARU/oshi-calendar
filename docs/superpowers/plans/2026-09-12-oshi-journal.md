# Oshi Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存カレンダーに現場記録・振り返り・生涯セトリを追加し、既存不具合を修正する。

**Architecture:** 個人記録ドメインをjournal.ts、UIをJournalWorkspace.tsx、スタイルをjournal.cssに分離。App.tsxはナビゲーションと選択公演連携を担当。既存の永続キーを変更しない。

**Tech Stack:** Existing React 18, TypeScript, Vite; node:test; Playwright for browser verification.

**Spec:** ../specs/2026-09-12-oshi-journal-design.md

## Global Constraints
- 有料API不要。個人データはこのブラウザにのみ保存する。
- 実公演・参加履歴・セトリの自動捏造をしない。
- 既存の行きたい、出力履歴、個人終演時刻を変更しない。
- IDが一致する既存記録は取り込みで上書きしない。

## Task 1: Journal domain
Files: src/journal.ts, tests/journal.test.cjs.
Interfaces: AttendanceRecord, parseJournal(text), serializeJournal(records), mergeJournal(existing,incoming), recordFromEntry(entry), summarizeJournal(records), rankSongs(records).
- [ ] 独立した期待値で重複公演、参加状態、曲別公演数、JSON不正入力を試験して失敗を確認する。
- [ ] 各関数を実装し、同じ試験が通ることを確認する。
- [ ] 日付存在性、負数・NaN、過大データ、重複ID、任意オブジェクト入力を検証する。

## Task 2: Personal journal UI
Files: src/JournalWorkspace.tsx, src/journal.css, src/App.tsx.
Interfaces: JournalWorkspace receives CalendarExportEntry[] for selected shows; navigation sets its initial view.
- [ ] 現場の新規作成・選択公演追加・編集・削除と保存状態を実装する。
- [ ] 参加済みだけの振り返り、曲検索・該当現場への移動、JSON出入力を実装する。
- [ ] Appにカレンダー/現場記録/振り返り/生涯セトリのナビを接続する。
- [ ] 実ブラウザで追加→編集→参加済み→セトリ登録→再読込→出入力を確認する。

## Task 3: Existing review and delivery
Files: review-identified production files and necessary regression tests; README.md.
- [ ] 独立レビューの各指摘を実装と照合し、再現する問題を修正する。
- [ ] npm test, npm run buildを実行する。
- [ ] モバイル/デスクトップのレイアウトと主要操作を確認する。
- [ ] GitHubへ差分を保存し、機能・検証・保存範囲・本番反映状態を明記する。
