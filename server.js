const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- MIDDLEWARES DE BASE ---------- //
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ---------- SESSIONS (rester connecté) ---------- //
app.use(
  session({
    secret: "change-ce-texte-par-un-secret-plus-long", // mets une phrase longue ici
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 1 jour
    },
  })
);

// ---------- BASE DE DONNÉES ---------- //
const db = new sqlite3.Database(path.join(__dirname, "database.sqlite"));


db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// ---------- MIDDLEWARE : vérifier si connecté ---------- //
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login.html");
  }
  next();
}

// ---------- ROUTES D'AUTH ---------- //

// INSCRIPTION
app.post("/api/signup", (req, res) => {
  const { username, email, password } = req.body;

  console.log("Tentative inscription :", username, email);

  if (!username || !email || !password) {
    return res.status(400).send("Tous les champs sont obligatoires.");
  }

  if (password.length < 8) {
    return res.status(400).send("Le mot de passe doit faire au moins 8 caractères.");
  }

  db.get(
    "SELECT * FROM users WHERE username = ? OR email = ?",
    [username, email],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Erreur serveur.");
      }

      if (row) {
        return res
          .status(400)
          .send("Nom d'utilisateur ou email déjà utilisé.");
      }

      const hash = bcrypt.hashSync(password, 10);

      db.run(
        "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
        [username, email, hash],
        function (err) {
          if (err) {
            console.error(err);
            return res.status(500).send("Erreur lors de l'inscription.");
          }

          console.log("Utilisateur créé avec ID :", this.lastID);

          // on connecte directement le nouvel utilisateur
          req.session.userId = this.lastID;
          req.session.username = username;

          return res.redirect("/profile.html");
        }
      );
    }
  );
});

// CONNEXION
app.post("/api/login", (req, res) => {
  const { identifier, password } = req.body; // identifier = email ou username

  console.log("Tentative connexion avec :", identifier);

  if (!identifier || !password) {
    return res.status(400).send("Tous les champs sont obligatoires.");
  }

  db.get(
    "SELECT * FROM users WHERE email = ? OR username = ?",
    [identifier, identifier],
    (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Erreur serveur.");
      }

      if (!user) {
        console.log("Utilisateur introuvable");
        return res.status(400).send("Utilisateur introuvable.");
      }

      const match = bcrypt.compareSync(password, user.password_hash);
      if (!match) {
        console.log("Mot de passe incorrect");
        return res.status(400).send("Mot de passe incorrect.");
      }

      console.log("Connexion réussie pour l'utilisateur ID :", user.id);

      // création de la session
      req.session.userId = user.id;
      req.session.username = user.username;

      return res.redirect("/profile.html");
    }
  );
});

// DÉCONNEXION
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    return res.redirect("/login.html");
  });
});
// ---------- API : infos du profil connecté ---------- //
app.get("/api/me", (req, res) => {
  // Si pas connecté → on ne redirige PAS, on répond 401
  if (!req.session.userId) {
    return res.status(401).json({ loggedIn: false });
  }

  db.get(
    "SELECT id, username, email, created_at FROM users WHERE id = ?",
    [req.session.userId],
    (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Erreur serveur." });
      }

      if (!user) {
        return res.status(404).json({ error: "Utilisateur non trouvé." });
      }

      return res.json({
        loggedIn: true,
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at,
      });
    }
  );
});

// ---------- PAGE PROFILE PROTÉGÉE ---------- //
app.get("/profile.html", requireLogin, (req, res) => {
  // si on arrive ici, l'utilisateur est connecté
  console.log("Accès à profile.html par :", req.session.username);
  return res.sendFile(path.join(__dirname, "profile.html"));
});
app.get("/dashboard.html", requireLogin, (req, res) => {
  console.log("Accès à dashboard.html par :", req.session.username);
  return res.sendFile(path.join(__dirname, "dashboard.html"));
});

// ---------- FICHIERS STATIQUES (HTML / CSS) ---------- //
app.use(express.static(__dirname));

// ---------- DÉMARRAGE DU SERVEUR ---------- //
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
