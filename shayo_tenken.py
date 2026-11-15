import streamlit as st
import openpyxl
from openpyxl.styles import Alignment, Font
from openpyxl.drawing.image import Image as XLImage
from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.utils import column_index_from_string
from openpyxl.utils.units import pixels_to_EMU
from PIL import Image as PILImage, ImageOps, ImageDraw, ImageFont
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

TEMPLATE = "template_shayo.xlsx"

st.set_page_config(page_title="車両点検表", page_icon="🚗", layout="centered")
st.title("🚗 車両点検表 入力アプリ")

# =====================================================================
# 車両マスタ（★ナンバー・担当者は実際の内容に変更してください）
# =====================================================================
VEHICLES = {
    "ハイエース　1号": {"納入": date(2002, 2, 1), "ナンバー": "", "担当": ""},
    "ハイエース　2号": {"納入": date(2005, 4, 1), "ナンバー": "", "担当": ""},
    "キャラバン": {"納入": date(2010, 5, 1), "ナンバー": "", "担当": ""},
    "ノート": {"納入": date(2015, 8, 1), "ナンバー": "", "担当": ""},
    "サクシード": {"納入": date(2015, 9, 1), "ナンバー": "", "担当": ""},
    "Labo号": {"納入": date(2015, 10, 1), "ナンバー": "", "担当": ""},
}

# =====================================================================
# 点検項目（テンプレート template_shayo.xlsx の行番号と対応）
#   (区分, 項目, 結果セル, 点検のポイント)
# =====================================================================
CHECK_ITEMS = [
    ("ブレーキ", "ブレーキペダルの遊び、ブレーキの効きが十分か", "W10",
     "ペダルをいっぱいに踏み込んだとき、床板とのすき間（踏み残りしろ）や踏みごたえが適当か。走行してブレーキが十分効くか。"),
    ("ブレーキ", "ブレーキ液が適量か", "W11",
     "リザーバ・タンクの液量が MAX〜MIN の間にあるか。減りが早いときはブレーキ系統からの液漏れが考えられるので整備工場へ。"),
    ("ブレーキ", "サイドブレーキの引きしろ、効きが十分か", "W12",
     "いっぱいに引いたとき（踏んだとき）、引きしろ（踏みしろ）が多すぎたり少なすぎたりしないか。"),
    ("ブレーキ", "ブレーキ、ハイマウントブレーキランプは点灯するか", "W13",
     "ブレーキを踏んで点灯するか、レンズに汚れや損傷がないか（後方で人に見てもらうか、壁への反射で確認）。"),
    ("エンジン", "エンジンがかかるか、また異音はないか", "W14",
     "スムーズにかかるか、かかり具合や異音がないか。暖機後のアイドリングが安定しているか。"),
    ("エンジン", "エンジンオイルが適量で濁っていないか", "W15",
     "平らな場所でエンジン停止後、レベルゲージを抜いて拭き取り、差し込み直して H〜L の間にあるか確認。汚れがひどい場合は交換。"),
    ("エンジン", "冷却水が適量か", "W16",
     "ラジエータ・リザーバ・タンクの液量が FULL〜LOW の間にあるか。著しく減る場合は水漏れの疑い。"),
    ("エンジン", "ファンベルトの張りは適切か", "W17",
     "ベルトの中央を指で押してたわみ量が適当か。（エンジン停止状態で確認）"),
    ("エンジン", "ファンベルトに損傷はないか", "W18",
     "ベルトに亀裂・ひび割れ・ほつれがないか。"),
    ("タイヤ", "空気圧が適切か", "W19",
     "接地部のたわみ具合を確認。エアゲージがあれば指定空気圧（運転席ドア付近のラベル）と比較。"),
    ("タイヤ", "亀裂や損傷がないか", "W20",
     "タイヤ全周に亀裂・損傷がないか。釘・石などの異物が刺さったり、かみ込んだりしていないか。"),
    ("タイヤ", "溝に摩耗がないか", "W21",
     "溝の深さが十分か。スリップサインが出ていたら使用不可（残り溝 1.6mm）。偏摩耗がないか。"),
    ("タイヤ", "ホイールの取り付け状態が適切か", "W22",
     "ホイールナットの緩み・脱落がないか。"),
    ("バッテリー", "バッテリー液量は適量か", "W23",
     "液量が UPPER〜LOWER の間にあるか（側面の目盛りで確認）。メンテナンスフリー型はインジケーターで確認。"),
    ("ヘッドライト", "ヘッドライト、車幅灯は点灯するか", "W24",
     "スイッチを入れて点灯するか。"),
    ("ヘッドライト", "損傷はないか", "W25",
     "レンズに汚れ・割れ・損傷がないか。"),
    ("方向指示器", "不良なく点滅するか", "W26",
     "左右・前後とも正常に点滅するか（点滅が速い場合は球切れの可能性）。"),
    ("方向指示器", "損傷はないか", "W27",
     "レンズに汚れ・割れ・損傷がないか。"),
    ("ワイパー", "払拭状態が適切か", "W28",
     "ウォッシャー液を噴射してワイパーを作動させ、拭きムラやビビりがないか。"),
    ("ワイパー", "ウィンドウォッシャー液が適量か", "W29",
     "タンクの液量が十分か。不足時は専用液を補充（冬季は濃度に注意）。"),
    ("ワイパー", "ウィンドウォッシャー液の噴射状態に不良はないか", "W30",
     "噴射の向き・高さが適当か。"),
    ("車内関係", "ルームランプは正常に点灯するか", "W31", ""),
    ("車内関係", "発煙筒は設置されているか", "W32", "有効期限も確認してください（下の欄に入力）。"),
    ("車内関係", "三角停止板が車載されているか", "W33", ""),
    ("車内関係", "車載道具は整理されているか", "W34", ""),
    ("車内関係", "廃材やゴミは車内に残っていないか", "W35", ""),
    ("ボディ", "車体に汚れがあるか（汚れがあれば洗車機利用）", "AW4",
     "汚れがなければ「〇」、汚れがあれば「×」にして洗車してください。"),
    ("ボディ", "車体に損傷があるか", "AW5",
     "キズ・凹みがなければ「〇」。あれば「×」にして、下の「車両の状態記録」に写真を添付してください。"),
]
MARKS = ["〇", "×", "－"]  # 〇＝良好／×＝不良／－＝該当なし

