# blued-location

Overland iOS アプリから位置情報を受信し、Cloudflare Workers + D1 に保存するシステム。

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/azu/blued-location)

または手動でデプロイ:

```bash
# 1. Clone
git clone https://github.com/azu/blued-location.git
cd blued-location

# 2. Install
pnpm install

# 3. D1 データベース作成
pnpm wrangler d1 create blued-location-db
# 出力された database_id を wrangler.jsonc に設定

# 4. マイグレーション適用
pnpm wrangler d1 migrations apply blued-location-db --remote

# 5. API Token 設定
pnpm wrangler secret put API_TOKEN
# 任意の文字列を入力

# 6. デプロイ
pnpm run deploy
```

## Overland 設定

1. Overland アプリを開く
2. Settings > Server URL に `https://your-worker.workers.dev/api/locations` を設定
3. Settings > Access Token に API_TOKEN を設定

## API

### POST /api/locations

Overland からの位置データ受信。

```bash
curl -X POST https://your-worker.workers.dev/api/locations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"locations":[{"type":"Feature","geometry":{"type":"Point","coordinates":[139.7,35.6]},"properties":{"timestamp":"2026-02-01T10:00:00Z","device_id":"iphone"}}]}'
```

### GET /api/locations

保存データの取得。

| パラメータ | 説明 |
|-----------|------|
| `date` | 日付フィルタ (YYYY-MM-DD) |
| `from` / `to` | 期間フィルタ (ISO 8601) |
| `bbox` | バウンディングボックス (sw_lon,sw_lat,ne_lon,ne_lat) |
| `device_id` | デバイスIDフィルタ |
| `limit` | 最大件数 (デフォルト: 1000) |
| `format` | `geojson` (デフォルト), `json`, `jsonl` |

```bash
# GeoJSON
curl "https://your-worker.workers.dev/api/locations?date=2026-02-01" \
  -H "Authorization: Bearer YOUR_TOKEN"

# JSONL (DuckDB互換)
curl "https://your-worker.workers.dev/api/locations?date=2026-02-01&format=jsonl" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Viewer

`https://your-worker.workers.dev/` で地図ビューワーにアクセス。

URLパラメータで自動ログイン:

```
# ハッシュ（推奨、サーバーに送信されない）
https://your-worker.workers.dev/#token=YOUR_TOKEN&date=2026-02-01

# クエリ
https://your-worker.workers.dev/?token=YOUR_TOKEN&date=2026-02-01
```

## Development

```bash
# テスト
pnpm test

# ローカル実行
pnpm run dev

# ローカルD1マイグレーション
pnpm run db:migrate:local
```

## License

MIT
