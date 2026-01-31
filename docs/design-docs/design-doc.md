# Location Tracking System Design Document

## 概要

iOSアプリ Overland から位置情報を受信し、Cloudflare Workers + D1 に GeoJSON 形式で保存するシステム。保存したデータは DuckDB で分析可能な形式でアーカイブする。

## 背景と目的

個人の位置履歴を自分のインフラで管理し、任意のタイミングで分析・可視化できるようにする。Google Timelineのようなサードパーティに依存せず、データの所有権を保持することが目的。

## 技術選定

### Overland（iOSアプリ）

位置情報の送信元として Overland を採用する。選定理由は以下の通り。

- GeoJSON（RFC 7946）準拠のデータフォーマットで送信する。OwnTracks は独自JSON形式のため、後段での互換性に劣る
- バッチ送信に対応しており、1リクエストで複数地点をまとめて送る（デフォルト50件、最大1000件）。通信効率が良くバッテリー消費を抑えられる
- 任意のHTTPエンドポイントにPOSTできる。カスタムHTTPヘッダーの設定も可能で、Bearer Token認証に対応する
- オープンソース（ https://github.com/aaronpk/Overland-iOS ）

### Cloudflare Workers + D1

受信・保存のバックエンドとして Cloudflare Workers と D1 を採用する。

- Workers：グローバルエッジで動作するサーバーレス実行環境。コールドスタートなし
- D1：SQLiteベースのマネージドDB。`json_extract()` と generated columns をネイティブサポートしており、GeoJSONをそのまま保存しつつ構造化カラムを自動生成できる
- R2：S3互換オブジェクトストレージ。日次アーカイブの保存先

### DuckDB（分析用）

D1からエクスポートしたデータの分析に使用する。spatial extension により `ST_Point()`、`ST_Distance()`、`ST_Within()` などの空間関数が利用可能。D1では不可能な本格的な空間クエリをカバーする。

## システム構成

```
┌──────────────┐
│  Overland    │
│  (iOS)       │
└──────┬───────┘
       │ POST /api/locations
       │ Authorization: Bearer <token>
       │ Content-Type: application/json
       ▼
┌──────────────────────────────┐
│  Cloudflare Workers          │
│                              │
│  1. Bearer Token 検証        │
│  2. GeoJSON バリデーション    │
│  3. D1 バッチINSERT          │
└──────┬───────────┬───────────┘
       │           │
       ▼           ▼ (Cron: 日次)
┌──────────┐  ┌──────────┐
│  D1      │  │  R2      │
│ (SQLite) │  │ (JSONL)  │
└──────────┘  └──────────┘
                   │
                   ▼
              ┌──────────┐
              │  DuckDB  │
              │ (分析)    │
              └──────────┘
```

## Overland のデータフォーマット

Overland は GeoJSON FeatureCollection 形式で位置情報をバッチ送信する。1リクエストに含まれる `locations` 配列が複数の Feature を持つ。

```json
{
  "locations": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [139.7099, 35.6476]
      },
      "properties": {
        "timestamp": "2026-02-01T14:30:00Z",
        "altitude": 40,
        "speed": 1.2,
        "horizontal_accuracy": 10,
        "vertical_accuracy": 4,
        "motion": ["walking"],
        "battery_state": "charging",
        "battery_level": 0.85,
        "wifi": "home-network",
        "device_id": "iPhone-azu"
      }
    }
  ],
  "current": { ... }
}
```

GeoJSON の座標順序は `[longitude, latitude]` である点に注意する（緯度経度の逆順）。`properties.timestamp` は ISO 8601 形式。`current` フィールドには最新位置が含まれるが、`locations` 配列と重複するため保存対象外とする。

## D1 スキーマ設計

### 設計方針

GeoJSON Feature 全体を `geojson` TEXT列に保存し、頻繁にクエリするフィールドだけ generated columns（生成列）で自動抽出する。D1（SQLite）の `json_extract()` を活用することで、書き込み時は JSON を1つ入れるだけでよく、読み取り時はインデックスの効いた構造化カラムで検索できる。

### テーブル定義

```sql
CREATE TABLE locations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id  TEXT NOT NULL,
    geojson    TEXT NOT NULL,

    -- generated columns（geojson から自動抽出、STORED = 物理保存）
    lon         REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.geometry.coordinates[0]')
                ) STORED,
    lat         REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.geometry.coordinates[1]')
                ) STORED,
    altitude    REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.altitude')
                ) STORED,
    speed       REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.speed')
                ) STORED,
    accuracy    REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.horizontal_accuracy')
                ) STORED,
    battery     REAL GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.battery_level')
                ) STORED,
    recorded_at TEXT GENERATED ALWAYS AS (
                    json_extract(geojson, '$.properties.timestamp')
                ) STORED,

    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

### インデックス

```sql
-- 主要クエリ：デバイス × 時系列
CREATE INDEX idx_device_time ON locations(device_id, recorded_at DESC);

-- 空間検索（バウンディングボックス）用
CREATE INDEX idx_lat ON locations(lat);
CREATE INDEX idx_lon ON locations(lon);

