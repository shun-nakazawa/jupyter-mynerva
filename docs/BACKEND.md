# バックエンド設計

## 概要

Python で実装された Jupyter Server 拡張機能。Tornado ベースの HTTP ハンドラで API を提供する。

## エントリーポイント (`jupyter_mynerva/__init__.py`)

- `_jupyter_server_extension_points()` で拡張機能として登録
- `_load_jupyter_server_extension(server_app)` で初期化
  - nblibram バイナリの存在チェック（PATH 検索）
  - なければ警告ログ出力（機能は制限される）
  - `setup_route_handlers(web_app)` でルーティング登録

## API エンドポイント一覧

全エンドポイントは `/jupyter-mynerva/` プレフィックス。

| メソッド | パス | ハンドラ | 説明 |
|---------|------|---------|------|
| GET | `/providers` | `ProvidersHandler` | プロバイダー一覧・暗号化状態・フィルター設定 |
| GET | `/config` | `ConfigHandler` | ユーザー設定読み込み |
| POST | `/config` | `ConfigHandler` | ユーザー設定保存 |
| POST | `/chat` | `ChatHandler` | LLM にメッセージ送信 |
| POST | `/openai-models` | `OpenAIModelsHandler` | OpenAI 互換エンドポイントからモデル一覧取得 |
| GET | `/sessions` | `SessionsHandler` | セッション一覧 |
| POST | `/sessions` | `SessionsHandler` | 新規セッション作成 |
| GET | `/sessions/{id}` | `SessionHandler` | セッション取得 |
| PUT | `/sessions/{id}` | `SessionHandler` | セッション更新 |
| DELETE | `/sessions/{id}` | `SessionHandler` | セッション削除 |
| POST | `/nblibram` | `NblibramHandler` | nblibram クエリ実行 |
| POST | `/enki-gate/device-flows` | `EnkiGateDeviceFlowHandler` | デバイスフロー開始 |
| POST | `/enki-gate/device-flows/{code}/poll` | `EnkiGateDeviceFlowPollHandler` | デバイスフロー ポーリング |

## LLM プロバイダー

### プロバイダー定義

```python
PROVIDERS = [
    {'id': 'openai', 'displayName': 'OpenAI', 'models': [...]},
    {'id': 'anthropic', 'displayName': 'Anthropic', 'models': [...]},
    {'id': 'enki-gate', 'displayName': 'Enki Gate', 'models': []},
    {'id': 'echo', 'displayName': 'Echo (Testing)', 'models': []}  # MYNERVA_ECHO_AGENT=1 時のみ
]
```

### ChatHandler のフロー

1. ユーザー設定をロード（`load_config()`）
2. チャット設定を解決（`resolve_chat_config()`）
   - デフォルト使用時: 環境変数から取得
   - カスタム時: ユーザー設定から取得（API キー復号）
3. プロバイダー別に LLM 呼び出し（すべてストリーミング SSE レスポンス）:
   - `chat_openai(handler, ...)`: OpenAI Responses API（Enki Gate も同関数を `base_url` 指定で呼ぶ）
   - `chat_anthropic(handler, ...)`: Anthropic `messages.stream()`
   - `chat_echo(handler, messages)`: テスト用エコーエージェント（`MYNERVA_ECHO_AGENT=1` 時のみ）

詳細な SSE フォーマット、Serializer のマッピング、非対応事項（Chat Completions API, tools 系機能）は `docs/DESIGN_STREAMING.md` を参照。

## 設定管理

### 設定の優先順位

```
1. 環境変数（管理者設定）← 最優先のデフォルト
   MYNERVA_OPENAI_API_KEY, MYNERVA_ANTHROPIC_API_KEY,
   MYNERVA_OPENAI_BASE_URL, MYNERVA_DEFAULT_PROVIDER,
   MYNERVA_DEFAULT_MODEL
2. ユーザー設定 ~/.mynerva/config.json
3. フォールバック: なし（エラー）
```

