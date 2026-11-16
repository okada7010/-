import streamlit as st
from copy import copy

import openpyxl
from openpyxl.styles import Alignment, Font
from openpyxl.drawing.image import Image as XLImage
from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.utils import column_index_from_string
from openpyxl.utils.units import pixels_to_EMU
from PIL import Image as PILImage, ImageOps
from streamlit_paste_button import paste_image_button
from datetime import date
import io
import os
import shutil
import subprocess
import tempfile

# iPhone の HEIC 写真にも対応（ライブラリがあれば）
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

TEMPLATE_DIR = "templates"
INSPECTORS_FILE = "inspectors.txt"

st.set_page_config(page_title="車両点検チェックシート", page_icon="🚗", layout="centered")
st.title("🚗 車両点検チェックシート")

# =====================================================================
# 車両マスタ（車両管理台帳より。★台帳が更新されたらここも更新してください）
#   納入：台帳の「購入日」／発煙筒：台帳の車両備品「発煙筒 有効期限」
# =====================================================================
VEHICLES = {
    "ハイエース　1号": {"ナンバー": "習志野 400 て 6162", "納入": date(2025, 9, 26),
                      "発煙筒": "2027年8月", "テンプレート": "tenken_hiace1.xlsx"},
    "ハイエース　2号": {"ナンバー": "習志野 400 て 6163", "納入": date(2025, 9, 26),
                      "発煙筒": "2027年8月", "テンプレート": "tenken_hiace2.xlsx"},
    "プロボックス": {"ナンバー": "習志野 400 て 6911", "納入": date(2026, 5, 22),
                   "発煙筒": "2029年12月", "テンプレート": "tenken_probox.xlsx"},
    "Labo号（フィット）": {"ナンバー": "習志野 502 て 58", "納入": date(2021, 12, 24),
                       "発煙筒": "2027年8月", "テンプレート": "tenken_labo.xlsx"},
    "キャラバン": {"ナンバー": "習志野 400 て 4494", "納入": date(2024, 12, 1),
                 "発煙筒": "2027年8月", "テンプレート": "tenken_caravan.xlsx"},
    "バネット": {"ナンバー": "習志野 400 て 5427", "納入": date(2025, 1, 1),
               "発煙筒": "", "テンプレート": "tenken_vanette.xlsx"},
}

