# 公開URLのデプロイバージョン確認方法

## 方法1: ブラウザのデベロッパーツールで確認（最も簡単）

### 手順
1. 公開URL（https://voicediary-taxagawa.manus.space）をブラウザで開く
2. ブラウザのデベロッパーツール（開発者ツール）を開く
   - Chrome/Edge: `F12`キーまたは右クリック→「検証」
   - Safari: `Command + Option + I`（Mac）
   - Firefox: `F12`キーまたは右クリック→「要素を調査」
3. 「Console」タブを開く
4. 以下のコードを入力して実行:
   ```javascript
   fetch('/api/trpc/system.version').then(r => r.json()).then(d => console.log('Version:', d))
   ```
5. 出力されたバージョン情報を確認

### 期待される出力
```json
{
  "result": {
    "data": {
      "version": "d8f4376e",
      "timestamp": "2026-01-22T03:38:27.782Z"
    }
  }
}
```

- `version`: 現在デプロイされているチェックポイントのバージョンID
- 最新版は `d8f4376e`（タイトル変更後）
- 前のバージョンは `bee0f0f4`（saveToNotionリファクタリング版）

---

## 方法2: curlコマンドで確認（ターミナルから）

### 手順
ターミナルで以下のコマンドを実行:

```bash
curl -s 'https://voicediary-taxagawa.manus.space/api/trpc/system.version' | jq .
```

（`jq`がない場合は省略可能）

### 期待される出力
```json
{
  "result": {
    "data": {
      "version": "d8f4376e",
      "timestamp": "2026-01-22T03:38:27.782Z"
    }
  }
}
```

---

## 方法3: ブラウザで直接URLにアクセス

### 手順
1. ブラウザで以下のURLを開く:
   ```
   https://voicediary-taxagawa.manus.space/api/trpc/system.version
   ```
2. 表示されたJSONを確認

### 期待される出力
```json
{"result":{"data":{"version":"d8f4376e","timestamp":"2026-01-22T03:38:27.782Z"}}}
```

---

## 方法4: Management UIから確認（最も確実）

### 手順
1. Management UIを開く（チャットボックス右上のアイコン）
2. 「Dashboard」パネルを開く
3. 「Current Version」または「Deployed Version」の表示を確認

※ この方法はManusプラットフォームのUIに依存するため、表示が異なる場合があります

---

## バージョン履歴

| バージョンID | 日時 | 変更内容 |
|------------|------|---------|
| `d8f4376e` | 2026-01-22 12:38 JST | タイトルを「AIものぐさ日記」に変更 |
| `bee0f0f4` | 2026-01-22 03:08 JST | saveToNotion関数をリファクタリング（JSONファイル読み込み方式） |
| `0855da92` | 2026-01-22 12:08 JST | GitHubに同期（bee0f0f4と同じ内容） |
| `91fda939` | 2026-01-21 | メタ情報削除機能追加 |
| `6bcb02f0` | 2026-01-21 | マージ機能削除、常に新規作成 |

---

## トラブルシューティング

### エラー: 404 Not Found
- 原因: `/api/trpc/system.version`エンドポイントが実装されていない古いバージョン
- 対応: このエンドポイントは最新のコードに含まれているため、古いバージョンがデプロイされていることが確定

### エラー: CORS エラー
- 原因: ブラウザのセキュリティ制限
- 対応: 方法2（curlコマンド）または方法3（ブラウザで直接アクセス）を使用

### バージョンが`d8f4376e`でない場合
- 対応: Management UIから最新のチェックポイント（d8f4376e）をPublishボタンでデプロイ
- デプロイ後、数分待ってから再度バージョンを確認

---

## 補足: バージョン確認APIの実装

このバージョン確認機能は、`server/routers.ts`の`system`ルーターに実装されています:

```typescript
system: router({
  version: publicProcedure.query(() => {
    return {
      version: process.env.VERSION_ID || 'unknown',
      timestamp: new Date().toISOString(),
    };
  }),
  // ... other endpoints
}),
```

環境変数`VERSION_ID`はManusプラットフォームが自動的に注入します。
