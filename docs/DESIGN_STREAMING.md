# 設計: LLM レスポンスのストリーミング対応

## 1. 概要

Mynerva の LLM チャットは常にストリーミング形式で応答を受信する。フロントエンドは全プロバイダーで共通の SSE フォーマットだけを扱い、プロバイダー固有の差分はバックエンドの **Serializer** が吸収する。

対象プロバイダー: OpenAI, Anthropic, Enki Gate, Echo（テスト用）

## 2. アーキテクチャ

```
LLM API                 Serializer (Backend)        Frontend
┌──────────┐  native   ┌────────────────┐  SSE   ┌──────────┐
│ OpenAI   │──stream──▶│ chat_openai    │──────▶│          │
│ (Resp.   │  events   │  (Responses)   │        │ sendChat │
│  API)    │           └────────────────┘        │          │
└──────────┘                                      │ runChat  │
┌──────────┐           ┌────────────────┐        │ (state   │
│Anthropic │──stream──▶│ chat_anthropic │──────▶│  binding)│
│(messages │  events   │                │        │          │
│ .stream) │           └────────────────┘        │ Streamdown│
└──────────┘                                      │ でレンダ  │
┌──────────┐           ┌────────────────┐        │          │
│EnkiGate  │──Resp API▶│ chat_openai    │──────▶│          │
│(OpenAI   │  events   │  (base_url 指定)│        │          │
│互換)     │           └────────────────┘        │          │
└──────────┘                                      │          │
┌──────────┐           ┌────────────────┐        │          │
│ Echo     │── mock ──▶│ chat_echo      │──────▶│          │
│(test)    │           │  (直接 SSE 生成)│        │          │
└──────────┘           └────────────────┘        └──────────┘
                           ↑ 全て同じ統一 SSE
                       _init_sse / _send_sse / _finish_sse
```

### 設計原則

- **ストリーミング一択**: 非ストリームフォールバックは持たない。Chat Completions API も使わない
- **統一 SSE**: プロバイダー差分はバックエンドの Serializer が吸収し、フロントは一種類のプロトコルのみ扱う
- **全プロバイダーが Responses API 互換である前提**（Enki Gate も含む）
- **Anthropic は独自 API（`messages.stream()`）** — Serializer で統一 SSE に変換

## 3. 統一 SSE フォーマット

### イベント型

| type | 意味 | フィールド |
|------|------|-----------|
| `content_block_start` | 新しいコンテンツブロック開始 | `content_type` [, 追加メタデータ] |
| `content_block_delta` | ブロック内のテキスト差分 | `content_type`, `delta` |
| `content_block_stop` | ブロック終了 | `content_type` [, `text`] |
| `message_done` | メッセージ完了 | `text`（完成テキスト）, `stop_reason` |
| `error` | エラー | `error` |

最終行は常に `data: [DONE]`。

### content_type

現在サポートする値:

| content_type | 意味 | クライアント表示 |
|-------------|------|---------------|
| `thinking` | LLM の思考・推論サマリー | 「Thinking...」＋ 推論テキスト |
| `text` | ユーザーへのメイン応答テキスト | Streamdown でリアルタイム Markdown |

※ `web_search`, `file_search`, `code_interpreter`, `image_generation` などの tools 関連 content_type は**非対応**（本ドキュメント §6 参照）

### SSE 出力例

```
data: {"type":"content_block_start","content_type":"thinking"}
data: {"type":"content_block_stop","content_type":"thinking"}
data: {"type":"content_block_start","content_type":"text"}
data: {"type":"content_block_delta","content_type":"text","delta":"The answer is"}
data: {"type":"content_block_delta","content_type":"text","delta":" 42."}
data: {"type":"content_block_stop","content_type":"text"}
data: {"type":"message_done","text":"{\"messages\":[...],\"actions\":[...]}","stop_reason":"completed"}
data: [DONE]
```

`message_done.text` には LLM の完全な応答 JSON（Mynerva のアクションプロトコル）が入る。フロントエンドの `processLLMResponse` がこれをパースしてアクションを解釈する。

## 4. Serializer マッピング

### OpenAI (`chat_openai`) — Responses API