# =====================================================================
# 点検項目（テンプレートの行番号と対応。結果は O 列に書き込む）
#   (点検箇所, 項目, 細目, 行, 種類, 良好の値, 点検のポイント)
#   種類 "判定"＝〇△×、"有無"＝有／無
# =====================================================================
JUDGE = ["〇", "△", "×"]
UMU = ["有", "無"]
CHECK_ITEMS = [
    ("エンジンルーム", "ウィンドウォッシャー液量の確認", "", 10, "判定", "〇",
     "タンクの液量が十分か。不足時は専用液を補充。"),
    ("エンジンルーム", "ブレーキ液量の確認", "", 11, "判定", "〇",
     "リザーバ・タンクの液量が MAX〜MIN の間にあるか。減りが早いときは液漏れの疑い。"),
    ("エンジンルーム", "バッテリー液量の確認", "", 12, "判定", "〇",
     "液量が UPPER〜LOWER の間にあるか。メンテナンスフリー型はインジケーターで確認。"),
    ("エンジンルーム", "冷却水量の確認", "", 13, "判定", "〇",
     "リザーバ・タンクの液量が FULL〜LOW の間にあるか。"),
    ("エンジンルーム", "エンジンオイルの状態確認", "オイル量の確認", 14, "判定", "〇",
     "レベルゲージを抜いて拭き取り、差し込み直して H〜L の間にあるか。"),
    ("エンジンルーム", "エンジンオイルの状態確認", "オイルの色", 15, "判定", "〇",
     "汚れ・濁りがひどくないか。"),
    ("車両外観・周囲", "タイヤの空気圧", "", 16, "判定", "〇",
     "接地部のたわみ具合を確認。指定空気圧は運転席ドア付近のラベルを参照。"),
    ("車両外観・周囲", "タイヤの状態の確認", "亀裂", 17, "有無", "無",
     "タイヤ全周に亀裂がないか。"),
    ("車両外観・周囲", "タイヤの状態の確認", "損傷", 18, "有無", "無",
     "損傷や、釘・石などの異物の刺さり・かみ込みがないか。"),
    ("車両外観・周囲", "スペアタイヤの有無", "", 19, "有無", "有", ""),
    ("車両外観・周囲", "タイヤ溝の摩耗状況の確認", "", 20, "判定", "〇",
     "溝の深さが十分か。スリップサインが出ていたら使用不可。"),
    ("車両外観・周囲", "ホイール取り付け状態の確認", "", 21, "判定", "〇",
     "ホイールナットの緩み・脱落がないか。"),
    ("車両外観・周囲", "ランプ類（ランプ、指示灯）の状況確認", "点灯", 22, "判定", "〇",
     "ヘッドライト・車幅灯・ブレーキランプ・方向指示器が点灯・点滅するか。"),
    ("車両外観・周囲", "ランプ類（ランプ、指示灯）の状況確認", "割れ", 23, "有無", "無", ""),
    ("車両外観・周囲", "ランプ類（ランプ、指示灯）の状況確認", "破損", 24, "有無", "無", ""),
    ("社用車内", "ブレーキペダルの遊びが適切か", "", 25, "判定", "〇",
     "いっぱいに踏み込んだとき、床板とのすき間や踏みごたえが適当か。"),
    ("社用車内", "ブレーキの効きの確認", "", 26, "判定", "〇", "走行してブレーキが十分効くか。"),
    ("社用車内", "パーキング（サイド）ブレーキ", "引きしろ", 27, "判定", "〇",
     "引きしろ（踏みしろ）が多すぎたり少なすぎたりしないか。"),
    ("社用車内", "パーキング（サイド）ブレーキ", "効き", 28, "判定", "〇", ""),
    ("社用車内", "エンジンの状態確認", "かかり具合", 29, "判定", "〇",
     "スムーズにかかるか。暖機後のアイドリングが安定しているか。"),
    ("社用車内", "エンジンの状態確認", "異音", 30, "有無", "無", ""),
    ("社用車内", "ワイパーの払拭状態の確認", "", 31, "判定", "〇", "拭きムラやビビりがないか。"),
    ("社用車内", "ウィンドウォッシャー液の噴射状態の確認", "", 32, "判定", "〇",
     "噴射の向き・高さが適当か。"),
    ("社用車内", "車載物の確認", "発煙筒（有効期限の確認）", 33, "有無", "有",
     "発煙筒が設置され、有効期限が切れていないことを確認したら「有」。"),
    ("社用車内", "車載物の確認", "車検証", 34, "有無", "有", ""),
    ("社用車内", "車載物の確認", "自賠責保険証", 35, "有無", "有", ""),
    ("社用車内", "整理整頓の確認", "", 36, "判定", "〇", ""),
    ("社用車内", "清掃状況の確認", "", 37, "判定", "〇", ""),
]
RESULT_COL = "O"

MAX_PHOTO_COLS = 2


def load_inspectors():
    """点検実施者の一覧（inspectors.txt に1行1名）"""
    try:
        with open(INSPECTORS_FILE, encoding="utf-8") as f:
            return [line.strip() for line in f if line.strip() and not line.startswith("#")]
    except OSError:
        return []


def elapsed(start, today):
    months = (today.year - start.year) * 12 + (today.month - start.month) - (today.day < start.day)
    months = max(months, 0)
    return months // 12, months % 12


# ---------------------------------------------------------------------
# session_state 初期化
# ---------------------------------------------------------------------
ss = st.session_state
ss.setdefault("pasted_photos", [])  # [{"img": PIL.Image, "memo": str}]
ss.setdefault("paste_count", 0)


def set_all_ok():
    for i, item in enumerate(CHECK_ITEMS):
        ss[f"chk_{i}"] = item[5]


def clear_all():
    for i in range(len(CHECK_ITEMS)):
        ss[f"chk_{i}"] = None


# ---------------------------------------------------------------------
# 基本情報
# ---------------------------------------------------------------------
st.subheader("① 基本情報")
vehicle = st.selectbox("車両名称", list(VEHICLES.keys()))
vinfo = VEHICLES[vehicle]
today = date.today()
ey, em = elapsed(vinfo["納入"], today)
nonyu_text = f"{vinfo['納入'].year}年{vinfo['納入'].month}月"
keika_text = f"{ey}年{em}か月" if em else f"{ey}年"

with st.container(border=True):
    st.markdown(
        f"**ナンバー**：{vinfo['ナンバー']}　　\n"
        f"**納入年**：{nonyu_text}　　\n"
        f"**経過年数**：{keika_text}"
    )
    st.caption(f"発煙筒の期限（車両管理台帳）：{vinfo['発煙筒'] or '未登録'}")

