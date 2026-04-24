/* ═══════════════════════════════════════════════════════
   FOOD BY K — patch.js  (load AFTER supabase CDN)
   Fixes: dashboard removal, logo→admin, live menu/events/hours/banner
   ═══════════════════════════════════════════════════════ */
(function () {
  var SB_URL = 'https://cuzqkwznwsuhjnwqqrix.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1enFrd3pud3N1aGpud3Fxcml4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NTMxNTAsImV4cCI6MjA5MjEyOTE1MH0.Kwk23gVcmDMcCN2APdE8zX8i7hMZC606DVzZz5n9lZ0';
  var CAT = { kota: 'Kota', sandwiches: 'Sandwiches', burgers: 'Burgers', platters: 'Platters', wraps: 'Wraps', specialty: 'Specialty', drinks: 'Drinks', addons: 'Add-ons' };
  var sb;

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmt(t) { return t ? String(t).slice(0, 5) : ''; }

  /* ── FIX 1: Nuke the in-page dashboard immediately ─────── */
  function removeDashboard() {
    var d = document.getElementById('page-dashboard');
    if (d) d.remove();
    // Also remove from nav bar if present
    var navD = document.getElementById('nav-dashboard');
    if (navD) navD.remove();
  }

  /* ── FIX 2: Override logo-tap → go to /admin.html ─────── */
  function patchLogoTap() {
    window.handleLogoTap = function () {
      window._logoTaps = (window._logoTaps || 0) + 1;
      clearTimeout(window._logoTimer);
      window._logoTimer = setTimeout(function () { window._logoTaps = 0; }, 2000);
      if (window._logoTaps >= 5) {
        window._logoTaps = 0;
        window.location.href = '/admin.html';
      }
    };
  }

  /* ── FIX 3: Banner ─────────────────────────────────────── */
  async function loadBanner() {
    try {
      var r = await sb.from('announcements').select('message').eq('active', true).limit(1);
      if (!r.data || !r.data.length || !r.data[0].message) return;
      var ex = document.getElementById('fbk-ann-banner');
      if (ex) ex.remove();
      var b = document.createElement('div');
      b.id = 'fbk-ann-banner';
      b.style.cssText = 'position:sticky;top:0;z-index:999;background:linear-gradient(90deg,#B03E00,#F26419);color:#fff;padding:10px 44px 10px 16px;font-family:Montserrat,sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;line-height:1.4;text-align:center;';
      b.innerHTML = esc(r.data[0].message) + '<button onclick="this.parentElement.remove()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.2);border:none;color:#fff;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:16px;line-height:1;">×</button>';
      var home = document.getElementById('page-home');
      if (home) home.insertBefore(b, home.firstChild);
    } catch (e) { }
  }

  /* ── FIX 4: Menu ───────────────────────────────────────── */
  async function loadMenu() {
    var bodyEl = document.querySelector('.menu-body');
    var pillsEl = document.querySelector('.menu-cats');
    if (!bodyEl || !pillsEl) return;
    try {
      var r = await sb.from('menu_items').select('*').order('category').order('sort_order');
      if (!r.data || !r.data.length) return;
      if (!window.ITEMS) window.ITEMS = {};
      r.data.forEach(function (item) {
        window.ITEMS[item.id] = { name: item.name, desc: item.description || '', price: item.price, img: item.image_url || 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=220&q=80' };
      });
      var grouped = {}, order = [];
      r.data.forEach(function (item) {
        var c = item.category || 'kota';
        if (!grouped[c]) { grouped[c] = []; order.push(c); }
        grouped[c].push(item);
      });
      pillsEl.innerHTML = order.map(function (cat, i) {
        return '<button class="cat-pill' + (i === 0 ? ' on' : '') + '" onclick="filterCat(\'' + cat + '\',this)">' + esc(CAT[cat] || cat) + '</button>';
      }).join('');
      bodyEl.innerHTML = order.map(function (cat, i) {
        return '<div class="menu-sec' + (i === 0 ? ' on' : '') + '" id="cat-' + cat + '">'
          + grouped[cat].map(function (item) {
            var avail = item.available !== false;
            var img = item.image_url || 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=220&q=80';
            return '<div class="menu-card' + (avail ? '' : ' sold-out-card') + '"'
              + ' onclick="' + (avail ? 'openItem(\'' + item.id + '\')' : 'typeof showToast===\'function\'&&showToast(\'Sold out today\')') + '"'
              + ' style="' + (avail ? '' : 'opacity:.6;cursor:default;') + '">'
              + '<div class="mc-info"><div class="mc-name">' + esc(item.name) + '</div>'
              + '<div class="mc-desc">' + esc(item.description || '') + '</div>'
              + '<div class="mc-footer"><span class="mc-price">R' + Number(item.price).toFixed(0) + '</span>'
              + (avail ? '<div class="mc-add">+</div>' : '<div class="mc-add" style="background:#1F1A15;color:#A08060;font-size:9px;font-family:Montserrat,sans-serif;padding:0 8px;font-weight:700;letter-spacing:1px;">SOLD</div>')
              + '</div></div>'
              + '<img class="mc-img" src="' + esc(img) + '" alt="' + esc(item.name) + '" loading="lazy" onerror="this.src=\'https://images.unsplash.com/photo-1550547660-d9450f859349?w=220&q=80\'">'
              + '</div>';
          }).join('') + '</div>';
      }).join('');
    } catch (e) { console.warn('FBK menu:', e); }
  }

  /* ── FIX 5: Events ─────────────────────────────────────── */
  async function loadEvents() {
    var bodyEl = document.querySelector('.events-body');
    if (!bodyEl) return;
    try {
      var r = await sb.from('events').select('*').eq('active', true).order('created_at', { ascending: false });
      if (!r.data || !r.data.length) return;
      var topbar = bodyEl.querySelector('.page-topbar');
      var header = bodyEl.querySelector('div:not(.page-topbar):not(.event-card):not(.glass)');
      bodyEl.innerHTML = '';
      if (topbar) bodyEl.appendChild(topbar);
      if (header) bodyEl.appendChild(header);
      r.data.forEach(function (ev) {
        var tix = Array.isArray(ev.tickets) ? ev.tickets : [];
        var dateStr = ev.event_date
          ? new Date(ev.event_date + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          : (ev.recurring_day || 'Date TBC');
        var cdHtml = '';
        if (!ev.is_recurring && ev.event_date) {
          var target = new Date(ev.event_date + (ev.start_time ? 'T' + ev.start_time : 'T00:00:00'));
          var diff = target - new Date();
          if (diff > 0) {
            var d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000);
            cdHtml = '<div style="display:flex;gap:10px;margin:12px 0 16px;">'
              + [['Days', d], ['Hrs', h], ['Min', m]].map(function (x) {
                return '<div style="text-align:center;background:#1F1A15;border:1px solid rgba(242,100,25,0.18);border-radius:12px;padding:10px 14px;min-width:52px;">'
                  + '<div style="font-family:\'Cormorant Garamond\',serif;font-size:28px;font-weight:700;color:#F26419;">' + x[1] + '</div>'
                  + '<div style="font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#A08060;">' + x[0] + '</div>'
                  + '</div>';
              }).join('') + '</div>';
          }
        }
        var tixHtml = tix.map(function (t) {
          return '<div style="display:inline-block;background:#1F1A15;border:1px solid rgba(242,100,25,0.18);border-radius:10px;padding:10px 14px;margin:0 8px 8px 0;">'
            + '<div style="font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#A08060;">' + esc(t.label) + '</div>'
            + '<div style="font-family:\'Cormorant Garamond\',serif;font-size:20px;font-weight:700;color:#F26419;">' + (t.free ? 'FREE' : 'R' + t.price) + '</div>'
            + '</div>';
        }).join('');
        var card = document.createElement('div');
        card.className = 'event-card glass';
        card.style.marginBottom = '16px';
        card.innerHTML = (ev.image_url ? '<img src="' + esc(ev.image_url) + '" style="width:100%;height:200px;object-fit:cover;border-radius:16px;margin-bottom:16px;" onerror="this.style.display=\'none\'">' : '')
          + '<span style="display:inline-block;font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 10px;border-radius:6px;margin-bottom:10px;'
          + (ev.is_recurring ? 'background:#2A2218;color:#D9C9B0;border:1px solid rgba(242,100,25,0.18);' : 'background:#D94F00;color:white;') + '">'
          + (ev.is_recurring ? '🔁 Recurring' : '⚡ Special Event') + '</span>'
          + (ev.sold_out ? '<span style="display:inline-block;margin-left:6px;font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 10px;border-radius:6px;background:rgba(255,68,68,0.15);color:#FF4444;border:1px solid rgba(255,68,68,0.3);">Sold Out</span>' : '')
          + '<div style="font-family:\'Cormorant Garamond\',serif;font-size:32px;font-weight:700;color:#FFF;line-height:1.1;margin-bottom:4px;">' + esc(ev.name) + '</div>'
          + (ev.subtitle ? '<div style="font-size:12px;color:#F26419;font-family:Montserrat,sans-serif;font-weight:600;letter-spacing:.5px;margin-bottom:8px;">' + esc(ev.subtitle) + '</div>' : '')
          + '<div style="font-size:12px;color:#A08060;margin-bottom:12px;">' + esc(dateStr) + '</div>'
          + (ev.description ? '<p style="font-size:13px;color:#A08060;line-height:1.6;margin-bottom:14px;">' + esc(ev.description) + '</p>' : '')
          + cdHtml
          + (tix.length ? '<div>' + tixHtml + '</div>' : '');
        bodyEl.appendChild(card);
      });
    } catch (e) { console.warn('FBK events:', e); }
  }

  /* ── FIX 6: Trading Hours ──────────────────────────────── */
  async function loadHours() {
    try {
      var r = await sb.from('trading_hours').select('*').order('day_order');
      if (!r.data || !r.data.length) return;
      var cards = document.querySelectorAll('.info-card');
      var hoursCard = null;
      cards.forEach(function (card) {
        if (card.textContent.indexOf('Trading Hours') >= 0 || card.textContent.indexOf('trading hours') >= 0) hoursCard = card;
      });
      if (!hoursCard) return;
      var p = hoursCard.querySelector('p');
      if (!p) return;
      p.innerHTML = r.data.map(function (h) {
        return '<span style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(242,100,25,0.1);">'
          + '<span style="font-weight:600;color:#A08060;font-size:11px;font-family:Montserrat,sans-serif;text-transform:uppercase;letter-spacing:1px;">' + esc(h.day_name) + '</span>'
          + '<span style="color:' + (h.is_closed ? '#FF4444' : '#F2E8D9') + ';font-size:12px;">' + (h.is_closed ? 'Closed' : fmt(h.open_time) + ' – ' + fmt(h.close_time)) + '</span>'
          + '</span>';
      }).join('');
    } catch (e) { }
  }

  /* ── INIT ──────────────────────────────────────────────── */
  function init() {
    try { sb = supabase.createClient(SB_URL, SB_KEY); } catch (e) { console.warn('FBK patch: Supabase unavailable'); return; }

    removeDashboard();
    patchLogoTap();
    loadBanner();
    loadMenu();
    loadEvents();
    loadHours();

    // Hook navigate() so tab switches re-render live data
    var _origNav = window.navigate;
    if (typeof _origNav === 'function') {
      window.navigate = function (page) {
        _origNav(page);
        if (page === 'menu') loadMenu();
        if (page === 'events') loadEvents();
        if (page === 'findus') loadHours();
      };
    }
  }

  // Fire when DOM + Supabase are both ready
  function tryInit() {
    if (typeof supabase !== 'undefined') { init(); }
    else { setTimeout(tryInit, 100); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
