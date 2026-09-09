# note改善記事：画像配置メモ

## 本文中の配置

1. 導入直後
   - 役割：現在のアプリが一目で分かるメイン画像
   - 内容：月曜始まり、日曜・祝日の赤字、イベント種別フィルター、公開スナップショット日、複数アーティストの表示が分かるカレンダー画面
   - 推奨撮影先：`https://oshi-calendar.badterumaru.workers.dev/`
   - 用意済み：`docs/note-screenshots/calendar-view.png`
   - キャプション案：現行版のカレンダー画面（2026年9月9日時点、58件）

2. 「行きたい」を、公演単位で管理できるようにした」の直後
   - 役割：今回の改善の中心を示す詳細画像
   - 内容：公演ごとのチェックボックス、開場・開演時刻、チケット状態、受付期間、公式リンク
   - 推奨対象：9月9日さわやか五郎BD、または複数公演のあるイベント
   - 用意済み：`docs/note-screenshots/detail-view.png`
   - キャプション案：公演単位で「行きたい」を選べる詳細画面（2026年9月9日時点）

## 比較用の既存画像

- 初期カレンダー画面：`C:\Users\rannk\Documents\Codex\2026-08-22\files-pasted-by-the-user-web\outputs\oshi-calendar\docs\local-preview-viewport.png`
- 初期詳細画面：`C:\Users\rannk\Documents\Codex\2026-08-22\files-pasted-by-the-user-web\outputs\oshi-calendar\docs\local-preview-detail-viewport.png`

既存画像は2026年8月22日時点の初期版で、40件表示や当時のチケット状態が写っています。改善記事で使う場合は「初期版」と明記し、現在版の画像と混同させないようにします。

## 公開前チェック

- `calendar-view.png` と `detail-view.png` をNoteの画像としてアップロードする
- 画面内のスナップショット日と記事本文の日付を揃える
- 個人情報、ログイン情報、会員限定画面が写っていないことを確認する
- 画像のキャプションに「2026年9月9日時点」などの確認日を付ける
- 画像はカレンダー画面1枚、詳細画面1枚を最低限掲載する

草稿本文には未処理のHTMLコメントを残していません。Noteへ貼り付ける際は、導入直後と「行きたい」の章の直後に、上記2枚をそれぞれ挿入します。
