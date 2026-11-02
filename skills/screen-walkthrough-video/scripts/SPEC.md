# 画面操作動画の編集仕様（Remotion）

画面操作の確認動画を Remotion で編集して書き出す。エージェントは素材（スクショ・操作ログ・図・
素のクリップ）と台本 JSON を用意するだけで、見やすい編集済み動画が出る。Claude Code / Codex の
どちらが撮った素材でも同じ見た目になる。

## 置き場所とセットアップ

- `scripts/` に独立した Remotion プロジェクトを置く（独自の package.json と lockfile）。
  ルート・frontend の workspace には入れない。インストールは `pnpm install --ignore-workspace --config.strict-dep-builds=false`。
- Remotion 4 系、React 18/19、TypeScript。Node 18 で動くこと。
- 書き出しコマンド（エージェントはこれだけ叩く）:

```bash
node scripts/render.mjs <storyboard.json> <out.mp4>
```

  - 書き出しは直列で実行する。Remotion 4.0.242 のローカル配信ポートは別プロセス間の競合を避けられず、並列 CLI は未対応。
  - 依存が未インストールなら自動で `pnpm install --ignore-workspace --config.strict-dep-builds=false` してから書き出す。
  - storyboard 内の相対パスは storyboard.json のあるディレクトリ基準で解決する（Remotion の
    public dir へのコピー or staticFile 相当で読めるようにする。素材のディレクトリを汚さない）。
  - 出力: H.264 / yuv420p / 1280x720（台本の `size` で変更可）/ 30fps / faststart / 読み上げがなければ音声なし（あれば AAC）。
- 検査: `node scripts/inspect.mjs <out.mp4> <inspection-dir>`。ffprobe の形式・尺と全編デコードを検査し、確認用 PNG と `inspection.json` を出力する。機能の合否は元画面・操作ログと目視で判断する。
- 型検査: `cd scripts && node node_modules/typescript/bin/tsc --noEmit`。テスト: 同ディレクトリで `node --test *.test.mjs`。
- 作業用プレビュー: `pnpm --config.verify-deps-before-run=false --dir scripts exec remotion studio src/index.tsx`（任意）。上記の依存導入後に実行し、pnpm 11 の自動再 install を避ける。

## 台本 storyboard.json

```json
{
  "size": [1280, 720],
  "title": "@ でデータベースをメンションする",
  "subtitle": "チャット入力欄",
  "options": [
    { "id": "own", "label": "自分のものだけ" },
    { "id": "all", "label": "共有も含める", "recommended": true }
  ],
  "checks": [
    "@ を打つと、共有されたデータベースも候補に出る",
    "選ぶとチップになり、入力欄の高さが崩れない"
  ],
  "scenes": [
    { "type": "title" },
    {
      "type": "shot",
      "image": "frames/mention/01.png",
      "caption": "入力欄に @ を打つ",
      "cursor": { "from": [900, 650], "to": [420, 680] },
      "click": [420, 680],
      "zoom": { "center": [420, 600], "scale": 1.8 },
      "hold": 1.6
    },
    { "type": "shot", "image": "frames/mention/02.png", "caption": "候補にデータベースが並ぶ", "highlight": [300, 420, 560, 640], "check": 1, "hold": 2.2 },
    { "type": "clip", "src": "raw/mention-anim.mp4", "trim": [0.4, 2.2], "caption": "選ぶとチップになる", "speed": 1.0 },
    { "type": "diagram", "svg": "media/scope.svg", "caption": "候補の出どころ", "reveal": ["#own", "#shared"], "option": "all", "hold": 3 },
    { "type": "end", "results": ["ok", "ok"] }
  ]
}
```

座標はすべて**その画像のピクセル座標**（スクショの実サイズ基準）。画像が出力サイズと違えば
contain で収め、座標も同じ比率で変換する。

### シーンの種類

