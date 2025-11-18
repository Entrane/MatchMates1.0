// server.js
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// === Connexion SQLite ===
const db = new sqlite3.Database('./database.sqlite');

// === Création des tables (users + amis) ===
db.serialize(() => {
  // Comptes utilisateurs
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // Demandes d'amis
  db.run(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Liste d'amis
  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

// === Middlewares ===
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(
  session({
    secret: 'change-this-secret', // à changer en prod
    resave: false,
    saveUninitialized: false,
  })
);

// expose req.user depuis la session
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  next();
});

// servir les fichiers statiques (CSS, images, etc.)
app.use(express.static(path.join(__dirname)));

// helper auth
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login.html');
  }
  next();
}

// === ROUTES PAGES ===

// page d'accueil
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// page de login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// page de signup
app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'signup.html'));
});

// page profile (si tu l'utilises)
app.get('/profile', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'profile.html'));
});

// tableau de bord – on injecte le username dans {{ username }}
app.get('/dashboard', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'dashboard.html');
  let html = fs.readFileSync(filePath, 'utf8');

  // remplace toutes les occurrences de {{ username }} par le vrai pseudo
  html = html.replace(/{{ username }}/g, req.user.username);

  res.send(html);
});

// déconnexion
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// === AUTH: inscription & connexion ===

// inscription
app.post('/signup', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).send('Champs manquants');
  }

  // NOTE : mdp non hashé = pas sécurisé, mais simple pour l'instant
  db.run(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
    [username.trim(), email.trim(), password],
    function (err) {
      if (err) {
        console.error(err);
        if (err.message.includes('UNIQUE constraint failed: users.username')) {
          return res.status(400).send('Ce nom d’utilisateur est déjà utilisé.');
        }
        if (err.message.includes('UNIQUE constraint failed: users.email')) {
          return res.status(400).send('Cet email est déjà utilisé.');
        }
        return res.status(500).send('Erreur serveur');
      }
      // après inscription, on peut rediriger vers login
      res.redirect('/login.html');
    }
  );
});

// connexion
aapp.post('/login', (req, res) => {
  // peut être email OU username
  const identifier = (req.body.identifier || '').trim();
  const password = req.body.password || '';

  if (!identifier || !password) {
    console.log('Champs manquants:', req.body);
    return res.status(400).send('Champs manquants');
  }

  // on cherche soit par email, soit par username
  db.get(
    'SELECT * FROM users WHERE email = ? OR username = ?',
    [identifier, identifier],
    (err, user) => {
      if (err) {
        console.error('Erreur DB login:', err);
        return res.status(500).send('Erreur serveur');
      }

      if (!user || user.password !== password) {
        return res.status(401).send('Email / pseudo ou mot de passe incorrect');
      }

      // on stocke l'utilisateur en session
      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email,
      };

      res.redirect('/dashboard');
    }
  );
});
// === API AMIS ===

// envoyer une demande d'ami
app.post('/api/friends/request', requireAuth, (req, res) => {
  const currentUserId = req.user.id;
  const { toUsername } = req.body;

  if (!toUsername || !toUsername.trim()) {
    return res.status(400).json({ error: 'missing_username' });
  }

  const targetUsername = toUsername.trim();

  // 1. trouver l'utilisateur cible
  db.get(
    'SELECT id FROM users WHERE username = ?',
    [targetUsername],
    (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'server_error' });
      }
      if (!user) {
        return res.status(404).json({ error: 'user_not_found' });
      }

      const receiverId = user.id;

      if (receiverId === currentUserId) {
        return res.status(400).json({ error: 'cannot_add_self' });
      }

      // 2. déjà amis ?
      db.get(
        'SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?',
        [currentUserId, receiverId],
        (err, row) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'server_error' });
          }
          if (row) {
            return res.status(400).json({ error: 'already_friends' });
          }

          // 3. demande déjà en attente ?
          db.get(
            `SELECT 1 FROM friend_requests
             WHERE ((sender_id = ? AND receiver_id = ?)
                 OR (sender_id = ? AND receiver_id = ?))
               AND status = 'pending'`,
            [currentUserId, receiverId, receiverId, currentUserId],
            (err, pendingRow) => {
              if (err) {
                console.error(err);
                return res.status(500).json({ error: 'server_error' });
              }
              if (pendingRow) {
                return res.status(400).json({ error: 'request_already_pending' });
              }

              // 4. créer la demande
              db.run(
                `INSERT INTO friend_requests (sender_id, receiver_id, status)
                 VALUES (?, ?, 'pending')`,
                [currentUserId, receiverId],
                function (err) {
                  if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'server_error' });
                  }
                  return res.json({ ok: true, requestId: this.lastID });
                }
              );
            }
          );
        }
      );
    }
  );
});

