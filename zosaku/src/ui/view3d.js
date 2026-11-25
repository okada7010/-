// 3D表示。座標は mm、Zが上（three.js の上方向を Z に変えて使う）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MATS } from '../core/catalog.js';
import { quatOf } from '../core/geom.js';
import { wallPieces } from '../core/framing.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const ACCENT = 0x1f6fd6;
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_BOX);
const FOV = 38;

const VIEW_DIRS = {
  iso: [0.75, -1.2, 0.8], top: [0, -0.0005, 1], front: [0, -1, 0],
  back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0]
};

// 建具の見た目（開口の中心を原点にした箱の集まり）
function fittingBoxes(type, w, t, h) {
  const out = [];
  if (type === 'door') {
    const fw = Math.min(30, w / 6);
    out.push({ s: [fw, t, h], c: [-(w - fw) / 2, 0, 0], m: 'frame' });
    out.push({ s: [fw, t, h], c: [(w - fw) / 2, 0, 0], m: 'frame' });
    out.push({ s: [w - 2 * fw, t, fw], c: [0, 0, (h - fw) / 2], m: 'frame' });
    out.push({ s: [w - 2 * fw - 6, Math.min(36, t), h - fw - 8], c: [0, 0, -fw / 2 + 4], m: 'leaf' });
    out.push({ s: [20, Math.min(36, t) + 50, 110], c: [w / 2 - fw - 70, 0, -h / 2 + 1000], m: 'metal' });
  } else if (type === 'window') {
    const fw = Math.min(35, w / 6, h / 6);
    out.push({ s: [fw, t, h], c: [-(w - fw) / 2, 0, 0], m: 'sash' });
    out.push({ s: [fw, t, h], c: [(w - fw) / 2, 0, 0], m: 'sash' });
    out.push({ s: [w - 2 * fw, t, fw], c: [0, 0, (h - fw) / 2], m: 'sash' });
    out.push({ s: [w - 2 * fw, t, fw], c: [0, 0, -(h - fw) / 2], m: 'sash' });
    out.push({ s: [w - 2 * fw, 6, h - 2 * fw], c: [0, 0, 0], m: 'glass' });
    if (w >= 1200) out.push({ s: [36, Math.min(40, t), h - 2 * fw], c: [0, 0, 0], m: 'sash' });
  }
  return out;
}

