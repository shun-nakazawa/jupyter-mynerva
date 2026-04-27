# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Jupyter-Mynerva は JupyterLab 4.x 向けの LLM アシスタント拡張機能。TypeScript/React のフロントエンドパネルと、Python サーバー拡張のバックエンドで構成される。LLM 呼び出し（OpenAI/Anthropic/Enki Gate）のプロキシと、外部 Go バイナリ `nblibram` を介したノートブック問い合わせ機能を提供する。

## ビルド・開発コマンド

```bash
# 開発モードでインストール（Python + フロントエンドリンク）
pip install -e "."
jupyter labextension develop . --overwrite
jupyter server extension enable jupyter_mynerva

# フロントエンドビルド
jlpm build          # 開発ビルド（tsc + labextension）
jlpm build:prod     # プロダクションビルド
jlpm watch          # ファイル変更の自動ビルド

# リント
jlpm lint           # 全リント修正（eslint + stylelint + prettier）
jlpm lint:check     # チェックのみ（修正なし）

# Python テスト
pytest tests/

# UI テスト（Playwright）
cd ui-tests && jlpm install && npx playwright install && jlpm test
```

## アーキテクチャ

```
フロントエンド (TypeScript/React)     バックエンド (Python)            外部
┌──────────────────────┐   HTTP    ┌─────────────────────┐     ┌──────────┐
│ Panel (panel.tsx)     │─────────▶│ routes.py            │────▶│ nblibram │
│ ContextEngine         │          │  /jupyter-mynerva/*  │     │ (Go CLI) │
│ Action Cards          │          │  LLM プロキシ        │     └──────────┘
│ nblibram.ts ラッパー   │          │  セッション CRUD     │
└──────────────────────┘          │  設定の暗号化        │
                                   └─────────────────────┘
```

**フロントエンド主要ファイル:**
- `src/index.ts` - 拡張機能エントリーポイント、プラグイン登録
- `src/panel.tsx` - メインの React パネル（チャット UI、設定、セッション選択、アクション承認）
- `src/context.ts` - ContextEngine: セル追跡、ミューテーション実行、djb2 ハッシュによる楽観的ロック
- `src/nblibram.ts` - バックエンド経由の nblibram クエリラッパー
- `src/actions/types.ts` - アクション型定義（query, mutate, help）
- `src/systemPrompt.ts` - LLM に送るシステムプロンプトとアクションドキュメント

**バックエンド主要ファイル:**
- `jupyter_mynerva/__init__.py` - 拡張機能登録、nblibram の存在チェック
- `jupyter_mynerva/routes.py` - 全 API ハンドラ（chat, config, sessions, nblibram, enki-gate）

**アクションプロトコル:** LLM は JSON `{ "messages": [...], "actions": [...] }` で応答する。アクションは query（読み取り専用、自動承認可）と mutate（ユーザー承認必須）に分類される。ステータス遷移: `pending` → `approved` → `executed`（または `rejected` → `notified`）。

## 設定・環境変数

- `MYNERVA_SECRET_KEY` - 保存 API キーの Fernet 暗号化キー
- `MYNERVA_OPENAI_API_KEY`, `MYNERVA_ANTHROPIC_API_KEY` - デフォルト LLM キー
- ユーザー設定: `~/.mynerva/config.json`（暗号化された API キー）
- セッション: `~/.mynerva/sessions/*.mnchat`
- プライバシーフィルター: `~/.nbfilterrc.toml`
- `nblibram` Go バイナリが PATH に必要（ノートブッククエリ機能用）

## コードスタイル

- TypeScript: strict モード、シングルクォート、末尾カンマなし、アロー関数優先
- ESLint + Stylelint + Prettier を適用（コミット前に `jlpm lint:check` を実行）
- Python ビルドは hatchling を使用。バージョンは `package.json` から `hatch-nodejs-version` で同期

## Docker 開発環境

```bash
docker compose up --build          # ビルドして起動（http://localhost:8888）
docker compose exec jupyter bash   # コンテナ内に入る
```

デフォルトでエコーエージェント（`MYNERVA_ECHO_AGENT=1`）が有効。LLM API キーは `docker-compose.yml` の environment で設定。

## 詳細ドキュメント

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - システムアーキテクチャ・モジュール構成
- [docs/ACTION_PROTOCOL.md](docs/ACTION_PROTOCOL.md) - アクションプロトコル仕様
- [docs/FRONTEND.md](docs/FRONTEND.md) - フロントエンド設計（React/TypeScript）
- [docs/BACKEND.md](docs/BACKEND.md) - バックエンド設計（Python/Tornado）
- [docs/DESIGN_STREAMING.md](docs/DESIGN_STREAMING.md) - ストリーミング設計（統一 SSE フォーマット、Serializer、プロバイダー対応、経緯）
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 開発ガイド・よくあるタスク
