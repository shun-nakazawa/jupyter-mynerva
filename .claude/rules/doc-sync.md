---
description: 機能追加・変更時のドキュメント同期ルール
globs: "src/**,jupyter_mynerva/**"
---

# ドキュメント同期ルール

機能追加・変更時には以下のドキュメントを同時に更新する。

1. **docs/ARCHITECTURE.md** — アーキテクチャ図、データ構造、フロー図
2. **docs/ACTION_PROTOCOL.md** — アクションタイプ追加時はプロトコル仕様を更新
3. **docs/BACKEND.md** — バックエンド API エンドポイント追加・変更時
4. **docs/FRONTEND.md** — フロントエンドコンポーネント追加・変更時
5. **CLAUDE.md** — ビルドコマンドや主要構造に影響がある場合

特に重要:
- 新しいアクションタイプを追加する場合: `types.ts`, `systemPrompt.ts`, `validator.ts`, `parser.ts`, および対応する ActionCard コンポーネントの全てを更新し、ドキュメントにも反映
- 新しい API エンドポイント追加時: `routes.py` のハンドラと `docs/BACKEND.md` のエンドポイント一覧を同時更新
- 新しい LLM プロバイダー追加時: ストリーム関数（`chat_*_stream`）、`ChatHandler` 分岐、テスト、`docs/BACKEND.md` のプロバイダー一覧を同時更新