col1, col2 = st.columns(2)
with col1:
    inspectors = load_inspectors()
    if inspectors:
        inspector = st.selectbox("点検実施者", inspectors, index=None, placeholder="選択してください")
    else:
        st.warning("点検実施者の一覧（inspectors.txt）が未登録です。")
        inspector = st.text_input("点検実施者")
    alcohol = st.text_input("アルコールチェッカー 期限", placeholder="例：2026年12月")
with col2:
    date_val = st.date_input("実施日", value=today)

with st.expander("⚠ 点検前の注意"):
    st.markdown(
        "- 平らで安全な場所に停め、エンジンを止めてから点検してください。\n"
        "- エンジン停止直後はエンジンルームが高温です。やけどに注意してください。\n"
        "- 異常があれば運転せず、車両担当者・管理者へ報告してください。"
    )

# ---------------------------------------------------------------------
# 点検項目
# ---------------------------------------------------------------------
st.subheader("② 点検項目")
st.caption("判定：〇＝良好　△＝要注意　×＝不良　　（各項目の ⓘ で点検のポイントを表示）")
b1, b2 = st.columns(2)
b1.button("✅ すべて良好にする", on_click=set_all_ok, width="stretch")
b2.button("↩ 入力をクリア", on_click=clear_all, width="stretch")

current_cat = None
for i, (cat, item, sub, row, kind, good, tip) in enumerate(CHECK_ITEMS):
    if cat != current_cat:
        st.markdown(f"**■ {cat}**")
        current_cat = cat
    label = f"{item}　―　{sub}" if sub else item
    st.radio(label, JUDGE if kind == "判定" else UMU, index=None, horizontal=True,
             key=f"chk_{i}", help=tip or None)

results = [ss.get(f"chk_{i}") for i in range(len(CHECK_ITEMS))]
unanswered = [i for i, r in enumerate(results) if r is None]
ng_items = [i for i, r in enumerate(results) if r is not None and r != CHECK_ITEMS[i][5]]


def item_label(i):
    _, item, sub, *_ = CHECK_ITEMS[i]
    return f"{item}（{sub}）" if sub else item


if unanswered:
    st.info(f"未入力：{len(unanswered)} 項目")
else:
    st.success("全項目入力済み")
if ng_items:
    st.warning("⚠ 良好でない項目があります。車両担当者・管理者へ報告してください。\n\n"
               + "\n".join(f"- {item_label(i)}：{results[i]}" for i in ng_items))

# ---------------------------------------------------------------------
# 写真
# ---------------------------------------------------------------------
st.subheader("③ 写真（任意）")
st.markdown("**📷 写真を添付**（スマホ：撮影／アルバムから選択、PC：ファイル選択・ドラッグ＆ドロップ）")
uploaded = st.file_uploader(
    "写真を選択", type=["png", "jpg", "jpeg", "webp", "heic", "heif"],
    accept_multiple_files=True, label_visibility="collapsed",
)

st.markdown("**📋 写真を貼り付け**（PC：画像をコピーしてからボタンを押す）")
paste_result = paste_image_button("📋 クリップボードから貼り付け", key=f"paste_{ss.paste_count}")
if paste_result.image_data is not None:
    ss.pasted_photos.append({"img": paste_result.image_data.convert("RGB"), "memo": ""})
    ss.paste_count += 1  # 同じ画像が二重登録されないようにボタンを作り直す
    st.rerun()


def open_image(file):
    img = PILImage.open(file)
    img = ImageOps.exif_transpose(img)  # スマホ写真の向きを補正
    img = img.convert("RGB")
    img.thumbnail((1600, 1600))  # 大きすぎる写真は縮小
    return img


photos = []  # [{"img", "memo", "key"}]
for i, f in enumerate(uploaded or []):
    try:
        img = open_image(f)
    except Exception:
        st.error(f"{f.name} を読み込めませんでした。JPEG で保存し直してください。")
        continue
    photos.append({"img": img, "memo": None, "key": f"up_{i}_{f.name}"})
for i, p in enumerate(ss.pasted_photos):
    photos.append({"img": p["img"], "memo": p["memo"], "key": f"ps_{i}", "pasted": i})

