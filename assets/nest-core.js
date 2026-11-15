/* NestCore — Can Sasmaz Studio parametrik ürün motoru.
   parts.glb (her parça ayrı düğüm, P<id>) + parts.json (tür, grup, ölçü) okur.
   Renk paleti, ölçü değiştirme (germe), çekmece açma ve patlatma burada.
   Hem çevrimdışı render (render.html) hem ürün sayfasındaki Özelleştir sekmesi bunu kullanır. */
(function (g) {
  var PALETTE = {
    profil: {
      'acik-gri': { ad: 'Açık gri', hex: '#b4b9bf' },
      'koyu-gri': { ad: 'Koyu gri', hex: '#4a4d52' }
    },
    panel: {
      'koyu-gri': { ad: 'Koyu gri', hex: '#3a3c40' },
      'kirmizi': { ad: 'Kırmızı', hex: '#9e3a31' },
      'sari': { ad: 'Sarı', hex: '#d0a03a' },
      'yesil': { ad: 'Yeşil', hex: '#5e7560' },
      'mavi': { ad: 'Mavi', hex: '#3f5e7e' }
    }
  };
  var STD = { corner: 0x7d838b, slide: 0xc3c7cc, lock: 0xa9aeb5, hinge: 0xa9aeb5, handle: 0x1d1d1f, cap: 0x1d1d1f, wheel: 0x3d3f43, device: 0x9da2a9, mesh: 0x9aa0a8, nut: 0x8a9098, screw: 0x5a5e64, other: 0x8f959d };
  function ease(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  function lin(THREE, c) { return new THREE.Color(c).convertSRGBToLinear(); }
  function Nest(THREE) {
    this.T = THREE; this.P = []; this.front = new THREE.Vector3(0, 0, 1); this.delta = 0;
    this.dims = null; this.dims0 = null; this.color = { profil: 'acik-gri', panel: 'koyu-gri' };
    var M = this.M = {};
    M.profile = new THREE.MeshStandardMaterial({ color: lin(THREE, PALETTE.profil['acik-gri'].hex), metalness: 0.35, roughness: 0.55 });
    M.panel = new THREE.MeshStandardMaterial({ color: lin(THREE, PALETTE.panel['koyu-gri'].hex), metalness: 0.0, roughness: 0.9, side: THREE.DoubleSide });
    Object.keys(STD).forEach(function (k) {
      var metal = /slide|lock|hinge|mesh|corner|nut|screw/.test(k);
      M[k] = new THREE.MeshStandardMaterial({ color: lin(THREE, STD[k]), metalness: metal ? 0.6 : 0.1, roughness: metal ? 0.4 : 0.7, side: k === 'mesh' ? THREE.DoubleSide : THREE.FrontSide });
    });
    M.ghost = new THREE.MeshLambertMaterial({ color: 0x9aa1aa, transparent: true, opacity: 0.3, depthWrite: false });
    M.accent = new THREE.MeshStandardMaterial({ color: 0xE34520, metalness: 0.2, roughness: 0.5 });
  }
  Nest.PALETTE = PALETTE;
  Nest.prototype.load = function (info, gltfScene) {
    var T = this.T, self = this, byName = {};
    gltfScene.traverse(function (o) { if (o.name) byName[o.name] = o; });
    gltfScene.updateMatrixWorld(true);
    info.forEach(function (p) {
      var n = byName['P' + p.id]; if (!n) return;
      n.traverse(function (o) { if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); });
      p.node = n; p.base = n.position.clone(); p.baseScale = n.scale.clone();
      p.c0 = new T.Vector3(p.c[0], p.c[1], p.c[2]).multiplyScalar(0.001);
      p.e0 = new T.Vector3(p.ext[0], p.ext[1], p.ext[2]).multiplyScalar(0.001);
      self.P.push(p);
    });
    /* kapalı konum farkı */
    var oz = -1e9, iz = -1e9;
    this.P.forEach(function (p) { var fz = p.c0.z + p.e0.z / 2; if (p.group === 'outer' && p.kind !== 'cap') oz = Math.max(oz, fz); if (p.group === 'inner' && p.kind === 'panel') iz = Math.max(iz, fz); });
    this.delta = (iz > -1e8 && oz > -1e8) ? Math.max(0, iz - oz) : 0;
    /* kapalı koordinatlar ve çerçeve bölgesi */
    var lo = new T.Vector3(1e9, 1e9, 1e9), hi = new T.Vector3(-1e9, -1e9, -1e9), all = new T.Box3();
    this.P.forEach(function (p) {
      p.cc = p.c0.clone(); if (p.group === 'inner') p.cc.addScaledVector(self.front, -self.delta);
      var a = p.cc.clone().addScaledVector(p.e0, -0.5), b = p.cc.clone().addScaledVector(p.e0, 0.5);
      if (p.kind === 'profile') { lo.min(a); hi.max(b); }
      all.expandByPoint(a); all.expandByPoint(b);
    });
    if (lo.x > 1e8) { lo = all.min.clone(); hi = all.max.clone(); }
    this.lo = lo; this.hi = hi;
    this.dims0 = { w: hi.x - lo.x, h: hi.y - lo.y, d: hi.z - lo.z };
    this.dims = Object.assign({}, this.dims0);
    this.R = all.getSize(new T.Vector3()).length() / 2;
    this.center = all.getCenter(new T.Vector3());
    this.computeDirs(); this.paint(); this.apply(0);
    return this;
  };
  Nest.prototype.computeDirs = function () {
    var T = this.T, R = this.R, front = this.front, P = this.P;
    function gc(g) { var c = new T.Vector3(), n = 0; P.forEach(function (p) { if (p.group === g) { c.add(p.c0); n++; } }); return n ? c.multiplyScalar(1 / n) : c; }
    var G = { outer: gc('outer'), inner: gc('inner'), door: gc('door') };
    P.forEach(function (p) {
      var c = G[p.group] || G.outer, d = p.c0.clone().sub(c), dir = new T.Vector3();
      var e = [p.e0.x, p.e0.y, p.e0.z], k = p.kind, thin = e.indexOf(Math.min.apply(null, e)), lng = e.indexOf(Math.max.apply(null, e)), dd = [d.x, d.y, d.z];
      if (k === 'panel' || k === 'mesh') { var s = Math.abs(dd[thin]) > 0.01 ? Math.sign(dd[thin]) : (thin === 1 ? -1 : 1); dir.setComponent(thin, s * 0.42 * R); }
      else if (k === 'profile') { dd[lng] = 0; dir.set(dd[0], dd[1], dd[2]); if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0); dir.normalize().multiplyScalar(0.2 * R); }
      else if (k === 'corner' || k === 'cap' || k === 'nut' || k === 'screw') { dir.copy(d); if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0); dir.normalize().multiplyScalar((k === 'corner' ? 0.32 : k === 'nut' ? 0.5 : 0.62) * R); }
      else if (k === 'device') { dir.set(d.x * 0.6, 0, d.z * 0.6).add(new T.Vector3(0, 0.5 * R, 0)); }
      else if (k === 'wheel') { dir.set(0, -0.22 * R, 0); }
      else if (k === 'slide') { dir.set(Math.sign(d.x) * 0.1 * R, 0, 0); }
      else { dir.copy(d); if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1); dir.normalize().multiplyScalar(0.36 * R); }
      if (p.group === 'inner') dir.addScaledVector(front, 0.22 * R).add(new T.Vector3(0, 0.16 * R, 0));
      if (p.group === 'door') dir.addScaledVector(front, 0.3 * R);
      p.dir = dir;
    });
  };
  Nest.prototype.setColor = function (which, key) {
    var c = PALETTE[which === 'profil' ? 'profil' : 'panel'][key]; if (!c) return;
    this.color[which] = key; (which === 'profil' ? this.M.profile : this.M.panel).color.copy(lin(this.T, c.hex));
  };
  /* vis: {id:'new'|'old'|'hi'} ya da null (hepsi) */
  Nest.prototype.paint = function (vis) {
    var M = this.M;
    this.P.forEach(function (p) {
      var mode = vis ? vis[p.id] : 'new'; p.node.visible = !!mode; if (!mode) return;
      var m = mode === 'old' ? M.ghost : mode === 'hi' ? M.accent : (M[p.kind] || M.other);
      p.node.traverse(function (o) { if (o.isMesh) o.material = m; });
    });
  };
  Nest.prototype.setDims = function (d) { this.dims = Object.assign({}, this.dims, d); };
  /* bir eksende konum eşleme: alt uç sabit (y) ya da ortadan simetrik (x,z) */
  Nest.prototype._map = function (axis, v, near) {
    var lo = this.lo[axis], hi = this.hi[axis], S = hi - lo, key = axis === 'x' ? 'w' : axis === 'y' ? 'h' : 'd';
    var S2 = this.dims[key], D = S2 - S, lo2 = axis === 'y' ? lo : lo - D / 2, k = S2 / S, m = 0.045;
    if (v <= lo + (near ? m : 0)) return v + (lo2 - lo);
    if (v >= hi - (near ? m : 0)) return v + (lo2 - lo) + D;
    return lo2 + (v - lo) * k;
  };
  /* x: 0 kapalı · 0–0.4 çekmece açılır · 0.4–1 patlar. open: sabit açıklık (0–1) */
  Nest.prototype.apply = function (x, open) {
    var T = this.T, self = this, d0 = this.dims0, dm = this.dims;
    var op = this.delta > 0 ? Math.min(1, x / 0.4) : 1, ex = this.delta > 0 ? Math.max(0, (x - 0.4) / 0.6) : x;
    op = ease(op); ex = ease(ex); if (open != null) { op = open; ex = 0; }
    var kd = dm.d / d0.d, travel = this.delta * kd * op;
    this.P.forEach(function (p) {
      var e = p.e0, c = p.cc, s = new T.Vector3(1, 1, 1), c2 = new T.Vector3();
      ['x', 'y', 'z'].forEach(function (ax) {
        var S = self.hi[ax] - self.lo[ax], key = ax === 'x' ? 'w' : ax === 'y' ? 'h' : 'd', D = dm[key] - S;
        var stretch = /profile|panel|mesh|slide/.test(p.kind) && e[ax] > 0.06;
        if (stretch) {
          var ne = e[ax] > 0.6 * S ? e[ax] + D : e[ax] * dm[key] / S;
          s[ax] = ne / e[ax]; c2[ax] = self._map(ax, c[ax], false);
          if (e[ax] > 0.6 * S) c2[ax] = (self._map(ax, c[ax] - e[ax] / 2, true) + self._map(ax, c[ax] + e[ax] / 2, true)) / 2;
        } else if (p.kind === 'device' && ax === 'y') {
          var b = c[ax] - e[ax] / 2; c2[ax] = self._map(ax, b, true) + e[ax] / 2;
        } else c2[ax] = self._map(ax, c[ax], true);
      });
      if (p.group === 'inner') c2.addScaledVector(self.front, travel);
      if (p.group === 'slide' && self.delta > 0) {
        var L = e.z * s.z, f = (L - self.delta * kd * (1 - op)) / L; s.z *= f; c2.z = c2.z - L / 2 + f * L / 2;
      }
      c2.addScaledVector(p.dir, ex);
      /* dünya: p' = s * p + t; merkez c0 -> c2 */
      p.node.scale.set(s.x, s.y, s.z);
      p.node.position.set(c2.x - s.x * p.c0.x, c2.y - s.y * p.c0.y, c2.z - s.z * p.c0.z);
      p.newLen = p.kind === 'profile' ? Math.round(Math.max(e.x * s.x, e.y * s.y, e.z * (p.group === 'slide' ? 1 : s.z)) * 1000) : null;
      p.newExt = [e.x * s.x, e.y * s.y, e.z * s.z].map(function (v) { return Math.round(v * 1000); });
    });
  };
  /* kesim listesi: yeni boylara göre */
  Nest.prototype.cutList = function () {
    var m = {};
    this.P.forEach(function (p) {
      if (p.kind !== 'profile') return;
      var L = Math.round(Math.max.apply(null, p.newExt) / 5) * 5; m[L] = (m[L] || 0) + 1;
    });
    return Object.keys(m).map(Number).sort(function (a, b) { return b - a; }).map(function (L) { return { boyMm: L, adet: m[L] }; });
  };
  Nest.prototype.panelList = function () {
    var m = {};
    this.P.forEach(function (p) {
      if (p.kind !== 'panel') return;
      var e = p.newExt.slice().sort(function (a, b) { return b - a; }), k = Math.round(e[0] / 5) * 5 + ' × ' + Math.round(e[1] / 5) * 5; m[k] = (m[k] || 0) + 1;
    });
    return Object.keys(m).map(function (k) { return { olcu: k, adet: m[k] }; });
  };
  g.NestCore = Nest;
})(typeof window !== 'undefined' ? window : this);
