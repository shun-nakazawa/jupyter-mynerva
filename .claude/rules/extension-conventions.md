---
description: JupyterLab 拡張機能開発時の技術的制約とパターン
globs: "src/**,jupyter_mynerva/**"
---

# JupyterLab 拡張機能の規約

## フロントエンド (TypeScript/React)

- JupyterLab 4.x API を使用（`@jupyterlab/*` パッケージ）
- React 関数コンポーネント + useState/useEffect/useRef パターン
- CSS クラス名は `jp-Mynerva-*` プレフィックス（BEM スタイル）
- シングルクォート、末尾カンマなし、アロー関数優先
- `marked` ライブラリで Markdown レンダリング（完了済みメッセージ）
- `Streamdown` コンポーネントでストリーミング中の Markdown レンダリング

## バックエンド (Python)

- `jupyter_server` の `APIHandler` を継承してハンドラ実装
- ルーティングは `setup_route_handlers()` で一括登録
- API パスは `/jupyter-mynerva/` プレフィックス
- LLM API キーは Fernet 暗号化で保存（`MYNERVA_SECRET_KEY`）
- nblibram は `subprocess.run()` でCLI呼び出し
- パストラバーサル防止: `_validate_path()` で contents_manager.root_dir 外アクセスを遮断
- ストリーミング SSE: `_init_sse()`, `_send_sse()`, `_finish_sse()` ヘルパーを使用
- 新しいプロバイダーの Serializer は既存パターン（`chat_openai` 等）に合わせ、統一 SSE フォーマットに変換する

## アクションプロトコル

- LLM レスポンスは必ず JSON: `{ "messages": [...], "actions": [...] }`
- アクションステータス遷移: `pending` → `approved` → `executed`（または `rejected` → `notified`）
- ミューテーション（insertCell/updateCell/deleteCell/runCell）は djb2 ハッシュによる楽観的ロック必須
- クエリアクションには自動承認の階層あり: getOutput > getCells > getSection > getToc