for n, p in enumerate(photos, start=1):
    pc1, pc2 = st.columns([1, 2])
    with pc1:
        st.image(p["img"], caption=f"No.{n}", width="stretch")
    with pc2:
        p["memo"] = st.text_input("コメント", value=p["memo"] or "", key=f"memo_{p['key']}",
                                  placeholder="例：左リアドアに擦りキズ")
        if "pasted" in p:
            ss.pasted_photos[p["pasted"]]["memo"] = p["memo"]
            if st.button("🗑 削除", key=f"del_{p['key']}"):
                ss.pasted_photos.pop(p["pasted"])
                st.rerun()

if photos:
    st.caption(f"写真 {len(photos)} 枚（「写真一覧」シートに出力）")

# ---------------------------------------------------------------------
# 備考
# ---------------------------------------------------------------------
st.subheader("④ 備考（任意）")
remarks = st.text_area("備考（気づいた点など）")


# =====================================================================
# Excel 出力（車両別テンプレートへ転記）
# =====================================================================
def write_cell(ws, cell_name, value, horizontal=None, vertical=None, wrap=None):
    cell = ws[cell_name]
    # 結合セルなら左上のセルに書き込む
    if isinstance(cell, openpyxl.cell.cell.MergedCell):
        for merged_range in ws.merged_cells.ranges:
            if cell.coordinate in merged_range:
                cell = merged_range.start_cell
                break
    cell.value = value
    al = cell.alignment
    cell.alignment = Alignment(
        horizontal=horizontal or al.horizontal or "center",
        vertical=vertical or al.vertical or "center",
        wrap_text=al.wrap_text if wrap is None else wrap,
        text_rotation=al.text_rotation,
    )


def place_image(ws, img, col, row, max_w, max_h, off_x=4, off_y=4):
    """セル (col, row) から少しずらして、max_w×max_h(px) に収まるように画像を貼る"""
    img = img.copy()
    img.thumbnail((max_w, max_h))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    buf.seek(0)
    xl = XLImage(buf)
    xl.width, xl.height = img.width, img.height
    marker = AnchorMarker(col=column_index_from_string(col) - 1, colOff=pixels_to_EMU(off_x),
                          row=row - 1, rowOff=pixels_to_EMU(off_y))
    xl.anchor = OneCellAnchor(_from=marker, ext=XDRPositiveSize2D(pixels_to_EMU(img.width), pixels_to_EMU(img.height)))
    ws.add_image(xl)


