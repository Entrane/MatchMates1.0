const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS friend_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, receiver_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE)`);
  db.run(`CREATE TABLE IF NOT EXISTS friends (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE (user_id, friend_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE)`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, receiver_id INTEGER NOT NULL, content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE)`);
});

const sessionMiddleware = session({
  secret: 'change-this-secret',
  resave: false,
  saveUninitialized: false,
});

app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use((req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  next();
});

app.use(express.static(path.join(__dirname)));

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login.html');
  next();
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/profile', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));

app.get('/dashboard', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'dashboard.html');
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace(/{{ username }}/g, req.user.username);
  res.send(html);
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

app.post('/signup', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).send('Champs manquants');
  db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username.trim(), email.trim(), password], (err) => {
    if (err) {
      if (err.message.includes('UNIQUE')) return res.status(400).send('Ce nom d’utilisateur ou email est déjà utilisé.');
      return res.status(500).send('Erreur serveur');
    }
    res.redirect('/login.html');
  });
});

app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).send('Champs manquants');
  db.get('SELECT * FROM users WHERE email = ? OR username = ?', [identifier, identifier], (err, user) => {
    if (err) return res.status(500).send('Erreur serveur');
    if (!user || user.password !== password) return res.status(401).send('Identifiants incorrects');
    req.session.user = { id: user.id, username: user.username, email: user.email };
    res.redirect('/dashboard');
  });
});

// WebSocket Server Logic
const clients = new Map();

function getFriends(userId, callback) {
  db.all(`SELECT u.username FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ?`, [userId], (err, rows) => {
    if (err) return callback(err, null);
    callback(null, rows.map(r => r.username));
  });
}

function broadcastToFriends(userId, message) {
    getFriends(userId, (err, friends) => {
        if (err) return;
        friends.forEach(friendUsername => {
            sendMessageToUser(friendUsername, message);
        });
    });
}

wss.on('connection', (ws, req) => {
  sessionMiddleware(req, {}, () => {
    const user = req.session.user;
    if (!user) {
      ws.close();
      return;
    }

    clients.set(user.username, ws);
    console.log(`${user.username} connected`);
    broadcastToFriends(user.id, { type: 'online_status', username: user.username, online: true });

    ws.on('close', () => {
      clients.delete(user.username);
      console.log(`${user.username} disconnected`);
      broadcastToFriends(user.id, { type: 'online_status', username: user.username, online: false });
    });
  });
});

function sendMessageToUser(username, message) {
  const client = clients.get(username);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

app.post('/api/friends/request', requireAuth, (req, res) => {
  const { toUsername } = req.body;
  const currentUserId = req.user.id;
  db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'user_not_found' });
    if (user.id === currentUserId) return res.status(400).json({ error: 'cannot_add_self' });
    db.run(`INSERT INTO friend_requests (sender_id, receiver_id, status) VALUES (?, ?, 'pending')`, [currentUserId, user.id], function (err) {
      if (err) return res.status(500).json({ error: 'server_error' });
      sendMessageToUser(toUsername, { type: 'friend_request', from: req.user.username });
      res.json({ ok: true });
    });
  });
});

app.get('/api/friends', requireAuth, (req, res) => {
  const currentUserId = req.user.id;
  db.all(`SELECT u.username FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.username`, [currentUserId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'server_error' });
    const friends = rows.map(f => ({ ...f, online: clients.has(f.username) }));
    res.json({ friends });
  });
});

app.get('/api/friends/requests', requireAuth, (req, res) => {
  const currentUserId = req.user.id;
  Promise.all([
    new Promise((resolve, reject) => db.all(`SELECT fr.id, u.username AS from_username FROM friend_requests fr JOIN users u ON u.id = fr.sender_id WHERE fr.receiver_id = ? AND fr.status = 'pending'`, [currentUserId], (err, rows) => err ? reject(err) : resolve(rows))),
    new Promise((resolve, reject) => db.all(`SELECT fr.id, u.username AS to_username FROM friend_requests fr JOIN users u ON u.id = fr.receiver_id WHERE fr.sender_id = ? AND fr.status = 'pending'`, [currentUserId], (err, rows) => err ? reject(err) : resolve(rows)))
  ]).then(([incoming, outgoing]) => {
    res.json({ incoming, outgoing });
  }).catch(() => res.status(500).json({ error: 'server_error' }));
});

app.post('/api/friends/requests/:id/accept', requireAuth, (req, res) => {
  const requestId = req.params.id;
  const currentUserId = req.user.id;
  db.get("SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ? AND status = 'pending'", [requestId, currentUserId], (err, fr) => {
    if (err || !fr) return res.status(404).json({ error: 'request_not_found' });
    db.serialize(() => {
      db.run("UPDATE friend_requests SET status = 'accepted' WHERE id = ?", [requestId]);
      db.run('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)', [fr.sender_id, fr.receiver_id]);
      db.run('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)', [fr.receiver_id, fr.sender_id], (err) => {
        if (err) return res.status(500).json({ error: 'server_error' });
        db.get('SELECT username FROM users WHERE id = ?', [fr.sender_id], (err, sender) => {
          if (sender) sendMessageToUser(sender.username, { type: 'friend_accept', from: req.user.username });
          res.json({ ok: true });
        });
      });
    });
  });
});

app.post('/api/friends/requests/:id/reject', requireAuth, (req, res) => {
  db.run("UPDATE friend_requests SET status = 'rejected' WHERE id = ? AND receiver_id = ?", [req.params.id, req.user.id], function (err) {
    if (err) return res.status(500).json({ error: 'server_error' });
    res.json({ ok: true });
  });
});

app.get('/api/messages/:friendUsername', requireAuth, (req, res) => {
  const { friendUsername } = req.params;
  const currentUserId = req.user.id;
  db.get('SELECT id FROM users WHERE username = ?', [friendUsername], (err, friend) => {
    if (err || !friend) return res.status(404).json({ error: 'user_not_found' });
    db.all(`SELECT sender_id, content, created_at FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at ASC`, [currentUserId, friend.id, friend.id, currentUserId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'server_error' });
      const messages = rows.map(m => ({ fromSelf: m.sender_id === currentUserId, content: m.content, created_at: m.created_at }));
      res.json({ messages });
    });
  });
});

app.post('/api/messages', requireAuth, (req, res) => {
  const { toUsername, content } = req.body;
  const currentUserId = req.user.id;
  if (!toUsername || !content.trim()) return res.status(400).json({ error: 'missing_fields' });

  db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, friend) => {
    if (err || !friend) return res.status(404).json({ error: 'user_not_found' });
    const receiverId = friend.id;
    const cleanContent = content.trim();
    const messageTime = new Date().toISOString();

    db.run('INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (?, ?, ?, ?)', [currentUserId, receiverId, cleanContent, messageTime], function (err) {
      if (err) return res.status(500).json({ error: 'server_error' });

      const messagePayload = {
        type: 'new_message',
        from: req.user.username,
        to: toUsername,
        content: cleanContent,
        created_at: messageTime
      };

      sendMessageToUser(toUsername, messagePayload);
      sendMessageToUser(req.user.username, messagePayload);

      res.status(201).json({ ok: true });
    });
  });
});

server.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
