# アクションプロトコル

LLM とフロントエンド間の対話を制御するプロトコル仕様。

## LLM レスポンスフォーマット

LLM は必ず以下の JSON 形式で応答する（テキストのみの応答は不可）:

```json
{
  "messages": [
    { "role": "assistant", "content": "応答テキスト" }
  ],
  "actions": [
    { "type": "アクションタイプ", ...パラメータ }
  ]
}
```

`messages` と `actions` はどちらも空配列可。

## アクション分類

### クエリアクション（読み取り専用）

ユーザーに「Share」ボタンで承認を求める。

| アクション | 必須パラメータ | 任意パラメータ | 説明 |
|-----------|---------------|---------------|------|
| `getToc` | なし | なし | 目次取得 |
| `getSection` | `query` | なし | セクション取得 |
| `getCells` | `query` | `count` | セル取得 |
| `getOutput` | `query` | なし | 出力取得 |
| `listNotebookFiles` | なし | なし | ノートブックファイル一覧 |
| `getTocFromFile` | `path` | なし | ファイルから目次取得 |
| `getSectionFromFile` | `path`, `query` | なし | ファイルからセクション取得 |
| `getCellsFromFile` | `path`, `query` | `count` | ファイルからセル取得 |
| `getOutputFromFile` | `path`, `query` | なし | ファイルから出力取得 |

### ミューテーションアクション（書き込み）

ユーザーに「Accept」ボタンで承認を求める。

| アクション | 必須パラメータ | 説明 |
|-----------|---------------|------|
| `insertCell` | `position`, `cellType`, `source` | セル挿入 |
| `updateCell` | `query`, `source`, `_hash` | セル更新（楽観的ロック） |
| `deleteCell` | `query`, `_hash` | セル削除（楽観的ロック） |
| `runCell` | `query` | セル実行 |

### ヘルプアクション

承認不要で即座に実行。

| アクション | 必須パラメータ | 説明 |
|-----------|---------------|------|
| `listHelp` | なし | 利用可能なアクション一覧 |
| `help` | `action` | 特定アクションの詳細ヘルプ |

## クエリ構文

セルを指定するクエリオブジェクト:

```json
{ "match": "正規表現" }      // セルソースの正規表現マッチ
{ "contains": "テキスト" }   // 部分文字列マッチ
{ "start": 0 }              // セルインデックス（0始まり）
{ "id": "セルUUID" }        // セルの一意ID
{ "active": true }          // 現在フォーカス中のセル
{ "selected": true }        // 最初の選択セル
```

## ステータス遷移

```
pending ──→ approved ──→ executed
   │
   └──→ rejected ──→ notified
```

- **pending**: ユーザーの判断待ち
- **approved**: ユーザーが承認、実行待ち
- **executed**: 実行完了
- **rejected**: ユーザーが拒否
- **notified**: 拒否が LLM に通知済み

## 自動承認メカニズム

ユーザーが「Share & Always」「Accept & Always」を選択すると、そのアクションタイプが自動承認リストに追加される。

### クエリの自動承認階層

上位のアクションを承認すると、下位のアクションも自動承認される:

```
getOutput（最上位）
  └── getCells
        └── getSection
              └── getToc（最下位）
```

例: `getOutput` を「Always」承認すると、`getCells`, `getSection`, `getToc` も自動承認される。

### スコープ

- アクティブノートブックのクエリ: `autoApproved[notebookPath]` で管理
- ファイルクエリ: `fileAutoApproved[filePath]` で別管理
- ノートブック切り替えやセッション変更時にクリアされない（Map で管理）

## 楽観的ロック（_hash）

`updateCell` と `deleteCell` では `_hash` パラメータが必須。

1. LLM が `getCells` でセルを取得 → レスポンスに `_hash`（djb2 ハッシュ）が含まれる
2. LLM が `updateCell` で更新を提案 → 取得時の `_hash` を含める
3. 実行時にセルの現在のハッシュと照合
4. 不一致の場合: 「Hash mismatch: cell has been modified」エラー → LLM に通知

djb2 ハッシュの計算対象: `セルタイプ + セルソース`

## バッチ処理フロー

1つのメッセージ内の全アクションはバッチとして処理される:

1. LLM がアクション付きレスポンスを返す
2. 全アクションの承認/拒否が揃うまで待機
3. 承認されたアクションを順次実行
4. 全結果を `[Action Results]` メッセージとして LLM に送信
5. LLM が結果を受けて次のレスポンスを生成

```
ユーザー: "データセクションを見せて"
  ↓
LLM: { messages: ["確認します"], actions: [getSection({match: "Data"})] }
  ↓
ユーザー: [Share] ボタンクリック
  ↓
フロントエンド: nblibram 経由でセクション取得
  ↓
フロントエンド → LLM: "[Action Results]\n{セクション内容}"
  ↓
LLM: { messages: ["データセクションには..."], actions: [] }
```

## エラーハンドリング

### JSON パースエラー
LLM のレスポンスが JSON として不正な場合、最大2回リトライ。エラー内容をフィードバックとして LLM に送信。

### バリデーションエラー
アクションの必須フィールドが不足している場合、最大2回リトライ。類似フィールド名の提案付きフィードバックを送信（`findSimilarField()` による typo 検出）。

### リトライ超過
3回目以降はリトライせず、LLM のレスポンスを生テキストとして表示。
