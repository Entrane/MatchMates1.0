(function () {
    const friendsListEl = document.getElementById("friends-list");
    const friendsCount = document.getElementById("friends-count");
    const addFriendForm = document.getElementById("add-friend-form");
    const addFriendInput = document.getElementById("friend-username");
    const friendError = document.getElementById("friend-error");
    const currentUsernameEl = document.getElementById("current-username");
    const requestsContainer = document.createElement("div");
    requestsContainer.id = "friends-requests";
    friendsListEl.parentNode.insertBefore(requestsContainer, friendsListEl);

    let friends = [];

    function showFriendError(message) {
        friendError.textContent = message || "";
    }

    function renderFriends() {
        friendsListEl.innerHTML = "";
        if (!friends.length) {
            friendsListEl.innerHTML = '<p class="friends-empty">Tu n’as encore aucun ami ajouté.</p>';
            friendsCount.textContent = "0 ami";
            return;
        }
        friendsCount.textContent = friends.length + (friends.length > 1 ? " amis" : " ami");
        friends.forEach((friend) => {
            const card = document.createElement("div");
            card.className = "friend-card";
            card.addEventListener("click", () => openChat(friend));
            const main = document.createElement("div");
            main.className = "friend-main";
            const avatar = document.createElement("div");
            avatar.className = "friend-avatar";
            avatar.textContent = friend.username.charAt(0).toUpperCase();
            const info = document.createElement("div");
            info.className = "friend-info";
            const name = document.createElement("div");
            name.className = "friend-name";
            name.textContent = friend.username;
            const status = document.createElement("div");
            status.className = "friend-status";
            status.innerHTML = '<span class="friend-status-dot"></span>En ligne';
            info.appendChild(name);
            info.appendChild(status);
            main.appendChild(avatar);
            main.appendChild(info);
            const removeBtn = document.createElement("button");
            removeBtn.className = "friend-remove-btn";
            removeBtn.type = "button";
            removeBtn.textContent = "✕";
            removeBtn.title = "Retirer cet ami";
            removeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                console.warn("Suppression d'ami non encore implémentée côté backend");
            });
            card.appendChild(main);
            card.appendChild(removeBtn);
            friendsListEl.appendChild(card);
        });
    }

    function renderFriendRequests(incoming, outgoing) {
        requestsContainer.innerHTML = "";
        if (!incoming.length && !outgoing.length) return;

        if (incoming.length) {
            const title = document.createElement("p");
            title.textContent = "Demandes reçues";
            title.className = "friend-request-title";
            requestsContainer.appendChild(title);
            incoming.forEach((req) => {
                const row = document.createElement("div");
                row.className = "friend-card friend-request-card";
                const txt = document.createElement("div");
                txt.className = "friend-name";
                txt.textContent = `${req.from_username} souhaite t’ajouter`;
                const actions = document.createElement("div");
                actions.className = "friend-request-actions";
                const acceptBtn = document.createElement("button");
                acceptBtn.className = "friend-request-accept";
                acceptBtn.textContent = "✔";
                acceptBtn.title = "Accepter";
                acceptBtn.onclick = (e) => {
                    e.stopPropagation();
                    respondToRequest(req.id, true);
                };
                const rejectBtn = document.createElement("button");
                rejectBtn.className = "friend-request-reject";
                rejectBtn.textContent = "✕";
                rejectBtn.title = "Refuser";
                rejectBtn.onclick = (e) => {
                    e.stopPropagation();
                    respondToRequest(req.id, false);
                };
                actions.appendChild(acceptBtn);
                actions.appendChild(rejectBtn);
                row.appendChild(txt);
                row.appendChild(actions);
                requestsContainer.appendChild(row);
            });
        }

        if (outgoing.length) {
            const title = document.createElement("p");
            title.textContent = "Demandes envoyées";
            title.className = "friend-request-title";
            requestsContainer.appendChild(title);
            outgoing.forEach((req) => {
                const row = document.createElement("div");
                row.className = "friend-card friend-request-card";
                row.style.borderColor = "rgba(59,130,246,0.7)";
                const txt = document.createElement("div");
                txt.className = "friend-name";
                txt.textContent = `En attente : ${req.to_username}`;
                row.appendChild(txt);
                requestsContainer.appendChild(row);
            });
        }
    }

    async function respondToRequest(requestId, accept) {
        try {
            const res = await fetch(`/api/friends/requests/${requestId}/${accept ? 'accept' : 'reject'}`, {
                method: "POST"
            });
            if (!res.ok) {
                console.error("Erreur réponse à la demande");
                return;
            }
            loadFriendData();
        } catch (e) {
            console.error(e);
        }
    }

    addFriendForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        const username = addFriendInput.value.trim();
        showFriendError("");
        if (!username) {
            showFriendError("Entre un pseudo pour ajouter un ami.");
            return;
        }
        if (username.toLowerCase() === (document.body.getAttribute("data-current-username") || "").toLowerCase()) {
            showFriendError("Tu ne peux pas t’ajouter toi-même 😅");
            return;
        }
        try {
            const res = await fetch("/api/friends/request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toUsername: username }),
            });
            const data = await res.json();
            if (!res.ok) {
                const errorMessages = {
                    user_not_found: "Cet utilisateur n’existe pas.",
                    already_friends: "Vous êtes déjà amis.",
                    request_already_pending: "Une demande est déjà en attente.",
                    cannot_add_self: "Tu ne peux pas t’ajouter toi-même.",
                };
                showFriendError(errorMessages[data.error] || "Erreur lors de l’envoi de la demande.");
                return;
            }
            addFriendInput.value = "";
            showFriendError("Demande envoyée ✅");
            loadFriendData();
        } catch (err) {
            console.error(err);
            showFriendError("Erreur réseau.");
        }
    });

    async function loadFriendData() {
        try {
            const [friendsRes, requestsRes] = await Promise.all([
                fetch("/api/friends"),
                fetch("/api/friends/requests"),
            ]);
            const friendsData = await friendsRes.json();
            const reqData = await requestsRes.json();
            friends = friendsData.friends || [];
            renderFriends();
            renderFriendRequests(reqData.incoming || [], reqData.outgoing || []);
        } catch (e) {
            console.error("Erreur chargement amis/demandes", e);
        }
    }

    currentUsernameEl.textContent = document.body.getAttribute("data-current-username") || "Moi";
    loadFriendData();
    setInterval(loadFriendData, 5000);

    /* ========= GESTION GROUPES ========= */
    const createGroupBtn = document.getElementById("create-group-btn");
    const groupsListEl = document.getElementById("groups-list");

    async function loadGroups() {
      try {
        const res = await fetch("/api/groups");
        const data = await res.json();
        if (res.ok) {
          renderGroups(data.groups || []);
        }
      } catch (e) {
        console.error("Erreur chargement groupes", e);
      }
    }

    function renderGroups(groups) {
      groupsListEl.innerHTML = "";
      if (!groups.length) return;
      const title = document.createElement("p");
      title.textContent = "Discussions de groupe";
      title.className = "friend-request-title";
      groupsListEl.appendChild(title);
      groups.forEach(group => {
        const card = document.createElement("div");
        card.className = "friend-card";
        card.textContent = group.name;
        card.addEventListener("click", () => {
          openChat({ username: group.name, isGroup: true, id: group.id });
        });
        groupsListEl.appendChild(card);
      });
    }

    createGroupBtn.addEventListener("click", () => {
      const groupName = prompt("Nom du groupe :");
      if (!groupName || !groupName.trim()) return;
      const memberIds = friends.map(f => f.id);
      fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName, members: memberIds }),
      })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          loadGroups();
        }
      })
      .catch(err => console.error("Erreur création groupe", err));
    });

    loadGroups();
    setInterval(loadGroups, 5000);

    const friendsSidebar = document.querySelector('.friends-sidebar');
    const toggleButton = document.getElementById('toggle-friends-sidebar');

    if (toggleButton && friendsSidebar) {
        toggleButton.addEventListener('click', () => {
            friendsSidebar.classList.toggle('visible');
        });
    }
})();
