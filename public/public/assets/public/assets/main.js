(() => {
  // Utility functions
  const fmt = (cents) => "$" + (cents / 100).toFixed(2);
  
  // Application state
  const state = {
    price_full: 5000,
    price_half: 3000,
    cart: [],
    selectedSize: "full",
    selectedFlavor: "Cajun",
    pickupDateIso: null,
    availability: { status_full: "ok", status_half: "ok" }
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
    if (menuDrop.classList.contains("open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });
  
  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (menuDrop.classList.contains("open") && 
        !menuDrop.contains(e.target) && 
        e.target !== menuBtn) {
      closeMenu();
    }
  });
  
  // Close menu on Escape key
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
      
      const formattedDates = dates.map(d => {
        const dt = new Date(d + "T00:00:00");
        const label = dt.toLocaleDateString(undefined, { 
          weekday: "short", 
          month: "short", 
          day: "numeric" 
        });
        return { iso: d, label };
      });
      
      formattedDates.forEach((obj, i) => {
        const btn = document.createElement("button");
        btn.className = "day-btn" + (i === 0 ? " active" : "");
        btn.textContent = obj.label;
        btn.addEventListener("click", () => {
          wrap.querySelectorAll(".day-btn").forEach(x => x.classList.remove("active"));
          btn.classList.add("active");
          state.pickupDateIso = obj.iso;
          loadAvailability();
        });
        wrap.appendChild(btn);
        
        // Set first date as default
        if (i === 0) state.pickupDateIso = obj.iso;
      });
    } catch (error) {
      console.error('Error loading dates:', error);
      alert('Failed to load available dates. Please refresh the page.');
    }
  }

  // ==================== FLAVOR SELECTION ====================
  document.querySelectorAll("#flavors .pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#flavors .pill").forEach(x => x.classList.remove("active"));
      pill.classList.add("active");
      state.selectedFlavor = pill.dataset.flavor;
    });
  });

  // ==================== SIZE SELECTION & STOCK ====================
  function renderStocks() {
    const chip = document.getElementById("stockChip");
    const key = state.selectedSize === "half" ? "status_half" : "status_full";
    const status = state.availability[key] || "ok";
    
    chip.classList.remove("stock-ok", "stock-low", "stock-out");
    
    if (status === "out") {
      chip.textContent = "Sold out";
      chip.classList.add("stock-out");
    } else if (status === "low") {
      chip.textContent = "Low stock";
      chip.classList.add("stock-low");
    } else {
      chip.textContent = "In stock";
      chip.classList.add("stock-ok");
    }
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
    
    try {
      const query = new URLSearchParams({ date: state.pickupDateIso });
      const data = await fetch("/api/availability?" + query.toString()).then(r => {
        if (!r.ok) throw new Error('Failed to load availability');
        return r.json();
      });
      
      state.availability = data;
      renderStocks();
    } catch (error) {
      console.error('Error loading availability:', error);
    }
  }

  // ==================== CART MANAGEMENT ====================
  function renderCart() {
    const list = document.getElementById("cartItems");
    
    if (state.cart.length === 0) {
      list.innerHTML = "Your cart is empty.";
    } else {
      list.innerHTML = state.cart.map((item, index) => `
        <div class="row" style="justify-content:space-between;margin:6px 0">
          <div>
            <div><b>Turkey</b> • ${item.size} • ${item.flavor}</div>
            <div class="small">${item.qty} × ${fmt(item.unit_price)}</div>
          </div>
          <button class="btn danger" onclick="window.removeFromCart(${index})">Remove</button>
        </div>
      `).join("");
    }
    
    const total = state.cart.reduce((sum, item) => sum + item.unit_price * item.qty, 0);
    document.getElementById("total").textContent = fmt(total);
  }
  
  // Global function for removing items
  window.removeFromCart = function(index) {
    state.cart.splice(index, 1);
    renderCart();
  };

  // ==================== ADD TO CART ====================
  document.getElementById("addBtn").addEventListener("click", () => {
    // Validate stock availability
    const key = state.selectedSize === "half" ? "status_half" : "status_full";
    if (state.availability[key] === "out") {
      alert("Sorry, this size is sold out for the selected date.");
      return;
    }
    
    // Validate quantity
    const qty = parseInt(document.getElementById("qty").value || "1", 10);
    if (qty < 1) {
      alert("Quantity must be at least 1");
      return;
    }
    
    const unitPrice = state.selectedSize === "half" ? state.price_half : state.price_full;
    
    state.cart.push({
      size: state.selectedSize,
      flavor: state.selectedFlavor,
      qty: qty,
      unit_price: unitPrice
    });
    
    renderCart();
  });

  // ==================== PLACE ORDER ====================
  document.getElementById("placeOrder").addEventListener("click", async () => {
    if (state.cart.length === 0) {
      alert("Your cart is empty. Please add items before placing an order.");
      return;
    }
    
    if (!state.pickupDateIso) {
      alert("Please select a pickup date.");
      return;
    }
    
    const name = document.getElementById("customerName").value.trim();
    const email = document.getElementById("customerEmail").value.trim();
    const phone = document.getElementById("customerPhone").value.trim();
    
    if (!name || !email) {
      alert("Please fill in your name and email.");
      return;
    }
    
    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      alert("Please enter a valid email address.");
      return;
    }
    
    const payload = {
      pickup_date: state.pickupDateIso,
      customer_name: name,
      email: email,
      phone: phone,
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
        document.getElementById("orderResult").textContent = 
          `✓ Order placed! Your order ID is ${result.order_id}`;
        document.getElementById("orderResult").style.color = "#9ae6b4";
        
        // Clear cart and form
        state.cart = [];
        renderCart();
        document.getElementById("customerName").value = "";
        document.getElementById("customerEmail").value = "";
        document.getElementById("customerPhone").value = "";
        
        // Clear success message after 5 seconds
        setTimeout(() => {
          document.getElementById("orderResult").textContent = "";
        }, 5000);
      } else {
        document.getElementById("orderResult").textContent = 
          `✗ Error: ${result.error || 'Failed to place order'}`;
        document.getElementById("orderResult").style.color = "#ff5252";
      }
    } catch (error) {
      console.error('Order error:', error);
      document.getElementById("orderResult").textContent = 
        "✗ Network error. Please check your connection and try again.";
      document.getElementById("orderResult").style.color = "#ff5252";
    }
  });

  // ==================== INITIALIZATION ====================
  document.getElementById("year").textContent = new Date().getFullYear();

  (async () => {
    await loadAllowedDates();
    await loadAvailability();
    renderStocks();
    renderCart();
  })();
})();
