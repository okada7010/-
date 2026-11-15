import streamlit as st
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
from openpyxl.drawing.image import Image as XLImage
from PIL import Image as PILImage, ImageOps
from streamlit_paste_button import paste_image_button
import io
import os

st.set_page_config(page_title="社用車 点検アプリ", page_icon="🚗", layout="centered")
st.title("🚗 社用車 点検アプリ")

# =====================================================================
# 点検項目（★点検表を受領したら、ここを差し替えてください）
#   カテゴリ名: [点検項目, ...]
# =====================================================================
CHECK_ITEMS = {
    "ブレーキ": [
        "ブレーキペダルの踏みしろ・効き",
        "ブレーキ液の量",
        "駐車ブレーキの引きしろ",
    ],
    "タイヤ": [
        "空気圧",
        "亀裂・損傷",
        "溝の深さ",
    ],
    "エンジンルーム": [
        "エンジンオイルの量",
        "冷却水の量",
        "バッテリー液の量",
        "ウォッシャー液の量",
    ],
    "灯火類・その他": [
        "ライト・ウインカー等の点灯・点滅",
        "ワイパーの拭き取り状態",
        "エンジンのかかり具合・異音",
    ],
}
RESULT_CHOICES = ["良", "否", "－"]  # 良＝異常なし／否＝異常あり／－＝該当なし

# 車両一覧（★実際の社用車に合わせて変更してください）
VEHICLES = ["（直接入力）", "社用車1号", "社用車2号", "社用車3号"]

PHOTO_PARTS = ["前", "後", "左側面", "右側面", "車内", "メーター", "その他"]

# 写真（貼り付け分）は再描画で消えないように session_state に保持
if "pasted_photos" not in st.session_state:
    st.session_state.pasted_photos = []  # [{"img": PIL.Image, "part": str, "memo": str}]
if "paste_count" not in st.session_state:
    st.session_state.paste_count = 0

# ---------------------------------------------------------------------
# 基本情報
# ---------------------------------------------------------------------
st.subheader("基本情報")
col1, col2 = st.columns(2)
with col1:
    vehicle_sel = st.selectbox("車両", VEHICLES)
    if vehicle_sel == "（直接入力）":
        vehicle = st.text_input("車両名 例：プロボックス")
    else:
        vehicle = vehicle_sel
    plate_no = st.text_input("登録番号 例：品川 500 あ 12-34")
with col2:
    date_val = st.date_input("点検日 ※カレンダーより選択")
    inspector = st.text_input("点検者 ※苗字のみ")
    mileage = st.number_input("走行距離（km）", min_value=0, step=1, value=0)

# ---------------------------------------------------------------------
# 点検項目
# ---------------------------------------------------------------------
st.subheader("点検項目")
st.caption("良＝異常なし ／ 否＝異常あり ／ －＝該当なし")

results = {}  # (カテゴリ, 項目) -> {"result": 良/否/－, "note": str}
for cat, items in CHECK_ITEMS.items():
    with st.expander(cat, expanded=True):
        for item in items:
            key = f"{cat}_{item}"
            r = st.radio(item, RESULT_CHOICES, horizontal=True, key=f"r_{key}")
            note = ""
            if r == "否":
                note = st.text_input("　└ 異常内容", key=f"n_{key}")
            results[(cat, item)] = {"result": r, "note": note}

ng_count = sum(1 for v in results.values() if v["result"] == "否")
if ng_count:
    st.warning(f"⚠ 異常（否）が {ng_count} 件あります。管理者へ報告してください。")

# ---------------------------------------------------------------------
# 車両の状態記録（写真）
# ---------------------------------------------------------------------
st.subheader("車両の状態記録")
condition = st.text_area("車両の状態・気づいた点（キズ、凹み、汚れ など）")

# スマホ：カメラ／アルバムからそのまま添付（PCでもファイル選択・ドラッグ＆ドロップ可）
st.markdown("**📷 写真を添付（スマホ：撮影／アルバムから選択）**")
uploaded = st.file_uploader(
    "写真を選択", type=["png", "jpg", "jpeg", "webp"],
    accept_multiple_files=True, label_visibility="collapsed",
)

# PC：クリップボードの画像を貼り付け
st.markdown("**📋 写真を貼り付け（PC：画像をコピーしてからボタンを押す）**")
paste_result = paste_image_button(
    "📋 クリップボードから貼り付け",
    key=f"paste_{st.session_state.paste_count}",
)
if paste_result.image_data is not None:
    st.session_state.pasted_photos.append(
        {"img": paste_result.image_data.convert("RGB"), "part": PHOTO_PARTS[0], "memo": ""}
    )
    # ボタンのキーを変えて、同じ画像が二重登録されないようにする
    st.session_state.paste_count += 1
    st.rerun()


def open_image(file):
    img = PILImage.open(file)
    img = ImageOps.exif_transpose(img)  # スマホ写真の向きを補正
    return img.convert("RGB")