def build_excel():
    wb = openpyxl.load_workbook(os.path.join(TEMPLATE_DIR, vinfo["テンプレート"]))
    ws = wb.worksheets[0]

    # 印刷設定：A4縦、1ページ目＝点検項目、2ページ目＝車両展開図・備考 に収める
    # 印刷範囲を2つに分けて、2ページ目の見出し（38行目）から必ず改ページさせる
    ws.print_area = "A1:Q37,A38:Q73"
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 2

    # 基本情報
    write_cell(ws, "D3", vehicle.replace("（フィット）", ""))
    write_cell(ws, "M3", vinfo["ナンバー"])
    write_cell(ws, "D4", nonyu_text)
    write_cell(ws, "M4", keika_text)
    # 一部の旧シート（プロボックス・バネット）は納入年・経過年数欄に斜線が引かれているので消す
    for row in ws.iter_rows(min_row=4, max_row=4):
        for c in row:
            if c.border.diagonalDown or c.border.diagonalUp:
                b = copy(c.border)
                b.diagonalDown = False
                b.diagonalUp = False
                c.border = b
    write_cell(ws, "D5", vinfo["発煙筒"] or "年　　月")
    write_cell(ws, "M5", alcohol or "年　　月")
    write_cell(ws, "D7", inspector or "")
    write_cell(ws, "M7", date_val.strftime("%Y年%m月%d日"))

    # 点検結果
    for i, (cat, item, sub, row, kind, good, tip) in enumerate(CHECK_ITEMS):
        write_cell(ws, f"{RESULT_COL}{row}", results[i] or "", horizontal="center")
    write_cell(ws, "I33", "発煙筒（有効期限の確認）")
    write_cell(ws, "C29", "エンジンの状態確認", horizontal="left")
    write_cell(ws, "L16", "")  # 旧様式の記入欄「基準：」は使わない

    # 備考欄（A68:Q73）：良好でない項目＋写真コメント＋備考
    lines = []
    if ng_items:
        lines.append("【要確認】" + "／".join(f"{item_label(i)}：{results[i]}" for i in ng_items))
    photo_notes = [f"No.{n} {p['memo']}" for n, p in enumerate(photos, start=1) if p["memo"]]
    if photo_notes:
        lines.append("【写真】" + "／".join(photo_notes))
    if remarks:
        lines.append(remarks)
    if lines:
        write_cell(ws, "A68", "\n".join(lines), horizontal="left", vertical="top", wrap=True)

    # 写真一覧シート（全写真＋コメント）
    if photos:
        wp = wb.create_sheet("写真一覧")
        wp.column_dimensions["A"].width = 48
        wp.column_dimensions["B"].width = 48
        wp["A1"] = f"写真一覧　{vehicle}　{date_val.strftime('%Y年%m月%d日')}"
        wp["A1"].font = Font(bold=True, size=14)
        for idx, p in enumerate(photos):
            col = "A" if idx % MAX_PHOTO_COLS == 0 else "B"
            base = 3 + (idx // MAX_PHOTO_COLS) * 17
            wp[f"{col}{base}"] = f"No.{idx + 1}　{p['memo'] or ''}"
            wp[f"{col}{base}"].alignment = Alignment(wrap_text=True, vertical="center")
            place_image(wp, p["img"], col, base + 1, 330, 300)
        wp.page_setup.orientation = "portrait"
        wp.page_setup.paperSize = 9
        wp.sheet_properties.pageSetUpPr.fitToPage = True
        wp.page_setup.fitToWidth = 1
        wp.page_setup.fitToHeight = 0

    out = io.BytesIO()
    wb.save(out)
    return out


# =====================================================================
# PDF 出力（LibreOffice で Excel を変換）
# =====================================================================
def find_soffice():
    for name in ("soffice", "libreoffice"):
        path = shutil.which(name)
        if path:
            return path
    for path in (r"C:\Program Files\LibreOffice\program\soffice.exe",
                 r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"):
        if os.path.exists(path):
            return path
    return None


def excel_to_pdf(xlsx_bytes):
    """Excel のバイト列を PDF に変換する。変換できなければ None を返す"""
    soffice = find_soffice()
    if not soffice:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "tenken.xlsx")
        with open(src, "wb") as f:
            f.write(xlsx_bytes)
        # 同時実行でぶつからないよう、変換ごとに専用のプロファイルを使う
        profile = "file:///" + os.path.join(tmp, "profile").replace("\\", "/").lstrip("/")
        try:
            subprocess.run(
                [soffice, f"-env:UserInstallation={profile}", "--headless",
                 "--convert-to", "pdf", "--outdir", tmp, src],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180, check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        pdf = os.path.join(tmp, "tenken.pdf")
        if not os.path.exists(pdf):
            return None
        with open(pdf, "rb") as f:
            return f.read()


st.divider()
if st.button("📄 点検表（Excel・PDF）を作成", type="primary", width="stretch"):
    ss.pop("outputs", None)
    errors = []
    if not inspector:
        errors.append("点検実施者を選択してください。")
    if unanswered:
        names = [item_label(i) for i in unanswered]
        errors.append(f"未入力の項目が {len(names)} 件あります：" + "、".join(names[:5])
                      + ("…" if len(names) > 5 else ""))
    template_path = os.path.join(TEMPLATE_DIR, vinfo["テンプレート"])
    if not os.path.exists(template_path):
        errors.append(f"テンプレート {template_path} が見つかりません。")
    if errors:
        for e in errors:
            st.error(e)
    else:
        with st.spinner("点検表を作成しています…（PDF 変換に数十秒かかることがあります）"):
            xlsx = build_excel().getvalue()
            pdf = excel_to_pdf(xlsx)
        base = f"{date_val.strftime('%Y%m%d')}_{vehicle.replace('　', '')}_車両点検チェックシート"
        # ダウンロードで画面が再描画されても両方のボタンが残るよう保存しておく
        ss.outputs = {"base": base, "xlsx": xlsx, "pdf": pdf}

if "outputs" in ss:
    o = ss.outputs
    st.caption("入力内容を変更した場合は、もう一度「作成」を押してください。")
    d1, d2 = st.columns(2)
    d1.download_button(
        "📥 Excel をダウンロード", o["xlsx"], f"{o['base']}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        width="stretch", key="dl_xlsx",
    )
    if o["pdf"]:
        d2.download_button(
            "📥 PDF をダウンロード", o["pdf"], f"{o['base']}.pdf",
            mime="application/pdf", width="stretch", key="dl_pdf",
        )
    else:
        d2.warning("PDF を作成できませんでした（変換ツールが見つかりません）。Excel をご利用ください。")
