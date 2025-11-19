(function () {
      /* ========= GESTION JEUX / CARROUSEL ========= */

      const GAMES = [
        {
          id: "lol",
          name: "League of Legends",
          tags: ["MOBA", "Ranked", "Flex"],
          from: "#1d4ed8",
          to: "#22c55e",
        },
        {
          id: "valorant",
          name: "Valorant",
          tags: ["FPS", "Compétitif", "5v5"],
          from: "#b91c1c",
          to: "#7f1d1d",
        },
        {
          id: "wow",
          name: "World of Warcraft",
          tags: ["MMORPG", "Donjons", "Raids"],
          from: "#eab308",
          to: "#1d4ed8",
        },
        {
          id: "rocketleague",
          name: "Rocket League",
          tags: ["2v2", "3v3", "Ranked"],
          from: "#06b6d4",
          to: "#2563eb",
        },
        {
          id: "gta",
          name: "GTA Online / RP",
          tags: ["RP", "Heists", "Free roam"],
          from: "#ea580c",
          to: "#7c2d12",
        },
        {
          id: "amongus",
          name: "Among Us",
          tags: ["Party game", "Social"],
          from: "#db2777",
          to: "#7c3aed",
        },
      ];

      const FAVORITES_KEY = "matchmates_favorite_games";

      const track = document.getElementById("games-track");
      const searchInput = document.getElementById("game-search");
      const favoritesList = document.getElementById("favorites-list");
      const favoritesCount = document.getElementById("favorites-count");
      const resultCount = document.getElementById("games-result-count");
      const prevBtn = document.getElementById("carousel-prev");
      const nextBtn = document.getElementById("carousel-next");

      let favorites = [];
      let filteredGames = [...GAMES];
      let currentIndex = 0;
      let autoSlideInterval = null;

      function loadFavorites() {
        try {
          const raw = localStorage.getItem(FAVORITES_KEY);
          if (!raw) return;
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            favorites = parsed;
          }
        } catch (e) {
          console.warn("Impossible de charger les favoris", e);
        }
      }

      function saveFavorites() {
        try {
          localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
        } catch (e) {
          console.warn("Impossible d’enregistrer les favoris", e);
        }
      }

      function isFavorite(id) {
        return favorites.includes(id);
      }

      function toggleFavorite(id) {
        if (isFavorite(id)) {
          favorites = favorites.filter((fid) => fid !== id);
        } else {
          favorites.push(id);
        }
        saveFavorites();
        renderFavorites();
        updateFavoriteButtonsState();
      }

      function renderFavorites() {
        favoritesList.innerHTML = "";

        if (!favorites.length) {
          favoritesList.innerHTML =
            '<span class="favorites-empty">Aucun favori pour l’instant. Clique sur ★ sur un jeu pour l’ajouter ici.</span>';
          favoritesCount.textContent = "0 jeu en favoris";
          return;
        }

        const favGames = GAMES.filter((g) => favorites.includes(g.id));
        favoritesCount.textContent =
          favGames.length + (favGames.length > 1 ? " jeux en favoris" : " jeu en favoris");

        favGames.forEach((game) => {
          const pill = document.createElement("button");
          pill.className = "favorite-pill";
          pill.type = "button";
          pill.innerHTML = '<span class="favorite-pill-dot"></span>' + game.name;

          pill.addEventListener("click", () => {
            searchInput.value = game.name;
            applySearch();
          });

          favoritesList.appendChild(pill);
        });
      }

      function createGameCard(game) {
        const card = document.createElement("div");
        card.className = "game-card";
        card.dataset.id = game.id;

        const gradient = document.createElement("div");
        gradient.className = "game-gradient";
        gradient.style.background = `linear-gradient(135deg, ${game.from}, ${game.to})`;
        card.appendChild(gradient);

        const favBtn = document.createElement("button");
        favBtn.type = "button";
        favBtn.className = "game-fav-btn";
        favBtn.innerHTML = "☆";
        favBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleFavorite(game.id);
        });
        card.appendChild(favBtn);

        const info = document.createElement("div");
        info.className = "game-info";
        const title = document.createElement("div");
        title.className = "game-title";
        title.textContent = game.name;
        const tags = document.createElement("div");
        tags.className = "game-tags";
        tags.textContent = game.tags.join(" · ");

        info.appendChild(title);
        info.appendChild(tags);
        card.appendChild(info);

        return card;
      }

      function renderGames() {
        track.innerHTML = "";
        filteredGames.forEach((game) => {
          track.appendChild(createGameCard(game));
        });
        updateFavoriteButtonsState();
        updateResultCount();
        resetCarouselPosition();
      }

      function updateFavoriteButtonsState() {
        const cards = track.querySelectorAll(".game-card");
        cards.forEach((card) => {
          const gameId = card.dataset.id;
          const btn = card.querySelector(".game-fav-btn");
          if (!btn) return;

          if (isFavorite(gameId)) {
            btn.classList.add("active");
            btn.innerHTML = "★";
          } else {
            btn.classList.remove("active");
            btn.innerHTML = "☆";
          }
        });
      }

      function updateResultCount() {
        if (!filteredGames.length) {
          resultCount.textContent = "Aucun jeu trouvé";
        } else if (filteredGames.length === GAMES.length) {
          resultCount.textContent = filteredGames.length + " jeux disponibles";
        } else {
          resultCount.textContent =
            filteredGames.length +
            (filteredGames.length > 1 ? " jeux correspondent à la recherche" : " jeu correspond à la recherche");
        }
      }

      function applySearch() {
        const q = searchInput.value.toLowerCase().trim();
        if (!q) {
          filteredGames = [...GAMES];
        } else {
          filteredGames = GAMES.filter((game) => {
            const inName = game.name.toLowerCase().includes(q);
            const inTags = game.tags.some((t) =>
              t.toLowerCase().includes(q)
            );
            return inName || inTags;
          });
        }
        renderGames();
      }

      searchInput.addEventListener("input", applySearch);

      function getCardStep() {
        const firstCard = track.querySelector(".game-card");
        if (!firstCard) return 0;

        const style = window.getComputedStyle(firstCard);
        const marginRight = parseFloat(style.marginRight) || 0;
        return firstCard.offsetWidth + marginRight;
      }

      function updateCarouselTransform() {
        const step = getCardStep();
        const offset = step * currentIndex;
        track.style.transform = "translateX(" + -offset + "px)";
      }

      function resetCarouselPosition() {
        currentIndex = 0;
        updateCarouselTransform();
        restartAutoSlide();
      }

      function goToNext() {
        if (!filteredGames.length) return;
        currentIndex = (currentIndex + 1) % filteredGames.length;
        updateCarouselTransform();
      }

      function goToPrev() {
        if (!filteredGames.length) return;
        currentIndex =
          currentIndex === 0 ? filteredGames.length - 1 : currentIndex - 1;
        updateCarouselTransform();
      }

      prevBtn.addEventListener("click", () => {
        goToPrev();
        restartAutoSlide();
      });

      nextBtn.addEventListener("click", () => {
        goToNext();
        restartAutoSlide();
      });

      function restartAutoSlide() {
        if (autoSlideInterval) clearInterval(autoSlideInterval);
        autoSlideInterval = setInterval(goToNext, 3500);
      }

      window.addEventListener("resize", () => {
        updateCarouselTransform();
      });

      loadFavorites();
      renderFavorites();
      renderGames();
      restartAutoSlide();
})();
