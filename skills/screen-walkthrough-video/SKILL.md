---
name: screen-walkthrough-video
description: 作った機能をブラウザで実際に操作し、操作ごとのスクショと操作ログから、見るところ ①②③ 付きの編集済み動画（Remotion、読み上げ任意）を書き出して人に渡す。人が自分で操作しなくても、何を見ればよいか迷わずに動作を確認できるようにする。「動画で確認したい」「画面を動画にして」「操作を撮って見せて」「動作確認の動画」と言われたとき、画面の変更を人に確認してもらうときに使う。
---

# screen-walkthrough-video

作った画面を自分で操作して撮り、**見るところ ①②③ が入った 20 秒前後の動画** にして渡す。録画をそのまま貼らない。操作ごとのスクショと操作ログを素材にし、台本（JSON）を書いて Remotion で編集・書き出す。

```
見るところを 1〜3 個決める
 ↓ ブラウザで操作し、操作ごとにスクショと操作ログを残す
 ↓ 台本を書いて書き出す（scripts/render.mjs）
 ↓ 自分で見て判定する（ok / ng / unsure）
渡す（aachat なら Project の media に置き、URL を送る）
```

書き出しの仕組みは `scripts/`（台本の全仕様は `scripts/SPEC.md`）。以下、`<skill>` はこのファイルのあるディレクトリを指す。

## 1. 見るところを決める

撮る前に、人に確認してほしいことを 1〜3 個書き出す。動画の軸になる。

- 「〜が〜になる」の形で、画面を見れば判定できる文にする（「正しく動く」は不可）
- 変更で壊れやすい所・人の好みが分かれる所を優先する。自明なものは入れない
- 1 シナリオ = 1 本。シナリオが複数あるなら動画を分ける

## 2. 撮る

アプリの起動・ログイン・操作権限は対象 repo の手順で確認する。既存の共有環境を初期化せず、試用には専用のテストデータを使う。

素材の置き場所は作業用ディレクトリ（例: `/tmp/walkthrough/<slug>/`）にする。完成前の素材を共有先に置かない。

- `frames/NN.png`: 操作の直前・直後のスクショ。ウィンドウは 1280x800 前後にそろえる
- 操作ログ: 対応する画像名、クリック座標・入力文字・操作の説明、保存の応答と再読込後の値。認証情報は記録しない。台本の `cursor` / `click` / `overlays.type` / `caption` に使う
- 動き（アニメーション・ローディング）を見せたい箇所だけ、短いクリップ（GIF / webm / mov）を撮る

ブラウザごとの撮り方:

- **Claude Code（claude-in-chrome）**: `tabs_context_mcp` → `tabs_create_mcp` で自分のタブを作り、`resize_window` で 1280x800。操作の前後で `computer screenshot`（`save_to_disk: true`）し、返ったパスを `frames/NN.png` にコピーする。動きは `gif_creator`（`export` は `download: true`）。使い終わったタブは閉じる
- **Codex（Browser Use）**: 利用できる場合はステップごとにスクショを `frames/NN.png` に保存し、操作ログを控える
- **Playwright MCP**: `browser_resize` で 1280x800、`browser_take_screenshot` を操作の前後に

Browser Use / Playwright MCP が無い環境では、対象 repo の Playwright で実ブラウザを操作してよい。依存の確認、状態待ち、撮影の例は [references/playwright.md](references/playwright.md)。画面や API 応答を mock に差し替えない。

スクショは要素が表示された時点で撮らず、期待する値・保存完了・アニメーションの終了を待って撮る。再試行では前回の成功通知を消してから始める。通知が短時間で消える場合は、クリック前に応答待ちを登録し、保存直後の撮影までを続けて実行する。

コンソールエラー、HTTP 4xx/5xx、通信失敗をシナリオごとに記録する。操作が原因の失敗を隠さない。自分のページ遷移で中断した通信など、シナリオ外の事象は理由を分けて残す。

## 3. 台本を書いて書き出す

```bash
node <skill>/scripts/render.mjs <work>/storyboard.json <work>/<slug>.mp4
# → <slug>.mp4 と <slug>.mp4.checks.json（見るところが何秒から出るか）ができる
```

初回は依存（Remotion）を自動で入れるため時間がかかる。ffmpeg / ffprobe が必要。複数本は1本ずつ書き出す。同梱の Remotion 4.0.242 は別プロセス間で配信ポートを取り合うことがあり、同時書き出しには対応していない。

```json
{
  "title": "@ でデータベースをメンションする",
  "checks": ["共有されたデータベースも候補に出る", "選ぶとチップになり、入力欄の高さが崩れない"],
  "scenes": [
    { "type": "shot", "image": "frames/01.png", "caption": "入力欄に @ を打つ", "click": [420, 680], "zoom": { "center": [420, 600], "scale": 1.8 } },
    { "type": "shot", "image": "frames/02.png", "caption": "候補が並ぶ", "highlight": [300, 420, 560, 640], "check": 1 },
    { "type": "shot", "image": "frames/03.png", "caption": "選ぶとチップになる", "highlight": [300, 640, 900, 700], "check": 2 },
    { "type": "end", "results": ["ok", "ok"] }
  ]
}
```

