# 開発ガイド

## 環境構築

### 前提条件

- Python >= 3.10
- Node.js >= 22
- JupyterLab >= 4.0.0, < 5
- nblibram バイナリ（PATH に配置）

### セットアップ

```bash
# リポジトリクローン
git clone https://github.com/NII-cloud-operation/jupyter-mynerva.git
cd jupyter-mynerva

# Python 仮想環境
python -m venv .venv
source .venv/bin/activate

# 開発インストール
pip install -e ".[test]"
jupyter labextension develop --overwrite .
jupyter server extension enable jupyter_mynerva

# フロントエンドの監視ビルド（開発時）
jlpm watch
```

### Docker での開発

```bash
# ビルドと起動
docker compose up --build

# ソースコードはボリュームマウントされるため、
# フロントエンド変更時は jlpm watch をコンテナ内で実行
docker compose exec jupyter jlpm --cwd /home/jovyan/jupyter-mynerva watch
```

### nblibram の取得

```bash
# Linux (amd64)
wget -qO- "https://github.com/NII-cloud-operation/nblibram/releases/latest/download/nblibram_linux_amd64.tar.gz" | tar xz -C /usr/local/bin/ nblibram

# macOS (arm64)
wget -qO- "https://github.com/NII-cloud-operation/nblibram/releases/latest/download/nblibram_darwin_arm64.tar.gz" | tar xz -C /usr/local/bin/ nblibram
```

## 開発ワークフロー

### フロントエンド開発

1. `jlpm watch` でファイル監視開始
2. ソースコード (`src/`) を編集
3. ブラウザで JupyterLab をリロード（Ctrl+Shift+R）

### バックエンド開発

1. `jupyter_mynerva/` 内のファイルを編集
2. JupyterLab を再起動（サーバー拡張はホットリロード非対応）

```bash
jupyter lab --no-browser
```

### テスト実行

```bash
# Python 単体テスト
pytest tests/

# 特定テスト
pytest tests/test_routes.py::test_encrypt_decrypt

# UI テスト（Playwright）
cd ui-tests
jlpm install
npx playwright install chromium
jlpm test

# 特定 UI テスト
npx playwright test tests/mynerva.spec.ts
```

### リント

```bash
# 全チェック
jlpm lint:check

# 自動修正
jlpm lint

# 個別実行
jlpm eslint        # TypeScript
jlpm stylelint     # CSS
jlpm prettier      # フォーマット
```

## よくある開発タスク

### 新しいアクションタイプの追加

1. **型定義**: `src/actions/types.ts` にアクション型を追加
2. **システムプロンプト**: `src/systemPrompt.ts` にアクション説明を追加
3. **バリデーション**: `src/actions/validator.ts` にスキーマを追加
4. **パーサー**: `src/actions/parser.ts`（通常変更不要）
5. **ActionCard**: クエリなら `QueryActionCard.tsx`、ミューテーションなら `MutateActionCard.tsx` を更新
6. **実行ロジック**: `src/panel.tsx` の `executeQueryAction()` または `executeMutateAction()` に追加
7. **バックエンド**: 必要なら `jupyter_mynerva/routes.py` にハンドラ追加
8. **ドキュメント**: `docs/ACTION_PROTOCOL.md` を更新

### 新しい LLM プロバイダーの追加

1. `jupyter_mynerva/routes.py`:
   - `PROVIDERS` リストにプロバイダー定義追加
   - `chat_<provider>(handler, ...)` ストリーム Serializer を実装（`_init_sse`, `_send_sse`, `_finish_sse`, `_block_start/delta/stop` を使用し統一 SSE に変換）
   - `ChatHandler.post()` の分岐に追加
   - `resolve_chat_config()` にデフォルト解決ロジック追加
2. `src/panel.tsx`:
   - 設定パネルに UI 追加（必要な場合）
3. `tests/test_routes.py`: Serializer のテストを追加
4. 環境変数のドキュメント更新

詳細は `docs/DESIGN_STREAMING.md` 参照。

### 新しい API エンドポイントの追加

1. `jupyter_mynerva/routes.py`:
   - `APIHandler` を継承したハンドラクラスを作成
   - `setup_route_handlers()` にルーティング追加
2. `src/request.ts` にリクエスト関数追加（必要な場合）
3. `docs/BACKEND.md` のエンドポイント一覧を更新

## テスト用エコーエージェント

LLM API キーなしでテストするには:

```bash
# 環境変数で有効化
export MYNERVA_ECHO_AGENT=1
jupyter lab
```

または docker-compose.yml で `MYNERVA_ECHO_AGENT=1` を設定（デフォルトで有効）。

エコーエージェントはユーザーメッセージ内のトリガーワード（`toc`, `cells`, `help` など）に基づいてアクションを自動生成する。

## リリース手順

`RELEASE.md` を参照。

## トラブルシューティング

### 拡張機能が表示されない

```bash
# サーバー拡張の確認
jupyter server extension list

# Lab 拡張の確認
jupyter labextension list

# 再インストール
pip install -e "."
jupyter labextension develop --overwrite .
jupyter server extension enable jupyter_mynerva
```

### nblibram が見つからない

```bash
# PATH 確認
which nblibram

# バージョン確認
nblibram --version
```

nblibram がない場合、クエリアクション（getToc, getSection 等）は動作しない。ミューテーションアクション（insertCell 等）は nblibram なしでも動作する。

### TypeScript ビルドエラー

```bash
# node_modules 再インストール
jlpm install --frozen-lockfile

# クリーンビルド
jlpm clean:all
jlpm build
```
