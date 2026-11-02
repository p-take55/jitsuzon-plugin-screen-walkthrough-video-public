# ブラウザツールがない環境での撮影

対象 repo に Playwright があれば、その依存を使って実アプリを操作できる。既存の開発サーバー・テストユーザーを使い、API の mock や作り物の画面は使わない。

## 起動とサイズ

対象 repo の package.json / lockfile から依存と実行方法を確認する。ブラウザ実行ファイルが無ければ、同じバージョンの Playwright CLI で `install chromium` を実行する。既存 Chrome を使う場合は `chromium.launch({ channel: 'chrome' })` も選べる。

```js
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  locale: 'ja-JP',
});
const page = await context.newPage();
```

`deviceScaleFactor: 1` と `screenshot({ scale: 'css' })` でスクショ座標と boundingBox の座標を揃える。別の倍率で撮る場合は実画像サイズから換算する。

## 保存と撮影を一続きにする

以下は形の例。locator・HTTP method・URL・期待値は実装と表示から確認して置き換える。入力欄の存在だけでなく値を、スイッチなら `aria-checked` を待つ。再読込直後は要素が先に描画され、値は後から入ることがある。

```js
// 保存前に応答待ちを登録する。URLやmethodは対象アプリに合わせる。
const saved = page.waitForResponse((response) =>
  response.request().method() === 'PATCH' &&
  new URL(response.url()).pathname === savePath
);
const button = page.getByRole('button', { name: '保存', exact: true });
const box = await button.boundingBox();
const click = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
await button.click();
const response = await saved;
if (!response.ok()) throw new Error(`保存失敗: ${response.status()}`);
await page.getByRole('status').filter({ hasText: '保存しました' }).waitFor();
// expect(locator).toHaveValue(...) / toHaveAttribute(...) 等でもよい。
await page.waitForFunction(({ selector, expected }) =>
  document.querySelector(selector)?.value === expected,
  { selector: inputSelector, expected: newValue }
);
await page.screenshot({ path: 'frames/03-saved.png', scale: 'css', animations: 'disabled' });
```

結果を静止画で見せるときは `animations: 'disabled'` で有限のCSSアニメーションを終点へ進める。スイッチの論理値が変わっても、描画途中では逆の状態に見える場合がある。動きそのものを検証する場面は無効化せず、動画として撮る。

再試行は前の成功通知が消え、初期状態へ戻ったことを確認してから撮り直す。スクショの文字を加工して結果を作らない。

## 診断とログ

撮影開始前にイベントを登録し、`console` の error、`pageerror`、`requestfailed`、`response` のHTTP 4xx/5xxを記録する。リクエストヘッダー・認証トークン・パスワードは保存しない。URLに秘密が含まれるアプリでは保存先をpathnameなどに限定する。

シナリオごとに画像名、操作、座標、入力したテスト値、応答status、再読込後の値を残す。ページ遷移による `ERR_ABORTED` と保存失敗を混同しない。撮影に使った context / browser は作業後に閉じる。
