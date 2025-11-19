document.addEventListener('DOMContentLoaded', () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('Connecté au serveur WebSocket');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case 'status':
                updateFriendStatus(data.username, data.online);
                break;
            case 'message':
                handleNewMessage(data);
                break;
            case 'group_message':
                handleNewGroupMessage(data);
                break;
        }
    };

    ws.onclose = () => {
        console.log('Déconnecté du serveur WebSocket');
        // On pourrait tenter de se reconnecter ici
    };

    function updateFriendStatus(username, isOnline) {
        // Logique pour mettre à jour l'indicateur de statut d'un ami
    }

    function handleNewMessage(message) {
        const chat = openChats[message.from] || openChats[message.to];
        if (chat) {
            loadMessagesForChat(chat);
        }
    }

    function handleNewGroupMessage(message) {
        const chat = openChats[`group_${message.groupId}`];
        if (chat) {
            loadMessagesForChat(chat);
        }
    }
});
