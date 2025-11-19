const openChats = {};

function createChatWindow(friend) {
    const windowEl = document.createElement("div");
    windowEl.className = "chat-window";

    const header = document.createElement("div");
    header.className = "chat-window-header";
    const title = document.createElement("div");
    title.className = "chat-window-title";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = friend.username.charAt(0).toUpperCase();
    const name = document.createElement("span");
    name.textContent = friend.username;
    title.appendChild(avatar);
    title.appendChild(name);

    const controls = document.createElement("div");
    controls.className = "chat-window-controls";
    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "chat-window-btn";
    minimizeBtn.textContent = "–";
    minimizeBtn.title = "Réduire";
    const closeBtn = document.createElement("button");
    closeBtn.className = "chat-window-btn";
    closeBtn.textContent = "✕";
    closeBtn.title = "Fermer";
    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(controls);

    const body = document.createElement("div");
    body.className = "chat-window-body";
    const messagesEl = document.createElement("div");
    messagesEl.className = "chat-messages";
    const form = document.createElement("form");
    form.className = "chat-form";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Écrire un message...";
    input.autocomplete = "off";
    const sendBtn = document.createElement("button");
    sendBtn.type = "submit";
    sendBtn.textContent = "Envoyer";
    form.appendChild(input);
    form.appendChild(sendBtn);
    body.appendChild(messagesEl);
    body.appendChild(form);

    windowEl.appendChild(header);
    windowEl.appendChild(body);

    const chat = { friend, windowEl, messagesEl, inputEl: input, form, intervalId: null };

    minimizeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        windowEl.classList.toggle("minimized");
    });
    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeChat(chat);
    });
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        sendMessage(chat, text);
    });

    return chat;
}

function openChat(friend) {
    const key = friend.isGroup ? `group_${friend.id}` : friend.username;
    if (openChats[key]) {
        const existing = openChats[key].windowEl;
        if (existing.parentNode === document.getElementById("chat-windows-container")) {
            document.getElementById("chat-windows-container").removeChild(existing);
            document.getElementById("chat-windows-container").prepend(existing);
        }
        return;
    }

    const chat = createChatWindow(friend);
    openChats[key] = chat;
    document.getElementById("chat-windows-container").prepend(chat.windowEl);

    loadMessagesForChat(chat);
}

function closeChat(chat) {
    const key = chat.friend.isGroup ? `group_${chat.friend.id}` : chat.friend.username;
    if (chat.intervalId) clearInterval(chat.intervalId);
    if (chat.windowEl.parentNode) {
        chat.windowEl.parentNode.removeChild(chat.windowEl);
    }
    delete openChats[key];
}

async function loadMessagesForChat(chat) {
    const url = chat.friend.isGroup ?
        `/api/groups/${chat.friend.id}/messages` :
        `/api/messages/${encodeURIComponent(chat.friend.username)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) {
            console.error("Erreur chargement messages", data);
            chat.messagesEl.innerHTML = '<p style="font-size: 0.75rem; color: #f97316;">Impossible de charger les messages.</p>';
            return;
        }
        renderMessages(chat, data.messages || []);
    } catch (e) {
        console.error(e);
        chat.messagesEl.innerHTML = '<p style="font-size: 0.75rem; color: #f97316;">Erreur réseau lors du chargement des messages.</p>';
    }
}

function renderMessages(chat, messages) {
    const el = chat.messagesEl;
    el.innerHTML = "";
    if (!messages.length) {
        el.innerHTML = '<p style="font-size: 0.75rem; color: var(--text-muted);">Aucun message pour le moment. Commence la conversation !</p>';
        return;
    }
    messages.forEach((m) => {
        const bubble = document.createElement("div");
        const fromSelf = m.sender_username === document.body.getAttribute('data-current-username');
        bubble.className = "chat-message " + (fromSelf ? "me" : "them");
        const text = document.createElement("div");
        text.textContent = m.content;
        const time = document.createElement("span");
        time.className = "chat-message-time";
        time.textContent = new Date(m.created_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit"
        });
        bubble.appendChild(text);
        bubble.appendChild(time);
        el.appendChild(bubble);
    });
    el.scrollTop = el.scrollHeight;
}

async function sendMessage(chat, text) {
    const url = chat.friend.isGroup ? `/api/groups/${chat.friend.id}/messages` : "/api/messages";
    const body = chat.friend.isGroup ? { content: text } : { toUsername: chat.friend.username, content: text };
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            console.error("Erreur envoi message", data);
            return;
        }
        chat.inputEl.value = "";
        loadMessagesForChat(chat);
    } catch (e) {
        console.error(e);
    }
}
