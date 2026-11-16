/* Beraber yapalım: satın alma bölümünde form. Mesaj WhatsApp'a ya da e-postaya hazır gelir. */
(function () {
  var WA = '4553514200';                             // ülke koduyla, yalnız rakam: örn. 4512345678
  var MAIL = 'm.cansasmaz@gmail.com';
  var opt = document.querySelector('input[name="opt"][value="birlikte"]');
  var cta = document.querySelector('.buy-cta'), btn = document.getElementById('buy-btn');
  if (!opt || !cta || !btn) return;
  var urun = (document.querySelector('.cs-localnav-title') || {}).textContent || document.title;
  var f = document.createElement('form'); f.className = 'together'; f.id = 'beraber'; f.hidden = true; f.noValidate = true;
  f.innerHTML = '<div><h3>Beraber yapalım</h3><p>Ne istediğini yaz, ölçülerini ekle. Mesajın WhatsApp\'a ya da e-postama hazır olarak gelir.</p></div>' +
    '<div class="row2"><label for="bf-ad">Adın<input id="bf-ad" autocomplete="name" required></label>' +
    '<label for="bf-ul">E-posta ya da telefon<input id="bf-ul" autocomplete="email" required></label></div>' +
    '<label for="bf-ne">Ne yapmak istiyorsun?<textarea id="bf-ne" required placeholder="Örn. 140 cm genişliğinde, iki çekmeceli bir masa. Koyu gri profil, mavi panel."></textarea></label>' +
    '<label for="bf-kod">Yapılandırma kodu<input id="bf-kod" placeholder="Özelleştir sekmesinden"></label>' +
    '<p class="err" id="bf-err" role="alert"></p>' +
    '<div class="send">' + (WA ? '<button class="cs-btn cs-btn-primary" type="button" data-to="wa">WhatsApp ile gönder</button>' : '') +
    '<button class="cs-btn ' + (WA ? 'cs-btn-secondary' : 'cs-btn-primary') + '" type="button" data-to="mail">E-posta ile gönder</button></div>' +
    '<p>E-posta açılmazsa adresim: <span class="mono" style="user-select:all">' + MAIL + '</span></p>';
  cta.parentNode.insertBefore(f, cta.nextSibling);
  function kod() { var c = document.querySelector('.cfg-code'); return c ? c.textContent.trim() : ''; }
  function sync() {
    var on = opt.checked; f.hidden = !on;
    if (on) { btn.textContent = 'Formu doldur'; btn.href = '#beraber'; btn.removeAttribute('target'); if (!document.getElementById('bf-kod').value) document.getElementById('bf-kod').value = kod(); }
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="opt"]'), function (r) { r.addEventListener('change', function () { setTimeout(sync, 0); }); });
  btn.addEventListener('click', function (e) { if (opt.checked) { e.preventDefault(); f.hidden = false; document.getElementById('bf-ad').focus(); } });
  f.addEventListener('submit', function (e) { e.preventDefault(); });
  f.addEventListener('click', function (e) {
    var b = e.target.closest('[data-to]'); if (!b) return;
    var v = function (id) { return document.getElementById(id).value.trim(); }, err = document.getElementById('bf-err');
    if (!v('bf-ad') || !v('bf-ul') || !v('bf-ne')) { err.textContent = 'Adını, iletişim bilgini ve ne istediğini yazman yeterli.'; return; }
    err.textContent = '';
    var txt = 'Merhaba Can, ' + urun.trim() + ' için beraber yapalım.\n\n' + v('bf-ne') + '\n\nAd: ' + v('bf-ad') + '\nİletişim: ' + v('bf-ul') + (v('bf-kod') ? '\nKod: ' + v('bf-kod') : '') + '\nSayfa: ' + location.href.split('#')[0];
    if (b.dataset.to === 'wa') window.location.href = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(txt);
    else window.location.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent(urun.trim() + ' · beraber yapalım') + '&body=' + encodeURIComponent(txt);
  });
})();