| type | 内容 | 既定の長さ |
|------|------|-----------|
| `title` | タイトル + サブタイトル。白（ダーク時は濃色）背景にシンプルな文字だけ | 読字量から算出 |
| `changes` | 「前回からの変更」の見出しの下に、`items`（what を本文、why を小さく薄く）を 1 件ずつフェードインする | 読字量から算出（項目も同じ累積時刻で表示） |
| `context` | 旧形式。`changes` の 1 件（what = response、why = request）として表示する | 同上 |
| `shot` | スクショ 1 枚。以下を任意で重ねる | 読字量から算出 |
| `clip` | 素の動画（GIF/webm/mp4 可）。`trim` で切り出し、`speed` で速度変更 | 読字量と切り出し長 / speed の大きい方 |
| `diagram` | SVG 図。`reveal` に CSS セレクタを並べると、その順に要素がフェードインする | 読字量から算出 |
| `end` | 期待結果を 1 行。`result` が `ok` なら控えめなチェック、`ng` なら控えめな注意表示 | 1.5 + 0.5 ×（checks + options の件数）秒 |

文字数は `[...str].length`。読む速さは 1 秒あたり、字幕 10 文字・見るところのラベル 15 文字・changes の what 14 文字・why 28 文字で見積もる（理由は報告にも同じ文を書くため、動画では目で追えれば足りる）。shot / clip / diagram は `1 + 字幕/10` 秒、check / option の初回参照時だけ `ラベル/15` 秒を足し最低 2.6 秒。title は `1.2 + (title・subtitle)/10` 秒。changes は `0.6 + Σ(0.5 + what/14 + why/28)` 秒で各項目を累積表示する。
`hold` は算出時間の下限。トップレベルの `pace`（既定1.0、0.5〜2.0の数値のみ）は各シーンの時間を倍率調整する（大きいほど遅い）。字幕の最低読了時間とモーション・クリック後0.8秒以上の静止時間を確保する。

### コメントへの対応

- 台本トップレベルの `changes: [{ what, why }]` は、最初の title シーンの直後に 1 つの changes シーンとして入る。トップレベルの `context`（旧形式）も changes に読み替えて同じシーンに加える。人の発言をそのまま貼らず、自分の言葉で書く。
- 以下は旧形式の説明。明示的なシーン: `{ "type": "context", "request": "人の元コメント", "response": "変更した内容" }`。任意の `hold` で長さを指定できる。
- 台本トップレベルにも `context` を指定できる。同じ `{request, response}` またはその配列を受け付け、最初の title シーンの直後に順番どおり context シーンを挿入する。title がない台本では先頭に挿入する。明示的な context シーンはその位置を維持する。
- `request` と `response` は文字列。request は人のコメントの原文を改変せず、改行・空白を保持して引用として表示する。response は対応内容を 1〜2 行で書く。HTML として解釈しない。
- 背景は白、左に細い縦線を添え、箱では囲まない。「対応」と response は 0.6 秒後から 0.3 秒でフェードインする。
- 挿入後の全シーンから共通のタイムラインを計算し、動画の長さと `<out>.checks.json` の checks / options の開始秒を更新する。入力の scenes 配列は変更しない。

```json
"context": [
  { "request": "共有されたものも候補に出してほしい。\n所有者も見たい。", "response": "共有された候補を追加し、所有者を表示しました。" }
]
```

`shot` の重ね:
- `cursor`: macOS 風の矢印カーソルが `from` → `to` へイージング移動（0.8 秒）。`from` 省略時は前シーンの最終位置。
- `click`: カーソル到着後、その位置に波紋（アクセント色、0.4 秒）。
- `zoom`: `center` に向けてなめらかに拡大（0.9 秒）、シーン終わりで戻す。直後のシーンも同じ zoom なら戻さず維持。
- `highlight`: `[x1, y1, x2, y2]` の矩形以外を少し暗くし、矩形に細い枠。
- `caption`: 画面下中央の字幕（半透明の黒帯、白文字、日本語フォントは Hiragino Sans / Noto Sans JP にフォールバック）。前後のシーンで字幕が同じなら出し直さない。
- `overlays.type`: `{ "at": [x, y], "text": "売上" }` で、その位置にタイピング風に文字が出る（スクショが入力前の状態のときに使う）。

