// ====================================================
// FICHIER : server.js
// VERSION : Complète (JWT + Profil Unifié + Matchmaking)
// ====================================================

const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const jwt = require('jsonwebtoken'); // Nécessaire pour l'authentification
const bcrypt = require('bcrypt'); // Nécessaire pour hacher les mots de passe

// Initialisation Express
const app = express();

// CONFIGURATION DU PORT
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'votre_cle_secrete_jwt_tres_longue_et_securisee'; // IMPORTANT: Changez cette clé en production

// Middleware
app.use(express.json()); // Pour parser les requêtes JSON
app.use(express.static(path.join(__dirname, 'public'))); // Servir les fichiers statiques (CSS, JS, images, etc.)

// ====================================================
// 1. BASE DE DONNÉES (SQLite)
// ====================================================
const db = new sqlite3.Database('./database.sqlite');
const saltRounds = 10;

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

    // 3. Messages (Chat)
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // 4. Paramètres spécifiques aux jeux (Rang actuel, Mode principal, Options)
    db.run(`
        CREATE TABLE IF NOT EXISTS game_settings (
            user_id INTEGER NOT NULL,
            game_id TEXT NOT NULL,
            rank TEXT,
            mainMode TEXT,
            options TEXT, -- JSON string for dynamic options like 'Vocal Obligatoire'
            PRIMARY KEY (user_id, game_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // 5. Préférences de recherche de partenaire (Rangs préférés, Tolérance)
    db.run(`
        CREATE TABLE IF NOT EXISTS partner_preferences (
            user_id INTEGER PRIMARY KEY,
            prefRanks TEXT, -- JSON string for preferred ranks array
            rankTolerance INTEGER DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
});

// ====================================================
// 2. MIDDLEWARE JWT D'AUTHENTIFICATION
// ====================================================

/**
 * Middleware pour vérifier le jeton JWT dans le header Authorization.
 */
function isAuthenticated(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'unauthorized', message: 'Token manquant ou format invalide.' });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            // Token invalide ou expiré
            return res.status(401).json({ error: 'unauthorized', message: 'Token invalide ou expiré.' });
        }
        
        // Stocker les infos utilisateur décodées dans req.user
        req.user = user; 
        next();
    });
}

// ====================================================
// 3. ROUTES D'AUTHENTIFICATION ET DE BASE
// ====================================================

// Route pour servir le fichier game.html (ou index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'game.html')); // Assurez-vous que le nom de fichier est correct
});

// Route d'enregistrement (Registration)
app.post('/register', (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'missing_fields' });
    }

    // Hachage du mot de passe
    bcrypt.hash(password, saltRounds, (err, hash) => {
        if (err) {
            console.error('Erreur de hachage:', err);
            return res.status(500).json({ error: 'server_error' });
        }

        // Insertion de l'utilisateur dans la DB
        db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, hash], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ error: 'user_exists' });
                }
                console.error('Erreur d\'enregistrement:', err);
                return res.status(500).json({ error: 'server_error' });
            }

            // Génération du JWT pour l'utilisateur nouvellement créé
            const token = jwt.sign({ id: this.lastID, username, email }, JWT_SECRET, { expiresIn: '1h' });
            res.json({ token, username });
        });
    });
});

// Route de connexion (Login)
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'missing_fields' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err) {
            console.error('Erreur de login:', err);
            return res.status(500).json({ error: 'server_error' });
        }

        if (!user) {
            return res.status(401).json({ error: 'invalid_credentials' });
        }

        // Comparaison du mot de passe haché
        bcrypt.compare(password, user.password, (err, result) => {
            if (err) {
                console.error('Erreur de comparaison de mot de passe:', err);
                return res.status(500).json({ error: 'server_error' });
            }

            if (result) {
                // Connexion réussie : Génération du JWT
                const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
                res.json({ token, username: user.username });
            } else {
                res.status(401).json({ error: 'invalid_credentials' });
            }
        });
    });
});

// ====================================================
// 4. ROUTES SOCIALES (Amis & Messages)
// ====================================================

// ----------------------
// GESTION DES AMIS
// ----------------------

// GET /api/friends : Récupérer la liste d'amis et les demandes
app.get('/api/friends', isAuthenticated, (req, res) => {
    const userId = req.user.id;

    const sql = `
        SELECT 
            U.username, 
            FR.status,
            CASE
                WHEN FR.sender_id = ? THEN 'outgoing'
                WHEN FR.receiver_id = ? THEN 'incoming'
                ELSE 'accepted'
            END AS type
        FROM friend_requests FR
        JOIN users U ON 
            CASE 
                WHEN FR.sender_id = ? THEN FR.receiver_id 
                ELSE FR.sender_id 
            END = U.id
        WHERE FR.sender_id = ? OR FR.receiver_id = ?
    `;

    db.all(sql, [userId, userId, userId, userId, userId], (err, requests) => {
        if (err) {
            console.error('Erreur GET /api/friends:', err);
            return res.status(500).json({ error: 'server_error' });
        }

        const friends = requests.filter(r => r.status === 'accepted');
        const incoming = requests.filter(r => r.status === 'pending' && r.type === 'incoming');
        const outgoing = requests.filter(r => r.status === 'pending' && r.type === 'outgoing');

        res.json({ friends, incomingRequests: incoming, outgoingRequests: outgoing });
    });
});

