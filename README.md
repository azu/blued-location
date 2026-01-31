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

# 3. API Token 設定
pnpm wrangler secret put API_TOKEN
# 任意の文字列を入力

# 4. デプロイ (D1は自動作成される)
pnpm run deploy

# 5. マイグレーション適用
pnpm wrangler d1 migrations apply blued-location-db --remote
```

## Overland 設定

[Overland GPS Tracker](https://apps.apple.com/app/overland-gps-tracker/id1292426766) (iOS) を使用。

GitHub: https://github.com/aaronpk/Overland-iOS

### 設定手順

1. Overland アプリを開く
2. 右上の歯車アイコン → Settings
3. **Server URL**: `https://your-worker.workers.dev/api/locations`
4. **Access Token**: Workers の環境変数 `API_TOKEN` に設定した値
5. 左上のスイッチをONでトラッキング開始

### Tracking Mode

| モード | 説明 | バッテリー消費 |
|--------|------|---------------|
| Significant Changes | 500m以上移動で記録（推奨） | 低 |
| Standard | バランス型 | 中 |
| High Frequency | 高精度・高頻度 | 高 |

## API

### POST /api/locations

Overland からの位置データ受信。

```bash
curl -X POST https://your-worker.workers.dev/api/locations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"locations":[{"type":"Feature","geometry":{"type":"Point","coordinates":[139.7,35.6]},"properties":{"timestamp":"2026-02-01T10:00:00Z","device_id":"iphone"}}]}'
```

#### リクエストスキーマ

Overland iOS が送信するペイロード形式:

```typescript
type RequestBody = {
  locations: Feature[]
  current?: unknown
  trip?: unknown
}

type Feature = {
  type: "Feature"
  geometry: {
    type: "Point"
    coordinates: [number, number]  // [longitude, latitude] 経度, 緯度
  }
  properties: {
    timestamp: string           // 必須 (ISO 8601)
    device_id?: string
    altitude?: number
    speed?: number
    horizontal_accuracy?: number
    vertical_accuracy?: number
    speed_accuracy?: number
    course?: number
    battery_level?: number
    battery_state?: string
    motion?: string[]
    wifi?: string
    unique_id?: string
  }
}
```

#### レスポンススキーマ

```typescript
// 成功
type SuccessResponse = { result: "ok" }

// エラー
type ErrorResponse = {
  result: "error"
  error: "invalid_json" | "validation_failed" | "database_error"
  details?: Array<{ path: string; message: string }>
}
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

#### レスポンススキーマ

`format` パラメータに応じて異なる形式を返す:

```typescript
// format=geojson (デフォルト)
type GeoJSONResponse = {
  type: "FeatureCollection"
  features: Feature[]
}

// format=json
type JSONResponse = Array<{
  id: number
  device_id: string
  timestamp: string
  geojson: Feature
}>

// format=jsonl
// NDJSON形式（1行1Feature）
// {"type":"Feature","geometry":{...},"properties":{...}}
// {"type":"Feature","geometry":{...},"properties":{...}}
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