# 添付写真の一覧（部位・コメント入力）
photos = []  # [{"img", "part", "memo"}]
if uploaded:
    for i, f in enumerate(uploaded):
        try:
            img = open_image(f)
        except Exception:
            st.error(f"{f.name} を読み込めませんでした。")
            continue
        c1, c2 = st.columns([1, 2])
        with c1:
            st.image(img, use_container_width=True)
        with c2:
            part = st.selectbox("部位", PHOTO_PARTS, key=f"up_part_{i}_{f.name}")
            memo = st.text_input("コメント", key=f"up_memo_{i}_{f.name}")
        photos.append({"img": img, "part": part, "memo": memo})

for i, p in enumerate(st.session_state.pasted_photos):
    c1, c2 = st.columns([1, 2])
    with c1:
        st.image(p["img"], use_container_width=True)
    with c2:
        p["part"] = st.selectbox(
            "部位", PHOTO_PARTS, index=PHOTO_PARTS.index(p["part"]), key=f"ps_part_{i}"
        )
        p["memo"] = st.text_input("コメント", value=p["memo"], key=f"ps_memo_{i}")
        if st.button("🗑 削除", key=f"ps_del_{i}"):
            st.session_state.pasted_photos.pop(i)
            st.rerun()
    photos.append(p)

if photos:
    st.caption(f"写真 {len(photos)} 枚")

# ---------------------------------------------------------------------
# Excel 出力
#   ★点検表テンプレート受領後は、既存の報告書アプリと同様に
#     openpyxl.load_workbook(テンプレート) ＋ セル番地指定 に差し替える
# ---------------------------------------------------------------------
thin = Side(style="thin", color="000000")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
HEAD_FILL = PatternFill("solid", fgColor="D9E1F2")
NG_FILL = PatternFill("solid", fgColor="F8CBAD")


def put(ws, cell, value, bold=False, fill=None, wrap=True):
    c = ws[cell]
    c.value = value
    c.border = BORDER
    c.alignment = Alignment(vertical="center", wrap_text=wrap)
    if bold:
        c.font = Font(bold=True)
    if fill:
        c.fill = fill


def build_excel():
    wb = openpyxl.Workbook()

    # --- シート1：点検表 ---
    ws = wb.active
    ws.title = "点検表"
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 8
    ws.column_dimensions["D"].width = 34

    ws["A1"] = "社用車 点検表"
    ws["A1"].font = Font(bold=True, size=16)

    info = [
        ("点検日", date_val.strftime("%Y年%m月%d日")),
        ("車両", vehicle),
        ("登録番号", plate_no),
        ("走行距離", f"{mileage:,} km"),
        ("点検者", inspector),
    ]
    row = 3
    for label, val in info:
        put(ws, f"A{row}", label, bold=True, fill=HEAD_FILL)
        ws.merge_cells(f"B{row}:D{row}")
        put(ws, f"B{row}", val)
        row += 1

    row += 1
    for col, h in zip("ABCD", ["区分", "点検項目", "結果", "異常内容"]):
        put(ws, f"{col}{row}", h, bold=True, fill=HEAD_FILL)
    row += 1
    for (cat, item), v in results.items():
        fill = NG_FILL if v["result"] == "否" else None
        put(ws, f"A{row}", cat)
        put(ws, f"B{row}", item)
        put(ws, f"C{row}", v["result"], fill=fill)
        ws[f"C{row}"].alignment = Alignment(horizontal="center", vertical="center")
        put(ws, f"D{row}", v["note"])
        row += 1

    row += 1
    put(ws, f"A{row}", "車両の状態", bold=True, fill=HEAD_FILL)
    ws.merge_cells(f"B{row}:D{row}")
    put(ws, f"B{row}", condition)
    ws.row_dimensions[row].height = max(30, 15 * (condition.count("\n") + 1))

    # --- シート2：写真 ---
    if photos:
        wp = wb.create_sheet("写真")
        wp.column_dimensions["A"].width = 45
        wp.column_dimensions["B"].width = 45
        wp["A1"] = "車両の状態 写真"
        wp["A1"].font = Font(bold=True, size=14)
        tmp_files = []
        for idx, p in enumerate(photos):
            col = "A" if idx % 2 == 0 else "B"
            base = 3 + (idx // 2) * 18  # 写真1枚あたり約18行
            put(wp, f"{col}{base}", f"No.{idx + 1}　{p['part']}　{p['memo']}")
            img = p["img"].copy()
            img.thumbnail((310, 310))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            buf.seek(0)
            tmp_files.append(buf)
            wp.add_image(XLImage(buf), f"{col}{base + 1}")

    out = io.BytesIO()
    wb.save(out)
    return out


st.divider()
if st.button("Excelを作成", type="primary"):
    if not vehicle or not inspector:
        st.error("車両と点検者を入力してください。")
    else:
        out = build_excel()
        fname = f"{date_val.strftime('%Y%m%d')}_{vehicle}_点検表.xlsx"
        st.download_button("📥 ダウンロード", out.getvalue(), fname)
