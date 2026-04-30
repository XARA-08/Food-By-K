/* ═══════════════════════════════════════════════════════════════
   Food By K — patch.js  (SECURED BUILD v2 — ORDER PIPELINE FIX)
   Overrides confirmCollection() to sync orders to Supabase.
   Maps exactly to live HTML element IDs and orders table schema.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SB_URL = 'https://cuzqkwznwsuhjnwqqrix.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1enFrd3pud3N1aGpud3Fxcml4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NTMxNTAsImV4cCI6MjA5MjEyOTE1MH0.Kwk23gVcmDMcCN2APdE8zX8i7hMZC606DVzZz5n9lZ0';

  var CAT = {
    kota:'Kota', sandwiches:'Sandwiches', burgers:'Burgers',
    platters:'Platters', wraps:'Wraps', specialty:'Specialty',
    drinks:'Drinks', addons:'Add-ons'
  };

  var sb, _fbkItems = {};

  /* ── Helpers ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmt(t) { return t ? String(t).slice(0,5) : ''; }

  function sanitize(s) {
    return String(s || '')
      .replace(/<[^>]*>/g,'')
      .replace(/javascript:/gi,'')
      .replace(/on\w+\s*=/gi,'')
      .trim()
      .slice(0,500);
  }

  function validPhone(p) {
    return String(p || '').replace(/[^0-9]/g,'').length >= 9;
  }

  function orderRateCheck() {
    try {
      var k = 'fbk_oc', n = parseInt(sessionStorage.getItem(k) || '0', 10);
      if (n >= 5) return false;
      sessionStorage.setItem(k, String(n + 1));
      return true;
    } catch(e) { return true; }
  }

  /* ── Admin portal: 5 rapid logo taps ────────────────────── */
  function patchLogoTap() {
    window.handleLogoTap = function () {
      window._lt = (window._lt || 0) + 1;
      clearTimeout(window._ltimer);
      window._ltimer = setTimeout(function () { window._lt = 0; }, 2000);
      if (window._lt >= 5) { window._lt = 0; window.location.href = '/admin.html'; }
    };
  }

  function removeDashboard() {
    var d = document.getElementById('page-dashboard');
    if (d) d.remove();
  }

  /* ── openItem override for Supabase UUID keys ────────────── */
  function patchOpenItem() {
    var _orig = window.openItem;
    window.openItem = function (id) {
      var item = _fbkItems[id];
      if (!item) { if (typeof _orig === 'function') _orig(id); return; }
      window.curItem = id; window.curQty = 1;
      var si = document.getElementById('sheet-img');
      if (si) { if (item.img) { si.src = item.img; si.style.display = 'block'; } else si.style.display = 'none'; }
      var sn = document.getElementById('sheet-name'); if (sn) sn.textContent = item.name;
      var sd = document.getElementById('sheet-desc'); if (sd) sd.textContent = item.desc || '';
      var sp = document.getElementById('sheet-price'); if (sp) sp.textContent = 'R' + Number(item.price).toFixed(0) + '.00';
      var qt = document.getElementById('qty-tot');  if (qt) qt.textContent = 'R' + Number(item.price).toFixed(0) + '.00';
      var qn = document.getElementById('qty-n');    if (qn) qn.textContent = '1';
      var ins = document.getElementById('sheet-instr'); if (ins) ins.value = '';
      var sheet = document.getElementById('item-sheet'); if (sheet) sheet.classList.add('open');
    };
  }

  /* ══════════════════════════════════════════════════════════
     ORDER PIPELINE — confirmCollection() OVERRIDE
     
     Root cause of the breakage:
       1. The deployed patch.js was the OLD version (no patchOrderFlow)
       2. The original confirmCollection() only saved to localStorage
       3. RLS policy had a merchant_ref uniqueness issue
     
     This override:
       - Runs AFTER index.html's script block (patch.js loads last)
       - Reads exact element IDs: #customer-name, #customer-phone
       - Captures #sheet-instr before the item sheet closes
       - Inserts into orders with all required columns
       - Falls back gracefully — receipt always shows even if DB hiccups
  ══════════════════════════════════════════════════════════ */
  function patchOrderFlow() {

    /* Intercept addToBasket to capture instructions
       before the item sheet disappears                    */
    var _origAdd = window.addToBasket;
    window.addToBasket = function () {
      var instrEl = document.getElementById('sheet-instr');
      window._lastInstr = instrEl ? sanitize(instrEl.value || '') : '';
      if (typeof _origAdd === 'function') _origAdd.apply(this, arguments);
    };

    window.confirmCollection = async function () {

      /* ── Guard: slot selected ── */
      if (!window.selectedSlot) {
        if (typeof window.showToast === 'function') window.showToast('Please choose a collection time');
        return;
      }

      /* ── Read customer inputs ── */
      var nameEl  = document.getElementById('customer-name');
      var phoneEl = document.getElementById('customer-phone');
      var name    = sanitize(nameEl  ? nameEl.value.trim()  : '');
      var phone   = sanitize(phoneEl ? phoneEl.value.trim() : '');
      var instr   = window._lastInstr || '';

      if (!name) {
        if (typeof window.showToast === 'function') window.showToast('Please enter your name');
        return;
      }
      if (!validPhone(phone)) {
        if (typeof window.showToast === 'function') window.showToast('Please enter a valid phone number');
        return;
      }

      /* ── Rate limit ── */
      if (!orderRateCheck()) {
        if (typeof window.showToast === 'function') window.showToast('Too many orders — please call us directly');
        return;
      }

      /* ── Basket ── */
      var basket = window.basket || [];
      if (!basket.length) {
        if (typeof window.showToast === 'function') window.showToast('Your basket is empty');
        return;
      }
      var total = basket.reduce(function (s, i) { return s + (i.price * (i.qty || 1)); }, 0);

      /* ── Build IDs and display strings ── */
      var now     = new Date();
      var dateStr = now.toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' });
      var timeStr = now.toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit' });
      var orderId = typeof window.genOrderId === 'function'
        ? window.genOrderId()
        : ('FBK-' + Date.now().toString(36).toUpperCase());

      /* ── Close collection picker immediately (snappy UX) ── */
      var picker = document.getElementById('collection-picker');
      if (picker) picker.style.display = 'none';

      /* ── Supabase insert ──
           Columns: customer_name, customer_phone, amount,
                    items (jsonb), instructions, collect_at,
                    status, merchant_ref
           All other columns have DB defaults (id, created_at,
           secure_token, token_expires_at, is_collected, etc.)  */
      var dbId = null;
      if (sb) {
        try {
          var payload = {
            customer_name:  name,
            customer_phone: phone,
            amount:         total,
            items:          basket.map(function (i) {
                              return { name: sanitize(i.name || ''), price: i.price, qty: i.qty || 1 };
                            }),
            instructions:   instr,
            collect_at:     window.selectedSlot,
            status:         'pending',
            merchant_ref:   orderId
          };

          var res = await sb.from('orders').insert(payload).select('id').single();

          if (res.error) {
            console.warn('[FBK] Order save failed:', res.error.message);
            /* Non-blocking: customer still gets receipt */
          } else if (res.data && res.data.id) {
            dbId = res.data.id;
            orderId = String(dbId).slice(-8).toUpperCase();
          }
        } catch (e) {
          console.warn('[FBK] Order exception:', e);
        }
      }

      /* ── localStorage backup ── */
      try {
        var stored = JSON.parse(localStorage.getItem('fbk_orders') || '[]');
        stored.unshift({ id: orderId, dbId: dbId, name: name, phone: phone,
          items: basket.map(function(i){return Object.assign({},i);}),
          total: total, instructions: instr,
          collectAt: window.selectedSlot,
          orderedAt: dateStr + ' at ' + timeStr, status: 'confirmed' });
        if (stored.length > 100) stored.pop();
        localStorage.setItem('fbk_orders', JSON.stringify(stored));
      } catch(e) {}

      /* ── Clear basket ── */
      window.basket = [];
      if (typeof window.updateBasket === 'function') window.updateBasket();
      window.selectedSlot = null;
      window._lastInstr   = '';

      /* ── Show receipt — exact shape showOrderReceipt() expects ── */
      if (typeof window.showOrderReceipt === 'function') {
        window.showOrderReceipt({
          id:          orderId,
          name:        name,
          phone:       phone,
          items:       basket.map(function(i){return Object.assign({},i);}),
          total:       total,
          instructions:instr,
          collectAt:   window.selectedSlot || '',
          orderedAt:   dateStr + ' at ' + timeStr,
          status:      'confirmed'
        });
      }
    };
  }

  /* ── Announcement banner ─────────────────────────────────── */
  async function loadBanner() {
    try {
      var r = await sb.from('announcements').select('message').eq('active', true).limit(1);
      if (!r.data || !r.data.length || !r.data[0].message) return;
      var ex = document.getElementById('fbk-ann-banner'); if (ex) ex.remove();
      var b = document.createElement('div');
      b.id = 'fbk-ann-banner';
      b.style.cssText = 'position:sticky;top:0;z-index:999;background:linear-gradient(90deg,#B03E00,#F26419);color:#fff;padding:10px 44px 10px 16px;font-family:Montserrat,sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;line-height:1.4;text-align:center;';
      b.innerHTML = esc(r.data[0].message) + '<button onclick="this.parentElement.remove()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.2);border:none;color:#fff;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:16px;">×</button>';
      var home = document.getElementById('page-home');
      if (home) home.insertBefore(b, home.firstChild);
    } catch(e) {}
  }

  /* ── Menu loader ─────────────────────────────────────────── */
  async function loadMenu() {
    var bodyEl  = document.querySelector('.menu-body');
    var pillsEl = document.querySelector('.menu-cats');
    if (!bodyEl || !pillsEl) return;
    try {
      var r = await sb.from('menu_items').select('*').order('category').order('sort_order');
      if (!r.data || !r.data.length) return;
      _fbkItems = {};
      r.data.forEach(function (item) {
        _fbkItems[item.id] = { name: item.name, desc: item.description || '', price: item.price, img: item.image_url || '' };
        try { if (window.ITEMS) window.ITEMS[item.id] = _fbkItems[item.id]; } catch(e) {}
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
        return '<div class="menu-sec' + (i === 0 ? ' on' : '') + '" id="cat-' + cat + '">' +
          grouped[cat].map(function (item) {
            var avail = item.available !== false;
            var img   = item.image_url || 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=220&q=80';
            return '<div class="menu-card' + (avail ? '' : ' sold-out-card') + '"' +
              ' onclick="' + (avail ? 'openItem(\'' + item.id + '\')' : 'typeof showToast===\'function\'&&showToast(\'Sold out today\')') + '"' +
              ' style="' + (avail ? '' : 'opacity:.6;cursor:default;') + '">' +
              '<div class="mc-info"><div class="mc-name">' + esc(item.name) + '</div>' +
              '<div class="mc-desc">' + esc(item.description || '') + '</div>' +
              '<div class="mc-footer"><span class="mc-price">R' + Number(item.price).toFixed(0) + '</span>' +
              (avail
                ? '<div class="mc-add">+</div>'
                : '<div class="mc-add" style="background:#1F1A15;color:#A08060;font-size:9px;font-family:Montserrat,sans-serif;padding:0 8px;font-weight:700;letter-spacing:1px;">SOLD</div>') +
              '</div></div>' +
              '<img class="mc-img" src="' + esc(img) + '" alt="' + esc(item.name) + '" loading="lazy"' +
              ' onerror="this.src=\'https://images.unsplash.com/photo-1550547660-d9450f859349?w=220&q=80\'">' +
              '</div>';
          }).join('') + '</div>';
      }).join('');
    } catch(e) { console.warn('[FBK] menu:', e); }
  }

  /* ── Events loader ───────────────────────────────────────── */
  async function loadEvents() {
    var bodyEl = document.querySelector('.events-body');
    if (!bodyEl) return;
    try {
      var r = await sb.from('events').select('*').eq('active', true).order('created_at', { ascending: false });
      if (!r.data || !r.data.length) return;
      var topbar = bodyEl.querySelector('.page-topbar');
      bodyEl.innerHTML = '';
      if (topbar) bodyEl.appendChild(topbar);
      r.data.forEach(function (ev) {
        var tix     = Array.isArray(ev.tickets) ? ev.tickets : [];
        var dateStr = ev.event_date
          ? new Date(ev.event_date + 'T00:00:00').toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
          : (ev.recurring_day || 'Date TBC');
        var cdHtml = '';
        if (!ev.is_recurring && ev.event_date) {
          var target = new Date(ev.event_date + (ev.start_time ? 'T' + ev.start_time : 'T00:00:00'));
          var diff = target - new Date();
          if (diff > 0) {
            var d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000);
            cdHtml = '<div style="display:flex;gap:10px;margin:12px 0 16px;">'
              + [['Days',d],['Hrs',h],['Min',m]].map(function (x) {
                  return '<div style="text-align:center;background:#1F1A15;border:1px solid rgba(242,100,25,0.18);border-radius:12px;padding:10px 14px;min-width:52px;">' +
                    '<div style="font-family:\'Cormorant Garamond\',serif;font-size:28px;font-weight:700;color:#F26419;">' + x[1] + '</div>' +
                    '<div style="font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#A08060;">' + x[0] + '</div></div>';
                }).join('') + '</div>';
          }
        }
        var card = document.createElement('div');
        card.className = 'event-card glass';
        card.style.marginBottom = '16px';
        card.innerHTML =
          (ev.image_url ? '<img src="' + esc(ev.image_url) + '" style="width:100%;height:200px;object-fit:cover;border-radius:16px;margin-bottom:16px;" onerror="this.style.display=\'none\'">' : '') +
          '<span style="display:inline-block;font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 10px;border-radius:6px;margin-bottom:10px;' +
          (ev.is_recurring ? 'background:#2A2218;color:#D9C9B0;border:1px solid rgba(242,100,25,0.18);' : 'background:#D94F00;color:white;') + '">' +
          (ev.is_recurring ? '🔁 Recurring' : '⚡ Special Event') + '</span>' +
          (ev.sold_out ? '<span style="display:inline-block;margin-left:6px;font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 10px;border-radius:6px;background:rgba(255,68,68,0.15);color:#FF4444;border:1px solid rgba(255,68,68,0.3);">Sold Out</span>' : '') +
          '<div style="font-family:\'Cormorant Garamond\',serif;font-size:32px;font-weight:700;color:#FFF;line-height:1.1;margin-bottom:4px;">' + esc(ev.name) + '</div>' +
          (ev.subtitle ? '<div style="font-size:12px;color:#F26419;font-family:Montserrat,sans-serif;font-weight:600;letter-spacing:.5px;margin-bottom:8px;">' + esc(ev.subtitle) + '</div>' : '') +
          '<div style="font-size:12px;color:#A08060;margin-bottom:12px;">' + esc(dateStr) + '</div>' +
          (ev.description ? '<p style="font-size:13px;color:#A08060;line-height:1.6;margin-bottom:14px;">' + esc(ev.description) + '</p>' : '') +
          cdHtml +
          (tix.length ? '<div>' + tix.map(function (t) {
            return '<div style="display:inline-block;background:#1F1A15;border:1px solid rgba(242,100,25,0.18);border-radius:10px;padding:10px 14px;margin:0 8px 8px 0;">' +
              '<div style="font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#A08060;">' + esc(t.label) + '</div>' +
              '<div style="font-family:\'Cormorant Garamond\',serif;font-size:20px;font-weight:700;color:#F26419;">' + (t.free ? 'FREE' : 'R' + t.price) + '</div></div>';
          }).join('') + '</div>' : '');
        bodyEl.appendChild(card);
      });
    } catch(e) { console.warn('[FBK] events:', e); }
  }

  /* ── Trading hours loader ────────────────────────────────── */
  async function loadHours() {
    try {
      var r = await sb.from('trading_hours').select('*').order('day_order');
      if (!r.data || !r.data.length) return;
      var hoursCard = null;
      document.querySelectorAll('.info-card').forEach(function (card) {
        if (card.textContent.indexOf('Trading Hours') >= 0 || card.textContent.indexOf('trading hours') >= 0) hoursCard = card;
      });
      if (!hoursCard) return;
      var p = hoursCard.querySelector('p'); if (!p) return;
      p.innerHTML = r.data.map(function (h) {
        return '<span style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(242,100,25,0.1);">' +
          '<span style="font-weight:600;color:#A08060;font-size:11px;font-family:Montserrat,sans-serif;text-transform:uppercase;letter-spacing:1px;">' + esc(h.day_name) + '</span>' +
          '<span style="color:' + (h.is_closed ? '#FF4444' : '#F2E8D9') + ';font-size:12px;">' + (h.is_closed ? 'Closed' : fmt(h.open_time) + ' – ' + fmt(h.close_time)) + '</span>' +
          '</span>';
      }).join('');
    } catch(e) {}
  }

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    try { sb = supabase.createClient(SB_URL, SB_KEY); } catch(e) { console.warn('[FBK] Supabase init failed'); return; }
    removeDashboard();
    patchLogoTap();
    patchOpenItem();
    patchOrderFlow();
    loadBanner();
    loadMenu();
    loadEvents();
    loadHours();
    var _nav = window.navigate;
    if (typeof _nav === 'function') {
      window.navigate = function (page) {
        _nav(page);
        if (page === 'menu')   loadMenu();
        if (page === 'events') loadEvents();
        if (page === 'findus') loadHours();
      };
    }
  }

  function tryInit() {
    if (typeof supabase !== 'undefined') { init(); }
    else { setTimeout(tryInit, 100); }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', tryInit); }
  else { tryInit(); }

})();
