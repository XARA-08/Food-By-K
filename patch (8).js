/* ═══════════════════════════════════════════════════════════════
   Food By K — patch.js  (v6 — ORDER FIX BUILD)
   FIXES IN THIS VERSION:
   1. getCollectionSlots() now fetches live trading_hours from Supabase
      — respects admin-set open/close times and closed days exactly
   2. confirmCollection() now properly detects Supabase insert errors
      — shows the customer a clear error message instead of a fake receipt
   3. Supabase insert result is checked for both .error and .data
   4. User gets a friendly retry prompt if the order fails to save
   5. checkout() now async — awaits live trading hours before showing slots
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

  // Cache for trading hours — refreshed on each checkout attempt
  var _tradingHoursCache = null;
  var _tradingHoursCacheTime = 0;
  var CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

  /* ══════════════════════════════════════════════════════════
     TRADING HOURS — fetched live from Supabase
     Returns the row for today, or null if closed/not found.
  ══════════════════════════════════════════════════════════ */
  async function fetchTradingHours() {
    var now = Date.now();
    if (_tradingHoursCache && (now - _tradingHoursCacheTime) < CACHE_TTL) {
      return _tradingHoursCache;
    }
    try {
      var r = await sb.from('trading_hours').select('*').order('day_order');
      if (r.error || !r.data) return null;
      _tradingHoursCache = r.data;
      _tradingHoursCacheTime = now;
      return r.data;
    } catch(e) {
      return null;
    }
  }

  /* ══════════════════════════════════════════════════════════
     GET COLLECTION SLOTS — FIX v6
     Previously: hardcoded 11:00-18:00, no day-of-week check.
     Now: reads live trading_hours from Supabase for today's day,
          respects is_closed flag and admin-set open/close times.
  ══════════════════════════════════════════════════════════ */
  async function getCollectionSlotsLive() {
    var now = new Date();
    var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var todayName = dayNames[now.getDay()];

    // Fetch live trading hours
    var hours = await fetchTradingHours();

    var openHour = 11, openMin = 0, closeHour = 18, closeMin = 0;

    if (hours) {
      var todayRow = null;
      for (var i = 0; i < hours.length; i++) {
        if (hours[i].day_name === todayName) { todayRow = hours[i]; break; }
      }
      if (!todayRow || todayRow.is_closed) {
        // Today is closed — return empty slots
        return [];
      }
      // Parse open/close times from Supabase (format: "HH:MM:SS" or "HH:MM")
      if (todayRow.open_time) {
        var op = todayRow.open_time.split(':');
        openHour = parseInt(op[0], 10);
        openMin  = parseInt(op[1], 10) || 0;
      }
      if (todayRow.close_time) {
        var cp = todayRow.close_time.split(':');
        closeHour = parseInt(cp[0], 10);
        closeMin  = parseInt(cp[1], 10) || 0;
      }
    } else {
      // Fallback: if Supabase unavailable, use hardcoded but still check day
      if (now.getDay() === 0) return []; // Sunday closed
    }

    // Convert open/close to minutes-since-midnight for easy comparison
    var openTotal  = openHour  * 60 + openMin;
    var closeTotal = closeHour * 60 + closeMin;

    // Build slots starting 20 min from now, rounded up to next 15-min mark
    var slots = [];
    var t = new Date(now.getTime() + 20 * 60000);
    t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15, 0, 0);

    for (var j = 0; j < 8; j++) {
      var tMins = t.getHours() * 60 + t.getMinutes();
      if (tMins >= openTotal && tMins < closeTotal) {
        slots.push(
          String(t.getHours()).padStart(2,'0') + ':' +
          String(t.getMinutes()).padStart(2,'0')
        );
      }
      t = new Date(t.getTime() + 15 * 60000);
    }
    return slots;
  }

  /* ══════════════════════════════════════════════════════════
     PATCH checkout() — async version that uses live hours
     Overrides the hardcoded synchronous version in index.html
  ══════════════════════════════════════════════════════════ */
  function patchCheckout() {
    window.checkout = async function() {
      var basket = window.basket || [];
      // basket may be the module-scope var; access via the global if needed
      // Try to get from the original scope by rechecking
      if (typeof basket === 'undefined' || !Array.isArray(basket)) {
        basket = [];
      }
      var total = basket.reduce(function(s,i){ return s + i.price * i.qty; }, 0);
      if (total === 0) {
        if (typeof window.showToast === 'function') window.showToast('Your basket is empty');
        return;
      }

      // Show a brief loading state on the checkout button if it exists
      var checkoutBtn = document.querySelector('[onclick*="checkout"]');
      if (checkoutBtn) { checkoutBtn.style.opacity = '0.5'; checkoutBtn.style.pointerEvents = 'none'; }

      var slots = await getCollectionSlotsLive();

      if (checkoutBtn) { checkoutBtn.style.opacity = ''; checkoutBtn.style.pointerEvents = ''; }

      if (!slots || slots.length === 0) {
        if (typeof window.showToast === 'function') {
          window.showToast('Sorry — we are closed today. Check our trading hours.');
        }
        return;
      }
      if (typeof window.showCollectionPicker === 'function') {
        window.showCollectionPicker(slots, total);
      }
    };
  }

  /* ══════════════════════════════════════════════════════════
     PATCH confirmCollection() — adds proper error handling
     Previously: errors were caught and silently ignored,
     receipt was shown even when DB insert failed.
     Now: checks res.error, shows user-facing error on failure,
     never shows a receipt for an order that wasn't saved.
  ══════════════════════════════════════════════════════════ */
  function patchConfirmCollection() {
    window.confirmCollection = async function() {
      if (!window.selectedSlot) {
        if (typeof window.showToast === 'function') window.showToast('Please choose a collection time');
        return;
      }

      var sanitize = window.sanitize || function(s){ return String(s).replace(/[<>"&']/g, function(c){ return {'<':'&lt;','>':'&gt;','"':'&quot;','&':'&amp;',"'":'&#x27;'}[c]||c; }); };

      var nameEl  = document.getElementById('customer-name');
      var phoneEl = document.getElementById('customer-phone');
      var instrEl = document.getElementById('sheet-instr');

      var name  = nameEl  ? sanitize(nameEl.value.trim())  : '';
      var phone = phoneEl ? sanitize(phoneEl.value.trim()) : '';
      var instr = instrEl ? sanitize(instrEl.value.trim()) : '';

      if (!name)  { if (typeof window.showToast === 'function') window.showToast('Please enter your name');  return; }
      if (!phone || phone.replace(/[^0-9]/g,'').length < 9) {
        if (typeof window.showToast === 'function') window.showToast('Please enter a valid phone number');
        return;
      }

      var basket = Array.isArray(window.basket) ? window.basket : [];
      if (!basket.length) {
        if (typeof window.showToast === 'function') window.showToast('Your basket is empty');
        return;
      }

      // Hide picker, show loading
      var pickerEl = document.getElementById('collection-picker');
      if (pickerEl) pickerEl.style.display = 'none';

      // Show a saving indicator
      if (typeof window.showToast === 'function') window.showToast('Placing your order…');

      var genOrderId = window.genOrderId || function(){
        var ts  = Date.now().toString(36).toUpperCase();
        var arr = new Uint8Array(4);
        window.crypto.getRandomValues(arr);
        var rand = Array.from(arr).map(function(b){ return b.toString(16).toUpperCase().padStart(2,'0'); }).join('');
        return 'FBK-'+ts+'-'+rand;
      };

      var orderId   = genOrderId();
      var now       = new Date();
      var dateStr   = now.toLocaleDateString('en-ZA',{day:'2-digit',month:'short',year:'numeric'});
      var timeStr   = now.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'});
      var total     = basket.reduce(function(s,i){ return s + i.price * i.qty; }, 0);
      var orderItems = basket.map(function(i){ return Object.assign({},i); });

      var order = {
        id: orderId,
        name: name,
        phone: phone,
        items: orderItems,
        total: total,
        instructions: instr,
        collectAt: window.selectedSlot,
        orderedAt: dateStr + ' at ' + timeStr,
        status: 'confirmed'
      };

      /* ── Persist to Supabase — WITH PROPER ERROR HANDLING ── */
      var orderSaved = false;
      var saveError  = null;

      try {
        var _sb = sb || supabase.createClient(SB_URL, SB_KEY);
        var payload = {
          customer_name:  name,
          customer_phone: phone,
          amount:         total,
          items:          orderItems.map(function(i){ return {name:i.name, price:i.price, qty:i.qty}; }),
          instructions:   instr,
          collect_at:     window.selectedSlot,
          status:         'pending',
          merchant_ref:   orderId
        };

        var res = await _sb.from('orders').insert(payload).select('id').single();

        // ── KEY FIX: check res.error, not just res.data ──
        if (res.error) {
          saveError = res.error.message || 'Database error';
          console.error('[FBK] order insert error:', res.error);
        } else if (res.data && res.data.id) {
          order.id = String(res.data.id).slice(-8).toUpperCase();
          orderSaved = true;
        } else {
          // Unexpected: no error but also no data
          saveError = 'No confirmation from server';
          console.error('[FBK] order insert: no data returned', res);
        }
      } catch(e) {
        saveError = e.message || 'Network error';
        console.error('[FBK] order sync exception:', e);
      }

      /* ── If save failed, tell the customer and restore UI ── */
      if (!orderSaved) {
        // Restore picker so they can retry
        if (pickerEl) pickerEl.style.display = 'flex';
        var friendlyMsg = 'Order failed to save. Please try again.';
        if (saveError && (saveError.toLowerCase().includes('network') || saveError.toLowerCase().includes('fetch'))) {
          friendlyMsg = 'No connection. Please check your internet and retry.';
        }
        if (typeof window.showToast === 'function') window.showToast(friendlyMsg);
        return; // ← CRITICAL: do NOT show receipt for failed order
      }

      /* ── Order saved successfully — localStorage backup ── */
      try {
        var existing = JSON.parse(localStorage.getItem('fbk_orders') || '[]');
        existing.unshift(order);
        if (existing.length > 100) existing.pop();
        localStorage.setItem('fbk_orders', JSON.stringify(existing));
      } catch(e) {}

      /* ── Clear basket and show receipt ── */
      if (Array.isArray(window.basket)) {
        window.basket = [];
        if (typeof window.updateBasket === 'function') window.updateBasket();
      }
      window.selectedSlot = null;

      if (typeof window.showOrderReceipt === 'function') {
        window.showOrderReceipt(order);
      }
    };
  }

  /* ══════════════════════════════════════════════════════════
     MENU LOADER
     KEY FIX: After fetching rows from Supabase, we immediately
     seed window.ITEMS with UUID keys. This means:
       - openItem(uuid) → works via original index.html function
       - ITEMS[curItem]  → resolves in confirmUpsell/skipUpsell
       - addToBasket(item.name, ...)  → correct name + price
       - showToast(name + ' added!') → correct toast message
     No override of openItem needed at all.
  ══════════════════════════════════════════════════════════ */
  async function loadMenu() {
    var bodyEl  = document.querySelector('.menu-body');
    var pillsEl = document.querySelector('.menu-cats');
    if (!bodyEl || !pillsEl) return;
    try {
      var r = await sb.from('menu_items').select('*').order('category').order('sort_order');
      if (!r.data || !r.data.length) return;

      /* ── Seed ITEMS with UUID keys so the original openItem,
             confirmUpsell, skipUpsell, addToBasket all work ── */
      if (!window.ITEMS) window.ITEMS = {};
      r.data.forEach(function(item) {
        window.ITEMS[item.id] = {
          name:  item.name,
          desc:  item.description || '',
          price: item.price,
          img:   item.image_url   || ''
        };
      });

      /* ── Build category pills ── */
      var grouped = {}, order = [];
      r.data.forEach(function(item) {
        var c = item.category || 'kota';
        if (!grouped[c]) { grouped[c] = []; order.push(c); }
        grouped[c].push(item);
      });

      pillsEl.innerHTML = order.map(function(cat, i) {
        return '<button class="cat-pill' + (i===0?' on':'') +
          '" onclick="filterCat(\'' + cat + '\',this)">' +
          esc(CAT[cat]||cat) + '</button>';
      }).join('');

      /* ── Build menu cards — onclick passes UUID to openItem ── */
      bodyEl.innerHTML = order.map(function(cat, i) {
        return '<div class="menu-sec' + (i===0?' on':'') + '" id="cat-' + cat + '">' +
          grouped[cat].map(function(item) {
            var avail = item.available !== false;
            var img   = item.image_url ||
              'https://images.unsplash.com/photo-1550547660-d9450f859349?w=220&q=80';
            return '<div class="menu-card' + (avail ? '' : ' sold-out-card') + '"' +
              ' onclick="' + (avail
                ? 'openItem(\'' + item.id + '\')'
                : 'typeof showToast===\'function\'&&showToast(\'Sold out today\')') + '"' +
              ' style="' + (avail ? '' : 'opacity:.6;cursor:default;') + '">' +
              '<div class="mc-info">' +
                '<div class="mc-name">'  + esc(item.name)             + '</div>' +
                '<div class="mc-desc">'  + esc(item.description||'')  + '</div>' +
                '<div class="mc-footer">' +
                  '<span class="mc-price">R' + Number(item.price).toFixed(0) + '</span>' +
                  (avail
                    ? '<div class="mc-add">+</div>'
                    : '<div class="mc-add" style="background:#1F1A15;color:#A08060;' +
                      'font-size:9px;font-family:Montserrat,sans-serif;padding:0 8px;' +
                      'font-weight:700;letter-spacing:1px;">SOLD</div>') +
                '</div>' +
              '</div>' +
              '<img class="mc-img" src="' + esc(img) + '" alt="' + esc(item.name) + '"' +
              ' loading="lazy" onerror="this.src=\'' +
              'https://images.unsplash.com/photo-1550547660-d9450f859349?w=220&q=80\'">' +
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
      var r = await sb.from('events').select('*').eq('active',true)
        .order('created_at',{ascending:false});
      var topbar = bodyEl.querySelector('.page-topbar');
      bodyEl.innerHTML = '';
      if (topbar) bodyEl.appendChild(topbar);
      if (!r.data || !r.data.length) return;
      r.data.forEach(function(ev) {
        var tix = Array.isArray(ev.tickets) ? ev.tickets : [];
        var dateStr = ev.event_date
          ? new Date(ev.event_date+'T00:00:00').toLocaleDateString('en-ZA',
              {weekday:'long',day:'numeric',month:'long',year:'numeric'})
          : (ev.recurring_day || 'Date TBC');
        var cdHtml = '';
        if (!ev.is_recurring && ev.event_date) {
          var target = new Date(ev.event_date+(ev.start_time?'T'+ev.start_time:'T00:00:00'));
          var diff = target - new Date();
          if (diff > 0) {
            var d=Math.floor(diff/86400000),
                h=Math.floor((diff%86400000)/3600000),
                m=Math.floor((diff%3600000)/60000);
            cdHtml = '<div style="display:flex;gap:10px;margin:12px 0 16px;">' +
              [['Days',d],['Hrs',h],['Min',m]].map(function(x) {
                return '<div style="text-align:center;background:#1F1A15;border:1px solid' +
                  ' rgba(242,100,25,0.18);border-radius:12px;padding:10px 14px;min-width:52px;">' +
                  '<div style="font-family:\'Cormorant Garamond\',serif;font-size:28px;' +
                  'font-weight:700;color:#F26419;">' + x[1] + '</div>' +
                  '<div style="font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;' +
                  'letter-spacing:2px;text-transform:uppercase;color:#A08060;">' + x[0] + '</div>' +
                  '</div>';
              }).join('') + '</div>';
          }
        }
        var card = document.createElement('div');
        card.className = 'event-card glass';
        card.style.marginBottom = '16px';
        card.innerHTML =
          (ev.image_url
            ? '<img src="'+esc(ev.image_url)+'" style="width:100%;height:200px;' +
              'object-fit:cover;border-radius:16px;margin-bottom:16px;"' +
              ' onerror="this.style.display=\'none\'">' : '') +
          '<span style="display:inline-block;font-family:Montserrat,sans-serif;font-size:8px;' +
          'font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 10px;' +
          'border-radius:6px;margin-bottom:10px;' +
          (ev.is_recurring
            ? 'background:#2A2218;color:#D9C9B0;border:1px solid rgba(242,100,25,0.18);'
            : 'background:#D94F00;color:white;') + '">' +
          (ev.is_recurring ? '🔁 Recurring' : '⚡ Special Event') + '</span>' +
          (ev.sold_out
            ? '<span style="display:inline-block;margin-left:6px;font-family:Montserrat,sans-serif;' +
              'font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;' +
              'padding:4px 10px;border-radius:6px;background:rgba(255,68,68,0.15);color:#FF4444;' +
              'border:1px solid rgba(255,68,68,0.3);">Sold Out</span>' : '') +
          '<div style="font-family:\'Cormorant Garamond\',serif;font-size:32px;font-weight:700;' +
          'color:#FFF;line-height:1.1;margin-bottom:4px;">' + esc(ev.name) + '</div>' +
          (ev.subtitle
            ? '<div style="font-size:12px;color:#F26419;font-family:Montserrat,sans-serif;' +
              'font-weight:600;letter-spacing:.5px;margin-bottom:8px;">'+esc(ev.subtitle)+'</div>'
            : '') +
          '<div style="font-size:12px;color:#A08060;margin-bottom:12px;">' + esc(dateStr) + '</div>' +
          (ev.description
            ? '<p style="font-size:13px;color:#A08060;line-height:1.6;margin-bottom:14px;">' +
              esc(ev.description) + '</p>' : '') +
          cdHtml +
          (tix.length ? '<div>' + tix.map(function(t) {
            return '<div style="display:inline-block;background:#1F1A15;border:1px solid' +
              ' rgba(242,100,25,0.18);border-radius:10px;padding:10px 14px;margin:0 8px 8px 0;">' +
              '<div style="font-family:Montserrat,sans-serif;font-size:8px;font-weight:700;' +
              'letter-spacing:1.5px;text-transform:uppercase;color:#A08060;">' + esc(t.label) + '</div>' +
              '<div style="font-family:\'Cormorant Garamond\',serif;font-size:20px;font-weight:700;' +
              'color:#F26419;">' + (t.free ? 'FREE' : 'R'+t.price) + '</div></div>';
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
      // Bust cache on explicit reload
      _tradingHoursCache = r.data;
      _tradingHoursCacheTime = Date.now();
      var hoursCard = null;
      document.querySelectorAll('.info-card').forEach(function(card) {
        if (card.textContent.indexOf('Trading Hours') >= 0 ||
            card.textContent.indexOf('trading hours') >= 0) hoursCard = card;
      });
      if (!hoursCard) return;
      var p = hoursCard.querySelector('p'); if (!p) return;
      p.innerHTML = r.data.map(function(h) {
        return '<span style="display:flex;justify-content:space-between;padding:5px 0;' +
          'border-bottom:1px solid rgba(242,100,25,0.1);">' +
          '<span style="font-weight:600;color:#A08060;font-size:11px;' +
          'font-family:Montserrat,sans-serif;text-transform:uppercase;letter-spacing:1px;">' +
          esc(h.day_name) + '</span>' +
          '<span style="color:' + (h.is_closed?'#FF4444':'#F2E8D9') + ';font-size:12px;">' +
          (h.is_closed ? 'Closed' : fmt(h.open_time)+' – '+fmt(h.close_time)) +
          '</span></span>';
      }).join('');
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════════════════
     REALTIME SUBSCRIPTIONS
  ══════════════════════════════════════════════════════════ */
  function subscribeRealtime() {
    var timers = {};
    function debounce(key, fn, delay) {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(fn, delay || 300);
    }
    sb.channel('fbk-menu')
      .on('postgres_changes',{ event:'*', schema:'public', table:'menu_items' },
        function(){ debounce('menu', loadMenu, 300); }).subscribe();

    sb.channel('fbk-events')
      .on('postgres_changes',{ event:'*', schema:'public', table:'events' },
        function(){ debounce('events', loadEvents, 300); }).subscribe();

    sb.channel('fbk-ann')
      .on('postgres_changes',{ event:'*', schema:'public', table:'announcements' },
        function(){ debounce('banner', loadBanner, 300); }).subscribe();

    sb.channel('fbk-hours')
      .on('postgres_changes',{ event:'*', schema:'public', table:'trading_hours' },
        function(){
          // Bust the trading hours cache so next checkout gets fresh data
          _tradingHoursCache = null;
          debounce('hours', loadHours, 300);
        }).subscribe();

    console.log('[FBK] Realtime active — 4 channels subscribed');
  }

  /* ── Navigate override: re-fetch on every tab open ───────── */
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
    patchNavigate();

    // Patch the ordering functions — must happen before any user interaction
    patchCheckout();
    patchConfirmCollection();

    /* Load all data — ITEMS seeded inside loadMenu */
    loadBanner();
    loadMenu();
    loadEvents();
    loadHours();

    /* Realtime — keeps customer in sync with admin forever */
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
