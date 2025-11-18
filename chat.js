document.addEventListener('DOMContentLoaded', () => {
  const chatWelcomeEl = document.getElementById('chat-welcome-message');
  const chatConversationEl = document.getElementById('chat-conversation');
  const chatHeaderEl = document.getElementById('chat-header');
  const chatMessagesEl = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  let currentChat = null;

  window.chatManager = {
    openChat: async (username) => {
      if (currentChat === username) return;
      currentChat = username;

      document.querySelectorAll('.friend-card.active').forEach(c => c.classList.remove('active'));
      document.querySelector(`.friend-card[data-username="${username}"]`).classList.add('active');

      chatWelcomeEl.classList.add('hidden');
      chatConversationEl.classList.remove('hidden');

      chatHeaderEl.textContent = `Conversation avec ${username}`;
      chatInput.disabled = false;
      chatForm.querySelector('button').disabled = false;
      chatMessagesEl.innerHTML = '<p>Chargement...</p>';

      try {
        const res = await fetch(`/api/messages/${username}`);
        const data = await res.json();
        renderMessages(data.messages || []);
      } catch (err) {
        chatMessagesEl.innerHTML = '<p>Erreur de chargement des messages.</p>';
      }
    },
    addMessage: (message) => {
      if (message.from !== currentChat && message.to !== currentChat) return;

      const fromSelf = message.from === document.body.dataset.currentUsername;
      appendMessage({ ...message, fromSelf });
    }
  };

  function renderMessages(messages) {
    chatMessagesEl.innerHTML = '';
    messages.forEach(appendMessage);
  }

  function appendMessage(msg) {
    const bubble = document.createElement('div');
    bubble.className = `chat-message ${msg.fromSelf ? 'me' : 'them'}`;
    bubble.innerHTML = `
      <div class="message-bubble">
        ${msg.content}
        <div class="message-time">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    `;
    chatMessagesEl.appendChild(bubble);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  chatForm.addEventListener('submit', async e => {
    e.preventDefault();
    const content = chatInput.value.trim();
    if (!content || !currentChat) return;

    chatInput.value = '';

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUsername: currentChat, content }),
      });
    } catch (err) {
      // Re-add message to input to allow resending
      chatInput.value = content;
      console.error("Failed to send message", err);
    }
  });
});
