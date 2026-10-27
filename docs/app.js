const OFF_URL = "https://world.openfoodfacts.org/api/v2/product/";
const NTFY_URL = "https://ntfy.sh";
const HEURE_NOTIF = "9h (8h en hiver)";

let JOURS_ALERTE = 5;
let produitsActuels = [];
let ntfyTopic = null;

const form = document.getElementById("form-produit");
const message = document.getElementById("message");
const liste = document.getElementById("liste");
const compteur = document.getElementById("compteur");
const apercu = document.getElementById("apercu");
const btnScan = document.getElementById("btn-scan");
const lecteur = document.getElementById("lecteur");

function afficherMessage(texte, erreur = false) {
  message.textContent = texte;
  message.style.color = erreur ? "var(--rouge)" : "var(--vert)";
}

function echapper(texte) {
  const div = document.createElement("div");
  div.textContent = texte ?? "";
  return div.innerHTML;
}

function joursRestants(dateIso) {
  const [a, m, j] = dateIso.split("-").map(Number);
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  return Math.round((new Date(a, m - 1, j) - aujourdhui) / 86400000);
}

// --- Connexion à Supabase ---

const configOk = typeof PERIMO_CONFIG !== "undefined"
  && !PERIMO_CONFIG.supabaseUrl.includes("VOTRE-PROJET")
  && !PERIMO_CONFIG.supabaseAnonKey.includes("VOTRE-CLE");
const db = configOk
  ? supabase.createClient(PERIMO_CONFIG.supabaseUrl, PERIMO_CONFIG.supabaseAnonKey)
  : null;

const ecranConnexion = document.getElementById("ecran-connexion");
const ecranApp = document.getElementById("ecran-app");
const btnDeconnexion = document.getElementById("btn-deconnexion");
const formConnexion = document.getElementById("form-connexion");
const messageConnexion = document.getElementById("message-connexion");

function messageCnx(texte, erreur = true) {
  messageConnexion.textContent = texte;
  messageConnexion.style.color = erreur ? "var(--rouge)" : "var(--vert)";
}

async function afficherSelonSession(session) {
  const connecte = Boolean(session);
  ecranConnexion.hidden = connecte;
  ecranApp.hidden = !connecte;
  btnDeconnexion.hidden = !connecte;
  if (connecte) {
    await chargerReglages();
    await chargerProduits();
  }
}

if (!db) {
  document.getElementById("erreur-config").hidden = false;
} else {
  // setTimeout : ne pas appeler Supabase directement dans ce rappel (risque de blocage)
  db.auth.onAuthStateChange((_evenement, session) => {
    setTimeout(() => afficherSelonSession(session), 0);
  });
}

formConnexion.addEventListener("submit", async (e) => {
  e.preventDefault();
  const { email, password } = Object.fromEntries(new FormData(formConnexion));
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) messageCnx("Connexion refusée : e-mail ou mot de passe incorrect, ou compte pas encore confirmé.");
});

document.getElementById("btn-inscription").addEventListener("click", async () => {
  if (!formConnexion.reportValidity()) return;
  const { email, password } = Object.fromEntries(new FormData(formConnexion));
  const { data, error } = await db.auth.signUp({ email, password });
  if (error) return messageCnx(`Inscription impossible : ${error.message}`);
  if (!data.session) {
    messageCnx("Compte créé ✔ Cliquez sur le lien reçu par e-mail, puis connectez-vous.", false);
  }
});

btnDeconnexion.addEventListener("click", () => db.auth.signOut());

// --- Scan du code-barres ---

let scanner = null;

btnScan.addEventListener("click", async () => {
  if (scanner) return arreterScan();
  lecteur.hidden = false;
  btnScan.textContent = "✖ Arrêter le scan";
  scanner = new Html5Qrcode("lecteur");
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 140 } },
      async (code) => {
        await arreterScan();
        await chercherProduit(code);
      }
    );
  } catch (err) {
    await arreterScan();
    afficherMessage("Caméra indisponible (il faut HTTPS ou localhost).", true);
  }
});

async function arreterScan() {
  if (scanner) {
    try { await scanner.stop(); } catch (_) {}
    scanner.clear();
    scanner = null;
  }
  lecteur.hidden = true;
  btnScan.textContent = "📷 Scanner un code-barres";
}

async function chercherProduit(code) {
  form.code_barre.value = code;
  afficherMessage(`Code ${code} : recherche…`);
  let p = null;
  try {
    const resp = await fetch(
      `${OFF_URL}${encodeURIComponent(code)}.json?fields=product_name_fr,product_name,brands,image_small_url`
    );
    const data = resp.ok ? await resp.json() : {};
    if (data.status === 1) p = data.product;
  } catch (_) {
    afficherMessage("Open Food Facts ne répond pas, saisissez le nom à la main.", true);
    form.nom.focus();
    return;
  }
  if (!p) {
    afficherMessage("Produit inconnu, saisissez le nom à la main.", true);
    form.nom.focus();
    return;
  }
  const nom = p.product_name_fr || p.product_name || "";
  form.nom.value = nom;
  form.marque.value = p.brands || "";
  form.image_url.value = p.image_small_url || "";
  apercu.hidden = !p.image_small_url;
  apercu.querySelector("img").src = p.image_small_url || "";
  apercu.querySelector("span").textContent = nom;
  afficherMessage("Produit trouvé ! Ajoutez la date de péremption.");
  form.date_peremption.focus();
}

