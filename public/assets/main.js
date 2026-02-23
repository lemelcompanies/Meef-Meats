(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const fmt = cents => "$" + (cents / 100).toFixed(2);

  // ─── State ────────────────────────────────────────────────
  const state = {
    cart: [],
    sel: {
      size: null,
      sizeLabel: "",
      sizePrice: 0,
      flavor: null,
      qty: 1,
      pickupDate: null,
      pickupLabel: null
    },
    menu: { sizes: [], flavors: [] },
    settings: {}
  };

  // ─── Toast ────────────────────────────────────────────────
  function toast(msg, type = "success") {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast " + type + " show";
    setTimeout(() => el.classList.remove("show"), 3000);
  }

  // ─── Menu button ──────────────────────────────────────────
  const menuBtn = $("menuBtn");
  const menuDrop = $("menuDrop");

  menuBtn.addEventListener("click", e => {
    e.stopPropagation();
    menuDrop.classList.toggle("open");
  });
  document.addEventListener("click", e => {
    if (!menuDrop.contains(e.target) && e.target !== menuBtn) menuDrop.classList.remove("open");
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") menuDrop.classList.remove("open");
  });

  // ─── Load settings ───────────────────────────────────────
  async function loadSettings() {
    try {
      state.settings = await fetch("/api/settings").then(r => r.json());
      const pw = state.settings.pickup_window || "07:00 AM - 10:30 AM";
      $("pickupWindowBadge").textContent = "Pickup: " + pw;

      if (state.settings.instagram_url) {
        $("navIG").href = state.settings.instagram_url;
        $("footIG").href = state.settings.instagram_url;
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }

  // ─── Load menu (dynamic sizes & flavors) ──────────────────
  async function loadMenu() {
    try {
      state.menu = await fetch("/api/menu").then(r => r.json());

      // Render sizes
      const sizeWrap = $("sizeOptions");
      sizeWrap.innerHTML = "";
      for (const size of state.menu.sizes) {
        const btn = document.createElement("button");
        btn.className = "opt-btn";
        btn.dataset.id = size.id;
        btn.dataset.price = size.price_cents;
        btn.innerHTML = `<div>${size.label}</div><span class="price">${fmt(size.price_cents)}</span>`;
        btn.addEventListener("click", () => selectSize(btn, size));
        sizeWrap.appendChild(btn);
      }

      // Render flavors
      const flavorWrap = $("flavorOptions");
      flavorWrap.innerHTML = "";
      for (const flavor of state.menu.flavors) {
        const btn = document.createElement("button");
        btn.className = "opt-btn";
        btn.dataset.id = flavor.id;
        btn.textContent = flavor.label;
        btn.addEventListener("click", () => selectFlavor(btn, flavor));
        flavorWrap.appendChild(btn);
      }
    } catch (err) {
      console.error("Failed to load menu:", err);
      toast("Failed to load menu. Please refresh.", "error");
    }
  }

  // ─── Date loading ─────────────────────────────────────────
  async function loadDates() {
    try {
      const dates = await fetch("/api/allowed-dates").then(r => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      });

      const wrap = $("dayButtons");
      wrap.innerHTML = "";

      dates.forEach((iso, i) => {
        const dt = new Date(iso + "T00:00:00");
        const label = dt.toLocaleDateString(undefined, {
          weekday: "short", month: "short", day: "numeric"
        });

        const btn = document.createElement("button");
        btn.className = "date-pill";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          wrap.querySelectorAll(".date-pill").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          state.sel.pickupDate = iso;
          state.sel.pickupLabel = label;
          updatePreview();
        });
        wrap.appendChild(btn);

        if (i === 0) {
          btn.classList.add("selected");
          state.sel.pickupDate = iso;
          state.sel.pickupLabel = label;
        }
      });

      updatePreview();
    } catch (err) {
      console.error("Failed to load dates:", err);
      toast("Failed to load dates. Please refresh.", "error");
    }
  }

  // ─── Selection handlers ───────────────────────────────────
  function selectSize(btn, size) {
    $("sizeOptions").querySelectorAll(".opt-btn").forEach(x => x.classList.remove("selected"));
    btn.classList.add("selected");
    state.sel.size = size.id;
    state.sel.sizeLabel = size.label;
    state.sel.sizePrice = size.price_cents;
    updatePreview();
  }

  function selectFlavor(btn, flavor) {
    $("flavorOptions").querySelectorAll(".opt-btn").forEach(x => x.classList.remove("selected"));
    btn.classList.add("selected");
    state.sel.flavor = flavor.label;
    updatePreview();
  }

  // ─── Quantity ─────────────────────────────────────────────
  $("qtyMinus").addEventListener("click", () => {
    if (state.sel.qty > 1) {
      state.sel.qty--;
      $("qtyDisplay").textContent = state.sel.qty;
      updatePreview();
    }
  });
  $("qtyPlus").addEventListener("click", () => {
    if (state.sel.qty < 50) {
      state.sel.qty++;
      $("qtyDisplay").textContent = state.sel.qty;
      updatePreview();
    }
  });

  // ─── Preview update ───────────────────────────────────────
  function updatePreview() {
    $("prevSize").textContent = state.sel.sizeLabel || "—";
    $("prevFlavor").textContent = state.sel.flavor || "—";
    $("prevQty").textContent = state.sel.qty;
    $("prevDate").textContent = state.sel.pickupLabel || "—";
    $("prevTotal").textContent = fmt(state.sel.sizePrice * state.sel.qty);

    const addBtn = $("addToCartBtn");
    addBtn.disabled = !(state.sel.size && state.sel.flavor && state.sel.pickupDate);
  }

  // ─── Add to cart ──────────────────────────────────────────
  $("addToCartBtn").addEventListener("click", () => {
    if (!state.sel.size || !state.sel.flavor || !state.sel.pickupDate) return;

    state.cart.push({
      size: state.sel.size,
      sizeLabel: state.sel.sizeLabel,
      flavor: state.sel.flavor,
      qty: state.sel.qty,
      unitPrice: state.sel.sizePrice,
      pickupDate: state.sel.pickupDate,
      pickupLabel: state.sel.pickupLabel
    });

    toast("Added to cart!");
    renderCart();

    // Reset qty
    state.sel.qty = 1;
    $("qtyDisplay").textContent = "1";
    updatePreview();
  });

  // ─── Render cart ──────────────────────────────────────────
  function renderCart() {
    const wrap = $("cartItems");
    const countEl = $("cartCount");
    const checkBtn = $("checkoutBtn");
    const totalEl = $("cartTotal");

    countEl.textContent = state.cart.length;

    if (state.cart.length === 0) {
      wrap.innerHTML = '<div class="cart-empty">Add items to get started</div>';
      checkBtn.classList.add("hidden");
      $("customerSection").classList.add("hidden");
      return;
    }

    const total = state.cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    totalEl.textContent = fmt(total);

    wrap.innerHTML = state.cart.map((item, i) => `
      <div class="cart-item">
        <div style="flex:1;min-width:0">
          <div class="cart-item-name">${item.sizeLabel}</div>
          <div class="cart-item-meta">${item.flavor} • Qty: ${item.qty} • ${fmt(item.unitPrice * item.qty)}<br>Pickup: ${item.pickupLabel}</div>
        </div>
        <button class="btn-remove" data-idx="${i}">Remove</button>
      </div>
    `).join("");

    // Attach remove handlers
    wrap.querySelectorAll(".btn-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        state.cart.splice(parseInt(btn.dataset.idx), 1);
        renderCart();
      });
    });

    checkBtn.classList.remove("hidden");
  }

  // ─── Checkout ─────────────────────────────────────────────
  $("checkoutBtn").addEventListener("click", () => {
    $("customerSection").classList.remove("hidden");
    $("customerSection").scrollIntoView({ behavior: "smooth" });
  });

  // ─── Place order ──────────────────────────────────────────
  $("placeOrderBtn").addEventListener("click", async () => {
    const name = $("custName").value.trim();
    const email = $("custEmail").value.trim();
    const phone = $("custPhone").value.trim();
    const notes = $("custNotes").value.trim();
    const errDiv = $("orderError");
    errDiv.textContent = "";

    if (!name || !email || !phone) {
      errDiv.textContent = "Please fill in all required fields.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errDiv.textContent = "Please enter a valid email address.";
      return;
    }
    if (state.cart.length === 0) {
      errDiv.textContent = "Your cart is empty.";
      return;
    }

    const btn = $("placeOrderBtn");
    btn.disabled = true;
    btn.textContent = "Placing Order...";

    try {
      const payload = {
        customer_name: name,
        email,
        phone,
        pickup_date: state.cart[0].pickupDate,
        notes,
        items: state.cart.map(i => ({
          size: i.size,
          flavor: i.flavor,
          qty: i.qty
        }))
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await res.json();

      if (result.ok) {
        showPaymentModal(result.order_id, result.total_cents);

        // Reset everything
        state.cart = [];
        renderCart();
        $("custName").value = "";
        $("custEmail").value = "";
        $("custPhone").value = "";
        $("custNotes").value = "";
        $("customerSection").classList.add("hidden");
      } else {
        errDiv.textContent = result.error || "Failed to place order. Please try again.";
      }
    } catch (err) {
      console.error("Order error:", err);
      errDiv.textContent = "Network error. Please check your connection.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Place Order";
    }
  });

  // ─── Payment modal ────────────────────────────────────────
  async function showPaymentModal(orderId, totalCents) {
    try {
      const settings = await fetch("/api/settings").then(r => r.json());
      const pay = settings.payment_methods || {};
      const total = fmt(totalCents);

      $("confirmId").textContent = orderId;

      let html = "";

      if (pay.venmo_enabled) {
        html += `<div class="pay-method">
          <div class="row" style="gap:12px;margin-bottom:8px">
            <div class="pay-icon venmo">V</div>
            <strong>Venmo</strong>
          </div>
          <div class="small" style="margin-left:48px">
            Send ${total} to: <strong style="color:var(--text)">${pay.venmo_username || "@MeefMeats"}</strong>
            ${pay.venmo_qr_url ? `<br><img src="${pay.venmo_qr_url}" alt="Venmo QR" style="margin-top:10px;max-width:200px;border-radius:8px">` : ""}
          </div>
        </div>`;
      }

      if (pay.zelle_enabled) {
        html += `<div class="pay-method">
          <div class="row" style="gap:12px;margin-bottom:8px">
            <div class="pay-icon zelle">Z</div>
            <strong>Zelle</strong>
          </div>
          <div class="small" style="margin-left:48px">
            Send ${total} to: <strong style="color:var(--text)">${pay.zelle_info || "orders@meefmeats.com"}</strong>
          </div>
        </div>`;
      }

      if (pay.cash_enabled) {
        html += `<div class="pay-method">
          <div class="row" style="gap:12px;margin-bottom:8px">
            <div class="pay-icon cash">$</div>
            <strong>Cash at Pickup</strong>
          </div>
          <div class="small" style="margin-left:48px">
            Pay ${total} in cash${pay.cash_instructions ? "<br>" + pay.cash_instructions : ""}
          </div>
        </div>`;
      }

      $("payInstructions").innerHTML = html || '<div class="cart-empty">No payment methods configured. Contact us directly.</div>';

      $("payNote").innerHTML = pay.payment_note
        ? `<strong>⚠️ Important:</strong> ${pay.payment_note}`
        : `<strong>⚠️ Important:</strong> Your order is reserved but not confirmed until payment is received.`;

      $("payModal").classList.add("open");
    } catch (err) {
      console.error("Error showing payment modal:", err);
    }
  }

  // ─── Init ─────────────────────────────────────────────────
  $("year").textContent = new Date().getFullYear();

  (async () => {
    await Promise.all([loadSettings(), loadMenu(), loadDates()]);
    updatePreview();
    renderCart();
  })();

})();
