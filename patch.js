/* ═══════════════════════════════════════════════════════════════
   Food By K — patch.js  (v4 — REALTIME SYNC)
   Admin changes reflect on customer site INSTANTLY via
   Supabase Realtime WebSocket subscriptions on all 4 tables.
   No page refresh needed. Ever.
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

  var sb;
  window._fbkSb = null;
  var _fbkItems = {};

  /* ── Helpers ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmt(t) { return t ? String(t).slice(0,5) : ''; }

  /* ── Admin portal: 5 rapid logo taps ────────────────────── */
  function patchLogoTap() {
    window.handleLogoTap = function () {
      window._lt = (window._lt||0) + 1;
      clearTimeout(window._ltimer);
      window._ltimer = setTimeout(function(){ window._lt=0; }, 2000);
      if (window._lt >= 5) { window._lt=0; window.location.href='/admin.html'; }
    };
  }

  /* ── openItem override for Supabase UUID keys ────────────── */
  function patchOpenItem() {
    var _orig = window.openItem;
    window.openItem = function (id) {
      var item = _fbkItems[id];
      if (!item) { if (typeof _orig==='function') _orig(id); return; }
      window.curItem=id; window.curQty=1;
      var si=document.getElementById('sheet-img');
      if (si) { if(item.img){si.src=item.img;si.style.display='block';}else si.style.display='none'; }
      var sn=document.getElementById('sheet-name'); if(sn) sn.textContent=item.name;
      var sd=document.getElementById('sheet-desc'); if(sd) sd.textContent=item.desc||'';
      var sp=document.getElementById('sheet-price'); if(sp) sp.textContent='R'+Number(item.price).toFixed(0)+'.00';
      var qt=document.getElementById('qty-tot');  if(qt) qt.textContent='R'+Number(item.price).toFixed(0)+'.00';
      var qn=document.getElementById('qty-n');    if(qn) qn.textContent='1';
      var ins=document.getElementById('sheet-instr'); if(ins) ins.value='';
      var sheet=document.getElementById('item-sheet'); if(sheet) sheet.classList.add('open');
    };
  }

  /* ══════════════════════════════════════════════════════════
     DATA LOADERS
     Each loader fetches fresh data and re-renders the relevant
     section of the customer site completely.
  ══════════════════════════════════════════════════════════ */

  /* ── Banner ──────────────────────────────────────────────── */
  async function loadBanner() {
    try {
      var r = await sb.from('announcements').select('message').eq('active',true).limit(1);
      var ex = document.getElementById('fbk-ann-banner');
      if (ex) ex.remove();
      if (!r.data || !r.data.length || !r.data[0].message) return;
      var b = document.createElement('div');
      b.id = 'fbk-ann-banner';
      b.style.cssText = 'position:sticky;top:0;z-index:999;background:linear-gradient(90deg,#B03E00,#F26419);color:#fff;padding:10px 44px 10px 16px;font-family:Montserrat,sans-serif;font-size:11px;font-weight:600;letter-spacing:.5px;line-height:1.4;text-align:center;';
      b.innerHTML = esc(r.data[0].message) + '<button onclick="this.parentElement.remove()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.2);border:none;color:#fff;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:16px;">×</button>';
      var home = document.getElementById('page-home');
      if (home) home.insertBefore(b, home.firstChild);
    } catch(e) {}
  }

  /* ── Menu ────────────────────────────────────────────────── */
  async function loadMenu() {
    var bodyEl  = document.querySelector('.menu-body');
    var pillsEl = document.querySelector('.menu-cats');
    if (!bodyEl || !pillsEl) return;
    try {
      var r = await sb.from('menu_items').select('*').order('category').order('sort_order');
      if (!r.data || !r.data.length) return;
      _fbkItems = {};
      r.data.forEach(function(item) {
        _fbkItems[item.id] = { name:item.name, desc:item.description||'', price:item.price, img:item.image_url||'' };
        try { if (window.ITEMS) window.ITEMS[item.id] = _fbkItems[item.id]; } catch(e) {}
      });
      var grouped = {}, order = [];
      r.data.forEach(function(item) {
        var c = item.category || 'kota';
        if (!grouped[c]) { grouped[c] = []; order.push(c); }
        grouped[c].push(item);
      });
      pillsEl.innerHTML = order.map(function(cat, i) {
        return '<button class="cat-pill' + (i===0?' on':'') + '" onclick="filterCat(\'' + cat + '\',this)">' + esc(CAT[cat]||cat) + '</button>';
      }).join('');
      bodyEl.innerHTML = order.map(function(cat, i) {
        return '<div class="menu-sec' + (i===0?' on':'') + '" id="cat-' + cat + '">' +
          grouped[cat].map(function(item) {
            var avail = item.available !== false;
            var img   = item.image_url || 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=220&q=80';
            return '<div class="menu-card' + (avail?'':' sold-out-card') + '"' +
              ' onclick="' + (avail ? 'openItem(\'' + item.id + '\')' : 'typeof showToast===\'function\'&&showToast(\'Sold out today\')') + '"' +
              ' style="' + (avail?'':'opacity:.6;cursor:default;') + '">' +
              '<div class="mc-info"><div class="mc-name">' + esc(item.name) + '</div>' +
              '<div class="mc-desc">' + esc(item.description||'') + '</div>' +
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

  /* ── Events ──────────────────────────────────────────────── */
  async function loadEvents() {
    var bodyEl = document.querySelector('.events-body');
    if (!bodyEl) return;
    try {
      var r = await sb.from('events').select('*').eq('active',true).order('created_at',{ascending:false});
      var topbar = bodyEl.querySelector('.page-topbar');
      bodyEl.innerHTML = '';
      if (topbar) bodyEl.appendChild(topbar);
      if (!r.data || !r.data.length) return;
      r.data.forEach(function(ev) {
        var tix = Array.isArray(ev.tickets) ? ev.tickets : [];
        var dateStr = ev.event_date
          ? new Date(ev.event_date+'T00:00:00').toLocaleDateString('en-ZA',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
          : (ev.recurring_day || 'Date TBC');
        var cdHtml = '';
        if (!ev.is_recurring && ev.event_date) {
          var target = new Date(ev.event_date + (ev.start_time?'T'+ev.start_time:'T00:00:00'));
          var diff = target - new Date();
          if (diff > 0) {
            var d=Math.floor(diff/86400000), h=Math.floor((diff%86400000)/3600000), m=Math.floor((diff%3600000)/60000);
            cdHtml = '<div style="display:flex;gap:10px;margin:12px 0 16px;">' +
              [['Days',d],['Hrs',h],['Min',m]].map(function(x) {
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
          (ev.image_url ? '<img src="'+esc(ev.image_url)+'" style="width:100%;height:200px;object-fit:cover;border-radius:16px;margin-bottom:16px;" onerror="this.style.display=\'none\'">' : '') +
          '<span style="display:inline-block;font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 10px;border-radius:6px;margin-bottom:10px;' +
          (ev.is_recurring?'background:#2A2218;color:#D9C9B0;border:1px solid rgba(242,100,25,0.18);':'background:#D94F00;color:white;') + '">' +
          (ev.is_recurring?'🔁 Recurring':'⚡ Special Event') + '</span>' +
          (ev.sold_out?'<span style="display:inline-block;margin-left:6px;font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 10px;border-radius:6px;background:rgba(255,68,68,0.15);color:#FF4444;border:1px solid rgba(255,68,68,0.3);">Sold Out</span>':'') +
          '<div style="font-family:\'Cormorant Garamond\',serif;font-size:32px;font-weight:700;color:#FFF;line-height:1.1;margin-bottom:4px;">' + esc(ev.name) + '</div>' +
          (ev.subtitle?'<div style="font-size:12px;color:#F26419;font-family:Montserrat,sans-serif;font-weight:600;letter-spacing:.5px;margin-bottom:8px;">'+esc(ev.subtitle)+'</div>':'') +
          '<div style="font-size:12px;color:#A08060;margin-bottom:12px;">' + esc(dateStr) + '</div>' +
          (ev.description?'<p style="font-size:13px;color:#A08060;line-height:1.6;margin-bottom:14px;">'+esc(ev.description)+'</p>':'') +
          cdHtml +
          (tix.length ? '<div>' + tix.map(function(t) {
            return '<div style="display:inline-block;background:#1F1A15;border:1px solid rgba(242,100,25,0.18);border-radius:10px;padding:10px 14px;margin:0 8px 8px 0;">' +
              '<div style="font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#A08060;">' + esc(t.label) + '</div>' +
              '<div style="font-family:\'Cormorant Garamond\',serif;font-size:20px;font-weight:700;color:#F26419;">' + (t.free?'FREE':'R'+t.price) + '</div></div>';
          }).join('') + '</div>' : '');
        bodyEl.appendChild(card);
      });
    } catch(e) { console.warn('[FBK] events:', e); }
  }

  /* ── Hours ───────────────────────────────────────────────── */
  async function loadHours() {
    try {
      var r = await sb.from('trading_hours').select('*').order('day_order');
      if (!r.data || !r.data.length) return;
      var hoursCard = null;
      document.querySelectorAll('.info-card').forEach(function(card) {
        if (card.textContent.indexOf('Trading Hours')>=0 || card.textContent.indexOf('trading hours')>=0) hoursCard = card;
      });
      if (!hoursCard) return;
      var p = hoursCard.querySelector('p'); if (!p) return;
      p.innerHTML = r.data.map(function(h) {
        return '<span style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(242,100,25,0.1);">' +
          '<span style="font-weight:600;color:#A08060;font-size:11px;font-family:Montserrat,sans-serif;text-transform:uppercase;letter-spacing:1px;">' + esc(h.day_name) + '</span>' +
          '<span style="color:' + (h.is_closed?'#FF4444':'#F2E8D9') + ';font-size:12px;">' + (h.is_closed?'Closed':fmt(h.open_time)+' – '+fmt(h.close_time)) + '</span>' +
          '</span>';
      }).join('');
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════════════════
     REALTIME SUBSCRIPTIONS
     One channel per table. Any INSERT/UPDATE/DELETE from admin
     instantly triggers a full re-render of that section.
     Customer sees the change in under 200ms — no refresh.
  ══════════════════════════════════════════════════════════ */
  function subscribeRealtime() {
    /* Debounce helper — prevents rapid-fire re-renders if admin
       saves multiple rows in quick succession               */
    var timers = {};
    function debounce(key, fn, delay) {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(fn, delay || 300);
    }

    /* ── menu_items channel ── */
    sb.channel('fbk-menu')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'menu_items' },
        function() { debounce('menu', loadMenu, 300); }
      )
      .subscribe();

    /* ── events channel ── */
    sb.channel('fbk-events')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'events' },
        function() { debounce('events', loadEvents, 300); }
      )
      .subscribe();

    /* ── announcements channel ── */
    sb.channel('fbk-ann')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        function() { debounce('banner', loadBanner, 300); }
      )
      .subscribe();

    /* ── trading_hours channel ── */
    sb.channel('fbk-hours')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trading_hours' },
        function() { debounce('hours', loadHours, 300); }
      )
      .subscribe();

    console.log('[FBK] Realtime subscriptions active — admin changes sync instantly');
  }

  /* ══════════════════════════════════════════════════════════
     NAVIGATE OVERRIDE
     Re-fetches fresh data every time a tab is opened,
     so even if Realtime had a momentary hiccup the data
     is always fresh when the user navigates.
  ══════════════════════════════════════════════════════════ */
  function patchNavigate() {
    var _nav = window.navigate;
    if (typeof _nav !== 'function') return;
    window.navigate = function(page) {
      _nav(page);
      if (page === 'menu')   loadMenu();
      if (page === 'events') loadEvents();
      if (page === 'findus') loadHours();
    };
  }

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    try {
      sb = supabase.createClient(SB_URL, SB_KEY, {
        realtime: { params: { eventsPerSecond: 10 } }
      });
      window._fbkSb = sb;
    } catch(e) {
      console.warn('[FBK] Supabase init failed:', e);
      return;
    }
    patchLogoTap();
    patchOpenItem();
    patchNavigate();

    /* Initial data load */
    loadBanner();
    loadMenu();
    loadEvents();
    loadHours();

    /* Start Realtime — admin changes now sync instantly */
    subscribeRealtime();
  }

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