`client.responses.create(model, input, stream=True)` を使用。`system` ロールは `developer` ロールに変換。

| Responses API イベント | → 統一 SSE |
|----------------------|-----------|
| `response.in_progress` | `content_block_start(thinking)` |
| `response.content_part.added` | `content_block_stop(thinking)` + `content_block_start(text)` |
| `response.reasoning_summary_text.delta` | `content_block_delta(thinking, delta)` |
| `response.reasoning_summary_text.done` | `content_block_stop(thinking, text=...)` |
| `response.output_text.delta` | `content_block_delta(text, display)`（`_extract_json_content` で content フィールドを抽出） |
| `response.output_text.done` | `content_block_stop(text)` |
| `response.completed` | `message_done(text, stop_reason)` |
| `response.failed` | `error(message)` |

Enki Gate も同じ `chat_openai()` を `base_url` 指定で呼ぶ。

### Anthropic (`chat_anthropic`)

`client.messages.stream(model, **kwargs)` を使用。メッセージ構築は `_build_anthropic_params()` で共通化（`system` ロール抽出、`max_tokens=4096`、actions 付与）。

| Anthropic イベント | → 統一 SSE |
|-------------------|-----------|
| `content_block_start(thinking)` | `content_block_start(thinking)` |
| `content_block_start(text)` | `content_block_start(text)` |
| `content_block_delta(thinking_delta)` | `content_block_delta(thinking, delta)` |
| `content_block_delta(text_delta)` | `content_block_delta(text, delta)` |
| `content_block_stop` | `content_block_stop(current_block_type)` |
| `get_final_text()` + `get_final_message()` | `message_done(text, stop_reason)` |

### Echo (`chat_echo`)

テスト用モック。実 LLM を呼ばず、ユーザーメッセージ内のトリガー語（`toc`, `cells`, `help` 等）からアクション JSON を合成し、同じ SSE 形式で返す。`thinking → text → message_done` の擬似ストリーミング。

## 5. フロントエンド

### 主要関数・コンポーネント

| 名前 | 役割 |
|------|------|
| `sendChat(messages, callbacks, signal?)` | SSE を消費してコールバックに流す純粋関数 |
| `runChat(messages, signal?)` | `sendChat` をコンポーネント state（`setStreamingContent` 等）に束ねて呼ぶラッパー。前後で `clearStreamingState()` |
| `IStreamCallbacks` | `onContentBlockStart/Delta/Stop`, `onMessageDone` |
| `Streamdown` | ストリーミング中の Markdown をリアルタイム描画 |

### State と UI

| state | 値の意味 | UI 表示 |
|-------|--------|--------|
| `activeContentType` | 最新の `content_block_start` の `content_type` | - |
| `thinkingContent` | 推論テキスト（delta 蓄積、done で上書き） | 「Thinking...」下部に小さく表示 |
| `streamingContent` | メイン応答テキスト（content フィールドを抽出済み） | `<Streamdown>` で Markdown レンダリング |
| `stopReason` | `message_done.stop_reason` | `max_tokens`/`length` のとき切断警告 |

ストリーミング完了後は蓄積テキストを `processLLMResponse()` に渡し、JSON パースとアクション解釈を既存フローで実行。

## 6. 非対応事項

### Chat Completions API

Chat Completions API は使用しない。すべてのプロバイダーが **OpenAI Responses API 互換である前提**。分岐を増やさないこと自体が目的。

### tools 系機能

OpenAI Responses API / Anthropic API の以下の機能は**意図的に非対応**:

| 機能 | 発火条件 | 非対応の理由 |
|------|---------|------------|
| Web 検索 (`web_search`) | `tools: [{type:"web_search"}]` | ノートブック用途で優先度低、YAGNI |
| ファイル検索 (`file_search`) | `tools: [{type:"file_search"}]` | アップロード機能を前提とするため不使用 |
| コードインタプリタ (`code_interpreter`) | `tools: [{type:"code_interpreter"}]` | **ユーザーの Jupyter カーネルと OpenAI サンドボックスの二重実行になり混乱を生む** |
| 画像生成 (`image_generation`) | `tools: [{type:"image_generation"}]` | ノートブック用途で優先度低 |

