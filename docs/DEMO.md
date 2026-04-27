# デモフロー (OpenAI ストリーミング)

上司向けデモで見せる、OpenAI を使ったストリーミングの動作パターン。

## 準備

- Docker コンテナ起動済み (http://localhost:8888)
- `.env` に `MYNERVA_OPENAI_API_KEY` 設定済み
- JupyterLab で `sales_analysis.ipynb` を開き、Mynerva パネルを表示

## デモパターン

### パターン 1: シンプルなテキストストリーミング

**目的**: Streamdown による逐次 Markdown レンダリングを見せる。

- 質問: "Explain pandas DataFrames briefly in markdown"
- 期待する挙動:
  1. 送信直後 `Thinking...`（パルスアニメーション）
  2. トークンが届き始めると `Generating...`（一瞬）
  3. 箇条書き・太字の Markdown がリアルタイムでレンダリングされる
  4. 完了後: 通常のメッセージとして表示

### パターン 2: ノートブック情報取得（アクションプロトコル）

**目的**: LLM がノートブックの情報を取得するためにアクションを提案し、承認フローが動作することを見せる。

- 質問: "What is this notebook about?"
- 期待する挙動:
  1. ストリーミングで短い説明（「Let me check the notebook structure」等）
  2. アクションカード `getToc` が表示、`Share` / `Dismiss` ボタン
  3. `Share` クリック → nblibram で目次取得 → `Shared` 表示
  4. `[Action Results]` が LLM に送信され、再度ストリーミング開始
  5. 目次情報をもとにノートブックの説明が生成される

### パターン 3: ノートブックのセル追加（ミューテーション）

**目的**: LLM がノートブックを変更するアクションを提案し、承認が必要であることを見せる。

- 質問: "Add a new cell that prints 'hello world'"
- 期待する挙動:
  1. ストリーミングで提案内容の説明
  2. アクションカード `insertCell` が表示、プレビュー展開可能
  3. `Show Preview` でコード確認
  4. `Accept` クリック → ノートブックにセル追加される

### パターン 4: 長めの応答（ストリーミング効果が顕著）

**目的**: ストリーミングがない場合との UX 差を見せる。

- 質問: "Explain the main differences between pandas and NumPy in detail, with examples"
- 期待する挙動: 長文が徐々に表示される。待ち時間の体感が大幅に短縮される。

### パターン 5: セッション管理

**目的**: セッション切り替えでチャット履歴が保持されることを見せる。

- `Sessions` ボタン → 既存セッション一覧を表示
- 過去のセッションを選択 → チャット履歴が復元
- `+ New session` → 新規セッション作成

## 内部的に動作しているもの

デモで見える部分の裏側で動作している機能:

- **統一 SSE フォーマット**: OpenAI Responses API の複雑なイベント（`response.in_progress`, `response.content_part.added`, `response.output_text.delta`, `response.completed` 等）をバックエンドで統一 SSE（`content_block_start/delta/stop`, `message_done`）に変換
- **JSON content 抽出**: LLM の生 JSON レスポンスから content フィールドだけをバックエンドで抽出してフロントに送信
- **content_type マッピング**: `thinking`, `text`, `web_search`, `file_search`, `code_interpreter`, `image_generation` に対応
- **stop_reason**: `max_tokens` で切断された場合は UI に警告表示

## 上司に伝えるポイント

1. **API に準拠した統一設計**: Anthropic の content_block モデルを参考に、プロバイダー非依存の SSE フォーマットを定義
2. **プロバイダー横断**: OpenAI, Anthropic, Enki Gate すべて同じフォーマットで動作
3. **UX**: ChatGPT と同等のストリーミング体験 + Mynerva 独自のアクション承認フロー
4. **テスト**: 51件のユニットテストでserializer の挙動を保証

## 統合シナリオ（フルデモ動画用）

全パターンを自然な流れで見せる統合シナリオ。約40〜60秒を想定。

### ストーリー: 「ノートブックを理解して拡張する」

| 幕 | 質問 | 見せる機能 | 該当パターン |
|---|------|-----------|-----------|
| **Act 1: pandas を聞く** | `In your own words, what is pandas? Answer briefly with 3 bullets in markdown.` | ストリーミング + Streamdown による Markdown レンダリング（箇条書き） | 1, 4 |
| **Act 2: ノートブックを理解する** | `What is this notebook about?` | LLM が `getToc` を提案 → `Share` 承認 → 目次を取得 → 再度ストリーミングで内容解説 | 2 |
| **Act 3: セルを追加する** | `Add a new code cell at the end that prints "Hello from Mynerva!"` | LLM が `insertCell` を提案 → `Accept` 承認 → ノートブックに実際にセル追加 | 3 |

準備段階で **+ New session** を押して新セッションを作成する（録画前）ため、パターン5（セッション管理）も暗黙的にデモに含まれる。

### 安全ネット

LLM が予期せぬアクションを提案する可能性があるため、各 Act の終わりに以下を実施:
- Act 1 終了後: `Dismiss` ボタンがあればクリック（Act 1 は純粋な知識質問なのでアクション不要）
- Act 2 で `Share` が複数ある場合: 最新のもののみクリック
- Act 3 で `Accept` 以外のアクションカードがあれば優先度を判断

### 準備

1. Docker コンテナ起動 + OpenAI API キー設定済み
2. JupyterLab で `sales_analysis.ipynb` を開く
3. Mynerva パネルを表示
4. **Sessions → + New session** でクリーンな新セッション作成
5. 入力欄にフォーカスしない状態にする（カーソル点滅が動画に映らないように）

### 実行

`docs/record-demo.js` の中身を Chrome DevTools Console または `javascript_tool` で実行。画面共有ダイアログで「このタブ」を選ぶ。

```bash
# 録画完了後、webm を mp4 に変換
docker run --rm -v $(pwd)/docs:/work -w /work linuxserver/ffmpeg:latest \
  -i mynerva-full-demo.webm \
  -c:v libx264 -preset medium -crf 23 -movflags +faststart -y \
  mynerva-full-demo.mp4
```

## デモ動画の作成手順

### 方針

- Claude Code のツール呼び出し間レイテンシが動画に含まれるとアイドル時間が目立つため、**録画中のすべての操作をブラウザ内 JavaScript 一発で完結させる**
- `navigator.mediaDevices.getDisplayMedia()` + `MediaRecorder` で webm 録画 → ffmpeg で mp4 変換

### 手順

1. **ブラウザ準備**
   - JupyterLab で対象ノートブックを開く（例: `sales_analysis.ipynb`）
   - Mynerva パネルを開く
   - 新セッション作成（Sessions → + New session）
   - 入力欄が空の状態にする

2. **録画スクリプト実行**
   - Chrome DevTools Console または `javascript_tool` で以下を実行
   - 画面共有ダイアログで「このタブ」を選んで共有

   ```js
   (async () => {
     const stream = await navigator.mediaDevices.getDisplayMedia({
       video: { frameRate: 30 }, audio: false, preferCurrentTab: true
     });
     const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
     const chunks = [];
     recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
     recorder.onstop = () => {
       const blob = new Blob(chunks, { type: 'video/webm' });
       const a = document.createElement('a');
       a.href = URL.createObjectURL(blob);
       a.download = 'mynerva-demo.webm';
       a.click();
       stream.getTracks().forEach(t => t.stop());
     };
     recorder.start();

     const wait = ms => new Promise(r => setTimeout(r, ms));
     const waitFor = (sel, present, timeout = 60000) => new Promise((resolve, reject) => {
       const start = Date.now();
       const check = () => (!!document.querySelector(sel)) === present;
       if (check()) return resolve();
       const iv = setInterval(() => {
         if (check()) { clearInterval(iv); resolve(); }
         else if (Date.now() - start > timeout) { clearInterval(iv); reject(new Error('timeout')); }
       }, 100);
     });

     // 初期状態の余韻
     await wait(600);

     // タイピング
     const ta = document.querySelector('.jp-Mynerva-input');
     ta.focus();
     const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
     const msg = 'Explain pandas DataFrames briefly with bullet points in markdown.';
     for (let i = 1; i <= msg.length; i++) {
       setter.call(ta, msg.slice(0, i));
       ta.dispatchEvent(new Event('input', { bubbles: true }));
       await wait(25);
     }
     await wait(400);

     // 送信 → ストリーミング完了まで待機
     document.querySelector('.jp-Mynerva-send').click();
     await waitFor('.jp-Mynerva-cancel', true, 5000);   // Cancel 出現まで
     await waitFor('.jp-Mynerva-cancel', false, 60000); // Cancel 消失まで（= ストリーミング完了）
     await wait(1500);

     recorder.stop();
   })();
   ```

3. **mp4 変換**

   ```bash
   docker run --rm -v $(pwd)/docs:/work -w /work linuxserver/ffmpeg:latest \
     -i mynerva-demo.webm \
     -c:v libx264 -preset medium -crf 23 -movflags +faststart -y \
     mynerva-demo.mp4
   ```

### 重要なポイント

- **Send クリック後すぐに Cancel ボタンをチェックしない**: React の state 更新が非同期なので、Cancel ボタンの出現を `waitFor` で確認してから、その消失を待つ 2 段階構え
- **タイピング速度**: 25ms/文字が自然に見える（30ms でも可）
- **余韻**: 入力完了後 400ms、ストリーミング完了後 1500ms が見やすい
- **frameRate: 30**: 60 fps だとファイルサイズが倍増する割に違いが分かりにくい