環境変数は起動時に読み込まれ、セキュリティのため環境から削除される。

### デフォルトプロバイダー自動検出

`MYNERVA_DEFAULT_PROVIDER` が未設定の場合:
- OpenAI キーまたは base_url のみ → `openai`
- Anthropic キーのみ → `anthropic`
- 両方設定 → 明示的な `MYNERVA_DEFAULT_PROVIDER` が必要

### API キー暗号化

- 暗号化キー: `MYNERVA_SECRET_KEY` 環境変数（Fernet キー）
- 保存時: `encrypt_api_key()` で `encrypted:` プレフィックス付きで暗号化
- 読み込み時: `decrypt_api_key()` で `encrypted:` プレフィックスを検出して復号
- キー未設定時: `decryptError` フラグを設定（フロントエンドに通知）

## セッション管理

### ファイル形式

パス: `~/.mynerva/sessions/{id}.mnchat`

```json
{
  "id": "20240101_120000_a1b2c3d4",
  "created": "2024-01-01T12:00:00.000000",
  "updated": "2024-01-01T12:30:00.000000",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "...", "actions": [...] }
  ]
}
```

### セッション ID 形式

`YYYYMMDD_HHMMSS_<uuid[:8]>`

例: `20240101_120000_a1b2c3d4`

## nblibram ハンドラ

### リクエスト処理

1. コマンド検証: `toc`, `section`, `cells`, `outputs` のみ許可
2. パス解決:
   - **ライブクエリ**: `notebookContent` 付き → LRU キャッシュ（最大16エントリ）に一時保存
   - **ファイルクエリ**: パス検証（トラバーサル防止、隠しファイル拒否）
3. CLI 引数構築: `-file <path> -format json -query <query> -count <count> -no-filter`
4. `subprocess.run()` で実行
5. JSON パースまたは生テキストを返却

### パス検証（セキュリティ）

```python
def _validate_path(path):
    root_dir = realpath(contents_manager.root_dir)
    resolved = realpath(join(root_dir, path))
    # root_dir 外へのアクセスを拒否
    if not resolved.startswith(root_dir + os.sep):
        raise ValueError('path escapes content root')
    # 隠しファイル・ディレクトリを拒否
    for part in rel.split(os.sep):
        if part.startswith('.'):
            raise ValueError('hidden files are not accessible')
    return resolved
```

### ノートブック一時ストア

- LRU キャッシュ（最大16エントリ）でダーティなノートブック内容を一時保存
- キー: ノートブックパス
- 値: 一時ファイルパス
- 古いエントリは自動削除（一時ファイルも削除）

## プライバシーフィルター

### 設定ファイル (`~/.nbfilterrc.toml`)

```toml
[[filters]]
pattern = '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b'
label = '[IPv4_#]'
```

### デフォルトフィルター

- IPv4 アドレスパターン
- ドメイン名パターン

`load_filters()` で読み込み、`/providers` エンドポイント経由でフロントエンドに通知。

## Echo エージェント (`jupyter_mynerva/echo_agent.py`)

テスト用のモック LLM。ユーザーメッセージ内のトリガーワードに基づいてアクションを生成:

| トリガー | 生成アクション |
|---------|--------------|
| `toc` | `getToc` |
| `cells` | `getCells({start:0}, count:2)` |
| `help` | `help(action:'getToc')` |
| ... | ... |

`[Action Results]` を受信した場合: テキストのみ返却（アクションなし）。

## テスト (`tests/test_routes.py`)

| テスト | 対象 |
|-------|------|
| 暗号化/復号ラウンドトリップ | Fernet 暗号化 |
| 設定の読み込み/保存 | ConfigHandler |
| ノートブック一時ストア LRU | NblibramHandler |
| OpenAI モデル取得 + キャッシュ | OpenAIModelsHandler |
| チャット設定解決 | resolve_chat_config() |
