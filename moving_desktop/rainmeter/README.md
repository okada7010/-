# Claude Monitor（Rainmeter 版）

[Rainmeter](https://www.rainmeter.net/)（無料）で動く、軽いデスクトップパネルです。
Lively 版のようにブラウザを動かさないので、メモリは数十MB程度、CPU もほとんど使いません。
アリス風の女の子（オリジナルのドット絵）が歩くキャラスキンも付いています。

![キャラのプレビュー](alice_preview.gif)

## 表示する内容
| 場所 | 内容 |
|---|---|
| 上 | 時計・日付 |
| PC | CPU・メモリ・GPU の円ゲージ、メモリ使用量、VRAM 使用量、ネット受信・送信速度、CPU・メモリ・GPU のグラフ |
| Claude | 5時間枠・週間枠の大きな円ゲージ（70%で黄・90%で赤）とリセットまでの時間、追加利用、Claude Code の日別トークン（このPC・7日）、今日・7日合計 |
| キャラ（別スキン） | 女の子が横に歩いて往復し、後ろにキラキラを残す。CPU 負荷で歩く速さが上がり、ときどき立ち止まる |

## ダウンロード
**[ClaudeMonitor_v1.4.rmskin](ClaudeMonitor_v1.4.rmskin)** を開き、右上の「↓（Download raw file）」で保存します。

## 導入手順
1. Rainmeter を https://www.rainmeter.net/ からインストールします（初回のみ）。最初に出てくるサンプルのスキンは、右クリック →「スキンを閉じる」で消して構いません。
2. ダウンロードした **`ClaudeMonitor_v1.4.rmskin` をダブルクリック** →「Install」を押します。パネルと、歩くキャラがデスクトップに表示されます。
3. Claude の値を出すため、パネルを**右クリック →「カスタムスキンアクション」→「集計プログラムを開始」**を選びます（Python が必要。1分以内に表示されます）。
   - うまく出ないときは、同じメニューの「取得テスト」で内容を確認できます。
   - PC 起動時に自動で集計したい場合は、`ドキュメント\Rainmeter\Skins\ClaudeMonitor\@Resources\ai_usage_autostart_on.bat` を1回実行します。
4. パネルもキャラも、ドラッグで好きな位置に動かせます（キャラは歩いている帯のどこかをドラッグ）。右クリック →「設定」で、最背面に固定（「位置」→「デスクトップ上」）や透明度の変更ができます。
5. キャラを消したり出したりするときは、パネルを右クリック →「カスタムスキンアクション」→「キャラ（アリス）の表示／非表示」。
   歩くはばや速さは、キャラを右クリック →「歩くはばを変える」で開く設定の `Range`（はば）・`SpeedBase` / `SpeedCpu`（速さ）・`PauseChance`（立ち止まりやすさ）で変えられます。

## 更新するとき
1. パネルを右クリック →「カスタムスキンアクション」→「集計プログラムを停止」。
2. 新しい `.rmskin` をダブルクリック →「Install」。
3. もう一度「集計プログラムを開始」。

「Unable to move to ...@Backup\ClaudeMonitor」と出てインストールできないときは、集計プログラムが止まっていません。手順1をやり直すか、タスクマネージャーで「Python」（pythonw.exe）を終了してから、もう一度インストールしてください（v1.3 以降は起きにくくなっています）。

## Lively 版を使っていた場合
Lively はアンインストールするか、壁紙を元に戻してください。Lively 版で常駐させた集計プログラムは `ai_usage_stop.bat` で止め、スタートアップ登録していた場合は `ai_usage_autostart_off.bat` で解除してから、Rainmeter 版の @Resources のもので登録し直してください。

## 仕組み
- CPU・メモリ・ネットは Rainmeter が直接測ります。GPU は Windows のパフォーマンスカウンター（全 GPU の 3D エンジン使用率）を読みます。
- Claude の値は `@Resources\ai_usage_collector.py` が1分ごとに集計して `@Resources\claude.txt` に書き出し、スキンが30秒ごとに読み込みます。
- Claude の利用枠の問い合わせは10分に1回です。Lively 版と Rainmeter 版の集計プログラムが両方動いていても、結果を共有して問い合わせは1か所にまとめます（`%LOCALAPPDATA%\ClaudeMonitor\limits_cache.json`）。
- 「Anthropic の回数制限中」（HTTP 429）と出たときは、15分→30分→60分と間隔をあけて再取得し、その間は前回取れた値を表示します。
- 集計プログラムは同じフォルダで二重に起動しません（「開始」を何回押しても1つだけ動きます）。取得元の説明は [Lively 版の README](../README.md#claude-の値について) と同じです。

## 作り直すとき（開発用）
スキンは日本語を含むため UTF-16 で保存する必要があります。ini を直接編集せず、`tools/build_skin.py`（パネル）・`tools/build_alice.py`（キャラ）・`tools/make_sprites.py`（ドット絵）を直して `python tools/package.py .` を実行すると、ini と `.rmskin` が作り直されます（ドット絵の生成に Pillow が必要）。
