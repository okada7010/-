# 動くデスクトップ（Lively Wallpaper 版） v8

[Lively Wallpaper](https://www.rocksdanister.com/lively/)（無料・Microsoft Store から入手可）で動くライブ壁紙です。
左に PC の状態、右に Claude の使用状況を大きく表示します。

![画面](screenshot.png)

## ダウンロード
**[MovingDesktop_Lively_v8.zip](MovingDesktop_Lively_v8.zip)** を開き、右上の「Download raw file」（↓ボタン）で保存します。
ZIP には、このフォルダのファイルが全部入っています。

## 表示する内容
| 場所 | 内容 |
|---|---|
| 背景 | 黒い宇宙にまたたく星と、アリス風の女の子のドット絵（オリジナル）。CPU負荷が上がると速く歩き、キラキラが増える |
| 左の列（PC） | 時計・日付、CPU／メモリ／ネットのゲージ、60秒グラフ、GPU使用率 |
| 右の列（Claude） | 5時間枠・週間枠の使用率（大きな円ゲージ、70%で黄・90%で赤、リセットまでの時間）、追加利用、Claude Code の日別トークン（このPC・7日）と今日・7日合計 |

## 導入手順
1. ZIP を PC の任意のフォルダ（例：`C:\Tools\動くデスクトップ_Lively`）に展開します。
2. Lively を起動し、左上の「＋」から**同じ ZIP** を追加して、ライブラリの「動くデスクトップ」をクリックします。
3. 展開したフォルダの `ai_usage_check.bat` で、Claude の値が取れるか確認します。
4. `ai_usage_start.bat` で集計プログラムを常駐させます（毎回自動で動かす場合は `ai_usage_autostart_on.bat`）。

旧版から入れ替えるときは、Lively のライブラリで旧版を削除してから ZIP を追加します。集計プログラムは新しい壁紙フォルダを自動で探すので、起動し直す必要はありません。

## ファイル
| ファイル | 内容 |
|---|---|
| `index.html` | 壁紙本体 |
| `LivelyInfo.json` | Lively 用の設定（CPU などのシステム情報の受け取りを有効化） |
| `ai_usage_collector.py` | Claude の使用量の集計プログラム（Python 標準ライブラリのみ） |
| `ai_usage_start.bat` / `ai_usage_stop.bat` | 集計プログラムの常駐起動／終了 |
| `ai_usage_check.bat` | 1回だけ集計して内容を表示（動作確認用） |
| `ai_usage_autostart_on.bat` / `ai_usage_autostart_off.bat` | Windows 起動時の自動起動を登録／解除 |

## Claude の値について
- **利用枠（5時間・週間・追加利用）**：claude.ai と Claude Code を合わせた全体の使用率です。PC の Claude Code のログイン情報で Anthropic に問い合わせます（Claude Code の `/usage` と同じ情報源）。公開仕様ではないため、将来取れなくなる可能性があります。ログイン情報はファイルに書き出しません。
- **日別トークン**：このPCの Claude Code のログ（`%USERPROFILE%\.claude\projects\`）から集計します。claude.ai のチャットや、ほかのPCでの利用は含みません。

## カスタマイズ
`index.html` 冒頭の `CFG` を書き換えます。
| 項目 | 内容 |
|---|---|
| `layout` | `"claude"`（左＝PC・右＝Claude、標準）／ `"wide"`（Claude と Gemini CLI を並べて表示）／ `"tall"`（縦長1列） |
| `theme` | `"pixel"`（ドット絵の女の子、標準）／ `"network"`（粒と線） |
| `panelScale` / `fontScale` | パネルの大きさ（標準0.9）／小さい文字の拡大率（標準1.2） |
| `panelMarginX` / `panelMarginY` | 画面の端・上からの距離（デスクトップのアイコンを避ける） |
| `fps` / `particles` | 描画の上限（標準30）／背景の粒の数。下げるほど軽い |