// --- Lecture de la date par photo ---

const btnPhotoDate = document.getElementById("btn-photo-date");
const inputPhotoDate = document.getElementById("photo-date");
const messageDate = document.getElementById("message-date");
const datesTrouvees = document.getElementById("dates-trouvees");

function dateFr(isoDate) {
  const [a, m, j] = isoDate.split("-");
  return `${j}/${m}/${a}`;
}

function choisirDate(isoDate) {
  form.date_peremption.value = isoDate;
  for (const puce of datesTrouvees.children) {
    puce.classList.toggle("choisie", puce.dataset.date === isoDate);
  }
}

btnPhotoDate.addEventListener("click", () => inputPhotoDate.click());

inputPhotoDate.addEventListener("change", async () => {
  const fichier = inputPhotoDate.files[0];
  inputPhotoDate.value = "";
  if (!fichier) return;

  btnPhotoDate.disabled = true;
  datesTrouvees.innerHTML = "";
  messageDate.style.color = "var(--gris)";
  messageDate.textContent = "Lecture de la photo… (la première fois peut prendre quelques secondes)";
  try {
    const { dates } = await OcrDate.lireDate(fichier);
    if (!dates.length) {
      messageDate.style.color = "var(--rouge)";
      messageDate.textContent = "Aucune date lue. Cadrez la date de plus près, bien éclairée, ou saisissez-la.";
      return;
    }
    datesTrouvees.innerHTML = dates.slice(0, 4).map((d) =>
      `<button type="button" class="puce-date" data-date="${d.date}">${dateFr(d.date)}</button>`
    ).join("");
    choisirDate(dates[0].date);
    messageDate.style.color = "var(--vert)";
    messageDate.textContent = dates.length > 1
      ? "Date lue ✔ Vérifiez-la, ou choisissez une autre date trouvée :"
      : "Date lue ✔ Vérifiez-la avant d'ajouter.";
  } catch (err) {
    messageDate.style.color = "var(--rouge)";
    messageDate.textContent = "La lecture a échoué (connexion internet nécessaire la première fois).";
  } finally {
    btnPhotoDate.disabled = false;
  }
});

datesTrouvees.addEventListener("click", (e) => {
  const puce = e.target.closest(".puce-date");
  if (puce) choisirDate(puce.dataset.date);
});

// --- Ajout ---

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  for (const champ of ["marque", "code_barre", "image_url"]) {
    if (!data[champ]) data[champ] = null;
  }
  data.quantite = Number(data.quantite) || 1;

  const { error } = await db.from("produits").insert(data);
  if (error) return afficherMessage("Erreur lors de l'ajout.", true);

  form.reset();
  apercu.hidden = true;
  datesTrouvees.innerHTML = "";
  messageDate.textContent = "";
  afficherMessage("Ajouté au frigo ✔");
  chargerProduits();
});

// --- Liste ---

function badge(jours) {
  if (jours < 0) return `<span class="badge perime">Périmé</span>`;
  if (jours === 0) return `<span class="badge perime">Aujourd'hui</span>`;
  const classe = jours <= JOURS_ALERTE ? "bientot" : "ok";
  return `<span class="badge ${classe}">J-${jours}</span>`;
}

async function chargerProduits() {
  const { data, error } = await db.from("produits").select("*").order("date_peremption");
  if (error) {
    liste.innerHTML = `<li class="vide">Impossible de charger le frigo.</li>`;
    return;
  }
  produitsActuels = data.map((p) => ({ ...p, jours_restants: joursRestants(p.date_peremption) }));
  compteur.textContent = `(${produitsActuels.length})`;
  if (!produitsActuels.length) {
    liste.innerHTML = `<li class="vide">Le frigo est vide 🧊</li>`;
    return;
  }
  liste.innerHTML = produitsActuels.map((p) => `
    <li>
      ${p.image_url ? `<img src="${echapper(p.image_url)}" alt="">` : "<span>🍽️</span>"}
      <div class="infos">
        <strong>${echapper(p.nom)}${p.quantite > 1 ? ` ×${p.quantite}` : ""}</strong>
        <small>${echapper(p.marque || "")} · ${dateFr(p.date_peremption)}</small>
      </div>
      ${badge(p.jours_restants)}
      <button class="supprimer" data-id="${p.id}" title="Retirer du frigo">🗑️</button>
    </li>`).join("");
}

