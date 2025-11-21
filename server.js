// ====================================================
// FICHIER : server.js
// VERSION : Complète (Chat + Amis + Matchmaking) - MISE À JOUR JWT/BCRYPT
// ====================================================

const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session'); // Dépendance gardée, mais la logique d'auth est JWT.
const fs = require('fs');
// --- NOUVELLES DÉPENDANCES POUR LA SÉCURITÉ ---
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
// ---------------------------------------------

// Initialisation Express
const app = express();
app.use(express.json()); // Middleware pour parser le JSON du body

// CONFIGURATION DU PORT (Obligatoire pour Railway)
const PORT = process.env.PORT || 3000;

// --- VARIABLE DE SÉCURITÉ JWT (À CHANGER) ---
// ATTENTION : Changez VOTRE_SECRET_TRES_LONG_ET_COMPLEXE_A_CHANGER pour une clé unique !
const JWT_SECRET = process.env.JWT_SECRET || 'VOTRE_SECRET_TRES_LONG_ET_COMPLEXE_A_CHANGER';
// ---------------------------------

// --- DÉFINITION DES RANGS (Copie exacte depuis game (6).html pour le matching serveur) ---
const RANKS = {
    lol: [
        { id: 'Iron', name: 'Iron', img: '/lol_rank/Iron.webp' },
        { id: 'Bronze', name: 'Bronze', img: '/lol_rank/Bronze.webp' },
        { id: 'Silver', name: 'Silver', img: '/lol_rank/Silver.webp' },
        { id: 'Gold', name: 'Gold', img: '/lol_rank/Gold.webp' },
        { id: 'Platinum', name: 'Platinum', img: '/lol_rank/Platinum.webp' },
        { id: 'Emerald', name: 'Emerald', img: '/lol_rank/Emerald.webp' },
        { id: 'diamond', name: 'diamond', img: '/lol_rank/diamond.webp' },
        { id: 'Master', name: 'Master', img: '/lol_rank/Master.webp' },
        { id: 'GrandM', name: 'Grand Master', img: '/lol_rank/Grand_Master.webp' },
        { id: 'Challenger', name: 'Challenger', img: '/lol_rank/Challenger.webp' },
    ],
    valorant: [
        { id: 'fer1', name: 'Fer 1', img: '/Valorant_rank/Iron_1_Rank.webp' },
        { id: 'fer2', name: 'Fer 2', img: '/Valorant_rank/Iron_2_Rank.webp' },
        { id: 'fer3', name: 'Fer 3', img: '/Valorant_rank/Iron_3_Rank.webp' },
        { id: 'bronze1', name: 'Bronze 1', img: '/Valorant_rank/Bronze_1_Rank.webp' },
        { id: 'bronze2', name: 'Bronze 2', img: '/Valorant_rank/Bronze_2_Rank.webp' },
        { id: 'bronze3', name: 'Bronze 3', img: '/Valorant_rank/Bronze_3_Rank.webp' },
        { id: 'argent1', name: 'Argent 1', img: '/Valorant_rank/Silver_1_Rank.webp' },
        { id: 'argent2', name: 'Argent 2', img: '/Valorant_rank/Silver_2_Rank.webp' },
        { id: 'argent3', name: 'Argent 3', img: '/Valorant_rank/Silver_3_Rank.webp' },
        { id: 'or1', name: 'Or 1', img: '/Valorant_rank/Gold_1_Rank.webp' },
        { id: 'or2', name: 'Or 2', img: '/Valorant_rank/Gold_2_Rank.webp' },
        { id: 'or3', name: 'Or 3', img: '/Valorant_rank/Gold_3_Rank.webp' },
        { id: 'platine1', name: 'Platine 1', img: '/Valorant_rank/Platinum_1_Rank.webp' },
        { id: 'platine2', name: 'Platine 2', img: '/Valorant_rank/Platinum_2_Rank.webp' },
        { id: 'platine3', name: 'Platine 3', img: '/Valorant_rank/Platinum_3_Rank.webp' },
        { id: 'diamant1', name: 'Diamant 1', img: '/Valorant_rank/Diamond_1_Rank.webp' },
        { id: 'diamant2', name: 'Diamant 2', img: '/Valorant_rank/Diamond_2_Rank.webp' },
        { id: 'diamant3', name: 'Diamant 3', img: '/Valorant_rank/Diamond_3_Rank.webp' },
        { id: 'ascendant_1', name: 'Ascendant 1', img: '/Valorant_rank/Ascendant_1_Rank.webp' },
        { id: 'ascendant_2', name: 'Ascendant 2', img: '/Valorant_rank/Ascendant_2_Rank.webp' },
        { id: 'ascendant_3', name: 'Ascendant 3', img: '/Valorant_rank/Ascendant_3_Rank.webp' },
        { id: 'immortal_1', name: 'Immortal 1', img: '/Valorant_rank/Immortal_1_Rank.webp' },
        { id: 'immortal_2', name: 'Immortal 2', img: '/Valorant_rank/Immortal_2_Rank.webp' },
        { id: 'immortal_3', name: 'Immortal 3', img: '/Valorant_rank/Immortal_3_Rank.webp' },
        { id: 'radiant', name: 'Radiant', img: '/Valorant_rank/Radiant_Rank.webp' },
    ],
};
// --- FIN DÉFINITION DES RANGS ---