// liste des amis
app.get('/api/friends', requireAuth, (req, res) => {
  const currentUserId = req.user.id;

  db.all(
    `SELECT u.username
     FROM friends f
     JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ?
     ORDER BY u.username`,
    [currentUserId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'server_error' });
      }
      res.json({ friends: rows });
    }
  );
});

// demandes d'amis (reçues + envoyées)
app.get('/api/friends/requests', requireAuth, (req, res) => {
  const currentUserId = req.user.id;

  // incoming
  db.all(
    `SELECT fr.id, u.username AS from_username
     FROM friend_requests fr
     JOIN users u ON u.id = fr.sender_id
     WHERE fr.receiver_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC`,
    [currentUserId],
    (err, incomingRows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'server_error' });
      }

      // outgoing
      db.all(
        `SELECT fr.id, u.username AS to_username
         FROM friend_requests fr
         JOIN users u ON u.id = fr.receiver_id
         WHERE fr.sender_id = ? AND fr.status = 'pending'
         ORDER BY fr.created_at DESC`,
        [currentUserId],
        (err2, outgoingRows) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ error: 'server_error' });
          }

          res.json({
            incoming: incomingRows,
            outgoing: outgoingRows
          });
        }
      );
    }
  );
});

// accepter une demande
app.post('/api/friends/requests/:id/accept', requireAuth, (req, res) => {
  const currentUserId = req.user.id;
  const requestId = req.params.id;

  db.get(
    'SELECT * FROM friend_requests WHERE id = ?',
    [requestId],
    (err, fr) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'server_error' });
      }
      if (!fr) {
        return res.status(404).json({ error: 'request_not_found' });
      }
      if (fr.receiver_id !== currentUserId) {
        return res.status(403).json({ error: 'not_authorized' });
      }
      if (fr.status !== 'pending') {
        return res.status(400).json({ error: 'not_pending' });
      }

      db.run(
        "UPDATE friend_requests SET status = 'accepted' WHERE id = ?",
        [requestId],
        (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'server_error' });
          }

          // ajout mutuel dans friends
          db.run(
            'INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)',
            [fr.sender_id, fr.receiver_id]
          );
          db.run(
            'INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)',
            [fr.receiver_id, fr.sender_id]
          );

          res.json({ ok: true });
        }
      );
    }
  );
});

// refuser une demande
app.post('/api/friends/requests/:id/reject', requireAuth, (req, res) => {
  const currentUserId = req.user.id;
  const requestId = req.params.id;

  db.get(
    'SELECT * FROM friend_requests WHERE id = ?',
    [requestId],
    (err, fr) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'server_error' });
      }
      if (!fr) {
        return res.status(404).json({ error: 'request_not_found' });
      }
      if (fr.receiver_id !== currentUserId) {
        return res.status(403).json({ error: 'not_authorized' });
      }

      db.run(
        "UPDATE friend_requests SET status = 'rejected' WHERE id = ?",
        [requestId],
        (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'server_error' });
          }
          res.json({ ok: true });
        }
      );
    }
  );
});

// === LANCEMENT SERVEUR ===
app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
