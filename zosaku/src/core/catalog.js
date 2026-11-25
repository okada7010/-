// 材料と部材ライブラリ。寸法は mm。よく使う呼び寸法の目安で、製品の実寸は仕入先で確認すること。

export const MATS = {
  wood:      { name: '木材（杉・桧など）', color: 0xd9b382 },
  spf:       { name: 'SPF（2×材）',        color: 0xe6cf9e },
  plywood:   { name: '合板',               color: 0xc9a66b },
  lumbercore:{ name: 'ランバーコア',       color: 0xdcc39a },
  laminated: { name: '集成材',             color: 0xcf9f62 },
  gypsum:    { name: '石膏ボード',         color: 0xe9e7e0 },
  keical:    { name: 'ケイカル板',         color: 0xd6dadc },
  lgs:       { name: '軽量鉄骨（LGS）',    color: 0xa9b4bd },
  steel:     { name: '鋼材',               color: 0x7d8a96 },
  concrete:  { name: 'コンクリート',       color: 0xb9bbb8 },
  wall:      { name: '壁（仕上げ）',       color: 0xf1ede4 },
  floor:     { name: '床',                 color: 0xc8b08a },
  ceiling:   { name: '天井',               color: 0xf5f4f0 },
  white:     { name: '白（化粧）',         color: 0xfafafa },
  glass:     { name: 'ガラス',             color: 0xa9d4e8 },
  other:     { name: 'その他',             color: 0x9fb7d4 }
};

export const matName = key => (MATS[key] ? MATS[key].name : key || '');

export const KIND_NAMES = {
  lumber: '角材', panel: '板材', wall: '壁', slab: '床・天井', box: '汎用', fitting: '建具', hardware: '金物'
};

// 寸法欄の見出し（s[0], s[1], s[2] の順）
export const SIZE_LABELS = {
  lumber: ['長さ', '幅', 'せい'],
  panel: ['長さ', '幅', '厚さ'],
  wall: ['長さ', '厚さ', '高さ'],
  slab: ['長さ（X）', '奥行（Y）', '厚さ'],
  box: ['X寸法', 'Y寸法', 'Z寸法'],
  fitting: ['幅', '厚さ', '高さ'],
  hardware: ['幅', '腕の長さ', '縦の長さ']
};

const L = (name, b, h, len, mat = 'wood', stand = false) => ({ type: 'part', kind: 'lumber', name, s: [len, b, h], mat, stand });
const P = (name, len, w, t, mat) => ({ type: 'part', kind: 'panel', name, s: [len, w, t], mat });