- パスは台本のあるディレクトリから見た相対パス。座標はスクショ画像のピクセル座標（CSS ピクセルではない）
- **頭から具体的な画面で始める。** 「見るところは 3 つ」と先に並べない。見るところは、その場面の右上ラベルで初めて出し、最後の `end` で並べ直す。`title` シーンは入れなくてよい
- シーンの長さは字幕の文字数から自動で決まる。全体をゆっくりにするなら台本直下に `"pace": 1.3`
- 直してもらった後の版では、台本直下に `changes: [{ "what": "<何をどう変えたか>", "why": "<受けた指摘を自分の言葉で 1 行>" }]` を書くと、冒頭に「前回からの変更」が入る。人の発言をそのまま貼らない
- 選択肢を比べる動画（今 → A → B → 推奨）は `options` と各シーンの `option` で作る（`scripts/SPEC.md`）
- 素の GIF / webm を単体で渡すときは `scripts/to-mp4.sh <in> <out.mp4>` を通す（H.264 / yuv420p でないと Safari で再生されない）

### 読み上げ

読み上げサービスのキーがあれば、書き出すだけで場面ごとに読み上げが入る。なければ無音。

- ElevenLabs: `ELEVENLABS_API_KEY`（声は `ELEVENLABS_VOICE_ID`）。Google: `GOOGLE_TTS_API_KEY`（声は `GOOGLE_TTS_VOICE`）。両方あれば ElevenLabs。無音にするなら `WALKTHROUGH_VIDEO_TTS=none`
- キーは環境変数か `~/.screen-walkthrough-video/.env`（`KEY=値` の行、権限 600）。この置き場所が無く `~/.decision-board/` があれば、そちらを読む。キーの値をチャットや台本に書かない
- 読み間違いは `~/.screen-walkthrough-video/readings.txt` に「表記=読み」を足す（台本ごとなら `"readings": { "表記": "読み" }`）。字幕の表記は変わらない
- 読み上げる文は外部のサービスに送られる。顧客名や個人情報を字幕に書かない

## 4. 自分で見て判定する

まず `results` を省略して初稿を書き出す。次の検査で全編をデコードし、形式・尺を確かめ、冒頭・各見るところ・末尾の確認画像を取り出す。

```bash
node <skill>/scripts/inspect.mjs <work>/<slug>.mp4 <work>/inspection
```

検査で作る `inspection.json` と PNG を開き、元のスクショ・操作ログに照らして、値、スイッチ、字幕、①②③、カーソルと強調位置を確かめる。動きが確認対象なら動画も再生する。検査スクリプトの成功は、機能が正しいという判定ではない。

書き出した動画の内容を確認して、見るところごとに `ok` / `ng` / `unsure` を決め、`end` シーンの `results` に入れて書き出し直す。`ng` / `unsure` は理由を 1 行で控える。シナリオに関係するコンソールエラーや通信失敗があれば `ng` にする。判定を入れて書き出し直した最終版も同じ検査と目視確認を行う。

判定が `ok` でないものを、黙って渡さない。直せるなら直して撮り直す。

## 5. 渡す

- **aachat の Session**: 完成した mp4 を Project の `media/<slug>.mp4` へ移す（作りかけを置かない。契約は `aachat/contracts/media.md`）。ready になったら `chat media <project> --q <slug>` で canonical URL を確かめ、メッセージに通常のリンクで書く。判断や承認が要るなら、その URL を添えて ask にする（`aachat/contracts/asks.md`）
- **それ以外**: mp4 のパスを渡す

渡すメッセージには、何の画面か 1 行・見るところと判定・`ng` / `unsure` の理由を書く。見るところが何秒から出るかは `.checks.json` の `at` で分かる（「① は 3.4 秒から」）。

直してと言われたら、そのシナリオだけ撮り直し、`changes` を書いて差し替える。

## 文言

字幕・見るところ・メッセージは、こなれた日本語で書く。

- 仕組みの説明を書かない。人が知りたいのは結果と判断材料だけ
- 内部の名前（ファイル名・関数名・自作の略語）を出さない
- 1 文を短く。体言止めと「〜する」の言い切りを使う

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| 初回の書き出しで依存の install が失敗する | `cd <skill>/scripts && rm -rf node_modules && pnpm install --ignore-workspace --config.strict-dep-builds=false` |
| 並列書き出しで `Visited ... but got no response` が出る | 他の書き出しの完了後に1本ずつ再実行する。途中の mp4 は納品せず、再出力と検査を行う |
| 台本の座標がずれる | 座標はスクショ画像のピクセル座標で書く |
| 動画が Safari で再生されない | `render.mjs` を通したか。素のクリップは `to-mp4.sh` を通す |
| `pnpm run` / `pnpm exec` が `ERR_PNPM_IGNORED_BUILDS` で止まる | 依存を上記の install で導入済みなら `--config.verify-deps-before-run=false` で自動再 install を避ける。型検査は `cd <skill>/scripts && node node_modules/typescript/bin/tsc --noEmit` でも実行できる |
| 読み上げが入らない | キーの名前と置き場所。`"voice": false` や `WALKTHROUGH_VIDEO_TTS=none` が残っていないか |