// POST /api/friends/send : Envoyer une demande d'ami
app.post('/api/friends/send', isAuthenticated, (req, res) => {
    const { receiverUsername } = req.body;
    const senderId = req.user.id;
    const senderUsername = req.user.username;

    if (receiverUsername === senderUsername) {
        return res.status(400).json({ error: 'cannot_add_self', message: 'Vous ne pouvez pas vous ajouter vous-même.' });
    }

    // 1. Trouver l'ID du destinataire
    db.get('SELECT id FROM users WHERE username = ?', [receiverUsername], (err, receiver) => {
        if (err) return res.status(500).json({ error: 'server_error' });
        if (!receiver) return res.status(404).json({ error: 'user_not_found' });
        
        const receiverId = receiver.id;

        // 2. Vérifier si une relation existe déjà (friend, pending)
        const checkSql = `
            SELECT status FROM friend_requests 
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
        `;
        db.get(checkSql, [senderId, receiverId, receiverId, senderId], (err, existing) => {
            if (err) return res.status(500).json({ error: 'server_error' });

            if (existing) {
                if (existing.status === 'accepted') {
                    return res.status(409).json({ error: 'already_friends', message: 'Vous êtes déjà amis.' });
                }
                if (existing.status === 'pending') {
                    return res.status(409).json({ error: 'already_pending', message: 'Une demande est déjà en attente.' });
                }
            }

            // 3. Insérer la nouvelle demande
            db.run('INSERT INTO friend_requests (sender_id, receiver_id, status) VALUES (?, ?, ?)', [senderId, receiverId, 'pending'], function(err) {
                if (err) {
                    console.error('Erreur POST /api/friends/send:', err);
                    return res.status(500).json({ error: 'server_error' });
                }
                res.json({ message: 'Demande d\'ami envoyée.', receiverUsername });
            });
        });
    });
});

// POST /api/friends/respond : Répondre à une demande (accept/reject)
app.post('/api/friends/respond', isAuthenticated, (req, res) => {
    const { senderUsername, action } = req.body;
    const receiverId = req.user.id;

    if (!['accept', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'invalid_action' });
    }

    db.get('SELECT id FROM users WHERE username = ?', [senderUsername], (err, sender) => {
        if (err) return res.status(500).json({ error: 'server_error' });
        if (!sender) return res.status(404).json({ error: 'sender_not_found' });
        
        const senderId = sender.id;
        const newStatus = action === 'accept' ? 'accepted' : 'rejected';

        const updateSql = `
            UPDATE friend_requests 
            SET status = ? 
            WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'
        `;

        db.run(updateSql, [newStatus, senderId, receiverId], function(err) {
            if (err) {
                console.error('Erreur POST /api/friends/respond:', err);
                return res.status(500).json({ error: 'server_error' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'request_not_found' });
            }
            res.json({ message: `Demande de ${senderUsername} ${action === 'accept' ? 'acceptée' : 'rejetée'}.` });
        });
    });
});

// ----------------------
// GESTION DU CHAT
// ----------------------

// POST /api/messages : Envoyer un message
app.post('/api/messages', isAuthenticated, (req, res) => {
    const { toUsername, content } = req.body;
    const senderId = req.user.id;

    db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, receiver) => {
        if (err) return res.status(500).json({ error: 'server_error' });
        if (!receiver) return res.status(404).json({ error: 'user_not_found' });
        
        const receiverId = receiver.id;

        db.run('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)', [senderId, receiverId, content], function(err) {
            if (err) {
                console.error('Erreur POST /api/messages:', err);
                return res.status(500).json({ error: 'server_error' });
            }
            res.json({ message: 'Message envoyé.' });
        });
    });
});