PHOTO_PARTS = ["前", "後", "左側面", "右側面", "車内", "エンジンルーム", "タイヤ", "メーター", "その他"]
MAX_PHOTOS_ON_SHEET = 4  # 点検表の「写真」欄に貼る枚数（残りは「写真一覧」シートへ）

# ---------------------------------------------------------------------
# session_state 初期化
# ---------------------------------------------------------------------
ss = st.session_state
ss.setdefault("pasted_photos", [])  # [{"img": PIL.Image, "part": str, "memo": str}]
ss.setdefault("paste_count", 0)


def set_all_ok():
    for i in range(len(CHECK_ITEMS)):
        ss[f"chk_{i}"] = "〇"


def clear_all():
    for i in range(len(CHECK_ITEMS)):
        ss[f"chk_{i}"] = None


# ---------------------------------------------------------------------
# 基本情報
# ---------------------------------------------------------------------
st.subheader("① 基本情報")
vehicle = st.selectbox("車種", list(VEHICLES.keys()))
vinfo = VEHICLES[vehicle]
today = date.today()
years = today.year - vinfo["納入"].year - ((today.month, today.day) < (vinfo["納入"].month, vinfo["納入"].day))
st.caption(f"納入：{vinfo['納入'].strftime('%Y年%m月')}　／　経過年数：{years}年")

col1, col2 = st.columns(2)
with col1:
    plate_no = st.text_input("ナンバー 例：千葉 わ 99-99", value=vinfo["ナンバー"], key=f"plate_{vehicle}")
    tantou = st.text_input("車輌担当者 ※苗字のみ", value=vinfo["担当"], key=f"tantou_{vehicle}")
with col2:
    date_val = st.date_input("点検日 ※カレンダーより選択", value=today)
    inspector = st.text_input("点検実施者 ※苗字のみ")

with st.expander("⚠ 点検前の注意"):
    st.markdown(
        "- 平らで安全な場所に停め、エンジンを止めてから点検してください。\n"
        "- エンジン停止直後はエンジンルームが高温です。やけどに注意してください。\n"
        "- ハイブリッド車・EV車のオレンジ色の高電圧ケーブル・部品には触れないでください。\n"
        "- 異常があれば運転せず、車輌担当者・管理者へ報告してください。"
    )

# ---------------------------------------------------------------------
# 点検項目
# ---------------------------------------------------------------------
st.subheader("② 点検項目")
st.caption("〇＝良好　×＝不良　－＝該当なし　　（各項目の ⓘ で点検のポイントを表示）")
b1, b2 = st.columns(2)
b1.button("✅ すべて〇にする", on_click=set_all_ok, width="stretch")
b2.button("↩ 入力をクリア", on_click=clear_all, width="stretch")

