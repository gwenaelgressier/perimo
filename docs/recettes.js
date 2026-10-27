// Propositions de recettes gratuites : cherche dans une base de recettes
// françaises celles qui utilisent le plus les produits du frigo, en priorité
// ceux qui périment bientôt.

const Recettes = (() => {
  const NB_RECETTES = 3;
  const PENALITE_MANQUANT = 0.75; // par ingrédient à acheter (hors placard)

  let base = null;

  /** Minuscules, sans accents : « Crème Fraîche » -> « creme fraiche ». */
  function normaliser(texte) {
    return texte.toLowerCase()
      .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/’/g, "'")
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  const echapperRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  async function charger() {
    if (base) return base;
    const resp = await fetch("recettes.json");
    const recettes = await resp.json();
    for (const recette of recettes) {
      for (const ing of recette.ingredients) {
        // Mot entier, avec pluriel facultatif : « oeuf » trouve « oeufs » mais pas « boeuf »
        ing.motifs = ing.cles.map((c) => new RegExp(`\\b${echapperRegex(c)}(s|x)?\\b`));
        ing.sauf = (ing.sauf || []).map(normaliser);
      }
    }
    base = recettes;
    return base;
  }

  function correspond(ingredient, nomProduit) {
    if (ingredient.sauf.some((s) => nomProduit.includes(s))) return false;
    return ingredient.motifs.some((m) => m.test(nomProduit));
  }

  /** 1 pour un produit lointain, jusqu'à joursAlerte + 2 s'il périme aujourd'hui. */
  function urgence(joursRestants, joursAlerte) {
    return 1 + Math.max(0, joursAlerte + 1 - joursRestants);
  }

  /** produits : produits non périmés, avec id, nom et jours_restants. */
  async function proposer(produits, joursAlerte) {
    const candidats = produits.map((p) => [normaliser(p.nom), p]);
    const resultats = [];
    for (const recette of await charger()) {
      const utilises = new Set();
      const duFrigo = [];
      const aAjouter = [];
      let score = 0;
      for (const ing of recette.ingredients) {
        // Le produit le plus urgent qui correspond et n'est pas déjà utilisé
        const trouves = candidats
          .filter(([nom, p]) => !utilises.has(p.id) && correspond(ing, nom))
          .map(([, p]) => p);
        if (trouves.length) {
          const produit = trouves.reduce((a, b) => (b.jours_restants < a.jours_restants ? b : a));
          utilises.add(produit.id);
          duFrigo.push(produit.nom);
          score += urgence(produit.jours_restants, joursAlerte);
        } else {
          aAjouter.push(ing.nom + (ing.placard ? " (placard)" : ""));
          if (!ing.placard) score -= PENALITE_MANQUANT;
        }
      }
      if (duFrigo.length) resultats.push({ score, recette, duFrigo, aAjouter });
    }

    resultats.sort((a, b) => b.score - a.score || a.recette.duree_minutes - b.recette.duree_minutes);
    return resultats.slice(0, NB_RECETTES).map(({ recette, duFrigo, aAjouter }) => ({
      titre: recette.titre,
      duree_minutes: recette.duree_minutes,
      ingredients_du_frigo: duFrigo,
      ingredients_a_ajouter: aAjouter,
      etapes: recette.etapes,
    }));
  }

  return { proposer, normaliser, correspond, charger };
})();
