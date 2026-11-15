/* Can Sasmaz Studio — Özelleştir bileşeni.
   CSConfigurator.mount(el, { glb, parts, spec, colors, title })
   glb/parts: NestCore parça dosyaları · spec: ozellestirme.json > urunler[key] · colors: ozellestirme.json > renkler
   Gerektirir: three r128, GLTFLoader, OrbitControls, nest-core.js */
(function (g) {
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function cm(mm) { return (mm / 10).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); }
  var LBL = { w: 'Genişlik', h: 'Yükseklik', d: 'Uzunluk' };
  var uid = 0;

  /* GLB: .glb adresi ya da window.CS_MODELS[key] (base64) taşıyan .js adresi */
  function loadGlb(url) {
    if (!/\.js$/.test(url)) return fetch(url).then(function (r) { return r.arrayBuffer(); });
    return new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = url;
      s.onload = function () { var k = Object.keys(window.CS_MODELS || {}).filter(function (k) { return url.indexOf(k) >= 0; })[0]; if (!k) return no(); var b = atob(window.CS_MODELS[k]), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); ok(a.buffer); };
      s.onerror = no; document.head.appendChild(s);
    });
  }
  function mount(root, o) {
    uid++;
    var spec = o.spec, colors = o.colors, state = { profil: 'acik-gri', panel: 'koyu-gri', w: spec.olcu.w, h: spec.olcu.h, d: spec.olcu.d, preset: 0, x: 0 };
    root.classList.add('cfg');
    /* sahne */
    var stage = h('div', { class: 'cfg-stage' });
    var load = h('div', { class: 'cfg-load', text: '3D model yükleniyor…' });
    var dimTag = h('div', { class: 'cfg-dimtag', 'aria-live': 'polite' });
    var tools = h('div', { class: 'cfg-tools' });
    var bOpen = h('button', { class: 'cfg-chip', type: 'button', 'aria-pressed': 'false', text: 'Çekmeceyi aç', hidden: '' });
    var bExp = h('button', { class: 'cfg-chip', type: 'button', 'aria-pressed': 'false', text: 'Parçalara ayır' });
    tools.appendChild(bOpen); tools.appendChild(bExp);
    stage.appendChild(load); stage.appendChild(dimTag); stage.appendChild(tools);
    /* kontroller */
    var side = h('div', { class: 'cfg-side' });
    var gName = 'cfgp' + uid;
    var presets = h('div', { class: 'cfg-presets', role: 'radiogroup', 'aria-label': 'Hazır seçenekler' });
    spec.hazir.forEach(function (p, i) {
      var pc = (colors.profil.filter(function (c) { return c.kod === p.profil; })[0] || {}).hex, nc = (colors.panel.filter(function (c) { return c.kod === p.panel; })[0] || {}).hex;
      var inp = h('input', { type: 'radio', name: gName, value: String(i) }); if (i === 0) inp.checked = true;
      var lab = h('label', { class: 'cfg-preset' }, [inp,
        h('span', { class: 'cfg-preset-dots', 'aria-hidden': 'true', html: '<i style="background:' + pc + '"></i><i style="background:' + nc + '"></i>' }),
        h('span', { class: 'cfg-preset-name', text: p.ad }),
        h('span', { class: 'cfg-preset-desc', text: p.aciklama }),
        h('span', { class: 'cfg-preset-dims', text: (spec.sabitYukseklik ? cm(p.olcu.w) + ' × ' + cm(p.olcu.d) : cm(p.olcu.w) + ' × ' + cm(p.olcu.d) + ' × ' + cm(p.olcu.h)) + ' cm' })]);
      inp.addEventListener('change', function () { applyPreset(i, true); });
      presets.appendChild(lab);
    });
    side.appendChild(h('div', { class: 'cfg-group' }, [h('h3', { class: 'cfg-h', text: 'Hazır seçenekler' }), presets]));
    function swatches(which, list, title) {
      var wrap = h('div', { class: 'cfg-swatches', role: 'radiogroup', 'aria-label': title });
      var name = h('span', { class: 'cfg-swatch-name' });
      list.forEach(function (c) {
        var inp = h('input', { type: 'radio', name: gName + which, value: c.kod, 'aria-label': c.ad });
        var lab = h('label', { class: 'cfg-swatch', title: c.ad }, [inp, h('span', { style: 'background:' + c.hex })]);
        inp.addEventListener('change', function () { state[which] = c.kod; state.preset = -1; sync(); });
        wrap.appendChild(lab);
      });
      return h('div', { class: 'cfg-group' }, [h('h3', { class: 'cfg-h' }, [document.createTextNode(title + ' '), name]), wrap]);
    }
    var swP = swatches('profil', colors.profil, 'Profil rengi'), swN = swatches('panel', colors.panel, 'Panel rengi');
    side.appendChild(swP); side.appendChild(swN);
    side.appendChild(h('p', { class: 'cfg-note', text: colors.sabit + ' ' + colors.yuzey }));
    /* ölçüler */
    var dimsBox = h('div', { class: 'cfg-group' }, [h('h3', { class: 'cfg-h', text: 'Ölçüler' })]);
    var ctl = {};
    ['w', 'd', 'h'].forEach(function (k) {
      var s = spec.sinir[k]; if (s.min === s.max) return;
      var id = 'cfg' + uid + k;
      var num = h('input', { type: 'number', id: id, min: s.min, max: s.max, step: 5, inputmode: 'numeric', class: 'cfg-num' });
      var rng = h('input', { type: 'range', min: s.min, max: s.max, step: 5, class: 'cfg-range', 'aria-label': LBL[k] });
      var why = h('p', { class: 'cfg-why', text: s.neden });
      var warn = h('span', { class: 'cfg-warn', hidden: '' });
      var row = h('div', { class: 'cfg-dim' }, [
        h('div', { class: 'cfg-dim-top' }, [h('label', { for: id, text: LBL[k] }), h('span', { class: 'cfg-num-wrap' }, [num, h('span', { text: 'mm' })])]),
        rng,
        h('div', { class: 'cfg-dim-lim' }, [h('span', { text: 'en az ' + cm(s.min) + ' cm' }), warn, h('span', { text: 'en çok ' + cm(s.max) + ' cm' })]),
        why]);
      function set(v, fromNum) {
        v = Math.round(Number(v) / 5) * 5; var cl = Math.min(s.max, Math.max(s.min, v));
        warn.hidden = !(fromNum && cl !== v); warn.textContent = v < s.min ? 'Alt sınıra çekildi' : 'Üst sınıra çekildi';
        state[k] = cl; state.preset = -1; sync();
      }
      rng.addEventListener('input', function () { set(rng.value); });
      num.addEventListener('change', function () { set(num.value, true); });
      ctl[k] = { num: num, rng: rng };
      dimsBox.appendChild(row);
    });
    var reset = h('button', { type: 'button', class: 'cfg-link', text: 'Orijinal ölçüye dön' });
    reset.addEventListener('click', function () { applyPreset(0, true); });
    dimsBox.appendChild(reset);
    side.appendChild(dimsBox);
    /* sonuç */
    var cutT = h('table', { class: 'cfg-table' });
    var panT = h('table', { class: 'cfg-table' });
    var code = h('code', { class: 'cfg-code' });
    var copy = h('button', { type: 'button', class: 'cfg-chip', text: 'Kopyala' });
    copy.addEventListener('click', function () {
      var t = code.textContent, done = function () { copy.textContent = 'Kopyalandı'; setTimeout(function () { copy.textContent = 'Kopyala'; }, 1500); };
      var fb = function () { var r = document.createRange(); r.selectNodeContents(code); var s = getSelection(); s.removeAllRanges(); s.addRange(r); };
      try { navigator.clipboard.writeText(t).then(done, fb); } catch (e) { fb(); }
    });
    var result = h('div', { class: 'cfg-result' }, [
      h('div', {}, [h('h3', { class: 'cfg-h', text: 'Profil kesim listesi' }), cutT]),
      h('div', {}, [h('h3', { class: 'cfg-h', text: 'Paneller' }), panT]),
      h('div', { class: 'cfg-codebox' }, [h('h3', { class: 'cfg-h', text: 'Yapılandırma kodu' }), h('div', { class: 'cfg-coderow' }, [code, copy]),
        h('p', { class: 'cfg-note', text: 'Ölçüyü değiştirdiğinde kesim listesi ve paneller bu ölçüye göre yeniden hesaplanır. Hazır üretim için bu kodu sipariş e-postana ekle.' })])
    ]);
    root.appendChild(h('div', { class: 'cfg-main' }, [stage, side]));
    root.appendChild(result);

    /* 3D */
    var THREE = g.THREE, N = null, renderer, scene, cam, controls, needs = true, anim = null;
    function fit(snap) {
      if (!N) return;
      var b = new THREE.Box3(); N.P.forEach(function (p) { if (p.node.visible) b.expandByObject(p.node); });
      var c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
      var dir = cam.position.clone().sub(controls.target).normalize(), dist = r / Math.sin(cam.fov * Math.PI / 360) * 1.08;
      var tgtPos = c.clone().addScaledVector(dir, dist);
      if (snap) { controls.target.copy(c); cam.position.copy(tgtPos); }
      else { fitTo = { t: c, p: tgtPos }; }
      needs = true;
    }
    var fitTo = null;
    function initThree(info, gltf) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.outputEncoding = THREE.sRGBEncoding;
      stage.insertBefore(renderer.domElement, stage.firstChild);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.05));
      var k1 = new THREE.DirectionalLight(0xffffff, 1.0); k1.position.set(2, 3, 2.5); scene.add(k1);
      var k2 = new THREE.DirectionalLight(0xffffff, 0.45); k2.position.set(-2.5, 1.5, -2); scene.add(k2);
      scene.add(gltf.scene);
      N = new g.NestCore(THREE).load(info, gltf.scene);
      if (N.delta > 0) bOpen.hidden = false;
      var a = 35 * Math.PI / 180; cam.position.set(Math.sin(a), 0.5, Math.cos(a));
      controls = new THREE.OrbitControls(cam, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 0, 0);
      controls.addEventListener('change', function () { needs = true; });
      var ro = new ResizeObserver(function () { var W = stage.clientWidth, H = stage.clientHeight; renderer.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix(); needs = true; });
      ro.observe(stage);
      load.hidden = true;
      sync(true); fit(true);
      (function loop() {
        if (anim) { var t = Math.min(1, (performance.now() - anim.t0) / 700); state.x = anim.from + (anim.to - anim.from) * t; N.apply(state.x); if (t >= 1) anim = null; needs = true; }
        if (fitTo) { controls.target.lerp(fitTo.t, 0.15); cam.position.lerp(fitTo.p, 0.15); if (cam.position.distanceTo(fitTo.p) < 0.002) fitTo = null; needs = true; }
        if (controls.update()) needs = true;
        if (needs) { renderer.render(scene, cam); needs = false; }
        requestAnimationFrame(loop);
      })();
    }
    function go(to) { anim = { from: state.x, to: to, t0: performance.now() }; }
    bExp.addEventListener('click', function () { var on = bExp.getAttribute('aria-pressed') !== 'true'; bExp.setAttribute('aria-pressed', String(on)); bOpen.setAttribute('aria-pressed', 'false'); go(on ? 1 : 0); });
    bOpen.addEventListener('click', function () { var on = bOpen.getAttribute('aria-pressed') !== 'true'; bOpen.setAttribute('aria-pressed', String(on)); bExp.setAttribute('aria-pressed', 'false'); go(on ? 0.4 : 0); });

    function applyPreset(i, animate) {
      var p = spec.hazir[i]; state.preset = i; state.profil = p.profil; state.panel = p.panel; state.w = p.olcu.w; state.h = p.olcu.h; state.d = p.olcu.d;
      sync(); if (N) fit(!animate);
    }
    var fitTimer = null;
    function sync(first) {
      /* form */
      Array.prototype.forEach.call(presets.querySelectorAll('input'), function (r, i) { r.checked = i === state.preset; });
      [['profil', swP, colors.profil], ['panel', swN, colors.panel]].forEach(function (a) {
        Array.prototype.forEach.call(a[1].querySelectorAll('input'), function (r) { r.checked = r.value === state[a[0]]; });
        a[1].querySelector('.cfg-swatch-name').textContent = '· ' + (a[2].filter(function (c) { return c.kod === state[a[0]]; })[0] || {}).ad;
      });
      Object.keys(ctl).forEach(function (k) { ctl[k].num.value = state[k]; ctl[k].rng.value = state[k]; ctl[k].rng.style.setProperty('--p', ((state[k] - spec.sinir[k].min) / (spec.sinir[k].max - spec.sinir[k].min) * 100) + '%'); });
      dimTag.textContent = spec.sabitYukseklik ? cm(state.w) + ' × ' + cm(state.d) + ' cm' : cm(state.w) + ' × ' + cm(state.d) + ' × ' + cm(state.h) + ' cm';
      var pk = state.profil === 'acik-gri' ? 'AG' : 'KG', nk = { 'koyu-gri': 'KG', kirmizi: 'KR', sari: 'SR', yesil: 'YS', mavi: 'MV' }[state.panel];
      code.textContent = spec.slug.toUpperCase().replace(/-/g, '').slice(0, 10) + '-' + state.w + 'x' + state.d + 'x' + state.h + '-' + pk + '-' + nk;
      if (!N) return;
      N.setColor('profil', state.profil); N.setColor('panel', state.panel);
      N.setDims({ w: state.w / 1000, h: state.h / 1000, d: state.d / 1000 }); N.apply(state.x);
      var cut = N.cutList(), pan = N.panelList();
      cutT.innerHTML = '<thead><tr><th scope="col">Boy</th><th scope="col">Adet</th></tr></thead><tbody>' + cut.map(function (r) { return '<tr><td>' + r.boyMm + ' mm</td><td>' + r.adet + '</td></tr>'; }).join('') + '</tbody><tfoot><tr><td>Toplam</td><td>' + (cut.reduce(function (s, r) { return s + r.boyMm * r.adet; }, 0) / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' m</td></tr></tfoot>';
      panT.innerHTML = '<thead><tr><th scope="col">Ölçü</th><th scope="col">Adet</th></tr></thead><tbody>' + pan.map(function (r) { return '<tr><td>' + r.olcu + ' mm</td><td>' + r.adet + '</td></tr>'; }).join('') + '</tbody>';
      needs = true;
      if (!first) { clearTimeout(fitTimer); fitTimer = setTimeout(function () { fit(false); }, 250); }
    }
    sync(true);
    /* yükle */
    function start() {
      Promise.all([fetch(o.parts).then(function (r) { return r.json(); }), loadGlb(o.glb)]).then(function (res) {
        new THREE.GLTFLoader().parse(res[1], '', function (gl) { initThree(res[0], gl); }, function () { load.textContent = '3D model okunamadı'; });
      }).catch(function () { load.textContent = '3D model yüklenemedi'; });
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '200px' }); io.observe(stage);
    } else start();
    return { state: state, applyPreset: applyPreset };
  }
  g.CSConfigurator = { mount: mount };
})(window);
