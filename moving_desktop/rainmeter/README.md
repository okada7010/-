# Claude Monitor（Rainmeter 版）

[Rainmeter](https://www.rainmeter.net/)（無料）で動く、軽いデスクトップパネルです。
Lively 版のようにブラウザを動かさないので、メモリは数十MB程度、CPU もほとんど使いません（背景アニメはありません）。

## 表示する内容
| 場所 | 内容 |
|---|---|
| 上 | 時計・日付 |
| PC | CPU・メモリの円ゲージ、メモリ使用量、ネット受信・送信速度、CPU・メモリのグラフ |
| Claude | 5時間枠・週間枠の大きな円ゲージ（70%で黄・90%で赤）とリセットまでの時間、追加利用、Claude Code の日別トークン（このPC・7日）、今日・7日合計 |

## ダウンロード
**[ClaudeMonitor_v1.0.rmskin](ClaudeMonitor_v1.0.rmskin)** を開き、右上の「↓（Download raw file）」で保存します。

## 導入手順
1. Rainmeter を https://www.rainmeter.net/ からインストールします（初回のみ）。最初に出てくるサンプルのスキンは、右クリック →「スキンを閉じる」で消して構いません。
2. ダウンロードした **`ClaudeMonitor_v1.0.rmskin` をダブルクリック** →「Install」を押します。パネルがデスクトップに表示されます。
3. Claude の値を出すため、パネルを**右クリック →「カスタムスキンアクション」→「集計プログラムを開始」**を選びます（Python が必要。1分以内に表示されます）。
   - うまく出ないときは、同じメニューの「取得テスト」で内容を確認できます。
   - PC 起動時に自動で集計したい場合は、`ドキュメント\Rainmeter\Skins\ClaudeMonitor\@Resources\ai_usage_autostart_on.bat` を1回実行します。
4. パネルはドラッグで好きな位置に動かせます。右クリック →「設定」で、最背面に固定（「位置」→「デスクトップ上」）や透明度の変更ができます。

## Lively 版を使っていた場合
Lively はアンインストールするか、壁紙を元に戻してください。Lively 版で常駐させた集計プログラムは `ai_usage_stop.bat` で止め、スタートアップ登録していた場合は `ai_usage_autostart_off.bat` で解除してから、Rainmeter 版の @Resources のもので登録し直してください。

## 仕組み
- CPU・メモリ・ネットは Rainmeter が直接測ります。
- Claude の値は `@Resources\ai_usage_collector.py` が1分ごとに集計して `@Resources\claude.txt` に書き出し、スキンが30秒ごとに読み込みます。取得元の説明は [Lively 版の README](../README.md#claude-の値について) と同じです。

## 作り直すとき（開発用）
スキンは日本語を含むため UTF-16 で保存する必要があります。`ClaudeMonitor.ini` を直接編集せず、`tools/build_skin.py` を直して `python tools/package.py .` を実行すると、ini と `.rmskin` が作り直されます。
