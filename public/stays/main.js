(() => {
  const state = { deck: [], likes: [], idx: 0, lastScanAt: null };

  const el = {
    meta: document.getElementById('meta'),
    cardStack: document.getElementById('cardStack'),
    likesList: document.getElementById('likesList'),
    deckView: document.getElementById('deckView'),
    likesView: document.getElementById('likesView')
  };

  const current = () => state.deck[state.idx] || null;

  function renderDeck() {
    const item = current();
    if (!item) {
      el.cardStack.innerHTML = '<div class="card"><h3>No more listings</h3><p>Run a new scan or check your likes.</p></div>';
      el.meta.textContent = `Scan: ${state.lastScanAt || 'n/a'} • Viewed all listings`;
      return;
    }

    el.meta.textContent = `Scan: ${state.lastScanAt || 'n/a'} • Card ${state.idx + 1} of ${state.deck.length}`;
    el.cardStack.innerHTML = `
      <article class="card">
        <div class="badges">
          <span class="badge">${item.source.toUpperCase()}</span>
          <span class="badge">$${item.price}/night</span>
          <span class="badge">${item.distance_miles} mi</span>
          <span class="badge">⭐ ${item.rating}</span>
        </div>
        <h3>${item.name}</h3>
        <p>${item.summary}</p>
        <p>${item.location}</p>
        <p><a href="${item.url}" target="_blank" rel="noreferrer">Open listing</a></p>
      </article>
    `;
  }

  function renderLikes() {
    if (!state.likes.length) {
      el.likesList.innerHTML = '<p>No likes yet. Swipe right on listings you want to save.</p>';
      return;
    }

    el.likesList.innerHTML = state.likes.map((item) => `
      <article class="like-row">
        <strong>${item.name}</strong> (${item.source}) - $${item.price}/night • ${item.distance_miles} mi<br>
        <small>${item.location}</small><br>
        <a href="${item.url}" target="_blank" rel="noreferrer">View details</a>
      </article>
    `).join('');
  }

  async function loadLikes() {
    const res = await fetch('/api/stays/likes');
    const payload = await res.json();
    state.likes = payload.likes || [];
    renderLikes();
  }

  async function runScan(force = false) {
    const res = await fetch(`/api/stays/scan${force ? '?force=1' : ''}`);
    const payload = await res.json();
    state.deck = payload.listings || [];
    state.lastScanAt = payload.scanned_at;
    state.idx = 0;
    renderDeck();
  }

  async function likeCurrent() {
    const item = current();
    if (!item) return;
    await fetch('/api/stays/likes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listing: item })
    });
    state.idx += 1;
    await loadLikes();
    renderDeck();
  }

  function passCurrent() {
    if (!current()) return;
    state.idx += 1;
    renderDeck();
  }

  document.getElementById('scanBtn').addEventListener('click', () => runScan(true));
  document.getElementById('likeBtn').addEventListener('click', likeCurrent);
  document.getElementById('passBtn').addEventListener('click', passCurrent);

  document.getElementById('showDeckBtn').addEventListener('click', () => {
    el.likesView.classList.add('hidden');
    el.deckView.classList.remove('hidden');
  });

  document.getElementById('showLikesBtn').addEventListener('click', async () => {
    await loadLikes();
    el.deckView.classList.add('hidden');
    el.likesView.classList.remove('hidden');
  });

  runScan();
  setInterval(() => runScan(true), 60_000);
  loadLikes();
})();
