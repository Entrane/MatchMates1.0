// ====================================================
// FICHIER : server.js
// ====================================================

const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const fs = require('fs');

// Initialisation de l'application
const app = express();

// CONFIGURATION PORT (CRUCIAL POUR RAILWAY)
// Railway fournit le port via process.env.PORT
const PORT = process.env.PORT || 3000;

// ====================================================
// 1. BASE DE DONNÉES (SQLite)
// ====================================================
const db = new sqlite3.Database('./database.sqlite');

// Création des tables au démarrage
db.serialize(() => {
  // Table Utilisateurs
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // Table Demandes d'amis
  db.run(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, rejected
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Table Amis (Liste confirmée)
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

  // Table Messages Privés
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Table Groupes
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      creator_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Table Membres de Groupes
  db.run(`
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Table Messages de Groupes
  db.run(`
    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

// ====================================================
// 2. MIDDLEWARES
// ====================================================

// Pour lire les données des formulaires et JSON
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Gestion de session (connexion persistante)
app.use(
  session({
    secret: 'matchmates_secret_key_railway', // À changer en prod idéalement
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 heures
  })
);

// Middleware pour rendre l'utilisateur accessible dans req.user
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  next();
});

// Servir les fichiers statiques (HTML, CSS, JS, Images)
app.use(express.static(path.join(__dirname)));

// Fonction de sécurité : redirige si non connecté
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login.html');
  }
  next();
}

// ====================================================
// 3. ROUTES PAGES (HTML)
// ====================================================

app.get('/', (req, res) => {
  // Si déjà connecté, on va au dashboard, sinon login
  if (req.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/profile', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));

// Route Dashboard avec injection du pseudo
app.get('/dashboard', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'dashboard.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erreur serveur loading dashboard.');
    }
    // On remplace {{ username }} par le vrai nom
    const personalizedHtml = html.replace(/{{ username }}/g, req.user.username);
    res.send(personalizedHtml);
  });
});

// Déconnexion
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// ====================================================
// 4. AUTHENTIFICATION (API)
// ====================================================

// Inscription
app.post('/signup', (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) return res.status(400).send("Champs manquants");

  db.run(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
    [username.trim(), email.trim(), password],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(400).send("Erreur : Pseudo ou Email déjà pris.");
      }
      // Connexion auto après inscription
      req.session.user = { id: this.lastID, username: username.trim(), email: email.trim() };
      res.redirect('/dashboard');
    }
  );
});

// Connexion
app.post('/login', (req, res) => {
  const { identifier, password } = req.body; // identifier = email OU username
  
  db.get(
    'SELECT * FROM users WHERE (email = ? OR username = ?) AND password = ?',
    [identifier, identifier, password],
    (err, user) => {
      if (err || !user) {
        return res.status(401).send("Identifiants incorrects.");
      }
      req.session.user = user;
      res.redirect('/dashboard');
    }
  );
});

// ====================================================
// 5. API AMIS
// ====================================================

// Envoyer une demande d'ami
app.post('/api/friends/request', requireAuth, (req, res) => {
  const { toUsername } = req.body;
  const currentUserId = req.user.id;

  // 1. Trouver l'ID de l'ami
  db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, targetUser) => {
    if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (targetUser.id === currentUserId) return res.status(400).json({ error: "Tu ne peux pas t'ajouter toi-même." });

    // 2. Vérifier si déjà amis ou demande en cours
    db.get(
        `SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?
         UNION
         SELECT 1 FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) AND status = 'pending'`,
        [currentUserId, targetUser.id, currentUserId, targetUser.id, targetUser.id, currentUserId],
        (err, existing) => {
            if (existing) return res.status(400).json({ error: "Déjà amis ou demande en cours." });

            // 3. Créer la demande
            db.run(
                'INSERT INTO friend_requests (sender_id, receiver_id) VALUES (?, ?)',
                [currentUserId, targetUser.id],
                function(err) {
                    if (err) return res.status(500).json({ error: "Erreur serveur" });
                    res.json({ ok: true });
                }
            );
        }
    );
  });
});

// Récupérer la liste des amis confirmés
app.get('/api/friends', requireAuth, (req, res) => {
  db.all(
    `SELECT u.username, u.id 
     FROM friends f 
     JOIN users u ON u.id = f.friend_id 
     WHERE f.user_id = ?`,
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Erreur DB" });
      res.json({ friends: rows || [] });
    }
  );
});

// Récupérer les demandes d'amis (reçues et envoyées)
app.get('/api/friends/requests', requireAuth, (req, res) => {
  const userId = req.user.id;
  
  // Demandes reçues (Incoming)
  db.all(
    `SELECT fr.id, u.username as from_username 
     FROM friend_requests fr 
     JOIN users u ON u.id = fr.sender_id 
     WHERE fr.receiver_id = ? AND fr.status = 'pending'`,
    [userId],
    (err, incoming) => {
        if (err) return res.status(500).json({ error: "Erreur DB" });
        
        // Demandes envoyées (Outgoing)
        db.all(
            `SELECT fr.id, u.username as to_username
             FROM friend_requests fr
             JOIN users u ON u.id = fr.receiver_id
             WHERE fr.sender_id = ? AND fr.status = 'pending'`,
            [userId],
            (err2, outgoing) => {
                res.json({ incoming: incoming || [], outgoing: outgoing || [] });
            }
        );
    }
  );
});