シーン間は 0.4 秒のクロスフェード。全体の長さは 20 秒程度を目安にし、超えても止めない。

## 何を確認すべきかを明示する（最重要）

見る人が「何を見ればいいか」を考えなくて済むようにする。

- `checks`: このシナリオで見てほしいことを 1〜3 個。各項目は「〜が〜になる」の形で、目で見て判定できる文にする。
- **冒頭で一覧にしない。** 何の画面か見る前に「見るところは 3 つ」と並べても伝わらないため、title シーンにはタイトルとサブタイトルだけを出す。台本は title シーンを省いて、いきなり具体的な画面（shot）から始めてよい（動画を渡すメッセージにタイトルを書く）。
- 見るところは、その場面で右上のラベルとして初めて出し、読み上げもその場面で「ここで見るのは 1 つ目、〜」と読む。
- `shot` / `clip` / `diagram` の `check: <番号>`: そのシーンの間、画面右上に「② 選ぶとチップになり…」の
  ラベルを出し、`highlight` があればその枠をアクセント色にする。字幕とは別の位置に出す。
- `end` シーン: checks を ①②③ で並べ直し、`results`（`ok` / `ng` / `unsure`、checks と同じ順）に応じて
  控えめなチェック / 注意 / ？ を添える。`results` 省略時は印なしで並べるだけ。
- 書き出し時に、動画と同じ場所に `<out>.checks.json` を出力する:
  `{ "duration": 14.2, "checks": [ { "n": 1, "text": "...", "at": 3.4, "result": "ok" } ], "options": [ { "id": "all", "label": "共有も含める", "at": 8.2 } ] }`
  `at` はその check が最初に出てくるシーンの開始秒。報告で「① は 3.4 秒から」のように場面を指すのに使う。

## 選択肢の比較動画

- 任意の `options: [{ "id": "own", "label": "自分のものだけ", "recommended": false }]` を台本に指定できる。
  `id` は空でない一意の文字列、`label` は空でない文字列、`recommended` は省略可能な真偽値。checks と共存できる。
- 任意の種類のシーンに `option: "<id>"` を付けられる。台本の options に存在しない ID は書き出し前にエラーにする。
  シーン中、check と同じ右上・同じ見た目で「A 自分のものだけ」を表示する。文字は options の順に A/B/C…。
  推奨には小さく「推奨」を添える。check もある場合は両ラベルを縦に並べ、重ならないようにする。
- 選択肢も冒頭では並べない。その option の場面で右上のラベルとして初めて出し、読み上げは「A案、〜」から始める。
- end にも A/B/C の一覧を表示し、推奨に控えめなチェックを添える。options に `results` は不要。
  checks が共存する場合は既存の results の表示も維持する。
- `<out>.checks.json` は既存の duration / checks を維持し、常に `options` を出力する（未指定時は `[]`）。
  各項目は `{ "id", "label", "at" }`。`at` はその option を初めて指定したシーンの開始秒（クロスフェードを含む実際のタイムライン基準）。
  一度も参照されない option は `at` を持たない。

## 読み上げ（ナレーション）

読み上げサービスのキーがあるときだけ、場面ごとに読み上げを入れる。なければ今までどおり無音。