-- 日次アーカイブ用
CREATE INDEX idx_recorded_date ON locations(
    substr(recorded_at, 1, 10)
);
```

### スキーマの補足

generated columns は `STORED` 指定によりINSERT時に物理的に書き込まれる。`VIRTUAL` にすると読み取り時に毎回計算されるが、インデックスを貼れないため `STORED` を選択した。ストレージ消費は増えるが、位置トラッキングのデータ量では無視できる規模（年間7MB程度）。

D1 は SpatiaLite 非対応のため、`ST_Within()` や `ST_Distance()` のような空間関数は使えない。代わりにバウンディングボックス（WHERE lat BETWEEN ... AND lon BETWEEN ...）で矩形絞り込みを行い、必要に応じてHaversine計算をSQL内で行う。本格的な空間分析はDuckDB側で実施する。

## API設計

### POST /api/locations

Overland からの位置データ受信エンドポイント。

**リクエスト:**

- Method: `POST`
- Header: `Authorization: Bearer <API_TOKEN>`
- Body: Overland GeoJSON（上記フォーマット）

**レスポンス:**

Overland は HTTP レスポンスの `result` フィールドを確認する。`"ok"` を返すと送信済みデータをローカルキューから削除する。それ以外の値や通信エラーの場合、Overland はデータを保持して再送する。

```json
{ "result": "ok" }
```

**エラー時:**

```json
{ "result": "error", "error": "unauthorized" }
```

### GET /api/locations

保存済み位置データの取得エンドポイント。地図表示やデバッグ用。

**クエリパラメータ:**

| パラメータ | 型 | 説明 |
|-----------|------|------|
| `date` | string | 日付フィルタ（YYYY-MM-DD） |
| `from` / `to` | string | 期間フィルタ（ISO 8601） |
| `bbox` | string | バウンディングボックス（`sw_lon,sw_lat,ne_lon,ne_lat`） |
| `limit` | number | 最大件数（デフォルト: 1000） |
| `format` | string | `geojson`（デフォルト）または `json` |

**レスポンス（format=geojson）:**

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [139.7099, 35.6476] },
      "properties": { "timestamp": "...", "speed": 1.2, ... }
    }
  ]
}
```

GeoJSON FeatureCollection として返すことで、Leaflet.js や Mapbox GL JS などの地図ライブラリでそのまま描画できる。

## アーカイブ設計（D1 → R2）

Cloudflare Workers の Cron Triggers により、日次で D1 から R2 に JSONL ファイルをエクスポートする。

**R2 のパスレイアウト:**

```
locations/
  2026/
    02/
      01.jsonl
      02.jsonl
      ...
```

各 `.jsonl` ファイルは、1行1 GeoJSON Feature の改行区切りテキスト。DuckDB の `read_json('locations/2026/02/*.jsonl', format='newline_delimited')` でそのまま読み取れる。

**アーカイブの目的:**

- D1 の 10GB 上限に対する長期的な安全策（実データ量は年間7MB程度なので当面不要だが、設計として用意しておく）
- DuckDB からの直接読み取り。`wrangler d1 export` 経由よりもR2のJSONLをダウンロードする方が手軽
- バックアップ。D1 とは独立したストレージにデータのコピーを持つ

## バッテリー消費に関する考慮

Overland の電力消費は設定によって大きく変わる。

**Significant Changes モード（推奨）:** iOS の CLLocationManager の significantLocationChange を利用し、500m以上の移動で発火する。バッテリー消費は1日あたり1〜2%程度。移動中は5〜15分間隔、静止中は数時間に1回程度の更新になる。1時間おきの定期記録は保証されないが、日常の行動ログとしては十分な粒度。

**Continuous モード:** GPS を常時使用し高精度・高頻度の記録を行うが、バッテリー消費が50%以上/日と非常に大きい。充電中のみの使用を推奨。

Overland の設定画面で Desired Accuracy と Activity Type を調整でき、バッテリーと精度のトレードオフをコントロールできる。

## データ量の見積もり

| 期間 | レコード数 | D1 サイズ（generated columns込み） | R2 JSONL サイズ |
|------|-----------|----------------------------------|----------------|
| 1日 | 約50件 | 約20 KB | 約15 KB |
| 1ヶ月 | 約1,500件 | 約600 KB | 約450 KB |
| 1年 | 約18,000件 | 約7 MB | 約5 MB |
| 10年 | 約180,000件 | 約70 MB | 約50 MB |

D1 の無料プラン（500MB上限）で10年以上運用可能。書き込み上限（10万行/日）に対しても50件/日は0.05%であり、余裕がある。

## セキュリティ

- **認証:** Bearer Token による単純なトークン認証。Cloudflare Workers の Secret（`wrangler secret put`）に保存し、環境変数から参照する
- **HTTPS:** Cloudflare Workers のエンドポイントはデフォルトで HTTPS。平文通信は不可
- **位置情報の機密性:** 位置履歴は高度な個人情報にあたるため、GET エンドポイントにも同じ Bearer Token 認証を要求する。公開アクセスは一切許可しない
- **D1 アクセス:** Workers バインディング経由のみ。外部からの直接SQL接続は不可

## 将来の拡張

- **逆ジオコーディング:** Nominatim API + KV キャッシュにより、座標から住所・地名を解決する。記録時ではなくアーカイブ時にバッチ処理する方がレートリミット（1req/sec）に優しい
- **地図可視化:** Cloudflare Pages に Leaflet.js ベースの静的サイトをデプロイし、GET API 経由でデータを表示する
- **JSON-LD 対応:** R2 アーカイブの JSONL に Schema.org の `@context` を付与し、Linked Data として再利用可能にする
- **複数デバイス対応:** `device_id` カラムで分離済みのため、スキーマ変更なしで対応可能