export const LIBRARY = [
  { title: '柱・間柱（立てて置く）', items: [
    L('柱 105角', 105, 105, 2700, 'wood', true),
    L('柱 90角', 90, 90, 2700, 'wood', true),
    L('間柱 30×105', 30, 105, 2700, 'wood', true),
    L('間柱 45×105', 45, 105, 2700, 'wood', true),
    L('LGSスタッド 65形', 45, 65, 2700, 'lgs', true),
    L('LGSスタッド 100形', 45, 100, 2700, 'lgs', true)
  ] },
  { title: '下地・角材（寝かせて置く）', items: [
    L('下地 30×40（野縁・胴縁）', 30, 40, 1820),
    L('胴縁 18×45', 18, 45, 1820),
    L('垂木 45×45', 45, 45, 1820),
    L('根太 45×60', 45, 60, 1820),
    L('根太 45×105', 45, 105, 3640),
    L('大引 90角', 90, 90, 3640),
    L('2×4（38×89）', 38, 89, 2440, 'spf'),
    L('2×6（38×140）', 38, 140, 2440, 'spf'),
    L('LGSランナー 67×40', 67, 40, 3000, 'lgs'),
    L('角パイプ □50', 50, 50, 2000, 'steel'),
    L('角パイプ □100', 100, 100, 2000, 'steel')
  ] },
  { title: '板材', items: [
    P('合板 t9（3×6）', 1820, 910, 9, 'plywood'),
    P('合板 t12（3×6）', 1820, 910, 12, 'plywood'),
    P('構造用合板 t24（3×6）', 1820, 910, 24, 'plywood'),
    P('石膏ボード t9.5（3×6）', 1820, 910, 9.5, 'gypsum'),
    P('石膏ボード t12.5（3×6）', 1820, 910, 12.5, 'gypsum'),
    P('石膏ボード t12.5（3×8）', 2420, 910, 12.5, 'gypsum'),
    P('ケイカル板 t6（3×6）', 1820, 910, 6, 'keical'),
    P('ランバーコア t18（4×8）', 2440, 1220, 18, 'lumbercore'),
    P('ランバーコア t21（4×8）', 2440, 1220, 21, 'lumbercore'),
    P('集成材カウンター t30', 1800, 600, 30, 'laminated'),
    P('棚板 t18', 900, 300, 18, 'lumbercore'),
    P('巾木 H60', 1820, 60, 9, 'white'),
    P('廻り縁 30×12', 1820, 30, 12, 'white')
  ] },
  { title: '壁・床・天井', items: [
    { type: 'tool', tool: 'wall', name: '壁を描く（2点クリック）', hint: '厚さ・高さは上のバーで指定' },
    { type: 'part', kind: 'slab', name: '床 3640×2730', s: [3640, 2730, 30], mat: 'floor', z: -30 },
    { type: 'part', kind: 'slab', name: '床 1820×1820', s: [1820, 1820, 30], mat: 'floor', z: -30 },
    { type: 'part', kind: 'slab', name: '天井 3640×2730', s: [3640, 2730, 9.5], mat: 'ceiling', z: 2400 },
    { type: 'part', kind: 'slab', name: '土間・スラブ t150', s: [3640, 3640, 150], mat: 'concrete', z: -150 }
  ] },
  { title: '建具・開口（壁をクリック）', items: [
    { type: 'opening', name: '片開きドア W800×H2000', o: { type: 'door', w: 800, h: 2000, sill: 0 } },
    { type: 'opening', name: '引戸 W1650×H2000', o: { type: 'door', w: 1650, h: 2000, sill: 0 } },
    { type: 'opening', name: '腰窓 W1650×H1100', o: { type: 'window', w: 1650, h: 1100, sill: 900 } },
    { type: 'opening', name: '小窓 W600×H900', o: { type: 'window', w: 600, h: 900, sill: 1100 } },
    { type: 'opening', name: '掃き出し窓 W1650×H2000', o: { type: 'window', w: 1650, h: 2000, sill: 0 } },
    { type: 'opening', name: '開口のみ W900×H2000', o: { type: 'open', w: 900, h: 2000, sill: 0 } }
  ] },
  { title: '造作家具（寸法を入れて作る）', items: [
    { type: 'gen', gen: 'cabinet', name: '箱物・棚', hint: '側板・天板・地板・棚板・背板' },
    { type: 'gen', gen: 'counter', name: 'カウンター', hint: '天板・側板・幕板' },
    { type: 'gen', gen: 'wallshelf', name: '壁付け棚', hint: '棚板・棚受け金物（壁をクリック）' }
  ] },
  { title: '汎用', items: [
    { type: 'part', kind: 'box', name: '直方体', s: [500, 500, 500], mat: 'other' },
    { type: 'part', kind: 'hardware', name: '棚受け金物 200×150', s: [25, 200, 150], mat: 'steel' }
  ] }
];

// 壁を描くときの、厚さの候補
export const WALL_PRESETS = [
  { name: '間仕切 90（LGS65＋PB12.5両面）', t: 90 },
  { name: '間仕切 130（木軸105＋PB12.5両面）', t: 130 },
  { name: '間仕切 65（下地40＋PB12.5両面）', t: 65 },
  { name: '外壁・厚壁 150', t: 150 }
];