export class View3D {
  constructor(container, labelLayer) {
    this.el = container;
    this.labelLayer = labelLayer;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);
    this.dom = this.renderer.domElement;
    this.dom.style.touchAction = 'none';

    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(FOV, 1, 10, 1e6);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -2e5, 2e6);
    this.camera = this.persp;
    this.persp.position.set(6000, -7000, 5200);
    this.halfH = 3000;

    this.controls = new OrbitControls(this.camera, this.dom);
    this.controls.target.set(1800, 1300, 1000);
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controls.zoomSpeed = 1.3;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a8, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(0.55, -0.9, 1.4);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1, 0.6, 0.4);
    this.scene.add(fill);

    this.partsGroup = new THREE.Group();
    this.ghostGroup = new THREE.Group();
    this.dimGroup = new THREE.Group();
    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup, this.partsGroup, this.ghostGroup, this.dimGroup);

    this.objs = new Map();     // id → { group, key }
    this.pickables = [];
    this.matCache = new Map();
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x4a4f57 });
    this.edgeSelMat = new THREE.LineBasicMaterial({ color: ACCENT });
    this.ghostMat = new THREE.MeshLambertMaterial({ color: ACCENT, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghostEdgeMat = new THREE.LineBasicMaterial({ color: ACCENT });
    this.dimMat = new THREE.LineBasicMaterial({ color: 0xc0392b, depthTest: false });
    this.dimSelMat = new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false });

    this.marker = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
      new THREE.PointsMaterial({ color: 0xe8590c, size: 11, sizeAttenuation: false, depthTest: false }));
    this.marker.visible = false;
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);

    this.raycaster = new THREE.Raycaster();
    this.labels = [];
    this.labelEls = new Map();
    this.dirty = true;
    this.theme = { bg: 0xeef1f5, grid1: 0xb8c0cb, grid2: 0xd8dde4 };
    this.buildGrid();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    const loop = () => { if (this.dirty) this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ---------- 表示の基本 ----------
  setTheme(t) {
    this.theme = t;
    this.buildGrid();
    this.requestRender();
  }

  buildGrid() {
    this.gridGroup.clear();
    this.scene.background = new THREE.Color(this.theme.bg);
    const make = (step, half, color) => {
      const pts = [];
      for (let v = -half; v <= half + 1; v += step) {
        pts.push(v, -half, 0, v, half, 0, -half, v, 0, half, v, 0);
      }
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
    };
    this.gridMinor = make(100, 10000, this.theme.grid2);
    this.gridMajor = make(1000, 20000, this.theme.grid1);
    this.gridGroup.position.z = -1; // 床の上面（Z=0）に線が透けないよう、わずかに下げる
    const ax = (to, color) => new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, ...to], 3)),
      new THREE.LineBasicMaterial({ color }));
    this.gridGroup.add(this.gridMinor, this.gridMajor, ax([1500, 0, 0], 0xd9480f), ax([0, 1500, 0], 0x2f9e44), ax([0, 0, 1500], 0x1c7ed6));
  }

  setGridVisible(v) { this.gridGroup.visible = v; this.requestRender(); }

  resize() {
    const w = Math.max(50, this.el.clientWidth), h = Math.max(50, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.dom.style.width = w + 'px';
    this.dom.style.height = h + 'px';
    this.w = w; this.h = h;
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
    this.requestRender();
  }

  updateOrtho() {
    const a = this.w / this.h;
    this.orthoCam.left = -this.halfH * a; this.orthoCam.right = this.halfH * a;
    this.orthoCam.top = this.halfH; this.orthoCam.bottom = -this.halfH;
    this.orthoCam.updateProjectionMatrix();
  }

  requestRender() { this.dirty = true; }

  get distance() { return this.camera.position.distanceTo(this.controls.target); }

  render() {
    this.dirty = false;
    if (this.camera === this.persp) {
      const d = this.distance;
      this.persp.near = Math.max(5, d * 0.01);
      this.persp.far = Math.max(300000, d * 60);
      this.persp.updateProjectionMatrix();
    }
    this.gridMinor.visible = this.mmPerPixel() < 5;
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  // 画面1ピクセルが何mmか（注視点の距離で）
  mmPerPixel() {
    if (this.camera === this.orthoCam) return (2 * this.halfH / this.orthoCam.zoom) / this.h;
    return 2 * this.distance * Math.tan(FOV * Math.PI / 360) / this.h;
  }

  get isOrtho() { return this.camera === this.orthoCam; }

  setOrtho(on) {
    if (on === this.isOrtho) return;
    const t = this.controls.target;
    const dir = this.camera.position.clone().sub(t);
    if (on) {
      this.halfH = dir.length() * Math.tan(FOV * Math.PI / 360);
      this.orthoCam.zoom = 1;
      this.orthoCam.position.copy(t).add(dir.normalize().multiplyScalar(Math.max(50000, this.halfH * 4)));
      this.orthoCam.quaternion.copy(this.camera.quaternion);
      this.camera = this.orthoCam;
      this.updateOrtho();
    } else {
      const d = (this.halfH / this.orthoCam.zoom) / Math.tan(FOV * Math.PI / 360);
      this.persp.position.copy(t).add(dir.normalize().multiplyScalar(d));
      this.camera = this.persp;
    }
    this.controls.object = this.camera;
    this.controls.update();
    this.requestRender();
  }

  // box＝{min,max}（なければ今の注視点のまま）に合わせて、指定の向きから見る
  // name を省くと、いまの向きのまま box に合わせる
  setView(name, box) {
    const dir = name
      ? new THREE.Vector3(...(VIEW_DIRS[name] || VIEW_DIRS.iso)).normalize()
      : this.camera.position.clone().sub(this.controls.target).normalize();
    let radius = null;
    if (box && isFinite(box.min[0])) {
      const c = new THREE.Vector3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
      radius = Math.max(300, new THREE.Vector3(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]).length() / 2);
      this.controls.target.copy(c);
    }
    const t = this.controls.target;
    if (this.isOrtho) {
      if (radius !== null) { this.halfH = radius * 1.15 * Math.max(1, this.h / this.w); this.orthoCam.zoom = 1; this.updateOrtho(); }
      this.orthoCam.position.copy(t).add(dir.multiplyScalar(Math.max(50000, this.halfH * 4)));
    } else {
      const d = radius !== null ? radius * 1.15 / Math.sin(FOV * Math.PI / 360) * Math.max(1, this.h / this.w) : this.distance;
      this.persp.position.copy(t).add(dir.multiplyScalar(d));
    }
    this.controls.update();
    this.requestRender();
  }

  setClip(z) {
    this.renderer.clippingPlanes = z === null ? [] : [new THREE.Plane(new THREE.Vector3(0, 0, -1), z)];
    this.requestRender();
  }

  // ---------- 部材 ----------
  material(matKey, selected) {
    const key = matKey + (selected ? '|s' : '');
    let m = this.matCache.get(key);
    if (!m) {
      const base = new THREE.Color((MATS[matKey] || MATS.other).color);
      if (selected) base.lerp(new THREE.Color(ACCENT), 0.4);
      const glass = matKey === 'glass';
      m = new THREE.MeshLambertMaterial({
        color: base, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        transparent: glass, opacity: glass ? 0.38 : 1, depthWrite: !glass
      });
      this.matCache.set(key, m);
    }
    return m;
  }

  specialMaterial(kind, selected) {
    const key = '#' + kind + (selected ? '|s' : '');
    let m = this.matCache.get(key);
    if (!m) {
      const colors = { frame: 0x9c7a55, leaf: 0xc9a67c, metal: 0x8b939c, sash: 0xdfe3e6, glass: 0xa9d4e8 };
      const base = new THREE.Color(colors[kind]);
      if (selected) base.lerp(new THREE.Color(ACCENT), 0.4);
      const glass = kind === 'glass';
      m = new THREE.MeshLambertMaterial({
        color: base, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        transparent: glass, opacity: glass ? 0.38 : 1, depthWrite: !glass
      });
      this.matCache.set(key, m);
    }
    return m;
  }

  addBox(group, s, c, mat, edgeMat, id) {
    const mesh = new THREE.Mesh(UNIT_BOX, mat);
    mesh.scale.set(s[0], s[1], s[2]);
    mesh.position.set(c[0], c[1], c[2]);
    if (id) mesh.userData.partId = id;
    group.add(mesh);
    if (edgeMat) {
      const e = new THREE.LineSegments(UNIT_EDGES, edgeMat);
      e.scale.copy(mesh.scale); e.position.copy(mesh.position);
      group.add(e);
    }
    return mesh;
  }

  addFitting(group, type, w, t, h, center, sel, id) {
    for (const b of fittingBoxes(type, w, t, h)) {
      this.addBox(group, b.s, [center[0] + b.c[0], center[1] + b.c[1], center[2] + b.c[2]],
        this.specialMaterial(b.m, sel), sel ? this.edgeSelMat : this.edgeMat, id);
    }
  }

  buildPart(part, sel) {
    const g = new THREE.Group();
    g.position.set(part.c[0], part.c[1], part.c[2]);
    g.quaternion.copy(quatOf(part.r));
    const edgeMat = sel ? this.edgeSelMat : this.edgeMat;
    if (part.kind === 'wall') {
      const [L, t, H] = part.s;
      const geos = wallPieces(part).map(r => {
        const b = new THREE.BoxGeometry(r.u1 - r.u0, t, r.v1 - r.v0);
        b.translate((r.u0 + r.u1) / 2 - L / 2, 0, (r.v0 + r.v1) / 2 - H / 2);
        return b;
      });
      if (geos.length) {
        const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos);
        const mesh = new THREE.Mesh(geo, this.material(part.mat, sel));
        mesh.userData.partId = part.id;
        mesh.userData.own = true;
        g.add(mesh);
      }
      // 外形と開口の線（面の継ぎ目は描かない）
      const pts = [];
      const rect = (u0, u1, v0, v1) => {
        for (const y of [-t / 2, t / 2]) {
          pts.push(u0, y, v0, u1, y, v0, u1, y, v0, u1, y, v1, u1, y, v1, u0, y, v1, u0, y, v1, u0, y, v0);
        }
        for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) pts.push(u, -t / 2, v, u, t / 2, v);
      };
      rect(-L / 2, L / 2, -H / 2, H / 2);
      for (const o of part.openings || []) {
        const u0 = Math.max(0, o.x), u1 = Math.min(L, o.x + o.w), v0 = Math.max(0, o.sill), v1 = Math.min(H, o.sill + o.h);
        if (u1 - u0 < 1 || v1 - v0 < 1) continue;
        rect(u0 - L / 2, u1 - L / 2, v0 - H / 2, v1 - H / 2);
        if (o.type !== 'open') {
          this.addFitting(g, o.type, u1 - u0, t, v1 - v0, [(u0 + u1) / 2 - L / 2, 0, (v0 + v1) / 2 - H / 2], sel, part.id);
        }
      }
      const lg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const lines = new THREE.LineSegments(lg, edgeMat);
      lines.userData.own = true;
      g.add(lines);
    } else if (part.kind === 'fitting') {
      this.addFitting(g, part.ftype || 'door', part.s[0], part.s[1], part.s[2], [0, 0, 0], sel, part.id);
    } else if (part.kind === 'hardware') {
      // L字の棚受け：背（+Y）に縦の板、上に腕
      const [w, d, h] = part.s, tb = Math.min(5, d / 4, h / 4);
      const m = this.material(part.mat, sel);
      this.addBox(g, [w, tb, h], [0, d / 2 - tb / 2, 0], m, edgeMat, part.id);
      this.addBox(g, [w, d - tb, tb], [0, -tb / 2, h / 2 - tb / 2], m, edgeMat, part.id);
    } else {
      this.addBox(g, part.s, [0, 0, 0], this.material(part.mat, sel), edgeMat, part.id);
    }
    return g;
  }

  disposeGroup(g) {
    g.traverse(o => { if (o.userData.own && o.geometry) o.geometry.dispose(); });
  }

  sync(parts, sel, hidden) {
    const seen = new Set();
    for (const p of parts) {
      seen.add(p.id);
      const isSel = sel.has(p.id);
      const key = JSON.stringify(p) + (isSel ? '|s' : '');
      let o = this.objs.get(p.id);
      if (!o || o.key !== key) {
        if (o) { this.partsGroup.remove(o.group); this.disposeGroup(o.group); }
        o = { group: this.buildPart(p, isSel), key };
        this.partsGroup.add(o.group);
        this.objs.set(p.id, o);
      }
      o.group.visible = !hidden.has(p.kind);
    }
    for (const [id, o] of this.objs) {
      if (!seen.has(id)) { this.partsGroup.remove(o.group); this.disposeGroup(o.group); this.objs.delete(id); }
    }
    this.pickables = [];
    this.partsGroup.traverse(o => {
      if (o.isMesh && o.userData.partId && o.parent.visible) this.pickables.push(o);
    });
    this.requestRender();
  }

  // 仮表示（配置中・作図中の部材）
  setGhost(parts) {
    for (const c of [...this.ghostGroup.children]) { this.ghostGroup.remove(c); }
    for (const p of parts || []) {
      const g = new THREE.Group();
      g.position.set(p.c[0], p.c[1], p.c[2]);
      g.quaternion.copy(quatOf(p.r));
      this.addBox(g, p.s, [0, 0, 0], this.ghostMat, this.ghostEdgeMat, null);
      this.ghostGroup.add(g);
    }
    this.requestRender();
  }

  setDims(dims, selId) {
    for (const c of [...this.dimGroup.children]) { this.dimGroup.remove(c); c.geometry.dispose(); }
    for (const d of dims) {
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([...d.a, ...d.b], 3));
      const line = new THREE.Line(g, d.id === selId ? this.dimSelMat : this.dimMat);
      line.renderOrder = 9;
      this.dimGroup.add(line);
      const pts = new THREE.Points(g.clone(), new THREE.PointsMaterial({ color: d.id === selId ? ACCENT : 0xc0392b, size: 7, sizeAttenuation: false, depthTest: false }));
      pts.renderOrder = 9;
      this.dimGroup.add(pts);
    }
    this.requestRender();
  }

  setMarker(p) {
    this.marker.visible = !!p;
    if (p) this.marker.position.set(p[0], p[1], p[2]);
    this.requestRender();
  }

  // ---------- 画面とのやりとり ----------
  setRay(clientX, clientY) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  // クリックした部材。返り値 { id, point, normal }
  pick(clientX, clientY) {
    this.setRay(clientX, clientY);
    const planes = this.renderer.clippingPlanes;
    for (const h of this.raycaster.intersectObjects(this.pickables, false)) {
      if (planes.some(pl => pl.distanceToPoint(h.point) < 0)) continue;
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 0, 1);
      return { id: h.object.userData.partId, point: [h.point.x, h.point.y, h.point.z], normal: [n.x, n.y, n.z] };
    }
    return null;
  }

  // 視線と平面の交点（normal・through は配列）
  planePoint(clientX, clientY, normal, through) {
    const ray = this.setRay(clientX, clientY);
    const n = new THREE.Vector3(...normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...through));
    const out = new THREE.Vector3();
    if (!ray.intersectPlane(plane, out)) {
      // 視点の後ろ側でも、線として交点を求める（平行投影で起きる）
      const denom = n.dot(ray.direction);
      if (Math.abs(denom) < 1e-9) return null;
      const tt = -(n.dot(ray.origin) + plane.constant) / denom;
      out.copy(ray.direction).multiplyScalar(tt).add(ray.origin);
    }
    return [out.x, out.y, out.z];
  }

  viewDir() {
    const v = new THREE.Vector3();
    this.camera.getWorldDirection(v);
    return [v.x, v.y, v.z];
  }

  project(p) {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    return { x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h, behind: v.z > 1 || v.z < -1 };
  }

  // ---------- 文字ラベル ----------
  // list: [{ key, p:[x,y,z], text, cls, data }]
  setLabels(list) {
    this.labels = list;
    const keep = new Set(list.map(l => l.key));
    for (const [k, el] of this.labelEls) if (!keep.has(k)) { el.remove(); this.labelEls.delete(k); }
    for (const l of list) {
      let el = this.labelEls.get(l.key);
      if (!el) {
        el = document.createElement('div');
        this.labelLayer.appendChild(el);
        this.labelEls.set(l.key, el);
      }
      el.className = 'lbl ' + (l.cls || '');
      el.textContent = l.text;
      if (l.data) el.dataset.dim = l.data; else delete el.dataset.dim;
    }
    this.requestRender();
  }

  placeLabels() {
    this.camera.updateMatrixWorld();
    for (const l of this.labels) {
      const el = this.labelEls.get(l.key);
      if (!el) continue;
      const s = this.project(l.p);
      if (s.behind) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(-50%,-50%) translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)`;
    }
  }

  snapshot() {
    this.render();
    return this.dom.toDataURL('image/png');
  }
}
