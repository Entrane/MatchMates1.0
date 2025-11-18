document.addEventListener('DOMContentLoaded', () => {
  const currentUsername = document.body.dataset.currentUsername;
  let ws;

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      // Initialize managers once connected
      window.friendsManager.init();
      // Chat manager is initialized by user action, not here.
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('WS Message Received:', message);

      switch (message.type) {
        case 'new_message':
          window.chatManager.addMessage(message);
          break;
        case 'friend_request':
        case 'friend_accept':
          // For simplicity, just reload all friend data
          window.friendsManager.init();
          break;
        case 'online_status':
          window.friendsManager.updateOnlineStatus(message.username, message.online);
          break;
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected. Reconnecting in 2s...');
      setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      ws.close();
    };
  }

  if (currentUsername) {
    connect();
  } else {
    console.log("No user logged in, WebSocket not started.");
  }
});