notes = {}
current_cat = None
for i, (cat, item, cell, tip) in enumerate(CHECK_ITEMS):
    if cat != current_cat:
        st.markdown(f"**■ {cat}**")
        current_cat = cat
    st.radio(item, MARKS, index=None, horizontal=True, key=f"chk_{i}", help=tip or None)
    if ss.get(f"chk_{i}") == "×":
        notes[i] = st.text_input("　└ 不良の内容", key=f"note_{i}", placeholder="例：右前タイヤの空気圧不足")
    if item.startswith("発煙筒"):
        hatsuen_kigen = st.text_input("　└ 発煙筒の有効期限 例：2028年3月", key="hatsuen")

results = [ss.get(f"chk_{i}") for i in range(len(CHECK_ITEMS))]
unanswered = [CHECK_ITEMS[i][1] for i, r in enumerate(results) if r is None]
ng_items = [i for i, r in enumerate(results) if r == "×"]

if unanswered:
    st.info(f"未入力：{len(unanswered)} 項目")
else:
    st.success("全項目入力済み")
if ng_items:
    st.warning(f"⚠ 不良（×）が {len(ng_items)} 件あります。車輌担当者・管理者へ報告してください。")

# ---------------------------------------------------------------------
# 車両の状態記録（写真）
# ---------------------------------------------------------------------
st.subheader("③ 車両の状態記録（写真）")

st.markdown("**📷 写真を添付**（スマホ：撮影／アルバムから選択、PC：ファイル選択・ドラッグ＆ドロップ）")
uploaded = st.file_uploader(
    "写真を選択", type=["png", "jpg", "jpeg", "webp", "heic", "heif"],
    accept_multiple_files=True, label_visibility="collapsed",
)

st.markdown("**📋 写真を貼り付け**（PC：画像をコピーしてからボタンを押す）")
paste_result = paste_image_button(
    "📋 クリップボードから貼り付け", key=f"paste_{ss.paste_count}",
)
if paste_result.image_data is not None:
    ss.pasted_photos.append(
        {"img": paste_result.image_data.convert("RGB"), "part": PHOTO_PARTS[0], "memo": ""}
    )
    ss.paste_count += 1  # 同じ画像が二重登録されないようにボタンを作り直す
    st.rerun()


def open_image(file):
    img = PILImage.open(file)
    img = ImageOps.exif_transpose(img)  # スマホ写真の向きを補正
    img = img.convert("RGB")
    img.thumbnail((1600, 1600))  # 大きすぎる写真は縮小
    return img


photos = []  # [{"img", "part", "memo"}]
for i, f in enumerate(uploaded or []):
    try:
        img = open_image(f)
    except Exception:
        st.error(f"{f.name} を読み込めませんでした。JPEG で保存し直してください。")
        continue
    photos.append({"img": img, "part": None, "memo": None, "key": f"up_{i}_{f.name}"})
for i, p in enumerate(ss.pasted_photos):
    photos.append({"img": p["img"], "part": p["part"], "memo": p["memo"], "key": f"ps_{i}", "pasted": i})

for n, p in enumerate(photos, start=1):
    c1, c2 = st.columns([1, 2])
    with c1:
        st.image(p["img"], caption=f"No.{n}", width="stretch")
    with c2:
        idx = PHOTO_PARTS.index(p["part"]) if p["part"] in PHOTO_PARTS else 0
        p["part"] = st.selectbox("部位", PHOTO_PARTS, index=idx, key=f"part_{p['key']}")
        p["memo"] = st.text_input("コメント", value=p["memo"] or "", key=f"memo_{p['key']}",
                                  placeholder="例：左リアドアに擦りキズ")
        if "pasted" in p:
            ss.pasted_photos[p["pasted"]]["part"] = p["part"]
            ss.pasted_photos[p["pasted"]]["memo"] = p["memo"]
            if st.button("🗑 削除", key=f"del_{p['key']}"):
                ss.pasted_photos.pop(p["pasted"])
                st.rerun()

if photos:
    st.caption(f"写真 {len(photos)} 枚（点検表の写真欄に {min(len(photos), MAX_PHOTOS_ON_SHEET)} 枚、全写真は「写真一覧」シートに出力）")

# ---------------------------------------------------------------------
# 備考
# ---------------------------------------------------------------------
st.subheader("④ 備考")
remarks = st.text_area("備考（気づいた点など）")


