/**
 * Mynerva フルデモ録画スクリプト
 *
 * 前提:
 *   - sales_analysis.ipynb が開かれている
 *   - Mynerva パネルが表示されている
 *   - 新セッションが作成済み（入力欄が空）
 *
 * 実行方法:
 *   - Chrome DevTools Console にペースト、または
 *   - Claude Code の mcp__claude-in-chrome__javascript_tool で実行
 *   - 画面共有ダイアログで「このタブ」を選択
 *
 * 処理完了後 mynerva-full-demo.webm が自動ダウンロードされる。
 */
(async () => {
  // ---- ユーティリティ ----

  const wait = ms => new Promise(r => setTimeout(r, ms));

  /** 指定セレクタの要素が present/absent になるまで待機 */
  const waitFor = (sel, present, timeout = 90000) =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => (!!document.querySelector(sel)) === present;
      if (check()) return resolve();
      const iv = setInterval(() => {
        if (check()) { clearInterval(iv); resolve(); }
        else if (Date.now() - start > timeout) {
          clearInterval(iv);
          reject(new Error(`waitFor timeout: ${sel} present=${present}`));
        }
      }, 100);
    });

  /**
   * 指定テキストを持つ最新の button 要素が出現するまで待って返す。
   * 「Share」「Accept」など、最新のアクションカードのボタンを取得するのに使う。
   * 既に「Shared」や「Applied」に変わった古いボタンは一致しないので
   * 自動的に「次の未処理カード」を選べる。
   */
  const waitForButton = (text, timeout = 15000) =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const find = () => {
        const btns = document.querySelectorAll('button');
        let match = null;
        btns.forEach(b => {
          if (b.textContent.trim() === text) match = b;
        });
        return match;
      };
      const first = find();
      if (first) return resolve(first);
      const iv = setInterval(() => {
        const el = find();
        if (el) { clearInterval(iv); resolve(el); }
        else if (Date.now() - start > timeout) {
          clearInterval(iv);
          reject(new Error(`waitForButton timeout: "${text}"`));
        }
      }, 100);
    });

  /** テキストを一文字ずつ人間らしい速度で入力 */
  const typeMessage = async (msg, delayMs = 25) => {
    const ta = document.querySelector('.jp-Mynerva-input');
    if (!ta) throw new Error('input textarea not found');
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    ).set;
    for (let i = 1; i <= msg.length; i++) {
      setter.call(ta, msg.slice(0, i));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(delayMs);
    }
  };

  /** 送信 → ストリーミング完了まで待機 */
  const sendAndAwaitStreaming = async () => {
    const sendBtn = document.querySelector('.jp-Mynerva-send');
    if (!sendBtn) throw new Error('send button not found');
    sendBtn.click();
    // Cancel ボタン出現 = ストリーミング開始（React state 反映待ち）
    await waitFor('.jp-Mynerva-cancel', true, 10000);
    // Cancel ボタン消失 = ストリーミング完了
    await waitFor('.jp-Mynerva-cancel', false, 120000);
  };

  /**
   * 残っている pending アクションをすべて Dismiss/Reject でクリア。
   * Act 1 で予期せぬアクションが出た場合などに使う。
   * Dismiss を押すと LLM にフィードバックが送られて新しいストリーミングが始まるので、
   * それが完了するまで待つ。
   */
  const dismissPendingActions = async () => {
    let dismissed = false;
    while (true) {
      const btns = document.querySelectorAll('button');
      let target = null;
      btns.forEach(b => {
        const t = b.textContent.trim();
        if (t === 'Dismiss' || t === 'Reject') target = b;
      });
      if (!target) break;
      target.click();
      dismissed = true;
      await wait(300);
    }
    if (dismissed) {
      // Dismiss/Reject 後、LLM 再呼び出しでストリーミングが始まる可能性
      try {
        await waitFor('.jp-Mynerva-cancel', true, 5000);
        await waitFor('.jp-Mynerva-cancel', false, 120000);
      } catch (_) {
        // ストリーミングが始まらなかった場合は何もしない
      }
    }
  };

  // ---- 録画セットアップ ----

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: false,
    preferCurrentTab: true
  });
  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 2_000_000
  });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mynerva-full-demo.webm';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    stream.getTracks().forEach(t => t.stop());
  };

  recorder.start();

  try {
    // ==== Act 1: pandas の説明 ====
    await wait(700);
    await typeMessage(
      'In your own words, what is pandas? Answer briefly with 3 bullets in markdown.'
    );
    await wait(400);
    await sendAndAwaitStreaming();
    await wait(1000);
    // 安全ネット: 予期せぬアクションがあれば Dismiss してクリア
    await dismissPendingActions();
    await wait(500);

    // ==== Act 2: ノートブックの内容を聞く ====
    await typeMessage('What is this notebook about?');
    await wait(400);
    await sendAndAwaitStreaming();
    await wait(800);

    // getToc アクションの Share を押す
    const shareBtn = await waitForButton('Share');
    shareBtn.click();
    // Share 後: アクション実行 → LLM 再呼び出し → 新たなストリーミング
    await waitFor('.jp-Mynerva-cancel', true, 15000);
    await waitFor('.jp-Mynerva-cancel', false, 120000);
    await wait(1500);

    // ==== Act 3: セル追加 ====
    await typeMessage(
      'Add a new code cell at the end that prints "Hello from Mynerva!"'
    );
    await wait(400);
    await sendAndAwaitStreaming();
    await wait(800);

    // insertCell アクションの Accept を押す
    const acceptBtn = await waitForButton('Accept');
    acceptBtn.click();
    // Accept 後: セル挿入 → LLM 再呼び出し → 新たなストリーミング
    await waitFor('.jp-Mynerva-cancel', true, 15000);
    await waitFor('.jp-Mynerva-cancel', false, 120000);
    await wait(2500); // 最終余韻（少し長め）
  } catch (e) {
    console.error('Demo error:', e);
    await wait(1000);
  } finally {
    recorder.stop();
  }
})();
