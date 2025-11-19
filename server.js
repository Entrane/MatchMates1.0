// ====================================================
// FICHIER : server.js
// VERSION : Complète (Chat + Amis + Favoris Utilisateur)
// ====================================================

const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const fs = require('fs');

// Initialisation Express
const app = express();

// CONFIGURATION DU PORT (Obligatoire pour Railway)
const PORT = process.env.PORT || 3000;

// ====================================================
// 1. BASE DE DONNÉES (SQLite)
// ====================================================
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  // 1. Utilisateurs
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // 2. Demandes d'amis (Statuts : pending, accepted, rejected)
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

  // 3. Liste d'amis (Relation confirmée)
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

  // 4. Messages Privés
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

  // 5. Groupes (Tables optionnelles pour le futur)
  db.run(`CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, creator_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, user_id INTEGER NOT NULL, added_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(group_id, user_id))`);
  db.run(`CREATE TABLE IF NOT EXISTS group_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  // 6. FAVORIS UTILISATEUR (NOUVELLE TABLE)
  db.run(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      user_id INTEGER NOT NULL,
      game_id TEXT NOT NULL,
      PRIMARY KEY (user_id, game_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
});

// ====================================================
// 2. MIDDLEWARES
// ====================================================

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Configuration de la session
app.use(session({
    secret: 'matchmates_secret_key_change_me', // Sécurité de session
    resave: false, 
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24h
}));

// Exposer l'utilisateur connecté dans req.user
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  next();
});

// Servir les fichiers statiques (HTML, CSS, JS front)
app.use(express.static(path.join(__dirname)));

// Middleware de protection des routes (Auth requise)
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/login.html');
  }
  next();
}

// ====================================================
// 3. ROUTES PAGES (HTML)
// ====================================================

// Racine
app.get('/', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Pages simples
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/profile', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));

// Dashboard (Injection du pseudo)
app.get('/dashboard', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'dashboard.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Erreur serveur chargement dashboard.');
    // Remplacement dynamique du pseudo
    const finalHtml = html.replace(/{{ username }}/g, req.user.username);
    res.send(finalHtml);
  });
});

// Déconnexion
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// Route pour la page de détail d'un jeu
app.get('/game/:id', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'game.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Erreur serveur chargement page jeu.');
    // On injecte le pseudo et l'ID du jeu si besoin
    let finalHtml = html.replace(/{{ username }}/g, req.user.username);
    finalHtml = finalHtml.replace(/{{ gameId }}/g, req.params.id);
    res.send(finalHtml);
  });
});

// ====================================================
// 4. API AUTHENTIFICATION
// ====================================================

app.post('/signup', (req, res) => {
  const { username, email, password } = req.body;
  db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, password], function(err) {
      if(err) return res.status(400).send("Erreur : Pseudo ou Email déjà utilisé.");
      // Auto-login
      req.session.user = { id: this.lastID, username, email };
      res.redirect('/dashboard');
  });
});

app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  db.get('SELECT * FROM users WHERE (email = ? OR username = ?) AND password = ?', [identifier, identifier, password], (err, user) => {
      if(!user) return res.status(401).send("Identifiants incorrects.");
      req.session.user = user;
      res.redirect('/dashboard');
  });
});

// ====================================================
// 5. API AMIS & DEMANDES
// ====================================================

// A. Récupérer la liste des amis confirmés
app.get('/api/friends', requireAuth, (req, res) => {
  db.all(
    `SELECT u.username, u.id 
     FROM friends f 
     JOIN users u ON u.id = f.friend_id 
     WHERE f.user_id = ?`, 
    [req.user.id], 
    (err, rows) => res.json({friends: rows || []})
  );
});

// B. Envoyer une demande d'ami
app.post('/api/friends/request', requireAuth, (req, res) => {
    const { toUsername } = req.body;
    const myId = req.user.id;

    // 1. Trouver l'utilisateur cible
    db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, target) => {
        if(!target) return res.status(404).json({error: "Utilisateur introuvable"});
        if(target.id === myId) return res.status(400).json({error: "Vous ne pouvez pas vous ajouter vous-même."});
        
        // 2. Vérifier doublon (déjà amis OU demande en cours)
        db.get(
            `SELECT 1 FROM friend_requests WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND status = 'pending'
             UNION 
             SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?`,
            [myId, target.id, target.id, myId, myId, target.id],
            (err, existing) => {
                if(existing) return res.status(400).json({error: "Déjà amis ou demande en cours."});
                
                // 3. Insérer la demande
                db.run(`INSERT INTO friend_requests (sender_id, receiver_id) VALUES (?, ?)`, [myId, target.id], (err) => {
                    if(err) return res.status(500).json({error: "Erreur serveur"});
                    res.json({ok: true});
                });
            }
        );
    });
});

// C. Récupérer les demandes (Reçues ET Envoyées) -- CRUCIAL POUR LE SUIVI
app.get('/api/friends/requests', requireAuth, (req, res) => {
    const uid = req.user.id;

    // 1. Demandes Reçues (Incoming)
    db.all(
        `SELECT fr.id, u.username as from_username 
         FROM friend_requests fr 
         JOIN users u ON u.id = fr.sender_id 
         WHERE fr.receiver_id = ? AND fr.status = 'pending'`, 
        [uid], 
        (err, incoming) => {
            if(err) return res.status(500).json({error: "Erreur DB"});

            // 2. Demandes Envoyées (Outgoing) -> Pour la section "En attente"
            db.all(
                `SELECT fr.id, u.username as to_username 
                 FROM friend_requests fr 
                 JOIN users u ON u.id = fr.receiver_id 
                 WHERE fr.sender_id = ? AND fr.status = 'pending'`, 
                [uid], 
                (err2, outgoing) => {
                    if(err2) return res.status(500).json({error: "Erreur DB"});
                    
                    // On renvoie les deux listes
                    res.json({ 
                        incoming: incoming || [], 
                        outgoing: outgoing || [] 
                    });
                }
            );
        }
    );
});

// D. Répondre à une demande (Accepter / Refuser)
app.post('/api/friends/requests/:id/:action', requireAuth, (req, res) => {
    const { id, action } = req.params;
    const status = action === 'accept' ? 'accepted' : 'rejected';
    
    // Mise à jour du statut
    db.run(`UPDATE friend_requests SET status = ? WHERE id = ?`, [status, id], function(err) {
        if(err) return res.status(500).json({error: "Erreur"});

        // Si accepté, on crée l'amitié réciproque
        if(action === 'accept') {
            db.get(`SELECT sender_id, receiver_id FROM friend_requests WHERE id = ?`, [id], (err, row) => {
                if(row) {
                    // Ajout sens A -> B
                    db.run(`INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)`, [row.sender_id, row.receiver_id]);
                    // Ajout sens B -> A
                    db.run(`INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)`, [row.receiver_id, row.sender_id]);
                }
            });
        }
        res.json({ok: true});
    });
});

// ====================================================
// 6. API MESSAGES (Chat)
// ====================================================

// Récupérer l'historique
app.get('/api/messages/:friendUsername', requireAuth, (req, res) => {
    const friendName = req.params.friendUsername;
    const myId = req.user.id;

    db.get('SELECT id FROM users WHERE username = ?', [friendName], (err, friend) => {
        if(!friend) return res.json({messages:[]});

        db.all(
            `SELECT sender_id, content, created_at 
             FROM messages 
             WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) 
             ORDER BY created_at ASC`, 
            [myId, friend.id, friend.id, myId], 
            (err, rows) => {
                if(err) return res.status(500).json({error: "Erreur"});
                const msgs = rows.map(r => ({ 
                    fromSelf: r.sender_id === myId, 
                    content: r.content 
                }));
                res.json({ messages: msgs });
            }
        );
    });
});

// Envoyer un message
app.post('/api/messages', requireAuth, (req, res) => {
    const { toUsername, content } = req.body;
    if(!content || !content.trim()) return res.json({ok: false});

    db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, friend) => {
        if(friend) {
            db.run('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)', 
                [req.user.id, friend.id, content], 
                (err) => res.json({ok: true})
            );
        } else {
            res.status(404).json({error: "Ami introuvable"});
        }
    });
});


// ====================================================
// 7. API FAVORIS (PROPRE AU COMPTE UTILISATEUR)
// ====================================================

// 1. Récupérer la liste des favoris de l'utilisateur actuel
app.get('/api/favorites', requireAuth, (req, res) => {
  db.all('SELECT game_id FROM user_favorites WHERE user_id = ?', [req.user.id], (err, rows) => {
    if (err) {
      console.error('Erreur GET /api/favorites:', err);
      return res.status(500).json({ error: 'server_error' });
    }
    // Renvoie un tableau simple d'IDs de jeu (ex: ['valorant', 'lol'])
    const favorites = rows.map(row => row.game_id);
    res.json({ favorites });
  });
});

// 2. Ajouter ou retirer un jeu des favoris
app.post('/api/favorites/:gameId', requireAuth, (req, res) => {
  const { gameId } = req.params;
  const userId = req.user.id;
  
  // 1. Vérifie si le jeu est déjà en favori
  db.get('SELECT 1 FROM user_favorites WHERE user_id = ? AND game_id = ?', [userId, gameId], (err, row) => {
    if (err) {
      console.error('Erreur POST /api/favorites:', err);
      return res.status(500).json({ error: 'server_error' });
    }

    if (row) {
      // Existe -> Suppression (Retirer)
      db.run('DELETE FROM user_favorites WHERE user_id = ? AND game_id = ?', [userId, gameId], function (err) {
        if (err) {
          console.error('Erreur DELETE favorite:', err);
          return res.status(500).json({ error: 'server_error' });
        }
        res.json({ status: 'removed' });
      });
    } else {
      // N'existe pas -> Insertion (Ajouter)
      db.run('INSERT INTO user_favorites (user_id, game_id) VALUES (?, ?)', [userId, gameId], function (err) {
        if (err) {
          console.error('Erreur INSERT favorite:', err);
          return res.status(500).json({ error: 'server_error' });
        }
        res.json({ status: 'added' });
      });
    }
  });
});


// ====================================================
// LANCEMENT SERVEUR
// ====================================================
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
