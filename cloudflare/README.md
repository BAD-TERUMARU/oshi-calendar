# Cloudflare構成

現在はCloudflare Workers Static Assetsで、同梱スナップショットを常時配信しています。公開URLは <https://oshi-calendar.badterumaru.workers.dev/> です。CloudflareのCron SchedulerやKVによる自動更新は、まだ有効化していません。

## 構成

- Cloudflare Workers Static Assets: React/Viteの画面配信
- Workers Cron Trigger: 将来、定期取得をCloudflare側で行う場合の候補
- Workers KV: 最新のイベントスナップショット保存
- `/api/events`: 画面が最新データを取得するAPI

## 取得範囲

`wrangler.jsonc` の `DATA_RANGE_MONTHS` で指定します。初期値は「日本時間の今日から6か月先」です。
開催前のイベントは毎回再確認し、受付状況や公式URLの変更を反映する設計です。

## 現在のデプロイ

ルートの `wrangler.jsonc` が公開用設定です。ビルドとデプロイは次で行います。

```bash
npm run cf:deploy
```

現在の構成では、画面は静的アセットとして配信し、`/api/events` と `/api/health` のみWorkerが処理します。KVやコレクターが未設定のため、APIは同梱スナップショットを返します。

## 将来の自動更新準備

1. `wrangler.example.jsonc` を `wrangler.jsonc` にコピーする
2. `npx wrangler kv namespace create EVENTS_KV` でKVを作成する
3. 出力されたIDを `kv_namespaces[0].id` に設定する
4. `COLLECTOR_URL` に、公開情報だけを返すコレクターのURLを設定する
5. `npm run build` の後に `npx wrangler deploy` を実行する

現時点では `COLLECTOR_URL` が空で、Cloudflare側の自動取得は有効化していません。コレクターを設定しない場合、画面は同梱スナップショットへフォールバックします。

当面は、必要に応じて人が公式ページを確認してデータを更新し、ビルド後にGitHubやCloudflare Pagesへ反映する運用を想定します。将来、自動更新を実装する場合は、公式公開ページごとの取得・正規化処理、根拠URL、確認日時、失敗時の前回データ保持を追加で検証します。

## 公開データの取り扱い

公開するのは、公式ページで一般公開されているイベント名・開催日・会場・出演者・受付状況の要約・公式URLに限定します。

会員限定ページの本文・画像・動画・ログインが必要な情報は取得・保存・再配布しません。公式ページへのリンクを必ず付け、公式運営と誤認される表現も避けます。

Hello! Projectの会員規約には、ファンクラブを通じて入手した情報・データ等の無断複製、転載、再配布を禁止する条項があります。公開範囲に迷う情報は掲載せず、必要に応じて権利者へ確認してください。