liste.addEventListener("click", async (e) => {
  const btn = e.target.closest(".supprimer");
  if (!btn) return;
  await db.from("produits").delete().eq("id", btn.dataset.id);
  chargerProduits();
});

// --- Recettes ---

const btnRecettes = document.getElementById("btn-recettes");
const messageRecettes = document.getElementById("message-recettes");
const zoneRecettes = document.getElementById("recettes");

function listeHtml(items, balise = "ul", classe = "") {
  return `<${balise}>${items.map((i) => `<li class="${classe}">${echapper(i)}</li>`).join("")}</${balise}>`;
}

btnRecettes.addEventListener("click", async () => {
  zoneRecettes.innerHTML = "";
  messageRecettes.style.color = "var(--rouge)";
  const produits = produitsActuels.filter((p) => p.jours_restants >= 0);
  if (!produits.length) {
    messageRecettes.textContent = "Le frigo est vide : ajoutez des produits d'abord.";
    return;
  }
  let recettes;
  try {
    recettes = await Recettes.proposer(produits, JOURS_ALERTE);
  } catch (_) {
    messageRecettes.textContent = "Impossible de charger les recettes.";
    return;
  }
  if (!recettes.length) {
    messageRecettes.textContent = "Aucune recette de la base n'utilise ces produits.";
    return;
  }
  messageRecettes.textContent = "";
  zoneRecettes.innerHTML = recettes.map((r, i) => `
    <details class="recette" ${i === 0 ? "open" : ""}>
      <summary>${echapper(r.titre)} <small>· ${r.duree_minutes} min</small></summary>
      <h3>Du frigo</h3>
      ${listeHtml(r.ingredients_du_frigo, "ul", "frigo")}
      ${r.ingredients_a_ajouter.length ? `<h3>À ajouter</h3>${listeHtml(r.ingredients_a_ajouter)}` : ""}
      <h3>Étapes</h3>
      ${listeHtml(r.etapes, "ol")}
    </details>`).join("");
});

// --- Notifications ---

const messageNotif = document.getElementById("message-notif");

function sujetAleatoire() {
  const octets = crypto.getRandomValues(new Uint8Array(8));
  return "perimo-" + [...octets].map((o) => o.toString(16).padStart(2, "0")).join("");
}

async function chargerReglages() {
  let { data } = await db.from("reglages").select("*").maybeSingle();
  if (!data) {
    // Le sujet ntfy est public : un nom aléatoire évite que d'autres le lisent
    ({ data } = await db.from("reglages").insert({ ntfy_topic: sujetAleatoire() }).select().single());
  }
  if (!data) return;
  ntfyTopic = data.ntfy_topic;
  JOURS_ALERTE = data.jours_alerte;
  document.getElementById("ntfy-topic").textContent = ntfyTopic;
  document.getElementById("ntfy-infos").textContent =
    `Alerte chaque jour vers ${HEURE_NOTIF} pour les produits à J-${JOURS_ALERTE} ou moins.`;
}

function decrireEcheance(jours) {
  if (jours < 0) return `périmé depuis ${-jours} j`;
  if (jours === 0) return "périme aujourd'hui";
  if (jours === 1) return "périme demain";
  return `dans ${jours} jours`;
}

// Même message que l'alerte quotidienne envoyée par Supabase
function messageAlerte() {
  const produits = produitsActuels.filter((p) => p.jours_restants <= JOURS_ALERTE);
  if (!produits.length) {
    return {
      title: "Périmo : tout va bien",
      message: `Rien ne périme dans les ${JOURS_ALERTE} prochains jours.`,
      tags: ["white_check_mark"],
    };
  }
  const n = produits.length;
  const urgent = produits.some((p) => p.jours_restants <= 1);
  return {
    title: `Périmo : ${n} produit${n > 1 ? "s" : ""} à consommer`,
    message: produits.map((p) => `• ${p.nom} : ${decrireEcheance(p.jours_restants)}`).join("\n"),
    tags: [urgent ? "rotating_light" : "warning"],
    priority: urgent ? 4 : 3,
  };
}

document.getElementById("btn-copier").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ntfyTopic);
    messageNotif.textContent = "Sujet copié ✔";
  } catch (_) {
    messageNotif.textContent = "Copie impossible, sélectionnez le texte à la main.";
  }
});

document.getElementById("btn-test").addEventListener("click", async () => {
  messageNotif.textContent = "Envoi…";
  try {
    const resp = await fetch(NTFY_URL, {
      method: "POST",
      body: JSON.stringify({ topic: ntfyTopic, ...messageAlerte() }),
    });
    messageNotif.textContent = resp.ok
      ? "Notification envoyée ✔ Vérifiez votre téléphone."
      : "Échec : le serveur ntfy a refusé l'envoi.";
  } catch (_) {
    messageNotif.textContent = "Échec : le serveur ntfy ne répond pas.";
  }
});
