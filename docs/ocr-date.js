// Lecture de la date de péremption sur une photo, directement dans le navigateur
// (Tesseract.js, gratuit, rien n'est envoyé au serveur).

const OcrDate = (() => {
  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const LARGEUR_MAX = 1600;

  const MOIS = {
    jan: 1, janv: 1, fev: 2, fevr: 2, feb: 2, mar: 3, mars: 3, avr: 4, apr: 4,
    mai: 5, may: 5, juin: 6, jun: 6, juil: 7, jul: 7, aou: 8, aout: 8, aug: 8,
    sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };

  // Plus la confiance est haute, plus la date est sûre
  const CONFIANCE = { complete: 3, moisEnLettres: 3, moisAnnee: 2, sansAnnee: 1 };

  // --- Analyse du texte ---

  function sansAccents(texte) {
    return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  // Corrige les confusions classiques de l'OCR sur les chiffres (O -> 0, l -> 1…)
  function corrigerChiffres(texte) {
    return texte
      .replace(/[OoQD]/g, "0")
      .replace(/[Il|!]/g, "1")
      .replace(/S/g, "5")
      .replace(/B/g, "8")
      .replace(/Z/g, "2");
  }

  function annee(a) {
    const n = Number(a);
    return a.length === 2 ? 2000 + n : n;
  }

  function dernierJourDuMois(an, mois) {
    return new Date(an, mois, 0).getDate();
  }

  function creerDate(an, mois, jour, aujourdhui) {
    if (mois < 1 || mois > 12 || jour < 1 || jour > dernierJourDuMois(an, mois)) return null;
    const d = new Date(an, mois - 1, jour);
    const min = new Date(aujourdhui); min.setDate(min.getDate() - 60);
    const max = new Date(aujourdhui); max.setFullYear(max.getFullYear() + 5);
    return d >= min && d <= max ? d : null;
  }

  function iso(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** Renvoie les dates trouvées, la plus probable en premier : [{date: "AAAA-MM-JJ", confiance}] */
  function extraireDates(texte, aujourdhui = new Date()) {
    aujourdhui = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());
    const trouvees = new Map();
    const ajouter = (d, confiance) => {
      if (!d) return;
      const cle = iso(d);
      trouvees.set(cle, Math.max(confiance, trouvees.get(cle) ?? 0));
    };

    let chiffres = corrigerChiffres(texte);

    // 12/11/2026, 12.11.26, 12-11-2026, 12 11 26
    const complete = /(?<!\d)(\d{1,2})\s?[\/.\-\s]\s?(\d{1,2})\s?[\/.\-\s]\s?(\d{4}|\d{2})(?!\d)/g;
    chiffres = chiffres.replace(complete, (m, j, mo, a) => {
      ajouter(creerDate(annee(a), Number(mo), Number(j), aujourdhui), CONFIANCE.complete);
      return " ".repeat(m.length);
    });

    // 11/2027 (date de durabilité minimale) -> dernier jour du mois
    const moisAnnee = /(?<!\d)(\d{1,2})\s?[\/.\-]\s?(20\d{2})(?!\d)/g;
    chiffres = chiffres.replace(moisAnnee, (m, mo, a) => {
      const an = Number(a), mois = Number(mo);
      if (mois >= 1 && mois <= 12) {
        ajouter(creerDate(an, mois, dernierJourDuMois(an, mois), aujourdhui), CONFIANCE.moisAnnee);
      }
      return " ".repeat(m.length);
    });

    // 12/11 sans année -> la prochaine fois que cette date arrive
    const sansAnnee = /(?<!\d)(\d{1,2})\/(\d{1,2})(?![\/\d])/g;
    for (const [, j, mo] of chiffres.matchAll(sansAnnee)) {
      let d = creerDate(aujourdhui.getFullYear(), Number(mo), Number(j), aujourdhui);
      if (d && d < aujourdhui) d = creerDate(aujourdhui.getFullYear() + 1, Number(mo), Number(j), aujourdhui);
      ajouter(d, CONFIANCE.sansAnnee);
    }

    // 12 NOV 2026, 12 nov. 26, 12 novembre
    const lettres = /(?<!\d)(\d{1,2})\s*(janv?|fevr?|feb|mars?|avr|apr|mai|may|juin|jun|juil|jul|aout|aou|aug|sept?|oct|nov|dec)[a-z]*\.?\s*(\d{4}|\d{2})?(?!\d)/g;
    for (const [, j, mo, a] of sansAccents(texte).matchAll(lettres)) {
      const mois = MOIS[mo];
      const an = a ? annee(a) : aujourdhui.getFullYear();
      ajouter(creerDate(an, mois, Number(j), aujourdhui), a ? CONFIANCE.moisEnLettres : CONFIANCE.sansAnnee);
    }

    // Les plus sûres d'abord ; à égalité, la plus lointaine (souvent la DLC, pas la date de fabrication)
    return [...trouvees]
      .map(([date, confiance]) => ({ date, confiance }))
      .sort((a, b) => b.confiance - a.confiance || b.date.localeCompare(a.date));
  }

  // --- Lecture de l'image ---

  let tesseractPret = null;
  let worker = null;

  function chargerTesseract() {
    tesseractPret ??= new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = TESSERACT_URL;
      s.onload = ok;
      s.onerror = () => { tesseractPret = null; ko(new Error("Impossible de charger Tesseract")); };
      document.head.appendChild(s);
    });
    return tesseractPret;
  }

  async function obtenirWorker() {
    await chargerTesseract();
    worker ??= await Tesseract.createWorker("fra");
    return worker;
  }

  // Agrandit si besoin, passe en niveaux de gris et augmente le contraste
  async function preparerImage(fichier) {
    const image = await createImageBitmap(fichier);
    const echelle = Math.min(LARGEUR_MAX / image.width, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = pixels.data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const etendue = Math.max(max - min, 1);
    for (let i = 0; i < d.length; i += 4) {
      const g = ((d[i] - min) / etendue) * 255;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }

  /** Lit le texte de la photo et renvoie {texte, dates} */
  async function lireDate(fichier) {
    const [w, canvas] = await Promise.all([obtenirWorker(), preparerImage(fichier)]);
    const { data } = await w.recognize(canvas);
    return { texte: data.text, dates: extraireDates(data.text) };
  }

  return { extraireDates, lireDate };
})();
