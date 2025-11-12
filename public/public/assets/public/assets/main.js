(() => {
  // Utility functions
  const fmt = (cents) => "$" + (cents / 100).toFixed(2);

  // Application state
  const state = {
    cart: [],
    currentSelection: {
      size: null,
      sizePrice: 0,
      flavor: null,
      qty: 1,
      pickupDate: null,
      pickupDateLabel: null
    }
  };

  // ==================== HEADER MENU ====================
  const menuBtn = document.getElementById("menuBtn");
  const menuDrop = document.getElementById("menuDrop");

  function closeMenu() {
    menuDrop.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    menuDrop.classList.add("open");
    menuBtn.setAttribute("aria-expanded", "true");
  }

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDrop.classList.contains("open") ? closeMenu() : openMenu();
  });

  document.addEventListener("click", (e) => {
    if (menuDrop.classList.contains("open") && 
        !menuDrop.contains(e.target) && 
        e.target !== menuBtn) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  // ==================== DATE SELECTION ====================
  async function loadAllowedDates() {
    try {
      const dates = await fetch("/api/allowed-dates").then(r => {
        if (!r.ok) throw new Error('Failed to load dates');
        return r.json();
      });

      const wrap = document.getElementById("dayButtons");
      wrap.innerHTML = "";

      dates.forEach((dateISO, i) => {
        const dt = new Date(dateISO + "T00:00:00");
        const label = dt.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric"
        });

        const btn = document.createElement("button");
        btn.className = "date-pill";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          document.querySelectorAll(".date-pill").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          state.currentSelection.pickupDate = dateISO;
          state.currentSelection.pickupDateLabel = label;
          updatePreview();
        });
        wrap.appendChild(btn);

        // Auto-select first date
        if (i === 0) {
          btn.classList.add("selected");
          state.currentSelection.pickupDate = dateISO;
          state.currentSelection.pickupDateLabel = label;
        }
      });

      updatePreview();
    } catch (error) {
      console.error('Error loading dates:', error);
      alert('Failed to load available dates. Please refresh the page.');
    }
  }

  // ==================== SIZE SELECTION ====================
  document.querySelectorAll("#sizeOptions .option-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#sizeOptions .option-btn").forEach(x => x.classList.remove("selected"));
      btn.classList.add("selected");
      state.currentSelection.size = btn.dataset.size;
      state.currentSelection.sizePrice = parseInt(btn.dataset.price);
      updatePreview();
    });
  });

  // ==================== FLAVOR SELECTION ====================
  document.querySelectorAll("#flavorOptions .option-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#flavorOptions .option-btn").forEach(x => x.classList.remove("selected"));
      btn.classList.add("selected");
      state.currentSelection.flavor = btn.dataset.flavor;
      updatePreview();
    });
  });

  // ==================== QUANTITY ====================
  const qtyDisplay = document.getElementById("qtyDisplay");
  const qtyMinus = document.getElementById("qtyMinus");
  const qtyPlus = document.getElementById("qtyPlus");

  qtyMinus.addEventListener("click", () => {
    if (state.currentSelection.qty > 1) {
      state.currentSelection.qty--;
      qtyDisplay.textContent = state.currentSelection.qty;
      updatePreview();
    }
  });

  qtyPlus.addEventListener("click", () => {
    state.currentSelection.qty++;
    qtyDisplay.textContent = state.currentSelection.qty;
    updatePreview();
  });

  // ==================== PREVIEW UPDATE ====================
  function updatePreview() {
    const sizeText = state.currentSelection.size === "full" ? "Full Turkey" :
                     state.currentSelection.size === "half" ? "Half Turkey" : "Not selected";
    const flavorText = state.currentSelection.flavor || "Not selected";
    const qtyText = state.currentSelection.qty;
    const dateText = state.currentSelection.pickupDateLabel || "Not selected";
    const total = state.currentSelection.sizePrice * state.currentSelection.qty;

    document.getElementById("previewSize").textContent = sizeText;
    document.getElementById("previewFlavor").textContent = flavorText;
    document.getElementById("previewQty").textContent = qtyText;
    document.getElementById("previewDate").textContent = dateText;
    document.getElementById("previewTotal").textContent = fmt(total);

    // Enable/disable add button
    const addBtn = document.getElementById("addToCartBtn");
    if (state.currentSelection.size && state.currentSelection.flavor && state.currentSelection.pickupDate) {
      addBtn.disabled = false;
    } else {
      addBtn.disabled = true;
    }
  }

  // ==================== ADD TO CART ====================
  document.getElementById("addToCartBtn").addEventListener("click", () => {
    if (!state.currentSelection.size || !state.currentSelection.flavor || !state.currentSelection.pickupDate) {
      alert("Please select all options before adding to cart.");
      return;
    }

    const item = {
      size: state.currentSelection.size,
      sizeLabel: state.currentSelection.size === "full" ? "Full Turkey" : "Half Turkey",
      flavor: state.currentSelection.flavor,
      qty: state.currentSelection.qty,
      unitPrice: state.currentSelection.sizePrice,
      pickupDate: state.currentSelection.pickupDate,
      pickupDateLabel: state.currentSelection.pickupDateLabel
    };

    state.cart.push(item);
    renderCart();

    // Reset quantity to 1
    state.currentSelection.qty = 1;
    qtyDisplay.textContent = "1";
    updatePreview();
  });

  // ==================== RENDER CART ====================
  function renderCart() {
    const cartItems = document.getElementById("cartItems");
    const cartCount = document.getElementById("cartCount");
    const checkoutBtn = document.getElementById("checkoutBtn");
    const cartTotal = document.getElementById("cartTotal");

    cartCount.textContent = state.cart.length;

    if (state.cart.length === 0) {
      cartItems.innerHTML = '<div class="preview-empty">Add items to get started</div>';
      checkoutBtn.style.display = "none";
    } else {
      const total = state.cart.reduce((sum, item) => sum + (item.unitPrice * item.qty), 0);
      cartTotal.textContent = fmt(total);

      cartItems.innerHTML = `
        <div class="order-list">
          ${state.cart.map((item, i) => `
            <div class="order-item">
              <div class="order-item-details">
                <div class="order-item-name">${item.sizeLabel}</div>
                <div class="order-item-specs">${item.flavor} • Qty: ${item.qty} • ${fmt(item.unitPrice * item.qty)}<br>Pickup: ${item.pickupDateLabel}</div>
              </div>
              <button class="remove-btn" onclick="window.removeCartItem(${i})">Remove</button>
            </div>
          `).join("")}
        </div>
      `;

      checkoutBtn.style.display = "block";
    }
  }

  window.removeCartItem = function(index) {
    state.cart.splice(index, 1);
    renderCart();
  };

  // ==================== CHECKOUT ====================
  document.getElementById("checkoutBtn").addEventListener("click", () => {
    document.getElementById("customerInfoSection").style.display = "block";
    document.getElementById("customerInfoSection").scrollIntoView({ behavior: "smooth" });
  });

  // ==================== PLACE ORDER ====================
  document.getElementById("placeOrderBtn").addEventListener("click", async () => {
    const name = document.getElementById("customerName").value.trim();
    const email = document.getElementById("customerEmail").value.trim();
    const phone = document.getElementById("customerPhone").value.trim();
    const errorDiv = document.getElementById("orderError");

    errorDiv.textContent = "";

    if (!name || !email || !phone) {
      errorDiv.textContent = "Please fill in all required fields.";
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errorDiv.textContent = "Please enter a valid email address.";
      return;
    }

    if (state.cart.length === 0) {
      errorDiv.textContent = "Your cart is empty.";
      return;
    }

    // Get the first pickup date from cart (all should be same ideally)
    const pickupDate = state.cart[0].pickupDate;

    const payload = {
      customer_name: name,
      email: email,
      phone: phone,
      pickup_date: pickupDate,
      items: state.cart.map(item => ({
        size: item.size,
        flavor: item.flavor,
        qty: item.qty
      }))
    };

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.ok) {
        // Show payment modal
        showPaymentModal(result.order_id, result.total_cents);

        // Clear cart and form
        state.cart = [];
        renderCart();
        document.getElementById("customerName").value = "";
        document.getElementById("customerEmail").value = "";
        document.getElementById("customerPhone").value = "";
        document.getElementById("customerInfoSection").style.display = "none";
      } else {
        errorDiv.textContent = result.error || "Failed to place order. Please try again.";
      }
    } catch (error) {
      console.error('Order error:', error);
      errorDiv.textContent = "Network error. Please check your connection and try again.";
    }
  });

  // ==================== PAYMENT MODAL ====================
  async function showPaymentModal(orderId, totalCents) {
    try {
      const settings = await fetch("/api/settings").then(r => r.json());
      const payment = settings.payment_methods || {};

      document.getElementById("confirmOrderId").textContent = orderId;

      let paymentHTML = "";

      if (payment.venmo_enabled) {
        paymentHTML += `
          <div class="payment-option">
            <div class="payment-option-header">
              <div class="payment-icon venmo">V</div>
              <div class="payment-option-name">Venmo</div>
            </div>
            <div class="payment-option-details">
              Send ${fmt(totalCents)} to: <strong>${payment.venmo_username || "@MeefMeats"}</strong>
            </div>
          </div>
        `;
      }

      if (payment.zelle_enabled) {
        paymentHTML += `
          <div class="payment-option">
            <div class="payment-option-header">
              <div class="payment-icon zelle">Z</div>
              <div class="payment-option-name">Zelle</div>
            </div>
            <div class="payment-option-details">
              Send ${fmt(totalCents)} to: <strong>${payment.zelle_info || "orders@meefmeats.com"}</strong>
            </div>
          </div>
        `;
      }

      if (payment.cash_enabled) {
        paymentHTML += `
          <div class="payment-option">
            <div class="payment-option-header">
              <div class="payment-icon cash">$</div>
              <div class="payment-option-name">Cash</div>
            </div>
            <div class="payment-option-details">
              Pay ${fmt(totalCents)} in cash at pickup${payment.cash_instructions ? "<br>" + payment.cash_instructions : ""}
            </div>
          </div>
        `;
      }

      document.getElementById("paymentInstructions").innerHTML = `
        <div style="font-weight:700;margin-bottom:16px;font-size:16px">Payment Instructions</div>
        ${paymentHTML || '<div class="preview-empty">No payment methods configured. Please contact us.</div>'}
      `;

      const noteHTML = payment.payment_note ? `<strong>Important:</strong> ${payment.payment_note}` : 
                       '<strong>Important:</strong> Your order is reserved but not confirmed until payment is received. Please complete payment within 24 hours.';

      document.getElementById("paymentNote").innerHTML = noteHTML;

      document.getElementById("paymentModal").classList.add("open");
    } catch (error) {
      console.error('Error loading payment info:', error);
    }
  }

  window.closePaymentModal = function() {
    document.getElementById("paymentModal").classList.remove("open");
  };

  // ==================== INITIALIZATION ====================
  document.getElementById("year").textContent = new Date().getFullYear();

  (async () => {
    await loadAllowedDates();
    updatePreview();
    renderCart();
  })();
})();