// GET /api/messages/:username : Récupérer l'historique de chat
app.get('/api/messages/:username', isAuthenticated, (req, res) => {
    const userA_id = req.user.id;
    const userB_username = req.params.username;

    db.get('SELECT id FROM users WHERE username = ?', [userB_username], (err, userB) => {
        if (err) return res.status(500).json({ error: 'server_error' });
        if (!userB) return res.status(404).json({ error: 'user_not_found' });
        
        const userB_id = userB.id;

        const sql = `
            SELECT M.sender_id, M.content, M.timestamp, U.username AS sender_username
            FROM messages M
            JOIN users U ON M.sender_id = U.id
            WHERE (M.sender_id = ? AND M.receiver_id = ?) OR (M.sender_id = ? AND M.receiver_id = ?)
            ORDER BY M.timestamp ASC
        `;

        db.all(sql, [userA_id, userB_id, userB_id, userA_id], (err, messages) => {
            if (err) {
                console.error('Erreur GET /api/messages:', err);
                return res.status(500).json({ error: 'server_error' });
            }
            res.json(messages);
        });
    });
});


// ====================================================
// 5. ROUTES API DE JEU ET MATCHMAKING (COMPLET)
// ====================================================

// --- UTILS : MAPPING DES RANGS ---
const RANK_MAP = {
    // Valorant (25 rangs)
    'fer1': 1, 'fer2': 2, 'fer3': 3,
    'bronze1': 4, 'bronze2': 5, 'bronze3': 6,
    'argent1': 7, 'argent2': 8, 'argent3': 9,
    'or1': 10, 'or2': 11, 'or3': 12,
    'platine1': 13, 'platine2': 14, 'platine3': 15,
    'diamant1': 16, 'diamant2': 17, 'diamant3': 18,
    'ascendant_1': 19, 'ascendant_2': 20, 'ascendant_3': 21,
    'immortal_1': 22, 'immortal_2': 23, 'immortal_3': 24,
    'radiant': 25,
};

function getRankValue(rankId) {
    return RANK_MAP[rankId.toLowerCase()] || 0; 
}


/**
 * GET /api/user/profile
 * Récupère les données complètes de l'utilisateur (Settings + Preferences)
 */
app.get('/api/user/profile', isAuthenticated, (req, res) => {
    const userId = req.user.id;
    const gameId = req.query.gameId || 'valorant'; 

    // 1. Récupérer les settings de jeu (Rang/Mode)
    db.get('SELECT * FROM game_settings WHERE user_id = ? AND game_id = ?', [userId, gameId], (err, settings) => {
        if (err) {
            console.error('Erreur GET /api/user/profile (settings):', err);
            return res.status(500).json({ error: 'server_error' });
        }
        
        const gameSettings = settings ? {
            rank: settings.rank,
            mainMode: settings.mainMode,
            options: settings.options ? JSON.parse(settings.options) : [],
        } : { rank: null, mainMode: null, options: [] };


        // 2. Récupérer les préférences de partenaire (Tolérance/Rangs préférés)
        db.get('SELECT * FROM partner_preferences WHERE user_id = ?', [userId], (err, prefs) => {
            if (err) {
                console.error('Erreur GET /api/user/profile (prefs):', err);
                return res.status(500).json({ error: 'server_error' });
            }
            
            const partnerPreferences = prefs ? {
                prefRanks: prefs.prefRanks ? JSON.parse(prefs.prefRanks) : [],
                rankTolerance: prefs.rankTolerance,
            } : { prefRanks: [], rankTolerance: 1 };
            
            res.json({ 
                id: userId, // Ajout de l'ID pour le front-end
                username: req.user.username,
                gameSettings, 
                partnerPreferences 
            });
        });
    });
});


/**
 * POST /api/game/settings
 * Sauvegarde les settings de jeu (Rang, Mode, Options)
 */
