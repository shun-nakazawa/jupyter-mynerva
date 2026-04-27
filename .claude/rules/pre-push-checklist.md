---
description: git commit / push 前に確認するチェックリスト
globs: "*"
---

# プッシュ前チェックリスト

コミット・プッシュ前に以下を確認する。

1. **リファクタリング確認**: code-review-principles に従い、差分がクリーンか確認
2. **リント通過**: `jlpm lint:check` がエラーなしで通ること
3. **TypeScript ビルド**: `jlpm build` がエラーなしで通ること
4. **Python テスト**: `pytest tests/` が通ること
5. **不要コード除去**: `console.log` やデバッグコードが残っていないか確認（`grep -r "console.log" src/`）
6. **ドキュメント更新**: 機能追加・変更時は関連ドキュメント（docs/, CLAUDE.md）も更新