// Accepter ou Refuser une demande
app.post('/api/friends/requests/:id/:action', requireAuth, (req, res) => {
  const { id, action } = req.params; // id = id de la requete, action = 'accept' ou 'reject'
  const userId = req.user.id;
  const newStatus = action === 'accept' ? 'accepted' : 'rejected';

  // Vérifier que la demande est bien destinée à l'utilisateur connecté
  db.get('SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ?', [id, userId], (err, request) => {
      if (!request) return res.status(404).json({ error: "Demande introuvable ou non autorisé" });

      // Mettre à jour le statut
      db.run('UPDATE friend_requests SET status = ? WHERE id = ?', [newStatus, id], (err) => {
          if (err) return res.status(500).json({ error: "Erreur update" });

          // SI ACCEPTÉ : Créer l'amitié dans les DEUX SENS
          if (action === 'accept') {
              const stmt = db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)');
              stmt.run(request.sender_id, request.receiver_id);
              stmt.run(request.receiver_id, request.sender_id);
              stmt.finalize();
          }
          res.json({ ok: true });
      });
  });
});

// ====================================================
// 6. API MESSAGES (Privés)
// ====================================================

// Récupérer les messages avec un ami spécifique
app.get('/api/messages/:friendUsername', requireAuth, (req, res) => {
    const friendName = req.params.friendUsername;
    const myId = req.user.id;

    db.get('SELECT id FROM users WHERE username = ?', [friendName], (err, friend) => {
        if (!friend) return res.status(404).json({ messages: [] });

        db.all(
            `SELECT sender_id, content, created_at 
             FROM messages 
             WHERE (sender_id = ? AND receiver_id = ?) 
                OR (sender_id = ? AND receiver_id = ?) 
             ORDER BY created_at ASC`,
            [myId, friend.id, friend.id, myId],
            (err, rows) => {
                if (err) return res.status(500).json({ error: "Erreur messages" });
                
                // Formater pour le front
                const formatted = rows.map(m => ({
                    fromSelf: m.sender_id === myId,
                    content: m.content,
                    created_at: m.created_at
                }));
                res.json({ messages: formatted });
            }
        );
    });
});

// Envoyer un message
app.post('/api/messages', requireAuth, (req, res) => {
    const { toUsername, content } = req.body;
    const myId = req.user.id;

    if (!content || !content.trim()) return res.status(400).json({ error: "Message vide" });

    db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, friend) => {
        if (!friend) return res.status(404).json({ error: "Ami introuvable" });

        db.run(
            'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
            [myId, friend.id, content],
            function(err) {
                if (err) return res.status(500).json({ error: "Erreur envoi" });
                res.json({ ok: true, id: this.lastID });
            }
        );
    });
});

// ====================================================
// 7. API GROUPES (Bonus)
// ====================================================

// Créer un groupe
app.post('/api/groups', requireAuth, (req, res) => {
  const { name, members } = req.body; // members = tableau d'IDs
  const creatorId = req.user.id;

  db.run('INSERT INTO groups (name, creator_id) VALUES (?, ?)', [name, creatorId], function(err) {
      if (err) return res.status(500).json({ error: "Erreur création groupe" });
      const groupId = this.lastID;

      // Ajouter le créateur + les membres
      const allMembers = [creatorId, ...(members || [])];
      const stmt = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)');
      allMembers.forEach(uid => stmt.run(groupId, uid));
      stmt.finalize();

      res.json({ ok: true, groupId });
  });
});

// Liste des groupes de l'utilisateur
app.get('/api/groups', requireAuth, (req, res) => {
  db.all(
      `SELECT g.id, g.name 
       FROM groups g 
       JOIN group_members gm ON g.id = gm.group_id 
       WHERE gm.user_id = ?`,
      [req.user.id],
      (err, rows) => {
          res.json({ groups: rows || [] });
      }
  );
});

// Messages de groupe
app.get('/api/groups/:groupId/messages', requireAuth, (req, res) => {
    const groupId = req.params.groupId;
    // Vérif membre
    db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.user.id], (err, isMember) => {
        if (!isMember) return res.status(403).json({ error: "Non autorisé" });

        db.all(
            `SELECT gm.content, gm.created_at, u.username as sender_username, gm.sender_id
             FROM group_messages gm
             JOIN users u ON u.id = gm.sender_id
             WHERE gm.group_id = ?
             ORDER BY gm.created_at ASC`,
            [groupId],
            (err, rows) => {
                const formatted = rows.map(m => ({
                    fromSelf: m.sender_id === req.user.id,
                    content: m.content,
                    senderName: m.sender_username, // Pour afficher qui parle
                    created_at: m.created_at
                }));
                res.json({ messages: formatted });
            }
        );
    });
});

app.post('/api/groups/:groupId/messages', requireAuth, (req, res) => {
    const groupId = req.params.groupId;
    const content = req.body.content;
    
    db.run(
        'INSERT INTO group_messages (group_id, sender_id, content) VALUES (?, ?, ?)',
        [groupId, req.user.id, content],
        function(err) {
            if (err) return res.status(500).json({ error: "Erreur" });
            res.json({ ok: true });
        }
    );
});

// ====================================================
// LANCEMENT DU SERVEUR
// ====================================================
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
  console.log(`Prêt pour Railway !`);
});
