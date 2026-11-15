# 動くデスクトップ（Lively Wallpaper 版）

[Lively Wallpaper](https://www.rocksdanister.com/lively/)（無料・Microsoft Store から入手可）で動かす版です。
Lively が壁紙の埋め込みを担当するので、Windows 11 の新しいバージョンでもデスクトップのアイコンの裏で正しく動きます。

## 表示する内容
- 背景：CPU負荷で速さと色（シアン→黄→赤）が変わるパーティクル
- 時計・日付
- CPU％ / メモリ％ / ネット受信速度のゲージ
- CPU・メモリ、ネット（↓受信 ↑送信）の60秒グラフ
- メモリ使用量、GPU使用率、CPU名・GPU名・ネットワークアダプター名

値は Lively の System Data API（`livelySystemInformation`）から約1秒ごとに受け取ります。
Lively 以外（ブラウザ）で `index.html` を開いた場合は、右上に「デモ表示」と出て、仮の値で動きます。

## 導入手順
1. Microsoft Store で「Lively Wallpaper」をインストールします。
2. Lively を起動し、左上の「＋」（壁紙を追加）を押します。
3. `動くデスクトップ_Lively.zip` を選びます（ウィンドウにドラッグ＆ドロップでも可）。
4. ライブラリに追加された「動くデスクトップ」をクリックすると、壁紙に設定されます。

## カスタマイズ
`index.html` 冒頭の `CFG`（粒の数・パネルの位置など）と `C`（色）を書き換えます。
Lively のライブラリで壁紙を右クリック →「ファイルの場所を開く」から編集できます。

## ファイル
| ファイル | 内容 |
|---|---|
| `index.html` | 壁紙本体 |
| `LivelyInfo.json` | Lively 用の設定。`"Arguments": "--system-information"` でシステム情報の受け取りを有効にしています |