- キーは環境変数か `$WALKTHROUGH_VIDEO_HOME/.env`（`KEY=値` の行。読み上げ用のキーだけを取り込み、引用符は外す）から読む。環境変数が優先。
- サービスの選び方: 台本の `voice.provider`、なければ環境変数 `WALKTHROUGH_VIDEO_TTS`（旧名 `DECISION_BOARD_TTS` も可）、なければキーのあるものを `ELEVENLABS_API_KEY` → `GOOGLE_TTS_API_KEY` の順に選ぶ。`"voice": false` か `WALKTHROUGH_VIDEO_TTS=none` で無音にできる。`say`（macOS の読み上げ）は明示したときだけ使う（試験用）。
- 声: ElevenLabs は `voice.voice` か `ELEVENLABS_VOICE_ID`（既定は汎用の声）と `ELEVENLABS_MODEL`（既定 `eleven_v4`。v2.5・v3・v4 系には `language_code: ja` を付ける）。Google は `voice.voice` か `GOOGLE_TTS_VOICE`（既定 `ja-JP-Chirp3-HD-Charon`。Chirp 3 HD の日本語の声）、`voice.speed`（既定 1.1）。
- 読む文: 場面の `narration`（文字列で上書き、`false` で読まない）。省略時は、title はタイトルだけ、changes は what、shot / clip / diagram は字幕（直前と同じ字幕なら読まない）。見るところ・選択肢は、初めて出てくる場面で字幕に添えて読む。end は見るところの結果（または推奨）。
- 読み方: `$WALKTHROUGH_VIDEO_HOME/readings.txt` の「表記=読み」の行と、台本の `readings`（{ 表記: 読み }、台本が優先）で、読み上げに送る文だけを置き換える。長い表記から順に一度で置き換え、字幕は変えない。
- 長さ: 読み上げのある場面は、0.35 秒置いてから読み始め、読み終えて 0.45 秒置くまで延ばす（pace に関係なく）。
- 音声は `$WALKTHROUGH_VIDEO_HOME/tts-cache/` に、サービス・声・文ごとにキャッシュする。キーは環境変数から読むだけで、URL・ファイル・ログには書かない（ElevenLabs は `xi-api-key`、Google は `x-goog-api-key` ヘッダー）。
- 出力の音声は AAC。音量はサービスごとに違うので、書き出し時に聞きやすい大きさにそろえる。サイドカーには `narrated: true` を入れる。

## 素材の撮り方（スキル側で案内する内容。実装の参考）

- Claude Code（claude-in-chrome）: 各操作の直前・直後に `computer screenshot`（`save_to_disk: true`）。
  クリックした座標・入力した文字・操作の説明を自分で記録し、台本の `cursor` / `click` / `type` / `caption` に入れる。
  動きそのものを見せたい箇所（アニメーション・ローディング）だけ `gif_creator` で素のクリップを撮って `clip` にする。
- Codex（Browser Use）: 同じくステップごとにスクショを保存し、操作ログから台本を書く。

## サンプル

`scripts/example/` に、スクショ 3 枚（ffmpeg か SVG→PNG で作った架空の画面でよい）・
SVG 図 1 枚・短いクリップ 1 本を使い、全シーン種類を 1 回ずつ含む storyboard.json を置く。
`node scripts/render.mjs scripts/example/storyboard.json /tmp/walkthrough-video-example.mp4`
で書き出せること。

`example/storyboard-decide.json` は既存の架空スクリーンショットと SVG を使い、「今 → A → B → 推奨」を比較する台本。
options は `own` / `all`（推奨）、diagram と shot を含む。トップレベルの context の自動挿入例にもなっている。storyboard.json は明示的な context シーンを含む。次で書き出せる:

```bash
node scripts/render.mjs scripts/example/storyboard-decide.json /tmp/walkthrough-video-decide.mp4
```

## 見た目の原則

- 装飾を足さない。ロゴ・透かし・派手なトランジションなし。
- アクセント色は 1 色（`#2f7de1`）。カーソル・波紋・ハイライト枠だけに使う。
- 字幕は 1 行・短く。読む前に次へ進まないよう、字幕のあるシーンは最低 1.4 秒。
