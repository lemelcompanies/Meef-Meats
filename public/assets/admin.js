(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const fmt = cents => "$" + (cents / 100).toFixed(2);

  // ─── Toast ────────────────────────────────────────────────
  function toast(msg, type = "success") {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast " + type + " show";
    setTimeout(() => el.classList.remove("show"), 3000);
  }

  // ─── Local state ──────────────────────────────────────────
  let menu = { sizes: [], flavors: [], sides: [], extras: [] };

  // ═══════════════════════════════════════════════════════════
  //  MENU MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  async function loadMenu() {
    try {
      menu = await fetch("/api/admin/menu").then(r => r.json());
      renderSizes();
      renderFlavors();
    } catch (err) {
      console.error("Failed to load menu:", err);
      toast("Failed to load menu", "error");
    }
  }

  function renderSizes() {
    const wrap = $("sizesList");
    wrap.innerHTML = menu.sizes.map((s, i) => `
      <div class="menu-item-row" data-idx="${i}">
        <input type="checkbox" ${s.active ? "checked" : ""} title="Active" style="accent-color:var(--accent)">
        <input class="input" value="${s.label}" placeholder="Label" style="flex:1">
        <input class="input" value="${s.id}" placeholder="ID (e.g. full)" style="width:100px">
        <input class="input price-input" type="number" value="${(s.price_cents / 100).toFixed(2)}" placeholder="Price $" step="0.01">
        <button class="btn danger" style="padding:8px 12px">✕</button>
      </div>
    `).join("");

    // Wire events
    wrap.querySelectorAll(".menu-item-row").forEach((row, i) => {
      const [checkbox, labelInput, idInput, priceInput, delBtn] = row.querySelectorAll("input, button.danger");
      
      checkbox.addEventListener("change", () => { menu.sizes[i].active = checkbox.checked; });
      labelInput.addEventListener("input", () => { menu.sizes[i].label = labelInput.value; });
      idInput.addEventListener("input", () => { menu.sizes[i].id = idInput.value; });
      priceInput.addEventListener("input", () => { menu.sizes[i].price_cents = Math.round(parseFloat(priceInput.value || 0) * 100); });
      delBtn.addEventListener("click", () => { menu.sizes.splice(i, 1); renderSizes(); });
    });
  }

  function renderFlavors() {
    const wrap = $("flavorsList");
    wrap.innerHTML = menu.flavors.map((f, i) => `
      <div class="menu-item-row" data-idx="${i}">
        <input type="checkbox" ${f.active ? "checked" : ""} title="Active" style="accent-color:var(--accent)">
        <input class="input" value="${f.label}" placeholder="Flavor name" style="flex:1">
        <input class="input" value="${f.id}" placeholder="ID" style="width:120px">
        <button class="btn danger" style="padding:8px 12px">✕</button>
      </div>
    `).join("");

    wrap.querySelectorAll(".menu-item-row").forEach((row, i) => {
      const [checkbox, labelInput, idInput, delBtn] = row.querySelectorAll("input, button.danger");
      
      checkbox.addEventListener("change", () => { menu.flavors[i].active = checkbox.checked; });
      labelInput.addEventListener("input", () => { menu.flavors[i].label = labelInput.value; });
      idInput.addEventListener("input", () => { menu.flavors[i].id = idInput.value; });
      delBtn.addEventListener("click", () => { menu.flavors.splice(i, 1); renderFlavors(); });
    });
  }

  $("addSizeBtn").addEventListener("click", () => {
    menu.sizes.push({ id: "", label: "", price_cents: 0, active: true });
    renderSizes();
  });

  $("addFlavorBtn").addEventListener("click", () => {
    menu.flavors.push({ id: "", label: "", active: true });
    renderFlavors();
  });

  $("saveMenuBtn").addEventListener("click", async () => {
    try {
      const res = await fetch("/api/admin/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(menu)
      }).then(r => r.json());

      if (res.ok) {
        toast("Menu saved!");
      } else {
        toast(res.error || "Failed to save menu", "error");
      }
    } catch (err) {
      toast("Network error", "error");
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  SETTINGS
  // ═══════════════════════════════════════════════════════════

  async function loadSettings() {
    try {
      const s = await fetch("/api/admin/settings").then(r => r.json());

      $("bizName").value = s.business_name || "";
      $("bizTagline").value = s.tagline || "";
      $("contactPhone").value = s.contact?.phone || "";
      $("contactEmail").value = s.contact?.email || "";
      $("contactAddr").value = s.contact?.address || "";
      $("pickupWindow").value = s.pickup_window || "";
      $("igUrl").value = s.instagram_url || "";

      // Stock
      const overrides = s.status_overrides || {};
      const dateVal = $("dateSel").value;
      if (dateVal && overrides[dateVal]) {
        $("statusFull").value = overrides[dateVal].full || "ok";
        $("statusHalf").value = overrides[dateVal].half || "ok";
      }

      // Payment
      const pm = s.payment_methods || {};
      $("venmoOn").checked = pm.venmo_enabled || false;
      $("venmoUser").value = pm.venmo_username || "";
      $("venmoQR").value = pm.venmo_qr_url || "";
      $("zelleOn").checked = pm.zelle_enabled || false;
      $("zelleInfo").value = pm.zelle_info || "";
      $("cashOn").checked = pm.cash_enabled || false;
      $("cashInstr").value = pm.cash_instructions || "";
      $("payNote").value = pm.payment_note || "";

      // Telegram
      const tg = s.telegram || {};
      $("tgEnabled").checked = tg.enabled || false;
      $("tgToken").value = tg.bot_token || "";
      $("tgChatId").value = tg.chat_id || "";

      // Notification emails
      renderEmails(s.notification_emails || []);
    } catch (err) {
      console.error("Failed to load settings:", err);
      toast("Failed to load settings", "error");
    }
  }

  // Save business settings
  $("saveSettingsBtn").addEventListener("click", async () => {
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: $("bizName").value,
          tagline: $("bizTagline").value,
          instagram_url: $("igUrl").value,
          pickup_window: $("pickupWindow").value,
          contact: {
            phone: $("contactPhone").value,
            email: $("contactEmail").value,
            address: $("contactAddr").value
          }
        })
      }).then(r => r.json());
      toast(res.ok ? "Settings saved!" : "Error saving", res.ok ? "success" : "error");
    } catch (err) { toast("Network error", "error"); }
  });

  // Save stock status
  $("saveStatusBtn").addEventListener("click", async () => {
    try {
      const current = await fetch("/api/admin/settings").then(r => r.json());
      const overrides = current.status_overrides || {};
      overrides[$("dateSel").value] = {
        full: $("statusFull").value,
        half: $("statusHalf").value
      };
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status_overrides: overrides })
      }).then(r => r.json());
      toast(res.ok ? "Stock status saved!" : "Error", res.ok ? "success" : "error");
    } catch (err) { toast("Network error", "error"); }
  });

  // Save payment settings
  $("savePayBtn").addEventListener("click", async () => {
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_methods: {
            venmo_enabled: $("venmoOn").checked,
            venmo_username: $("venmoUser").value,
            venmo_qr_url: $("venmoQR").value,
            zelle_enabled: $("zelleOn").checked,
            zelle_info: $("zelleInfo").value,
            cash_enabled: $("cashOn").checked,
            cash_instructions: $("cashInstr").value,
            payment_note: $("payNote").value
          }
        })
      }).then(r => r.json());
      toast(res.ok ? "Payment settings saved!" : "Error", res.ok ? "success" : "error");
    } catch (err) { toast("Network error", "error"); }
  });

  // Save telegram settings
  $("saveTgBtn").addEventListener("click", async () => {
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegram: {
            enabled: $("tgEnabled").checked,
            bot_token: $("tgToken").value,
            chat_id: $("tgChatId").value,
            notify_new_orders: true,
            notify_status_changes: true
          }
        })
      }).then(r => r.json());
      toast(res.ok ? "Telegram settings saved!" : "Error", res.ok ? "success" : "error");
    } catch (err) { toast("Network error", "error"); }
  });

  // ═══════════════════════════════════════════════════════════
  //  EMAIL NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════

  function renderEmails(emails) {
    const wrap = $("emailList");
    if (!emails.length) {
      wrap.innerHTML = '<div class="small" style="color:var(--text-dim)">No notification emails added</div>';
      return;
    }
    wrap.innerHTML = emails.map((email, i) => `
      <div class="setting-item" style="display:flex;justify-content:space-between;align-items:center;padding:12px;margin-bottom:6px">
        <div>
          <div style="font-weight:700;font-size:14px">${email}</div>
          <div class="small">Receives order notifications</div>
        </div>
        <button class="btn danger" data-idx="${i}" style="padding:6px 12px;font-size:12px">Remove</button>
      </div>
    `).join("");

    wrap.querySelectorAll(".btn.danger").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.idx);
        try {
          const s = await fetch("/api/admin/settings").then(r => r.json());
          const arr = s.notification_emails || [];
          arr.splice(idx, 1);
          const res = await fetch("/api/admin/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notification_emails: arr })
          }).then(r => r.json());
          if (res.ok) { renderEmails(arr); toast("Email removed"); }
        } catch (err) { toast("Failed to remove", "error"); }
      });
    });
  }

  $("addEmailBtn").addEventListener("click", async () => {
    const email = $("newEmail").value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("Enter a valid email", "error");
      return;
    }
    try {
      const s = await fetch("/api/admin/settings").then(r => r.json());
      const arr = s.notification_emails || [];
      if (arr.includes(email)) { toast("Already added", "error"); return; }
      arr.push(email);
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_emails: arr })
      }).then(r => r.json());
      if (res.ok) {
        $("newEmail").value = "";
        renderEmails(arr);
        toast("Email added!");
      }
    } catch (err) { toast("Network error", "error"); }
  });

  // ═══════════════════════════════════════════════════════════
  //  ORDERS
  // ═══════════════════════════════════════════════════════════

  const STATUSES = ["new", "confirmed", "preparing", "cooking", "ready", "picked_up", "canceled"];

  function renderOrders(orders) {
    const query = ($("search").value || "").toLowerCase();
    const statusFilter = $("filterStatus").value;

    const filtered = orders
      .filter(o => !statusFilter || o.status === statusFilter)
      .filter(o => !query || o.id.toLowerCase().includes(query) || (o.customer_name || "").toLowerCase().includes(query))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const tbody = document.querySelector("#ordersTbl tbody");

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-dim)">No orders found</td></tr>';
      $("ordersMsg").textContent = "0 orders";
      return;
    }

    tbody.innerHTML = filtered.map(o => {
      const items = (o.items || []).map(i => `${i.qty}x ${i.size_label || i.size} ${i.flavor}`).join(", ");
      const dt = new Date(o.created_at).toLocaleString();
      const badgeClass = "badge-" + o.status;
      return `<tr>
        <td><div style="font-weight:700">${o.id}</div><div class="small">${dt}</div></td>
        <td><div>${o.customer_name}</div><div class="small">${o.email}</div>${o.phone ? `<div class="small">${o.phone}</div>` : ""}</td>
        <td>${o.pickup_date}</td>
        <td><div class="small">${items}</div></td>
        <td style="font-weight:700">${fmt(o.total_cents || 0)}</td>
        <td><span class="badge-status ${badgeClass}">${o.status}</span></td>
        <td><select class="input statusSel" data-id="${o.id}" style="width:auto;padding:6px 8px;font-size:12px">
          ${STATUSES.map(s => `<option value="${s}" ${o.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select></td>
      </tr>`;
    }).join("");

    // Attach handlers
    tbody.querySelectorAll(".statusSel").forEach(sel => {
      sel.addEventListener("change", async () => {
        try {
          const res = await fetch(`/api/admin/orders/${sel.dataset.id}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: sel.value })
          }).then(r => r.json());
          if (res.ok) {
            toast("Status updated!");
            refreshOrders();
          } else {
            toast(res.error || "Failed", "error");
          }
        } catch (err) { toast("Network error", "error"); }
      });
    });

    $("ordersMsg").textContent = `Showing ${filtered.length} order${filtered.length !== 1 ? "s" : ""}`;
  }

  async function refreshOrders() {
    try {
      const data = await fetch("/api/admin/orders").then(r => r.json());
      renderOrders(data.orders || []);
    } catch (err) {
      toast("Failed to load orders", "error");
    }
  }

  $("refreshBtn").addEventListener("click", refreshOrders);
  $("filterStatus").addEventListener("change", refreshOrders);
  $("search").addEventListener("input", refreshOrders);

  // ═══════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════

  async function init() {
    try {
      // Load dates for stock selector
      const dates = await fetch("/api/allowed-dates").then(r => r.json());
      const dateSel = $("dateSel");
      dates.forEach(d => {
        const opt = document.createElement("option");
        opt.value = d;
        opt.textContent = new Date(d + "T00:00:00").toDateString();
        dateSel.appendChild(opt);
      });

      dateSel.addEventListener("change", loadSettings);

      await Promise.all([loadMenu(), loadSettings(), refreshOrders()]);
    } catch (err) {
      console.error("Init error:", err);
      toast("Failed to initialize. Please refresh.", "error");
    }
  }

  init();
})();
