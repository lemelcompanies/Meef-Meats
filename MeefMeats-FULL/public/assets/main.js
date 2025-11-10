(() => {
  const fmt = (c) => "$" + (c / 100).toFixed(2);
  const state = {
    price_full: 5000,
    price_half: 3000,
    cart: [],
    selectedSize: "full",
    selectedFlavor: "Cajun",
    pickupDateIso: null,
    availability: { status_full: "ok", status_half: "ok" }
  };

  // Header dropdown
  const menuBtn = document.getElementById("menuBtn");
  const menuDrop = document.getElementById("menuDrop");
  function closeMenu() { menuDrop.classList.remove("open"); menuBtn.setAttribute("aria-expanded","false"); }
  function openMenu() { menuDrop.classList.add("open"); menuBtn.setAttribute("aria-expanded","true"); }
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menuDrop.classList.contains("open")) closeMenu(); else openMenu();
  });
  document.addEventListener("click", (e) => {
    if (menuDrop.classList.contains("open") && !menuDrop.contains(e.target) && e.target !== menuBtn) {
      closeMenu();
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  // Day buttons
  async function loadAllowedDates() {
    const dates = await fetch("/api/allowed-dates").then(r => r.json());
    const wrap = document.getElementById("dayButtons");
    wrap.innerHTML = "";
    dates.map(d => {
      const dt = new Date(d + "T00:00:00");
      const lab = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      return { iso: d, lab };
    }).forEach((obj, i) => {
      const b = document.createElement("button");
      b.className = "day-btn" + (i === 0 ? " active" : "");
      b.textContent = obj.lab;
      b.addEventListener("click", () => {
        wrap.querySelectorAll(".day-btn").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        state.pickupDateIso = obj.iso;
        loadAvailability();
      });
      wrap.appendChild(b);
      if (i === 0) state.pickupDateIso = obj.iso;
    });
  }

  // Flavors
  document.querySelectorAll("#flavors .pill").forEach(p => {
    p.addEventListener("click", () => {
      document.querySelectorAll("#flavors .pill").forEach(x => x.classList.remove("active"));
      p.classList.add("active");
      state.selectedFlavor = p.dataset.flavor;
    });
  });

  // Size pills + stock chip
  function renderStocks() {
    const chip = document.getElementById("stockChip");
    const key = state.selectedSize === "half" ? "status_half" : "status_full";
    const v = state.availability[key] || "ok";
    chip.classList.remove("stock-ok","stock-low","stock-out");
    if (v === "out") { chip.textContent = "Sold out"; chip.classList.add("stock-out"); }
    else if (v === "low") { chip.textContent = "Low stock"; chip.classList.add("stock-low"); }
    else { chip.textContent = "In stock"; chip.classList.add("stock-ok"); }
  }
  document.querySelectorAll(".size-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".size-pill").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      state.selectedSize = btn.dataset.size;
      renderStocks();
    });
  });

  async function loadAvailability() {
    if (!state.pickupDateIso) return;
    const q = new URLSearchParams({ date: state.pickupDateIso });
    const data = await fetch("/api/availability?" + q.toString()).then(r => r.json());
    state.availability = data;
    renderStocks();
  }

  // Cart render
  function renderCart() {
    const list = document.getElementById("cartItems");
    if (state.cart.length === 0) list.innerHTML = "Your cart is empty.";
    else {
      list.innerHTML = state.cart.map((it, i) => \`
        <div class="row" style="justify-content:space-between;margin:6px 0">
          <div>
            <div><b>Turkey</b> • \${it.size} • \${it.flavor}</div>
            <div class="small">\${it.qty} × \${fmt(it.unit_price)}</div>
          </div>
          <button class="btn danger" data-i="\${i}">Remove</button>
        </div>
      \`).join("");
      list.querySelectorAll("button").forEach(b => {
        b.addEventListener("click", () => {
          const i = parseInt(b.dataset.i, 10);
          state.cart.splice(i, 1);
          renderCart();
        });
      });
    }
    const total = state.cart.reduce((s, it) => s + it.unit_price * it.qty, 0);
    document.getElementById("total").textContent = fmt(total);
  }

  // Add to cart
  document.getElementById("addBtn").addEventListener("click", () => {
    const qty = parseInt(document.getElementById("qty").value || "1", 10);
    const unit = state.selectedSize === "half" ? state.price_half : state.price_full;
    state.cart.push({ size: state.selectedSize, flavor: state.selectedFlavor, qty, unit_price: unit });
    renderCart();
  });

  // Place order
  document.getElementById("placeOrder").addEventListener("click", async () => {
    if (state.cart.length === 0) { alert("Cart is empty"); return; }
    if (!state.pickupDateIso) { alert("Pick a pickup date"); return; }
    const form = document.getElementById("checkoutForm");
    const name = form.customer_name.value.trim();
    const email = form.email.value.trim();
    if (!name || !email) { alert("Name and email required"); return; }
    const payload = {
      pickup_date: state.pickupDateIso,
      customer_name: name,
      email,
      phone: form.phone.value.trim(),
      items: state.cart.map(x => ({ size: x.size, flavor: x.flavor, qty: x.qty }))
    };
    const out = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(r => r.json());
    if (out.ok) {
      document.getElementById("orderResult").textContent = "Order placed. ID " + out.order_id;
      state.cart = []; renderCart();
    } else {
      document.getElementById("orderResult").textContent = "Error placing order.";
    }
  });

  document.getElementById("year").textContent = new Date().getFullYear();

  // Init
  (async () => {
    await loadAllowedDates();
    await loadAvailability();
    renderStocks();
    renderCart();
  })();
})();