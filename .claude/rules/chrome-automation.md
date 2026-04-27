---
description: Chrome 拡張でブラウザ操作する際のルール
globs: "*"
---

# Chrome ブラウザ操作ルール

## JupyterLab の Mynerva パネル操作

- Mynerva パネルは右サイドバー（alternate sidebar）の「Mynerva」タブで開く
- パネル内の主要要素は `find` ツールで検索するのが確実（DOM 構造が深いため ref_id 指定の read_page では取得しにくい）
- パネルが狭い場合、要素は存在するがスクリーンショットに映らない。`read_page` や `find` で確認する

## 操作パターン

1. **初回接続時**: `tabs_context_mcp` → `navigate` → `read_page(filter="interactive")`
2. **要素確認**: `find` で自然言語検索が最も効率的
3. **エラー確認**: `find` で "error" を検索、またはサーバーログを `docker compose logs` で確認
4. **LLM 応答待ち**: `wait` で 5-10 秒待ってから `find` で応答を検索
5. **スクリーンショット**: 全体確認用。パネル部分が狭い場合は `read_page` で DOM を直接読む

## ツールロード順序

Chrome ツールは deferred なので初回使用時に ToolSearch が必要:
- `select:mcp__claude-in-chrome__tabs_context_mcp` — 最初に必ずロード
- `select:mcp__claude-in-chrome__navigate` — ページ遷移
- `select:mcp__claude-in-chrome__computer` — クリック・入力・スクリーンショット
- `select:mcp__claude-in-chrome__read_page` — DOM 読み取り
- `select:mcp__claude-in-chrome__find` — 要素検索
- 一度ロードしたツールは再ロード不要
