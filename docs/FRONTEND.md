# フロントエンド設計

## 概要

TypeScript/React で実装された JupyterLab 拡張機能のフロントエンド。右サイドバーにパネルとして表示される。

## エントリーポイント (`src/index.ts`)

JupyterLab プラグインとして登録:
- プラグイン ID: `jupyter-mynerva:plugin`
- 依存: `INotebookTracker`（ノートブック追跡）
- オプション依存: `ISettingRegistry`（設定）、`ILabShell`（Notebook 7 互換のため optional）
- `autoStart: true` で自動起動

初期化処理:
1. `ContextEngine` インスタンス作成（ノートブックミューテーション用）
2. `NblibramLiveQuery` インスタンス作成（ノートブッククエリ用）
3. `activatePanel()` でパネルを作成し、右サイドバーに追加

## メインパネル (`src/panel.tsx`)

約2000行の React コンポーネント。以下のセクションで構成される。

### 状態管理

主要な state:

```typescript
// チャット
messages: IMessage[]              // メッセージ履歴
loading: boolean                  // LLM レスポンス待ち
actionStatuses: Map<number, Map<number, ActionStatus>>  // [メッセージIdx][アクションIdx] → ステータス

// 設定
config: IConfig | null            // LLM プロバイダー設定
providers: IProvider[]            // 利用可能なプロバイダー一覧
showSettings: boolean             // 設定パネル表示切替

// セッション
sessionId: string | null          // 現在のセッション ID
sessions: ISessionSummary[]       // セッション一覧

// 自動承認
autoApproved: Map<string, Set<ActionType>>      // ノートブック別
fileAutoApproved: Map<string, Set<ActionType>>  // ファイル別

// ストリーミング
streamingContent: string          // ストリーム中の表示テキスト
streamingStatus: string           // ステータス（'thinking' | 'searching' | 'generating' | ''）
reasoningContent: string          // 推論サマリー（推論モデル使用時）

// プライバシー
filterEnabled: boolean            // フィルター有効/無効

// エラー
initError: string | null          // 初期化エラー
sessionError: string | null       // セッションエラー
```

### useEffect フック（実行順序が重要）

1. **初期化** — プロバイダー・設定・セッション一覧を並列取得
2. **自動承認チェック** — pending アクションが全て自動承認可能か判定、可能なら一括承認
3. **承認済みアクション実行** — 全アクションの判断が揃ったら順次実行、結果をキューに格納
4. **結果送信** — pending なし＋結果あり＋ロード中でない → `[Action Results]` を LLM に送信
5. **セッション自動保存** — メッセージ変更時にセッションを保存

### 重複実行防止

```typescript
const executingActionsRef = React.useRef(false)
// useEffect 開始時に true、finally で false
// 開始時チェックでスキップ
```

### チャットフロー (`handleSendMessage`)

1. メッセージを `messages` に追加、`loading = true`
2. `runChat()` で LLM 呼び出し（すべてストリーミング）
3. SSE イベントに応じて `activeContentType` / `streamingContent` / `thinkingContent` / `stopReason` を更新
4. 完了後: `processLLMResponse()` で JSON パース → `validateActions()` でスキーマ検証
5. エラー時: LLM にフィードバックしてリトライ（最大2回）
6. 成功: メッセージとアクションを表示

### ストリーミング関連関数

- `sendChat(messages, callbacks, signal?)`: モジュールレベル。SSE を受信しコールバックに流す純粋関数
- `runChat(chatMessages, signal?)`: コンポーネント内ヘルパー。`sendChat` を state setter に束ねて呼ぶ。前後で `clearStreamingState()`
- `clearStreamingState()`: 全ストリーミング state を一括クリア

詳細な設計・フォーマットは `docs/DESIGN_STREAMING.md` を参照。

### 設定パネル

- プロバイダー選択（OpenAI / Anthropic / Enki Gate）
- モデル選択（カスタムエンドポイント時は動的取得）
- API キー入力（パスワードフィールド、暗号化保存）
- ベース URL（OpenAI 互換エンドポイント用）
- Enki Gate デバイスフロー認証（ポーリングループ）
- デフォルト設定トグル（管理者が環境変数で設定済みの場合）