// Fonction utilitaire pour générer le token
const generateToken = (id) => {
    return jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
};

// --- MIDDLEWARE DE PROTECTION JWT ---
const protect = (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);

            // Récupère l'utilisateur de la BDD par l'ID du token
            db.get('SELECT id, username FROM users WHERE id = ?', [decoded.id], (err, user) => {
                if (err || !user) {
                    return res.status(401).json({ message: 'Non autorisé, utilisateur non trouvé.' });
                }
                req.user = user; // Attache l'objet user à la requête (id et username)
                next();
            });

        } catch (error) {
            console.error('Erreur de token:', error);
            res.status(401).json({ message: 'Non autorisé, token invalide ou expiré.' });
        }
    } else if (!token) {
        res.status(401).json({ message: 'Non autorisé, pas de token.' });
    }
};
// --- FIN MIDDLEWARE ---


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
      UNIQUE(user_id, friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // 4. Messages privés
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

  // 5. Jeux Favoris de l'utilisateur
  db.run(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      user_id INTEGER NOT NULL,
      game_id TEXT NOT NULL,
      PRIMARY KEY (user_id, game_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // 6. PROFILS ET PRÉFÉRENCES UNIFIÉES (Remplace les anciennes tables de jeu)
  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      game_id TEXT,
      rank TEXT,
      main_mode TEXT, /* Mode principal du joueur (e.g., Classé, Non Classé) */
      options TEXT,  /* Options du joueur (e.g., 'Vocal Obligatoire') stockées en JSON */
      pref_ranks TEXT, /* Rangs préférés des partenaires stockés en JSON */
      rank_tolerance INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // 7. Initialisation des jeux disponibles
  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_url TEXT
    )
  `);
  
  // Vérification de la présence des jeux et insertion si absents
  db.get("SELECT COUNT(*) AS count FROM games", (err, row) => {
    if (row && row.count === 0) {
      db.run("INSERT INTO games (id, name, icon_url) VALUES (?, ?, ?)", ["valorant", "Valorant", "/icons/valorant.webp"]);
      db.run("INSERT INTO games (id, name, icon_url) VALUES (?, ?, ?)", ["lol", "League of Legends", "/icons/lol.webp"]);
    }
  });
});


// ====================================================
// 2. CONFIGURATION MIDDLEWARE
// ====================================================

// Servir les fichiers statiques (HTML, CSS, JS front)
app.use(express.static(path.join(__dirname)));

// Middleware de protection des routes (MAINTENUE, mais inutilisée pour l'API)
function requireAuth(req, res, next) {
  if (req.originalUrl.startsWith('/api/')) {
    // Si une route API utilise encore ça, renvoyer une erreur explicite.
    return res.status(500).send('Erreur de configuration: Utilisez le middleware "protect" pour les routes API.');
  }
  next();
}


// ====================================================
// 3. ROUTES PAGES (HTML) - Simplifiées pour l'architecture JWT
// ====================================================

// Racine
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Pages simples
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));

// Route pour la page de détail d'un jeu
app.get('/game/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.html'));
});

// Déconnexion (La déconnexion se fait principalement côté client)
app.get('/logout', (req, res) => {
    res.send('Déconnexion côté client effectuée (token supprimé)');
});


// ====================================================
// 4. API AUTHENTIFICATION (JWT / BCRYPT)
// ====================================================

// Route d'enregistrement (Inscription)
app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body;
    
    // 1. Vérification de l'existence
    db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email], async (err, row) => {
        if (err) return res.status(500).json({ error: 'Server error' });
        if (row) return res.status(400).json({ error: 'L\'utilisateur existe déjà' });

        try {
            // 2. Hachage du mot de passe
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // 3. Insertion dans la BDD
            db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', 
                [username, email, hashedPassword], 
                function(err) {
                    if (err) {
                        console.error("Erreur d'insertion:", err);
                        return res.status(500).json({ error: 'Erreur serveur' });
                    }
                    // 4. Succès : Génération du Token
                    const userId = this.lastID;
                    res.status(201).json({
                        username: username,
                        token: generateToken(userId),
                    });
            });
        } catch (bcryptError) {
            console.error('Erreur de hachage:', bcryptError);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });
});

// Route de connexion
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body; // username peut être le pseudo ou l'email

    db.get('SELECT id, username, password FROM users WHERE username = ? OR email = ?', [username, username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Erreur serveur' });
        if (!user) return res.status(401).json({ error: 'Identifiants invalides' });

        try {
            // 1. Vérification du mot de passe haché
            const isMatch = await bcrypt.compare(password, user.password);

            if (isMatch) {
                // 2. Succès : Génération du Token
                res.json({
                    username: user.username,
                    token: generateToken(user.id),
                });
            } else {
                res.status(401).json({ error: 'Identifiants invalides' });
            }
        } catch (bcryptError) {
            console.error('Erreur de comparaison:', bcryptError);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    });
});

// Route de Déconnexion (signal simple)
app.post('/api/auth/logout', (req, res) => {
    res.status(200).json({ message: 'Déconnexion réussie' });
});


// ====================================================
// 5. API AMIS & DEMANDES (PROTECTED)
// ====================================================

// A. Récupérer la liste des amis confirmés
app.get('/api/friends', protect, (req, res) => {
  const uid = req.user.id;
  db.all(`
    SELECT 
      CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS friend_id,
      u.username
    FROM friends f
    JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
    WHERE f.user_id = ? OR f.friend_id = ?
  `, [uid, uid, uid, uid], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur DB' });
    const friends = rows.map(row => ({ username: row.username }));
    res.json({ friends });
  });
});

// B. Envoyer une demande d'ami
app.post('/api/friends/request', protect, (req, res) => {
  const { toUsername } = req.body;
  const senderId = req.user.id;

  db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, receiver) => {
    if (!receiver) return res.status(404).json({ error: "Utilisateur non trouvé." });
    const receiverId = receiver.id;

    if (senderId === receiverId) return res.status(400).json({ error: "Vous ne pouvez pas vous ajouter vous-même." });

    db.get('SELECT id FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [senderId, receiverId, receiverId, senderId], (err, friend) => {
      if (friend) return res.status(400).json({ error: "Vous êtes déjà amis." });
      
      db.get('SELECT id, status FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)', [senderId, receiverId, receiverId, senderId], (err, request) => {
        if (request && request.status === 'pending') return res.status(400).json({ error: "Une demande est déjà en attente." });
        if (request && request.status === 'accepted') return res.status(400).json({ error: "La demande a déjà été acceptée (vous êtes amis)." });

        db.run('INSERT INTO friend_requests (sender_id, receiver_id, status) VALUES (?, ?, ?)', [senderId, receiverId, 'pending'], (err) => {
          if (err) return res.status(500).json({ error: "Erreur serveur lors de l'envoi." });
          res.json({ message: "Demande d'ami envoyée." });
        });
      });
    });
  });
});

// C. Récupérer les demandes (Reçues ET Envoyées)
app.get('/api/friends/requests', protect, (req, res) => {
    const uid = req.user.id;
    // 1. Demandes Reçues (Incoming)
    db.all(
        `SELECT fr.id, u.username as from_username FROM friend_requests fr JOIN users u ON u.id = fr.sender_id WHERE fr.receiver_id = ? AND fr.status = 'pending'`, 
        [uid], 
        (err, incoming) => {
            if(err) return res.status(500).json({error: "Erreur DB"});
            // 2. Demandes Envoyées (Outgoing)
            db.all(
                `SELECT fr.id, u.username as to_username FROM friend_requests fr JOIN users u ON u.id = fr.receiver_id WHERE fr.sender_id = ? AND fr.status = 'pending'`, 
                [uid], 
                (err2, outgoing) => {
                    if(err2) return res.status(500).json({error: "Erreur DB"});
                    res.json({ incoming: incoming || [], outgoing: outgoing || [] });
                }
            );
        }
    );
});

// D. Répondre à une demande (Accepter / Refuser)
app.post('/api/friends/requests/:id/:action', protect, (req, res) => {
    const { id, action } = req.params; // id de la demande
    const receiverId = req.user.id;

    if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: "Action invalide." });

    db.get('SELECT sender_id, status FROM friend_requests WHERE id = ? AND receiver_id = ?', [id, receiverId], (err, request) => {
        if (!request) return res.status(404).json({ error: "Demande introuvable ou non destinée à vous." });
        if (request.status !== 'pending') return res.status(400).json({ error: "La demande a déjà été traitée." });

        const senderId = request.sender_id;
        const newStatus = action === 'accept' ? 'accepted' : 'rejected';

        db.run('UPDATE friend_requests SET status = ? WHERE id = ?', [newStatus, id], (err) => {
            if (err) return res.status(500).json({ error: "Erreur serveur lors de la mise à jour." });

            if (action === 'accept') {
                // Ajouter à la table 'friends'
                db.run('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)', [Math.min(senderId, receiverId), Math.max(senderId, receiverId)], (err) => {
                    if (err) return res.status(500).json({ error: "Erreur lors de l'ajout à la liste d'amis." });
                    res.json({ message: "Demande acceptée, vous êtes maintenant amis.", action: 'accepted' });
                });
            } else {
                res.json({ message: "Demande rejetée.", action: 'rejected' });
            }
        });
    });
});


// ====================================================
// 6. API MESSAGERIE (PROTECTED)
// ====================================================

// A. Récupérer les messages entre deux utilisateurs
app.get('/api/messages/:username', protect, (req, res) => {
  const { username } = req.params;
  const senderId = req.user.id;

  db.get('SELECT id FROM users WHERE username = ?', [username], (err, friend) => {
    if (!friend) return res.status(404).json({ error: "Ami introuvable" });
    const receiverId = friend.id;

    db.all(`
      SELECT sender_id, content, created_at
      FROM messages
      WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
      ORDER BY created_at ASC
    `, [senderId, receiverId, receiverId, senderId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Erreur DB' });
      
      const messages = rows.map(m => ({
        content: m.content,
        fromSelf: m.sender_id === senderId,
        timestamp: m.created_at
      }));
      res.json({ messages });
    });
  });
});

// B. Envoyer un message privé
app.post('/api/messages', protect, (req, res) => {
  const { toUsername, content } = req.body;
  if(!content || !content.trim()) return res.json({ok: false});

  db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, friend) => {
    if(friend) {
      db.run('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)', [req.user.id, friend.id, content], (err) => {
        if (err) return res.status(500).json({ error: 'Erreur DB' });
        res.json({ok: true});
      });
    } else {
      res.status(404).json({error: "Ami introuvable"});
    }
  });
});

// ====================================================
// 7. API JEU & MATCHING (PROTECTED)
// ====================================================

// --- FONCTION UTILITAIRE DE RANG (Pour le matching) ---
function isRankWithinTolerance(rankList, searchRankId, targetRankId, tolerance) {
    if (!rankList || !searchRankId || !targetRankId || tolerance === undefined) return false; 

    // Les RANKS sont organisés par jeu, on prend la liste pour la recherche
    const searchIndex = rankList.findIndex(r => r.id === searchRankId.toLowerCase());
    const targetIndex = rankList.findIndex(r => r.id === targetRankId.toLowerCase());

    if (searchIndex === -1 || targetIndex === -1) {
        return false; 
    }
    return Math.abs(searchIndex - targetIndex) <= tolerance;
}

// GET /api/user/profile : Récupère les données utilisateur (settings et préférences)
app.get('/api/user/profile', protect, (req, res) => {
    const userId = req.user.id;
    
    db.get('SELECT * FROM user_settings WHERE user_id = ?', [userId], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Erreur serveur lors de la récupération du profil." });
        }
        
        // Formater les données pour le frontend
        const settings = row || {};
        const profile = {
            username: req.user.username,
            gameSettings: {
                gameId: settings.game_id,
                rank: settings.rank,
                mainMode: settings.main_mode,
                options: settings.options ? JSON.parse(settings.options) : [] 
            },
            partnerPreferences: {
                prefRanks: settings.pref_ranks ? JSON.parse(settings.pref_ranks) : [],
                rankTolerance: settings.rank_tolerance || 1 
            }
        };
        res.json(profile);
    });
});

// POST /api/game/settings : Met à jour le rang, le mode et les options
app.post('/api/game/settings', protect, (req, res) => {
    const userId = req.user.id;
    const { gameId, rank, mainMode, options } = req.body; 

    if (!gameId || !rank || !mainMode) {
        return res.status(400).json({ message: "Le jeu, le rang et le mode principal sont requis." });
    }
    
    const optionsJson = JSON.stringify(options || []);

    // Mise à jour ou insertion des settings (garde les préférences existantes si elles existent)
    const sql = `
        INSERT OR REPLACE INTO user_settings (user_id, game_id, rank, main_mode, options, pref_ranks, rank_tolerance) 
        VALUES (?, ?, ?, ?, ?, 
            (SELECT pref_ranks FROM user_settings WHERE user_id = ?), 
            (SELECT rank_tolerance FROM user_settings WHERE user_id = ?)
        )
    `;
    
    db.run(sql, [userId, gameId, rank, mainMode, optionsJson, userId, userId], function(err) {
        if (err) {
            console.error("Erreur POST /api/game/settings:", err);
            return res.status(500).json({ message: 'Erreur lors de la sauvegarde des paramètres.' });
        }
        res.status(200).json({ message: 'Paramètres du jeu sauvegardés.' });
    });
});


// POST /api/game/preferences : Met à jour les préférences de partenaire
app.post('/api/game/preferences', protect, (req, res) => {
    const userId = req.user.id; 
    const { prefRanks, rankTolerance } = req.body;
    
    const prefRanksJson = JSON.stringify(prefRanks || []);

    // Mise à jour ou insertion des préférences (garde les settings existants si ils existent)
    const sql = `
        INSERT OR REPLACE INTO user_settings (user_id, game_id, rank, main_mode, options, pref_ranks, rank_tolerance) 
        VALUES (?, 
            (SELECT game_id FROM user_settings WHERE user_id = ?), 
            (SELECT rank FROM user_settings WHERE user_id = ?), 
            (SELECT main_mode FROM user_settings WHERE user_id = ?), 
            (SELECT options FROM user_settings WHERE user_id = ?), 
            ?, ?
        )
    `;

    db.run(sql, [userId, userId, userId, userId, userId, prefRanksJson, rankTolerance || 1], function(err) {
        if (err) {
            console.error("Erreur POST /api/game/preferences:", err);
            return res.status(500).json({ message: 'Erreur lors de la sauvegarde des préférences.' });
        }
        res.status(200).json({ message: 'Préférences de partenaire sauvegardées.' });
    });
});


// GET /api/match/search/:gameId : Recherche des partenaires potentiels
app.get('/api/match/search/:gameId', protect, (req, res) => {
    const { gameId } = req.params;
    const userId = req.user.id;
    const gameRanks = RANKS[gameId.toLowerCase()];
    
    if (!gameRanks) {
        return res.status(404).json({ message: "Jeu non supporté." });
    }
    
    // 1. Récupération des critères de l'utilisateur actuel
    db.get('SELECT * FROM user_settings WHERE user_id = ?', [userId], (err, userSettings) => {
        if (err || !userSettings || !userSettings.rank || !userSettings.main_mode) {
            return res.status(400).json({ message: "Veuillez définir votre rang et mode de jeu." });
        }

        const { rank: userRank, main_mode: userMode, options: userOptionsJson, pref_ranks: prefRanksJson, rank_tolerance: tolerance } = userSettings;
        
        const userOptions = JSON.parse(userOptionsJson || '[]');
        const preferredRanks = JSON.parse(prefRanksJson || '[]');
        const userTolerance = tolerance || 1;
        const vocalRequired = userOptions.includes('Vocal Obligatoire');
        
        // Requête SQLite pour trouver les autres utilisateurs éligibles
        // On filtre par jeu et mode principal, puis on fera le matching des critères complexes (rang, vocal) en JS
        const sql = `
            SELECT 
                u.username, 
                us.rank, 
                us.main_mode, 
                us.options 
            FROM users u
            JOIN user_settings us ON u.id = us.user_id
            WHERE us.game_id = ? 
            AND u.id != ?
            
            -- Filtre Mode principal par SQL
            AND us.main_mode = ? 
            
            -- Exclure les amis et les requêtes en attente/acceptées
            AND u.id NOT IN (
                -- Amis
                SELECT user_id FROM friends WHERE friend_id = ?
                UNION
                SELECT friend_id FROM friends WHERE user_id = ?
                -- Demandes envoyées
                UNION
                SELECT receiver_id FROM friend_requests WHERE sender_id = ? AND status IN ('pending', 'accepted')
                -- Demandes reçues
                UNION
                SELECT sender_id FROM friend_requests WHERE receiver_id = ? AND status IN ('pending', 'accepted')
            )
        `;
        
        db.all(sql, [gameId, userId, userMode, userId, userId, userId, userId], (err, potentialPartners) => {
            if (err) {
                console.error("Erreur SQL recherche matching:", err);
                return res.status(500).json({ message: 'Erreur serveur lors de la recherche.' });
            }

            const foundMatches = [];

            // 3. Application des règles de matching (Logique Métier en JS)
            for (const targetUser of potentialPartners) {
                const targetOptions = JSON.parse(targetUser.options || '[]');
                
                // a) Vérification de l'Option Vocal Obligatoire (si A veut du Vocal, B doit l'avoir)
                const targetHasVocal = targetOptions.includes('Vocal Obligatoire');
                if (vocalRequired && !targetHasVocal) continue;
                
                // b) Vérification du Rang
                let rankMatch = false;
                const targetRank = targetUser.rank;
                if (!targetRank) continue;

                if (preferredRanks.length > 0) {
                    // Si A a des rangs préférés, B doit être dans cette liste
                    if (preferredRanks.includes(targetRank)) {
                        rankMatch = true;
                    }
                } else {
                    // Si A n'a pas de rangs préférés, utiliser la tolérance de A par rapport au rang de B
                    if (isRankWithinTolerance(gameRanks, userRank, targetRank, userTolerance)) {
                        rankMatch = true;
                    }
                }
                
                if (rankMatch) {
                     foundMatches.push({
                        username: targetUser.username,
                        rank: targetRank,
                        mainMode: targetUser.main_mode,
                        options: targetOptions,
                        // Créer le champ "mode" pour la compatibilité front-end
                        mode: targetUser.mainMode + (targetOptions.length > 0 ? ` (${targetOptions.join(', ')})` : ''), 
                     });
                }
            }
            
            res.json(foundMatches);
        });
    });
});


// ====================================================
// 8. API JEUX
// ====================================================

// A. Récupérer la liste de tous les jeux
app.get('/api/games', (req, res) => {
  db.all('SELECT * FROM games', [], (err, games) => {
    if (err) return res.status(500).json({ error: 'Erreur DB' });
    res.json({ games });
  });
});

// B. Récupérer les jeux favoris d'un utilisateur (si connecté)
app.get('/api/favorites', protect, (req, res) => {
    const userId = req.user.id;
    db.all('SELECT game_id FROM user_favorites WHERE user_id = ?', [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Erreur DB' });
        const favorites = rows.map(row => row.game_id);
        res.json({ favorites });
    });
});

// C. Ajouter ou supprimer un jeu favori
app.post('/api/favorites', protect, (req, res) => {
    const userId = req.user.id;
    const { gameId, action } = req.body; // action: 'add' or 'remove'
    
    if (action === 'add') {
        db.run('INSERT OR IGNORE INTO user_favorites (user_id, game_id) VALUES (?, ?)', [userId, gameId], (err) => {
            if (err) return res.status(500).json({ error: 'Erreur DB' });
            res.json({ message: 'Jeu ajouté aux favoris.' });
        });
    } else if (action === 'remove') {
        db.run('DELETE FROM user_favorites WHERE user_id = ? AND game_id = ?', [userId, gameId], (err) => {
            if (err) return res.status(500).json({ error: 'Erreur DB' });
            res.json({ message: 'Jeu retiré des favoris.' });
        });
    } else {
        res.status(400).json({ error: 'Action invalide.' });
    }
});


// ====================================================
// LANCEMENT SERVEUR
// ====================================================
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
