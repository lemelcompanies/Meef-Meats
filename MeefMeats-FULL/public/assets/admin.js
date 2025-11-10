(() => {
  function allowedDates(){ return fetch("/api/allowed-dates").then(r => r.json()); }
  function toMoney(c){ return "$" + (c/100).toFixed(2); }
  function applyBadge(el, val, label){
    el.classList.remove("stock-ok","stock-low","stock-out");
    if (val === "out"){ el.classList.add("stock-out"); el.textContent = label + ": Sold out"; }
    else if (val === "low"){ el.classList.add("stock-low"); el.textContent = label + ": Low stock"; }
    else { el.classList.add("stock-ok"); el.textContent = label + ": In stock"; }
  }

  const dateSel = document.getElementById("dateSel");
  const statusFull = document.getElementById("statusFull");
  const statusHalf = document.getElementById("statusHalf");
  const badgeFull = document.getElementById("badgeFull");
  const badgeHalf = document.getElementById("badgeHalf");
  const statusMsg = document.getElementById("statusMsg");

  const contactPhone = document.getElementById("contactPhone");
  const contactEmail = document.getElementById("contactEmail");
  const contactAddr  = document.getElementById("contactAddr");
  const igUrl = document.getElementById("igUrl");
  const settingsMsg = document.getElementById("settingsMsg");

  const filterStatus = document.getElementById("filterStatus");
  const search = document.getElementById("search");
  const refreshBtn = document.getElementById("refresh");
  const ordersMsg = document.getElementById("ordersMsg");

  async function loadSettings(){
    const s = await fetch("/api/admin/settings").then(r => r.json());
    contactPhone.value = s.contact?.phone || "";
    contactEmail.value = s.contact?.email || "";
    contactAddr.value  = s.contact?.address || "";
    igUrl.value        = s.instagram_url || "";
    const ov = s.status_overrides || {};
    const rec = ov[dateSel.value] || {};
    statusFull.value = rec.full || "ok";
    statusHalf.value = rec.half || "ok";
    applyBadge(badgeFull, statusFull.value, "Full");
    applyBadge(badgeHalf, statusHalf.value, "Half");
  }

  async function saveSettings(){
    const body = {
      instagram_url: igUrl.value,
      contact: { phone: contactPhone.value, email: contactEmail.value, address: contactAddr.value }
    };
    const out = await fetch("/api/admin/settings", { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) })
      .then(r => r.json());
    settingsMsg.textContent = out.ok ? "Saved." : "Error";
    setTimeout(() => settingsMsg.textContent = "", 1200);
  }

  async function saveStatus(){
    const current = await fetch("/api/admin/settings").then(r => r.json());
    const ov = current.status_overrides || {};
    ov[dateSel.value] = { full: statusFull.value, half: statusHalf.value };
    const out = await fetch("/api/admin/settings", {
      method: "PUT", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ status_overrides: ov })
    }).then(r => r.json());
    statusMsg.textContent = out.ok ? "Saved." : "Error";
    setTimeout(() => statusMsg.textContent = "", 1200);
  }

  function rowHTML(o){
    const items = (o.items||[]).map(it => \`\${it.qty||1}x \${it.size} \${it.flavor}\`).join(", ");
    return \`
      <tr>
        <td>\${o.id}<div class="small">\${new Date(o.created_at).toLocaleString()}</div></td>
        <td>\${o.customer_name}<div class="small">\${o.email}</div></td>
        <td>\${o.pickup_date}</td>
        <td>\${items}</td>
        <td>\${toMoney(o.total_cents||0)}</td>
        <td><span class="badge">\${o.status}</span></td>
        <td>
          <select data-id="\${o.id}" class="input statusSel">
            \${["new","confirmed","preparing","ready","picked_up","canceled"]
              .map(s => \`<option value="\${s}" \${o.status===s?"selected":""}>\${s}</option>\`).join("")}
          </select>
        </td>
      </tr>
    \`;
  }

  async function refreshOrders(){
    const data = await fetch("/api/admin/orders").then(r => r.json());
    const rows = data.orders || [];
    const q = (search.value||"").toLowerCase();
    const f = filterStatus.value;

    const tb = document.querySelector("#ordersTbl tbody");
    tb.innerHTML = rows
      .filter(o => (!f || o.status===f))
      .filter(o => !q || o.id.toLowerCase().includes(q) || (o.customer_name||"").toLowerCase().includes(q))
      .sort((a,b) => (a.created_at < b.created_at ? 1 : -1))
      .map(rowHTML).join("");

    document.querySelectorAll(".statusSel").forEach(sel => {
      sel.addEventListener("change", async () => {
        const id = sel.getAttribute("data-id");
        const out = await fetch("/api/admin/orders/" + id + "/status", {
          method: "PUT", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ status: sel.value })
        }).then(r => r.json());
        ordersMsg.textContent = out.ok ? "Status updated." : (out.error || "Error");
        setTimeout(() => ordersMsg.textContent = "", 1000);
        refreshOrders();
      });
    });
  }

  async function init(){
    const dates = await allowedDates();
    dates.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = new Date(d + "T00:00:00").toDateString();
      dateSel.appendChild(opt);
    });

    await loadSettings();
    await refreshOrders();

    document.getElementById("saveStatus").addEventListener("click", saveStatus);
    document.getElementById("saveSettings").addEventListener("click", saveSettings);
    document.getElementById("refresh").addEventListener("click", refreshOrders);
    document.getElementById("filterStatus").addEventListener("change", refreshOrders);
    document.getElementById("search").addEventListener("input", refreshOrders);

    statusFull.addEventListener("change", () => applyBadge(badgeFull, statusFull.value, "Full"));
    statusHalf.addEventListener("change", () => applyBadge(badgeHalf, statusHalf.value, "Half"));
  }

  init();
})();