### 将来、対応する場合に必要な作業

1. `chat_openai()` の `client.responses.create()` 呼び出しに `tools` パラメータを追加
2. 該当イベント型を `content_block_start/delta/stop` にマッピングする分岐を追加
3. フロントエンドで `content_type` ごとの UI 表示を追加
4. 対応するテスト追加

過去に実験実装した内容は git 履歴を参照。

## 7. バックエンド SSE ヘルパー

### ライフサイクル

| ヘルパー | 用途 |
|---------|------|
| `_init_sse(handler)` | SSE レスポンスヘッダー設定（Content-Type, Cache-Control, Connection） |
| `_send_sse(handler, data)` | JSON 化した SSE イベントを送信 |
| `_finish_sse(handler)` | `data: [DONE]` 送信 + レスポンス終了 |
| `@sse_serializer` | `_init_sse` / 例外キャッチ（`error` イベント送信）/ `_finish_sse` を自動実行するデコレータ。Serializer 本体は業務ロジックだけに集中できる |

### ブロックイベント

| ヘルパー | 用途 |
|---------|------|
| `_block_start(handler, type, **metadata)` | `content_block_start` イベント送信 |
| `_block_delta(handler, type, delta)` | `content_block_delta` イベント送信 |
| `_block_stop(handler, type, **metadata)` | `content_block_stop` イベント送信 |

### 変換ヘルパー

| ヘルパー | 用途 |
|---------|------|
| `_extract_json_content(raw)` | LLM の生 JSON から `content` フィールドを抽出（部分 JSON 対応） |
| `_convert_messages_for_responses_api(messages)` | `system` ロールを `developer` ロールに変換 |
| `_build_anthropic_params(messages)` | Anthropic 用に `system` パラメータ抽出・`max_tokens` 設定 |

### 新しい Serializer を書くとき

```python
@sse_serializer
async def chat_myprovider(handler, api_key, model, messages):
    # 本体は LLM 呼び出しと content_block_* / message_done の発火だけ書けばよい。
    # _init_sse / 例外処理 / _finish_sse はデコレータが行う。
    ...
```

## 8. 参考資料

