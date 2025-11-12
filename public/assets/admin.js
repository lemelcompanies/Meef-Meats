(() => {
  // Utility functions
  function toMoney(cents) {
    return "$" + (cents / 100).toFixed(2);
  }
  
  function applyBadge(element, value, label) {
    element.classList.remove("stock-ok", "stock-low", "stock-out");
    
    if (value === "out") {
      element.classList.add("stock-out");
      element.textContent = label + ": Sold out";
    } else if (value === "low") {
      element.classList.add("stock-low");
      element.textContent = label + ": Low stock";
    } else {
      element.classList.add("stock-ok");
      element.textContent = label + ": In stock";
    }
  }
  
  async function allowedDates() {
    try {
      return await fetch("/api/allowed-dates").then(r => r.json());
    } catch (error) {
      console.error('Error loading dates:', error);
      return [];
    }
  }

  // DOM Elements
  const dateSel = document.getElementById("dateSel");
  const statusFull = document.getElementById("statusFull");
  const statusHalf = document.getElementById("statusHalf");
  const badgeFull = document.getElementById("badgeFull");
  const badgeHalf = document.getElementById("badgeHalf");
  const statusMsg = document.getElementById("statusMsg");

  const contactPhone = document.getElementById("contactPhone");
  const contactEmail = document.getElementById("contactEmail");
  const contactAddr = document.getElementById("contactAddr");
  const igUrl = document.getElementById("igUrl");
  const settingsMsg = document.getElementById("settingsMsg");

  const filterStatus = document.getElementById("filterStatus");
  const search = document.getElementById("search");
  const refreshBtn = document.getElementById("refresh");
  const ordersMsg = document.getElementById("ordersMsg");

  // Payment method elements
  const venmoEnabled = document.getElementById("venmoEnabled");
  const venmoUsername = document.getElementById("venmoUsername");
  const zelleEnabled = document.getElementById("zelleEnabled");
  const zelleInfo = document.getElementById("zelleInfo");
  const cashEnabled = document.getElementById("cashEnabled");
  const cashInstructions = document.getElementById("cashInstructions");
  const paymentNote = document.getElementById("paymentNote");
  const paymentMsg = document.getElementById("paymentMsg");

  // ==================== SETTINGS MANAGEMENT ====================
  async function loadSettings() {
    try {
      const settings = await fetch("/api/admin/settings").then(r => r.json());
      
      // Load contact info
      contactPhone.value = settings.contact?.phone || "";
      contactEmail.value = settings.contact?.email || "";
      contactAddr.value = settings.contact?.address || "";
      igUrl.value = settings.instagram_url || "";
      
      // Load stock status overrides
      const overrides = settings.status_overrides || {};
      const dateOverride = overrides[dateSel.value] || {};
      
      statusFull.value = dateOverride.full || "ok";
      statusHalf.value = dateOverride.half || "ok";
      
      applyBadge(badgeFull, statusFull.value, "Full");
      applyBadge(badgeHalf, statusHalf.value, "Half");

      // Load payment methods
      const pm = settings.payment_methods || {};
      venmoEnabled.checked = pm.venmo_enabled || false;
      venmoUsername.value = pm.venmo_username || "";
      zelleEnabled.checked = pm.zelle_enabled || false;
      zelleInfo.value = pm.zelle_info || "";
      cashEnabled.checked = pm.cash_enabled || false;
      cashInstructions.value = pm.cash_instructions || "";
      paymentNote.value = pm.payment_note || "";

      // Load notification emails
      const emails = settings.notification_emails || [];
      renderEmailList(emails);
    } catch (error) {
      console.error('Error loading settings:', error);
      settingsMsg.textContent = "Error loading settings";
      settingsMsg.style.color = "#ff5252";
    }
  }

  async function saveSettings() {
    try {
      const body = {
        instagram_url: igUrl.value,
        contact: {
          phone: contactPhone.value,
          email: contactEmail.value,
          address: contactAddr.value
        }
      };
      
      const result = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(r => r.json());
      
      settingsMsg.textContent = result.ok ? "✓ Saved" : "✗ Error";
      settingsMsg.style.color = result.ok ? "#9ae6b4" : "#ff5252";
      setTimeout(() => settingsMsg.textContent = "", 2000);
    } catch (error) {
      console.error('Error saving settings:', error);
      settingsMsg.textContent = "✗ Network error";
      settingsMsg.style.color = "#ff5252";
    }
  }

  async function saveStatus() {
    try {
      const current = await fetch("/api/admin/settings").then(r => r.json());
      const overrides = current.status_overrides || {};
      
      overrides[dateSel.value] = {
        full: statusFull.value,
        half: statusHalf.value
      };
      
      const result = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status_overrides: overrides })
      }).then(r => r.json());
      
      statusMsg.textContent = result.ok ? "✓ Status saved" : "✗ Error";
      statusMsg.style.color = result.ok ? "#9ae6b4" : "#ff5252";
      setTimeout(() => statusMsg.textContent = "", 2000);
    } catch (error) {
      console.error('Error saving status:', error);
      statusMsg.textContent = "✗ Network error";
      statusMsg.style.color = "#ff5252";
    }
  }

  async function savePaymentSettings() {
    try {
      const body = {
        payment_methods: {
          venmo_enabled: venmoEnabled.checked,
          venmo_username: venmoUsername.value,
          zelle_enabled: zelleEnabled.checked,
          zelle_info: zelleInfo.value,
          cash_enabled: cashEnabled.checked,
          cash_instructions: cashInstructions.value,
          payment_note: paymentNote.value
        }
      };

      const result = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(r => r.json());

      paymentMsg.textContent = result.ok ? "✓ Payment settings saved" : "✗ Error";
      paymentMsg.style.color = result.ok ? "#9ae6b4" : "#ff5252";
      setTimeout(() => paymentMsg.textContent = "", 2000);
    } catch (error) {
      console.error('Error saving payment settings:', error);
      paymentMsg.textContent = "✗ Network error";
      paymentMsg.style.color = "#ff5252";
    }
  }

  // ==================== ORDERS MANAGEMENT ====================
  function rowHTML(order) {
    const items = (order.items || [])
      .map(item => item.qty + "x " + (item.size === "full" ? "Full" : "Half") + " Turkey, " + item.flavor)
      .join(", ");
    
    const createdDate = new Date(order.created_at).toLocaleString();
    
    return '<tr><td><div><strong>' + order.id + '</strong></div><div class="small">' + createdDate + '</div></td><td><div>' + order.customer_name + '</div><div class="small">' + order.email + '</div>' + (order.phone ? '<div class="small">' + order.phone + '</div>' : '') + '</td><td>' + order.pickup_date + '</td><td>' + items + '</td><td><strong>' + toMoney(order.total_cents || 0) + '</strong></td><td><span class="badge">' + order.status + '</span></td><td><select data-id="' + order.id + '" class="input statusSel">' + ["new", "confirmed", "preparing", "cooking", "ready", "picked_up", "canceled"].map(s => '<option value="' + s + '" ' + (order.status === s ? "selected" : "") + '>' + s + '</option>').join("") + '</select></td></tr>';
  }

  async function refreshOrders() {
    try {
      const data = await fetch("/api/admin/orders").then(r => r.json());
      const orders = data.orders || [];
      
      const query = (search.value || "").toLowerCase();
      const statusFilter = filterStatus.value;
      
      const filteredOrders = orders
        .filter(o => !statusFilter || o.status === statusFilter)
        .filter(o => !query || 
          o.id.toLowerCase().includes(query) || 
          (o.customer_name || "").toLowerCase().includes(query))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      
      const tbody = document.querySelector("#ordersTbl tbody");
      
      if (filteredOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px">No orders found</td></tr>';
      } else {
        tbody.innerHTML = filteredOrders.map(rowHTML).join("");
      }
      
      // Attach status change handlers
      document.querySelectorAll(".statusSel").forEach(select => {
        select.addEventListener("change", async () => {
          const orderId = select.getAttribute("data-id");
          
          try {
            const result = await fetch("/api/admin/orders/" + orderId + "/status", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: select.value })
            }).then(r => r.json());
            
            ordersMsg.textContent = result.ok ? "✓ Status updated" : "✗ " + (result.error || 'Error');
            ordersMsg.style.color = result.ok ? "#9ae6b4" : "#ff5252";
            
            setTimeout(() => ordersMsg.textContent = "", 2000);
            
            if (result.ok) {
              refreshOrders();
            }
          } catch (error) {
            console.error('Error updating status:', error);
            ordersMsg.textContent = "✗ Network error";
            ordersMsg.style.color = "#ff5252";
          }
        });
      });
      
      ordersMsg.textContent = "Showing " + filteredOrders.length + " order" + (filteredOrders.length !== 1 ? 's' : '');
      ordersMsg.style.color = "#bcbcbc";
    } catch (error) {
      console.error('Error refreshing orders:', error);
      ordersMsg.textContent = "✗ Failed to load orders";
      ordersMsg.style.color = "#ff5252";
    }
  }

  // ==================== EMAIL NOTIFICATIONS ====================
  function renderEmailList(emails) {
    const listDiv = document.getElementById("emailList");
    
    if (emails.length === 0) {
      listDiv.innerHTML = '<div class="small" style="color:#666">No notification emails added yet</div>';
      return;
    }

    listDiv.innerHTML = emails.map((email, index) => '<div class="payment-setting-item" style="display:flex;justify-content:space-between;align-items:center;padding:12px"><div><div style="font-weight:700">' + email + '</div><div class="small">Will receive order notifications</div></div><button class="btn danger" onclick="window.removeEmail(' + index + ')" style="padding:8px 12px">Remove</button></div>').join("");
  }

  window.removeEmail = async function(index) {
    try {
      const settings = await fetch("/api/admin/settings").then(r => r.json());
      const emails = settings.notification_emails || [];
      emails.splice(index, 1);

      const result = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_emails: emails })
      }).then(r => r.json());

      if (result.ok) {
        renderEmailList(emails);
        showEmailMessage("✓ Email removed", "#9ae6b4");
      } else {
        showEmailMessage("✗ Failed to remove email", "#ff5252");
      }
    } catch (error) {
      console.error("Error removing email:", error);
      showEmailMessage("✗ Network error", "#ff5252");
    }
  };

  document.getElementById("addEmail").addEventListener("click", async () => {
    const emailInput = document.getElementById("newEmail");
    const email = emailInput.value.trim();

    if (!email) {
      showEmailMessage("✗ Please enter an email", "#ff5252");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showEmailMessage("✗ Invalid email format", "#ff5252");
      return;
    }

    try {
      const settings = await fetch("/api/admin/settings").then(r => r.json());
      const emails = settings.notification_emails || [];

      if (emails.includes(email)) {
        showEmailMessage("✗ Email already added", "#ff5252");
        return;
      }

      emails.push(email);

      const result = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_emails: emails })
      }).then(r => r.json());

      if (result.ok) {
        emailInput.value = "";
        renderEmailList(emails);
        showEmailMessage("✓ Email added successfully", "#9ae6b4");
      } else {
        showEmailMessage("✗ Failed to add email", "#ff5252");
      }
    } catch (error) {
      console.error("Error adding email:", error);
      showEmailMessage("✗ Network error", "#ff5252");
    }
  });

  function showEmailMessage(msg, color) {
    const emailMsg = document.getElementById("emailMsg");
    emailMsg.textContent = msg;
    emailMsg.style.color = color;
    setTimeout(() => emailMsg.textContent = "", 3000);
  }

  // ==================== INITIALIZATION ====================
  async function init() {
    try {
      // Load available dates
      const dates = await allowedDates();
      dates.forEach(d => {
        const option = document.createElement("option");
        option.value = d;
        option.textContent = new Date(d + "T00:00:00").toDateString();
        dateSel.appendChild(option);
      });

      // Load initial data
      await loadSettings();
      await refreshOrders();

      // Event listeners - Contact & Stock
      document.getElementById("saveStatus").addEventListener("click", saveStatus);
      document.getElementById("saveSettings").addEventListener("click", saveSettings);
      document.getElementById("refresh").addEventListener("click", refreshOrders);
      document.getElementById("filterStatus").addEventListener("change", refreshOrders);
      document.getElementById("search").addEventListener("input", refreshOrders);
      
      dateSel.addEventListener("change", loadSettings);
      
      statusFull.addEventListener("change", () => {
        applyBadge(badgeFull, statusFull.value, "Full");
      });
      
      statusHalf.addEventListener("change", () => {
        applyBadge(badgeHalf, statusHalf.value, "Half");
      });

      // Event listener - Payment Settings
      document.getElementById("savePayment").addEventListener("click", savePaymentSettings);
    } catch (error) {
      console.error('Initialization error:', error);
      alert('Failed to initialize admin panel. Please refresh the page.');
    }
  }

  // Start the application
  init();
})();
