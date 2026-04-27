# アーキテクチャ概要

## システム全体像

jupyter-mynerva は JupyterLab 4.x 向けの LLM アシスタント拡張機能で、3層構造で構成される。

```
┌─────────────────────────────────────────────────────────────┐
│  JupyterLab (ブラウザ)                                       │
│  ┌────────────────────┐    ┌──────────────────────────────┐  │
│  │  ノートブック       │    │  Mynerva パネル (React)       │  │
│  │  (INotebookTracker) │    │  - チャット UI               │  │
│  │                    │    │  - アクションカード           │  │
│  │                    │    │  - 設定パネル                 │  │
│  └────────────────────┘    │  - セッション管理             │  │
│           │                └───────────┬──────────────────┘  │
│           │                            │                     │
│  ┌────────▼────────────────────────────▼──────────────────┐  │
│  │  ContextEngine (src/context.ts)                        │  │
│  │  - セル読み取り・書き込み                               │  │
│  │  - djb2 ハッシュによる楽観的ロック                      │  │
│  │  NblibramLiveQuery (src/nblibram.ts)                   │  │
│  │  - ノートブック構造クエリ                               │  │
│  └───────────────────────┬───────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │ HTTP POST /jupyter-mynerva/*
┌──────────────────────────▼──────────────────────────────────┐
│  Jupyter Server Extension (Python)                          │
│  jupyter_mynerva/routes.py                                  │
│  - /chat: LLM プロキシ (OpenAI / Anthropic / Enki Gate)    │
│  - /nblibram: ノートブッククエリ実行                        │
│  - /config: 設定管理（API キー暗号化）                      │
│  - /sessions: セッション CRUD                               │
│  - /providers: プロバイダー一覧                             │
│  - /enki-gate/device-flows: デバイスフロー認証              │
│  - /openai-models: モデル一覧取得                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ subprocess
┌──────────────────────────▼──────────────────────────────────┐
│  nblibram (外部 Go バイナリ)                                 │
│  - 目次（ToC）抽出                                          │
│  - セクション・セル・出力の抽出                              │
│  - プライバシーフィルタリング（gitleaks ベース）             │
└─────────────────────────────────────────────────────────────┘
```

## モジュール依存関係

```
src/index.ts (エントリーポイント)
  ├── src/panel.tsx (メインパネル UI)
  │     ├── src/context.ts (ContextEngine)
  │     ├── src/nblibram.ts (NblibramLiveQuery)
  │     ├── src/request.ts (HTTP リクエストユーティリティ)
  │     ├── src/systemPrompt.ts (システムプロンプト生成)
  │     ├── src/icons.ts (アイコン定義)
  │     └── src/actions/ (アクション関連)
  │           ├── types.ts (型定義)
  │           ├── parser.ts (LLM レスポンスパーサー)
  │           ├── validator.ts (アクションバリデーター)
  │           ├── QueryActionCard.tsx (クエリアクション UI)
  │           ├── MutateActionCard.tsx (ミューテーションアクション UI)
  │           └── DropdownButton.tsx (ドロップダウン UI)
  └── src/icons.ts

jupyter_mynerva/ (バックエンド)
  ├── __init__.py (拡張機能登録)
  ├── routes.py (全 API ハンドラ)
  └── echo_agent.py (テスト用エコーエージェント)
```

## ビルド成果物

```
src/ (TypeScript ソース)
  ↓ tsc (TypeScript コンパイル)
lib/ (JavaScript 出力)
  ↓ jupyterlab builder
jupyter_mynerva/labextension/ (バンドルされた拡張機能)
  ├── static/style.js
  ├── package.json
  └── ...
```

## 外部依存

| 依存 | 用途 | 取得方法 |
|------|------|----------|
| nblibram | ノートブック構造クエリ | GitHub Releases からバイナリ取得 |
| OpenAI API | LLM プロバイダー | API キー設定 |
| Anthropic API | LLM プロバイダー | API キー設定 |
| Enki Gate | LLM ゲートウェイ | デバイスフロー認証 |

## ファイル配置

| パス | 用途 |
|------|------|
| `~/.mynerva/config.json` | ユーザー設定（暗号化 API キー） |
| `~/.mynerva/sessions/*.mnchat` | チャットセッション |
| `~/.nbfilterrc.toml` | プライバシーフィルター定義 |
