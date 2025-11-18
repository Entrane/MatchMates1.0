document.addEventListener('DOMContentLoaded', () => {
  const friendsListEl = document.getElementById('friends-list');
  const friendsCountEl = document.getElementById('friends-count');
  const addFriendForm = document.getElementById('add-friend-form');
  const addFriendInput = document.getElementById('friend-username');
  const friendErrorEl = document.getElementById('friend-error');
  const requestsContainer = document.getElementById('friends-requests-container');

  let friends = [];
  let onlineFriends = new Set();

  window.friendsManager = {
    getFriends: () => friends,
    updateOnlineStatus: (username, isOnline) => {
      if (isOnline) onlineFriends.add(username);
      else onlineFriends.delete(username);
      renderFriends();
    },
    init: () => {
      loadFriendData();
    }
  };

  function showFriendError(message) {
    friendErrorEl.textContent = message || '';
  }

  function renderFriends() {
    friendsListEl.innerHTML = '';

    if (!friends.length) {
      friendsListEl.innerHTML = '<p class="friends-empty">Tu n’as encore aucun ami ajouté.</p>';
    } else {
      friends.sort((a, b) => {
        const aOnline = onlineFriends.has(a.username);
        const bOnline = onlineFriends.has(b.username);
        if (aOnline === bOnline) return a.username.localeCompare(b.username);
        return aOnline ? -1 : 1;
      });

      friends.forEach(friend => {
        const isOnline = onlineFriends.has(friend.username);
        const card = document.createElement('div');
        card.className = 'friend-card';
        card.dataset.username = friend.username;
        card.innerHTML = `
          <div class="friend-avatar">${friend.username.charAt(0).toUpperCase()}</div>
          <div class="friend-info">
            <div class="friend-name">${friend.username}</div>
            <div class="friend-status ${isOnline ? 'online' : 'offline'}">
              <div class="friend-status-dot"></div>
              <span>${isOnline ? 'En ligne' : 'Hors ligne'}</span>
            </div>
          </div>
        `;
        card.addEventListener('click', () => window.chatManager.openChat(friend.username));
        friendsListEl.appendChild(card);
      });
    }

    friendsCountEl.textContent = `${onlineFriends.size} en ligne`;
  }

  async function loadFriendData() {
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        fetch('/api/friends'),
        fetch('/api/friends/requests'),
      ]);
      const friendsData = await friendsRes.json();
      const requestsData = await requestsRes.json();

      friends = friendsData.friends || [];
      onlineFriends = new Set(friends.filter(f => f.online).map(f => f.username));

      renderFriends();
      renderFriendRequests(requestsData.incoming || []);
    } catch (e) {
      console.error('Erreur chargement amis/demandes', e);
    }
  }

  function renderFriendRequests(incoming) {
    requestsContainer.innerHTML = '';
    if (!incoming.length) return;

    requestsContainer.innerHTML = '<h4>Demandes reçues</h4>';
    incoming.forEach(req => {
      const card = document.createElement('div');
      card.className = 'friend-card';
      card.innerHTML = `
        <div class="friend-info">
          <div class="friend-name">${req.from_username}</div>
        </div>
        <div>
          <button class="accept-btn" data-id="${req.id}">✔</button>
          <button class="reject-btn" data-id="${req.id}">✖</button>
        </div>
      `;
      requestsContainer.appendChild(card);
    });

    requestsContainer.addEventListener('click', e => {
      const target = e.target;
      const id = target.dataset.id;
      if (!id) return;
      if (target.classList.contains('accept-btn')) respondToRequest(id, true);
      if (target.classList.contains('reject-btn')) respondToRequest(id, false);
    });
  }

  async function respondToRequest(id, accept) {
    await fetch(`/api/friends/requests/${id}/${accept ? 'accept' : 'reject'}`, { method: 'POST' });
    loadFriendData();
  }

  addFriendForm.addEventListener('submit', async e => {
    e.preventDefault();
    const username = addFriendInput.value.trim();
    if (!username) return;

    try {
      const res = await fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUsername: username }),
      });
      const data = await res.json();

      if (!res.ok) {
        showFriendError(data.error === 'user_not_found' ? 'Utilisateur non trouvé.' : 'Erreur.');
      } else {
        addFriendInput.value = '';
        showFriendError('Demande envoyée !');
        loadFriendData();
      }
    } catch (err) {
      showFriendError('Erreur réseau.');
    }
  });
});