- [OpenAI Responses API - Create](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI Responses API - Streaming Events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
- [Anthropic Messages Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Streamdown (Vercel)](https://github.com/vercel/streamdown)
- 関連: `docs/BACKEND.md`, `docs/FRONTEND.md`

---

# Appendix: 経緯と意思決定の記録

以下は設計に至るまでの議論、検討した代替案、却下した方針の記録。MTG や将来の再検討時の参考用。

## A. ストリーミング対応の初期実装

### 初期の方針比較（2026-04 上旬）

| 方針 | バックエンド | フロントエンド | 採用可否 |
|------|------------|--------------|:-------:|
| **A. SSE プロキシ** | Tornado で stream を SSE に変換 | fetch + ReadableStream | **採用** |
| B. WebSocket | Tornado WebSocketHandler | WebSocket クライアント | 却下: JupyterLab の XSRF/認証基盤との統合が複雑 |
| C. フロントエンドから直接 OpenAI 呼び出し | なし | fetch stream | 却下: API キーがブラウザに露出 |

### 当初は Chat Completions ストリーミングで試作

最初は `chat.completions.create(stream=True)` の `delta.content` を中継するシンプルな SSE で実装。ただし「Thinking...」「Searching...」などのリッチな状態表示ができないため、後に Responses API へ移行。

## B. 統一 SSE フォーマット vs プロバイダー別実装

2つの案を比較:

| 案 | 複雑性 | 初見理解 | 将来拡張 |
|----|-------|---------|---------|
| プロバイダー別に素朴実装 | 低 | ○ | × 新プロバイダーでフロント修正必要 |
| **統一 SSE + Serializer（採用）** | 中 | △ | ○ Serializer 追加のみでプロバイダー追加可 |

採用理由: フロントエンドの複雑さを大幅削減、プロトコル変更点が1箇所に集約、マッピング表をドキュメント化すれば初見問題も解消可能。

### フォーマットの源流

Anthropic API の `content_block_start/delta/stop` モデルに準拠。OpenAI Responses API の独自イベント名（`response.output_text.delta` 等）ではなく、より汎用的で意味が通る名前を選んだ。

## C. Streamdown の導入

### 当初の実装

ストリーミング中はプレーンテキスト表示、完了後に `marked` で Markdown レンダリング、という方式。ただし途中で Markdown プレビューがないため UX 体験が ChatGPT より見劣りした。

### 検討したライブラリ

- **Streamdown (vercel)**: ストリーミング中の不完全 Markdown を安全にレンダリング。採用。
- **FlowToken**: アニメーション特化。不要。
- **react-markdown + 手動ストリーム管理**: 不完全 Markdown の扱いを自前で実装する必要があり採用せず。

### Streamdown 導入時の課題

`streamdown` は React 19 推奨だが React 18 でも動作。Tailwind CSS 必須と書かれているが実際には `data-streamdown` 属性の CSS でも動く。`tsconfig.json` に `skipLibCheck: true` を追加して型エラーを回避。

## D. Responses API への移行

### 動機

Chat Completions API では LLM の「思考中」「検索中」などの状態を取得できない。OpenAI Responses API は 50+ のセマンティックイベントで状態を細かく通知する。

### 実装

`client.chat.completions.create()` → `client.responses.create()` に移行。`system` ロールは `developer` に変換（Responses API 仕様）。

## E. プロバイダー横断ストリーミング

OpenAI のみならず、Anthropic (`messages.stream()`)・Enki Gate (OpenAI 互換) もストリーミング対応。Enki Gate は当初 Chat Completions を使っていたが、MTG 決定により Responses API に統一。

## F. 情報欠落の調査

各プロバイダーの API が返すイベントと Serializer の出力を比較し、捨てている情報を列挙。結果、以下5項目を「検証として」実装:

1. `stop_reason`（切断警告用） — **残す**
2. Web 検索結果 — **却下**（tools 非対応のため発火しない）
3. コードインタプリタ — **却下**（Jupyter と二重実行で混乱）
4. 画像生成 — **却下**（ノートブック用途で優先度低）
5. 推論サマリー完了テキスト — **残す**（低コスト、推論モデルで役立つ）

## G. YAGNI 違反の反省と縮小

初期実装で tools 関連（web_search/code_interpreter/image_generation）も一度実装したが、現状の呼び出しでは `tools` パラメータを渡していないため発火しない＝ YAGNI 違反だった。MTG で削除決定。

## H. MTG（2026-04-24）での最終意思決定

- Serializer 戦略を維持
- Responses API を使用、Chat Completions API は完全に使わない（フォールバックなし）
- tools 関連機能はすべて非対応、コードも削除
- Enki Gate は Responses API 対応前提
- Streamdown は維持

### 背景となる価値観

- 複雑性の増加を重く評価する。追加実装・新仕様の導入は可能な限り避ける
- 分岐は認知負荷を増すため、統一パスが望ましい
- 「念のため残す」よりも「使わないなら消す」

## I. 却下した案のまとめ

| 項目 | 却下案 | 理由 |
|------|-------|------|
| 通信方式 | WebSocket | JupyterLab 認証と相性が悪い |
| 通信方式 | フロント直接呼び出し | API キー露出 |
| アーキテクチャ | プロバイダー別の素朴実装 | フロント側に分岐が増える |
| ストリーミング中の UI | プレーンテキスト表示のみ | UX が見劣り |
| Markdown ライブラリ | react-markdown | 不完全 Markdown の扱いが難 |
| OpenAI API | Chat Completions を両対応 | 分岐増加、状態取得不可 |
| tools | web_search/code_interpreter/image_generation 有効化 | ノートブック用途にそぐわない、二重実行混乱 |
| フォールバック | ストリーム失敗時の非ストリーム切替 | 分岐増加、実用頻度低 |

## J. 未対応の検討事項（将来）

- Anthropic の `tool_use` ブロック（ネイティブのツール呼び出し）の扱い
- OpenAI Responses API の `usage`（トークン使用量）取得 → 課金可視化
- Responses API の `conversation` パラメータ（サーバー側会話管理）の利用検討
