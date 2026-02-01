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

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `API_TOKEN` | YES | API認証用トークン（secret） |
| `NOMINATIM_USER_AGENT` | NO | リバースジオコーディング用 User-Agent（デフォルト設定済み） |
| `NOMINATIM_EMAIL` | NO | Nominatim API の連絡先メール（推奨） |

メールアドレスを設定する場合:

```bash
pnpm wrangler secret put NOMINATIM_EMAIL
```

## リバースジオコーディング

滞在ポイント（`motion` に `stationary` を含む）に対して、[Nominatim API](https://nominatim.openstreetmap.org/) を使用して住所と POI を自動取得します。

### 取得条件

- `motion` プロパティに `"stationary"` を含むポイントのみが対象
- 移動中のポイントにはリバースジオコーディングを実行しない

### POI 優先順位

Nominatim の `address` レスポンスから以下の優先順位で POI 名を抽出:

1. `amenity` - 施設（レストラン、カフェ、駅など）
2. `shop` - 店舗（コンビニ、スーパーなど）
3. `tourism` - 観光地（ホテル、美術館など）
4. `building` - 建物名

いずれも存在しない場合は `poi: null` となります。

### 最適化

- 50m 以内のポイントをグループ化して API 呼び出し回数を削減
- グループ内の代表ポイント1つのみを API に問い合わせ
- 同じグループ内のすべてのポイントに同一の住所・POI を適用

### Rate Limit

- Nominatim API の利用規約に従い、リクエスト間隔は 1 秒
- 429 エラー時は `Retry-After` ヘッダーに従って自動リトライ（最大 3 回）
- 5xx エラー時は指数バックオフでリトライ

### ビューワー表示

- ポップアップに POI 名（存在する場合）と住所を表示

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
| `from` / `to` | 期間フィルタ (ISO 8601) |
| `bbox` | バウンディングボックス (sw_lon,sw_lat,ne_lon,ne_lat) |
| `device_id` | デバイスIDフィルタ |
| `limit` | 最大件数 (デフォルト: 1000) |
| `format` | `geojson` (デフォルト), `json`, `jsonl` |

```bash
# GeoJSON
curl "https://your-worker.workers.dev/api/locations?from=2026-02-01T00:00:00+09:00&to=2026-02-02T00:00:00+09:00" \
  -H "Authorization: Bearer YOUR_TOKEN"

# JSONL (DuckDB互換)
curl "https://your-worker.workers.dev/api/locations?from=2026-02-01T00:00:00+09:00&to=2026-02-02T00:00:00+09:00&format=jsonl" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### レスポンススキーマ

`format` パラメータに応じて異なる形式を返す。

滞在ポイント（`motion` に `stationary` を含む）には `address` と `poi` が含まれます:

```typescript
// format=geojson (デフォルト)
type GeoJSONResponse = {
  type: "FeatureCollection"
  features: FeatureWithAddress[]
}

type FeatureWithAddress = Feature & {
  properties: Feature["properties"] & {
    address?: string   // 住所（例: "東京都渋谷区..."）
    poi?: string       // POI名（例: "渋谷駅", "セブンイレブン"）
  }
}

// format=json
type JSONResponse = Array<{
  id: number
  device_id: string
  timestamp: string
  geojson: string
  address: string | null   // 住所
  poi: string | null       // POI名
}>

// format=jsonl
// NDJSON形式（1行1Feature、properties に address/poi 含む）
// {"type":"Feature","geometry":{...},"properties":{...,"address":"東京都...","poi":"渋谷駅"}}
```

#### address / poi の例

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [139.7006, 35.6580]
  },
  "properties": {
    "timestamp": "2026-02-01T10:00:00Z",
    "device_id": "iphone",
    "motion": ["stationary"],
    "address": "日本, 東京都, 渋谷区, 道玄坂, 2丁目, 1, 150-0043",
    "poi": "渋谷駅"
  }
}
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