### UI 構成

```
┌─────────────────────────────────┐
│ ヘッダー                         │
│  [セッション選択] [新規] [⚙設定] │
├─────────────────────────────────┤
│ メッセージ領域（スクロール可能）  │
│                                  │
│  [ユーザー] メッセージ           │
│  [AI] 応答テキスト               │
│     [QueryActionCard]  [Share]  │
│     [MutateActionCard] [Accept] │
│  [ユーザー] 次のメッセージ       │
│  ...                            │
├─────────────────────────────────┤
│ 入力エリア                       │
│  [テキストエリア]                │
│  [フィルタ切替] [送信/キャンセル] │
└─────────────────────────────────┘
```

## ContextEngine (`src/context.ts`)

ノートブックへの書き込み操作を担当。JupyterLab の `NotebookActions` API を使用。

### メソッド

| メソッド | 引数 | 説明 |
|---------|------|------|
| `hasActiveNotebook()` | なし | アクティブなノートブックがあるか |
| `getNotebookPath()` | なし | 現在のノートブックパス |
| `insertCell(position, cellType, source)` | ICellQuery \| 'end' | セル挿入 |
| `updateCell(query, source, _hash)` | ICellQuery, string, string | セル更新（ハッシュ検証付き） |
| `deleteCell(query, _hash)` | ICellQuery, string | セル削除（ハッシュ検証付き） |
| `runCell(query)` | ICellQuery | セル実行 |

### セルクエリ解決

`_findCell(query)` でクエリを解決:
1. `{ active: true }` → 現在のアクティブセル
2. `{ selected: true }` → 最初の選択セル
3. `{ start: N }` → インデックス N のセル
4. `{ id: "..." }` → UUID でセル検索
5. `{ match: "..." }` → 正規表現でソースマッチ（最初のヒット）
6. `{ contains: "..." }` → 部分文字列でソースマッチ（最初のヒット）

### ハッシュ計算 (djb2)

```
hash = 5381
for each char in (cellType + source):
    hash = ((hash << 5) + hash) + charCode
return hash as unsigned 32-bit string
```

## NblibramLiveQuery (`src/nblibram.ts`)

ノートブックの読み取りクエリを nblibram 経由で実行。

### ダーティ状態管理

- `notebookTracker.currentChanged` シグナルで監視
- `model.contentChanged` シグナルで変更検出
- ダーティ時: ノートブック内容 JSON をリクエストに含める（バックエンドが一時ファイルに保存）
- クリーン時: パスのみ送信（ディスクから直接読み取り）

### クエリ前処理

- `{ active: true }` → `{ start: アクティブセルのインデックス }` に正規化
- `{ selected: true }` → `{ start: 選択セルのインデックス }` に正規化
- `noFilter` フラグ: プライバシーフィルターのバイパス

## アクションコンポーネント

### QueryActionCard (`src/actions/QueryActionCard.tsx`)

クエリアクションの表示カード:
- アイコン + アクションタイプラベル
- パラメータ表示（例: `Get Cells: {"start":0}(count: 2)`）
- pending 時: ドロップダウン（Share / Share & Always）+ Dismiss ボタン
- 実行後: 「Shared」「Dismissed」ラベル表示

### MutateActionCard (`src/actions/MutateActionCard.tsx`)

ミューテーションアクションの表示カード:
- アイコン + アクションタイプラベル
- プレビュー表示（Show Preview でコードブロック展開）
- pending 時: ドロップダウン（Accept / Accept & Always）+ Reject ボタン
- 実行後: 「Applied」「Rejected」ラベル表示

### DropdownButton (`src/actions/DropdownButton.tsx`)

汎用ドロップダウンボタン:
- プライマリボタン + トグル矢印
- クリック外検出でメニュー閉じ
- 「& Always」オプション付き承認に使用

## CSS 規約

- プレフィックス: `jp-Mynerva-*`
- ファイル構成:
  - `style/base.css` — 基本スタイル
  - `style/panel.css` — パネル固有スタイル
  - `style/index.css` — インポート集約
  - `style/index.js` — Webpack エントリー