app.post('/api/game/settings', isAuthenticated, (req, res) => {
    const { gameId, rank, mainMode, options } = req.body;
    const userId = req.user.id;

    if (!gameId || !rank || !mainMode) {
        return res.status(400).json({ error: 'gameId, rank et mainMode sont requis' });
    }
    
    const optionsJson = JSON.stringify(options || []);

    const sql = `
        INSERT OR REPLACE INTO game_settings (user_id, game_id, rank, mainMode, options)
        VALUES (?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [userId, gameId, rank, mainMode, optionsJson], function(err) {
        if (err) {
            console.error('Erreur POST /api/game/settings:', err);
            return res.status(500).json({ error: 'server_error' });
        }
        res.json({ message: 'Paramètres de jeu sauvegardés avec succès.' });
    });
});


/**
 * POST /api/game/preferences
 * Sauvegarde les préférences de partenaire (Rangs préférés, Tolérance)
 */
app.post('/api/game/preferences', isAuthenticated, (req, res) => {
    const { prefRanks, rankTolerance } = req.body;
    const userId = req.user.id;

    const prefRanksJson = JSON.stringify(prefRanks || []);
    
    const sql = `
        INSERT OR REPLACE INTO partner_preferences (user_id, prefRanks, rankTolerance)
        VALUES (?, ?, ?)
    `;
    
    db.run(sql, [userId, prefRanksJson, rankTolerance || 1], function(err) {
        if (err) {
            console.error('Erreur POST /api/game/preferences:', err);
            return res.status(500).json({ error: 'server_error' });
        }
        res.json({ message: 'Préférences de partenaire sauvegardées avec succès.' });
    });
});


/**
 * GET /api/match/search/:gameId
 * Algorithme de recherche de partenaire.
 */
app.get('/api/match/search/:gameId', isAuthenticated, async (req, res) => {
    const userId = req.user.id;
    const gameId = req.params.gameId;
    
    const [A_settings, A_prefs] = await new Promise((resolve) => {
        db.get('SELECT * FROM game_settings WHERE user_id = ? AND game_id = ?', [userId, gameId], (err, settings) => {
            db.get('SELECT * FROM partner_preferences WHERE user_id = ?', [userId], (err, prefs) => {
                if (err || !settings) {
                    return resolve([null, null]);
                }
                resolve([{
                    rank: settings.rank,
                    mainMode: settings.mainMode,
                    options: settings.options ? JSON.parse(settings.options) : [],
                }, {
                    prefRanks: prefs && prefs.prefRanks ? JSON.parse(prefs.prefRanks) : [],
                    rankTolerance: prefs ? prefs.rankTolerance : 1,
                }]);
            });
        });
    });

    if (!A_settings || !A_settings.rank || !A_settings.mainMode) {
        return res.status(400).json({ 
            error: 'settings_missing', 
            message: 'Veuillez d\'abord sauvegarder votre rang et votre mode de jeu.' 
        });
    }

    const A_rankValue = getRankValue(A_settings.rank);
    const A_tolerance = A_prefs.rankTolerance || 1;
    const A_minRank = A_rankValue - A_tolerance;
    const A_maxRank = A_rankValue + A_tolerance;

    const A_optionsPattern = A_settings.options.length > 0 ? 
                             A_settings.options.map(opt => `%"${opt}"%`).join(' AND B.options LIKE ') : 
                             '%%';

    const sql = `
        SELECT 
            U.id AS user_id,
            U.username, 
            B.rank, 
            B.mainMode, 
            B.options,
            PP.rankTolerance AS B_rankTolerance,
            PP.prefRanks AS B_prefRanks
        FROM users U
        INNER JOIN game_settings B ON U.id = B.user_id
        LEFT JOIN partner_preferences PP ON U.id = PP.user_id
        LEFT JOIN friend_requests F1 ON (F1.sender_id = ? AND F1.receiver_id = U.id AND F1.status IN ('pending', 'accepted'))
        LEFT JOIN friend_requests F2 ON (F2.sender_id = U.id AND F2.receiver_id = ? AND F2.status IN ('pending', 'accepted'))
        WHERE 
            U.id != ? AND
            B.game_id = ? AND 
            B.mainMode = ? AND
            B.options LIKE ? AND 
            F1.id IS NULL AND F2.id IS NULL
    `;

    const params = [
        userId, 
        userId, 
        userId, 
        gameId, 
        A_settings.mainMode, 
        A_optionsPattern
    ];

    db.all(sql, params, (err, potentialMatches) => {
        if (err) {
            console.error('Erreur GET /api/match/search:', err);
            return res.status(500).json({ error: 'server_error' });
        }
        
        const finalMatches = potentialMatches.filter(match => {
            const B_rankValue = getRankValue(match.rank);
            
            const B_tolerance = match.B_rankTolerance || 1; 
            const B_prefRanks = match.B_prefRanks ? JSON.parse(match.B_prefRanks) : [];

            // 1. Le rang de B doit être dans la tolérance de A
            const rankMatch_A = (B_rankValue >= A_minRank && B_rankValue <= A_maxRank);
            
            // 2. Le rang de A doit être dans la tolérance de B (Réciprocité)
            const B_minRank = B_rankValue - B_tolerance;
            const B_maxRank = B_rankValue + B_tolerance;
            const rankMatch_B = (A_rankValue >= B_minRank && A_rankValue <= B_maxRank);
            
            // 3. Vérification des préférences de rang (si définies)
            const A_PrefRanksMatch = A_prefs.prefRanks.length === 0 || A_prefs.prefRanks.includes(match.rank) || rankMatch_A;

            return rankMatch_A && rankMatch_B && A_PrefRanksMatch;
        }).map(match => ({ 
            id: match.user_id, // Ajout de l'ID du partenaire
            username: match.username,
            rank: match.rank,
            mainMode: match.mainMode,
            options: match.options ? JSON.parse(match.options) : [],
        }));

        res.json(finalMatches);
    });
});


// ====================================================
// LANCEMENT SERVEUR
// ====================================================
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