# =====================================================================
# Excel 出力（テンプレートへ転記）
# =====================================================================
def write_cell(ws, cell_name, value, wrap=False, size=None, horizontal=None):
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
        horizontal=horizontal or al.horizontal,
        vertical=al.vertical or "center",
        wrap_text=wrap or al.wrap_text,
        text_rotation=al.text_rotation,
    )
    if size:
        f = cell.font
        cell.font = Font(name=f.name, size=size, bold=f.bold, color=f.color)


def label_image(img, text):
    """写真の左上に番号を入れる"""
    img = img.copy()
    d = ImageDraw.Draw(img)
    fs = max(16, img.width // 12)
    try:
        font = ImageFont.load_default(size=fs)
    except TypeError:
        font = ImageFont.load_default()
    box = d.textbbox((0, 0), text, font=font)
    pad = fs // 4
    d.rectangle([0, 0, box[2] + pad * 2, box[3] + pad * 2], fill=(255, 255, 255))
    d.text((pad, pad), text, fill=(200, 0, 0), font=font)
    return img


def place_image(ws, img, col, row, max_w, max_h, off_x=6, off_y=6):
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
    wb = openpyxl.load_workbook(TEMPLATE)
    ws = wb.active

    # 基本情報
    write_cell(ws, "M3", f"点検日：{date_val.strftime('%Y年%m月%d日')}")
    write_cell(ws, "F4", vehicle)
    write_cell(ws, "F5", plate_no)
    write_cell(ws, "F6", tantou)
    write_cell(ws, "F7", inspector)

    # 点検結果
    for i, (cat, item, cell, tip) in enumerate(CHECK_ITEMS):
        write_cell(ws, cell, results[i] or "", horizontal="center")
    if hatsuen_kigen:
        write_cell(ws, "D32", f"発煙筒は設置されているか　（期限：{hatsuen_kigen}）")

    # 写真欄（AD18:AY32）に 2×2 で配置
    slots = [("AD", 18), ("AO", 18), ("AD", 26), ("AO", 26)]
    for n, p in enumerate(photos[:MAX_PHOTOS_ON_SHEET]):
        col, row = slots[n]
        place_image(ws, label_image(p["img"], f"No.{n + 1}"), col, row, 280, 220)

    # 備考欄（AD33:AY35）：不良内容＋写真コメント＋備考
    lines = []
    for i in ng_items:
        lines.append(f"【不良】{CHECK_ITEMS[i][1]}：{notes.get(i) or '（内容未記入）'}")
    photo_notes = [f"No.{n} {p['part']} {p['memo']}" for n, p in enumerate(photos, start=1) if p["memo"]]
    if photo_notes:
        lines.append("【写真】" + "／".join(photo_notes))
    if remarks:
        lines.append(remarks)
    if lines:
        if "AD33:AY35" not in [str(r) for r in ws.merged_cells.ranges]:
            ws.merge_cells("AD33:AY35")
        write_cell(ws, "AD33", "\n".join(lines), wrap=True, size=8, horizontal="left")
        ws["AD33"].alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)

    # 写真一覧シート（全写真＋部位・コメント）
    if photos:
        wp = wb.create_sheet("写真一覧")
        wp.column_dimensions["A"].width = 48
        wp.column_dimensions["B"].width = 48
        wp["A1"] = f"車両の状態 写真一覧　{vehicle}　{date_val.strftime('%Y年%m月%d日')}"
        wp["A1"].font = Font(bold=True, size=14)
        for idx, p in enumerate(photos):
            col = "A" if idx % 2 == 0 else "B"
            base = 3 + (idx // 2) * 17
            wp[f"{col}{base}"] = f"No.{idx + 1}　{p['part']}　{p['memo'] or ''}"
            wp[f"{col}{base}"].alignment = Alignment(wrap_text=True, vertical="center")
            place_image(wp, p["img"], col, base + 1, 330, 300, 4, 4)
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
        errors.append("点検実施者を入力してください。")
    if unanswered:
        errors.append(f"未入力の項目が {len(unanswered)} 件あります：" + "、".join(unanswered[:5])
                      + ("…" if len(unanswered) > 5 else ""))
    if not os.path.exists(TEMPLATE):
        errors.append(f"テンプレート {TEMPLATE} が見つかりません。")
    if errors:
        for e in errors:
            st.error(e)
    else:
        with st.spinner("点検表を作成しています…（PDF 変換に数十秒かかることがあります）"):
            xlsx = build_excel().getvalue()
            pdf = excel_to_pdf(xlsx)
        base = f"{date_val.strftime('%Y%m%d')}_{vehicle.replace('　', '')}_車両点検表"
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
