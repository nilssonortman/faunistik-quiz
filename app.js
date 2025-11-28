// =====================================================================
// Faunistics quiz: vocab-only
// - Species-level quiz
// - Genus-level quiz
// - Family-level quiz
// Images & attribution are pre-baked in the vocab JSON (exampleObservation).
// =====================================================================

// ---------------- CONFIG ----------------------------------------------
const CONFIG = {
  QUESTIONS_COUNT: 10,
  OPTIONS_PER_QUESTION: 4,

  VOCAB_SETS: {
    basic: {
      insects: "data/basic/insects_vocab_sweden.json",
      plants: "data/basic/plants_vocab_sweden.json",
      mosses: "data/basic/mosses_vocab_sweden.json",
      lichens: "data/basic/lichens_vocab_sweden.json",
      mammals: "data/basic/mammals_vocab_sweden.json",
      birds: "data/basic/birds_vocab_sweden.json",
      fungi: "data/basic/fungi_vocab_sweden.json",
      spiders: "data/basic/spiders_vocab_sweden.json",
      herptiles: "data/basic/herptiles_vocab_sweden.json",
    },
    extended: {
      insects: "data/extended/insects_vocab_sweden.json",
      plants: "data/extended/plants_vocab_sweden.json",
      mosses: "data/extended/mosses_vocab_sweden.json",
      lichens: "data/extended/lichens_vocab_sweden.json",
      mammals: "data/extended/mammals_vocab_sweden.json",
      birds: "data/extended/birds_vocab_sweden.json",
      fungi: "data/extended/fungi_vocab_sweden.json",
      spiders: "data/extended/spiders_vocab_sweden.json",
      herptiles: "data/extended/herptiles_vocab_sweden.json",
    },
  },
};


// ---------------- STATE -----------------------------------------------
let vocabByGroup = {};        // { groupKey: [speciesEntry, ...] }
let genusVocabByGroup = {};  // { groupKey: [ { genusName, swedishName, representative }, ... ] }
let familyVocabByGroup = {}; // { groupKey: [ { familyName, swedishName, representative }, ... ] }
let currentVocabSet = "basic"; // "basic" | "extended"
let quizQuestions = [];      // [{ correct, options }]
let currentIndex = 0;
let score = 0;
let currentLevel = "species"; // "species" | "genus" | "family"
let distractorScope = "group"; // "group" | "order" | "family"
let dataSource = "inat"; // "inat" | "course"
let courseVocab = [];    // species from course project


// ---------------- DOM ELEMENTS ----------------------------------------
const statusEl = document.getElementById("status");
const controlsEl = document.getElementById("controls");
const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const questionContainerEl = document.getElementById("question-container");
const photoEl = document.getElementById("photo");
const imageWrapperEl = document.getElementById("image-wrapper");
const answersEl = document.getElementById("answers");
const attributionEl = document.getElementById("attribution");
const nextBtn = document.getElementById("next-btn");
const levelSelectEl = document.getElementById("level-select");
const vocabSetSelectEl = document.getElementById("vocab-set-select");
const dataSourceSelectEl = document.getElementById("data-source-select");
const distractorScopeSelectEl = document.getElementById(
  "distractor-scope-select"
);

// ---------------- HELPERS ---------------------------------------------

async function loadAllVocabAndDerived() {
  await loadVocab();               // iNat basic/extended → vocabByGroup
  buildGenusVocabFromSpecies();    // bygger genusVocabByGroup från vocabByGroup
  buildFamilyVocabFromSpecies();   // bygger familyVocabByGroup
}

async function loadAllData() {
  await loadAllVocabAndDerived();
  await loadCourseVocab();         // fyller courseVocab från data/course_2025/...
}


function shuffleArray(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandomSubset(array, n) {
  if (array.length <= n) return array.slice();
  return shuffleArray(array).slice(0, n);
}

// generic label helper (works for species/genus/family)
function formatLabel(scientificName, swedishName) {
  const sci = `<i>${scientificName}</i>`;
  return swedishName ? `${sci} (${swedishName})` : sci;
}

function italicizeSci(name) {
  if (!name) return "";
  return `<i>${name}</i>`;
}

function determineGroupKeyForSpecies(entry) {
  const cls = (entry.classScientificName || "").toLowerCase();
  const ord = (entry.orderScientificName || "").toLowerCase();

  // Insects, birds, mammals, herptiles
  if (cls === "insecta") return "insects";
  if (cls === "aves") return "birds";
  if (cls === "mammalia") return "mammals";
  if (cls === "amphibia" || cls === "reptilia") return "herptiles";

  // Spiders
  if (ord === "araneae" || cls === "arachnida") return "spiders";

  // Lichens (main lichen classes)
  if (cls === "lecanoromycetes" || cls === "eurotiomycetes") return "lichens";

  // Mosses
  if (cls === "bryopsida" || cls === "marchantiopsida") return "mosses";

  // Crude plant detection: many plant classes end with -opsida
  if (cls.endsWith("opsida")) return "plants";

  // Crude fungi detection: many fungi classes end with -mycetes
  if (cls.endsWith("mycetes")) return "fungi";

  return null; // unknown group
}

function getAllInatSpeciesList() {
  const all = [];
  for (const list of Object.values(vocabByGroup)) {
    all.push(...list);
  }
  return all;
}

function getSpeciesDistractorPool(list, correctEntry, needed, scope) {
  // Start with all other species in the same broad group
  let basePool = list.filter((s) => s.taxonId !== correctEntry.taxonId);

  if (scope === "family") {
    const fam =
      correctEntry.familyName || correctEntry.familyScientificName || null;
    if (fam) {
      const famPool = basePool.filter(
        (s) =>
          (s.familyName || s.familyScientificName || null) === fam
      );
      if (famPool.length >= needed) {
        return famPool;
      }
      // not enough → downgrade to order
      scope = "order";
    } else {
      scope = "order";
    }
  }

  if (scope === "order") {
    const ord = correctEntry.orderScientificName || null;
    if (ord) {
      const ordPool = basePool.filter(
        (s) => s.orderScientificName === ord
      );
      if (ordPool.length >= needed) {
        return ordPool;
      }
    }
    // not enough or no order → fallback to broad group
  }

  // broad group fallback
  return basePool;
}

function getGenusDistractorPool(genusList, correctGenus, needed, scope) {
  let basePool = genusList.filter(
    (g) => g.genusName !== correctGenus.genusName
  );

  const rep = correctGenus.representative;
  if (!rep) return basePool;

  if (scope === "family") {
    const fam = rep.familyName || rep.familyScientificName || null;
    if (fam) {
      const famPool = basePool.filter((g) => {
        const r = g.representative;
        if (!r) return false;
        return (r.familyName || r.familyScientificName || null) === fam;
      });
      if (famPool.length >= needed) {
        return famPool;
      }
      scope = "order";
    } else {
      scope = "order";
    }
  }

  if (scope === "order") {
    const ord = rep.orderScientificName || null;
    if (ord) {
      const ordPool = basePool.filter((g) => {
        const r = g.representative;
        return r && r.orderScientificName === ord;
      });
      if (ordPool.length >= needed) {
        return ordPool;
      }
    }
  }

  return basePool;
}

function getFamilyDistractorPool(familyList, correctFamily, needed, scope) {
  let basePool = familyList.filter(
    (f) => f.familyName !== correctFamily.familyName
  );

  const rep = correctFamily.representative;
  if (!rep) return basePool;

  // "family" doesn't make sense here, treat it as "order"
  if (scope === "family") {
    scope = "order";
  }

  if (scope === "order") {
    const ord = rep.orderScientificName || null;
    if (ord) {
      const ordPool = basePool.filter((f) => {
        const r = f.representative;
        return r && r.orderScientificName === ord;
      });
      if (ordPool.length >= needed) {
        return ordPool;
      }
    }
    // Not enough or no order → broad group fallback
  }

  return basePool;
}

// ---------------- LOAD VOCAB ------------------------------------------

async function loadVocab() {
  const vocabConfig = CONFIG.VOCAB_SETS[currentVocabSet];
  const entries = Object.entries(vocabConfig);
  const result = {};

  for (const [groupKey, path] of entries) {
    try {
      const res = await fetch(path);
      if (!res.ok) {
        console.warn(
          `Failed to load vocab for ${groupKey} from ${path}: ${res.status}`
        );
        result[groupKey] = [];
        continue;
      }
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];

      const filtered = list.filter(
        (e) =>
          e.exampleObservation &&
          e.exampleObservation.photoUrl &&
          e.exampleObservation.obsId
      );

      result[groupKey] = filtered;
      console.log(
        `Loaded ${list.length} species for group "${groupKey}" from set "${currentVocabSet}", ` +
          `${filtered.length} with exampleObservation`
      );
    } catch (err) {
      console.warn(
        `Error loading vocab for ${groupKey} from ${path}`,
        err
      );
      result[groupKey] = [];
    }
  }

  vocabByGroup = result;
}


async function loadCourseVocab() {
  try {
    const res = await fetch("data/course_2025/course_2025_vocab.json");
    if (!res.ok) {
      console.warn(
        "Failed to load course vocab:",
        res.status,
        res.statusText
      );
      courseVocab = [];
      return;
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];

    const filtered = list.filter(
      (e) =>
        e.exampleObservation &&
        e.exampleObservation.photoUrl &&
        e.exampleObservation.obsId
    );

    courseVocab = filtered;
    console.log(
      `Loaded ${filtered.length} species from course project vocab`
    );
  } catch (err) {
    console.error("Error loading course vocab:", err);
    courseVocab = [];
  }
}



// Build genus-level derived vocab from species vocab
function buildGenusVocabFromSpecies() {
  const result = {};

  for (const [groupKey, speciesList] of Object.entries(vocabByGroup)) {
    const genusMap = new Map(); // genusName -> { genusName, swedishName, representative }

    for (const sp of speciesList) {
      const g = sp.genusName;
      if (!g) continue;

      if (!genusMap.has(g)) {
        genusMap.set(g, {
          genusName: g,
          swedishName: sp.swedishName || null, // borrow first species' Swedish name as hint
          representative: sp,                  // store species entry as representative for photos
        });
      }
    }

    const genera = Array.from(genusMap.values());
    result[groupKey] = genera;
    console.log(`Built ${genera.length} genera for group "${groupKey}"`);
  }

  genusVocabByGroup = result;
}
function buildFamilyVocabFromSpecies() {
  const result = {};

  for (const [groupKey, speciesList] of Object.entries(vocabByGroup)) {
    const familyMap = new Map(); // familyName -> { ... }

    for (const sp of speciesList) {
      const fam = sp.familyName;
      if (!fam) continue;

      const hasFamilySwe = !!sp.familySwedishName;

      const familySwe =
        sp.familySwedishName || sp.swedishName || null;

      if (!familyMap.has(fam)) {
        familyMap.set(fam, {
          familyName: fam,                  // Latin
          swedishName: familySwe,           // Either Swedish family or species name
          representative: sp,
          useExampleSpeciesName: !hasFamilySwe, // <---- NEW FLAG
        });
      }
    }

    const families = Array.from(familyMap.values());
    result[groupKey] = families;
    console.log(`Built ${families.length} families for group "${groupKey}"`);
  }

  familyVocabByGroup = result;
}



// ---------------- BUILD QUIZ: SPECIES LEVEL ---------------------------
// iNat
async function buildSpeciesQuizQuestionsFromVocab() {
  const neededDistractors = CONFIG.OPTIONS_PER_QUESTION - 1;
  const questions = [];

  const availableGroups = Object.entries(vocabByGroup).filter(
    ([, list]) => list && list.length > neededDistractors
  );

  console.log(
    "Available groups for species quiz:",
    availableGroups.map(([k, list]) => [k, list.length])
  );

  if (!availableGroups.length) {
    console.warn("No vocab groups with enough species to build questions.");
    return [];
  }

  let attempts = 0;
  const MAX_ATTEMPTS = 200;

  while (
    questions.length < CONFIG.QUESTIONS_COUNT &&
    attempts < MAX_ATTEMPTS
  ) {
    attempts++;

    const [groupKey, list] =
      availableGroups[Math.floor(Math.random() * availableGroups.length)];
    if (!list || list.length <= neededDistractors) continue;

    const correctEntry = list[Math.floor(Math.random() * list.length)];
    const ex = correctEntry.exampleObservation;
    if (!ex || !ex.photoUrl) {
      console.warn(
        "No exampleObservation for",
        correctEntry.scientificName,
        "– skipping."
      );
      continue;
    }

    let pool = getSpeciesDistractorPool(
        list,
        correctEntry,
        neededDistractors,
        distractorScope
        );
    if (pool.length < neededDistractors) continue;

    const distractorEntries = pickRandomSubset(pool, neededDistractors);

    const options = [
      {
        key: String(correctEntry.taxonId), // species: key = taxonId
        labelSci: correctEntry.scientificName,
        labelSwe: correctEntry.swedishName,
      },
      ...distractorEntries.map((d) => ({
        key: String(d.taxonId),
        labelSci: d.scientificName,
        labelSwe: d.swedishName,
      })),
    ];

    questions.push({
      correct: {
        answerKey: String(correctEntry.taxonId),
        labelSci: correctEntry.scientificName,
        labelSwe: correctEntry.swedishName,

        obsId: ex.obsId,
        photoUrl: ex.photoUrl,
        observer: ex.observer || "okänd",
        licenseCode: ex.licenseCode || null,
        obsUrl: ex.obsUrl || "#",
        groupKey,
      },
      options: shuffleArray(options),
    });
  }

  console.log(
    `Species quiz: built ${questions.length} questions after ${attempts} attempts`
  );
  return questions;
}
//Course project
async function buildSpeciesQuizQuestionsFromCourse() {
  const neededDistractors = CONFIG.OPTIONS_PER_QUESTION - 1;
  const questions = [];

  const usableCourseSpecies = courseVocab.filter(
    (e) =>
      e.exampleObservation &&
      e.exampleObservation.photoUrl &&
      e.exampleObservation.obsId
  );

  if (!usableCourseSpecies.length) {
    console.warn("No usable species in courseVocab.");
    return [];
  }

  const maxQuestions = Math.min(
    CONFIG.QUESTIONS_COUNT,
    usableCourseSpecies.length
  );

  // Make a shallow copy and shuffle
  const shuffled = [...usableCourseSpecies];
  shuffled.sort(() => Math.random() - 0.5);

  for (let i = 0; i < maxQuestions; i++) {
    const correctEntry = shuffled[i];

    // Determine group to pick distractors from in iNat vocab
    let groupKey = determineGroupKeyForSpecies(correctEntry);
    let inatList = [];

    if (groupKey && vocabByGroup[groupKey]?.length) {
      inatList = vocabByGroup[groupKey];
    } else {
      // fallback: all iNat species
      inatList = getAllInatSpeciesList();
      groupKey = "course"; // generic tag
    }

    const pool = getSpeciesDistractorPool(
      inatList,
      correctEntry,
      neededDistractors,
      distractorScope
    );

    if (pool.length < neededDistractors) {
      console.warn(
        "Not enough distractors for course species:",
        correctEntry.scientificName
      );
      continue;
    }

    const distractorEntries = pickRandomSubset(pool, neededDistractors);

    // Build options (= correct + distractors) with taxonId keys
    const options = [
      {
        key: String(correctEntry.taxonId),
        labelSci: correctEntry.scientificName,
        labelSwe: correctEntry.swedishName || null,
      },
      ...distractorEntries.map((e) => ({
        key: String(e.taxonId),
        labelSci: e.scientificName,
        labelSwe: e.swedishName || null,
      })),
    ];

    const ex = correctEntry.exampleObservation;

    questions.push({
      correct: {
        answerKey: String(correctEntry.taxonId),
        labelSci: correctEntry.scientificName,
        labelSwe: correctEntry.swedishName || null,

        obsId: ex.obsId,
        photoUrl: ex.photoUrl,
        observer: ex.observer || "okänd",
        licenseCode: ex.licenseCode || null,
        obsUrl: ex.obsUrl || "#",
        groupKey,
      },
      options: shuffleArray(options),
    });
  }

  console.log(
    `Course species quiz: built ${questions.length} questions (from ${usableCourseSpecies.length} course taxa)`
  );
  return questions;
}


// ---------------- BUILD QUIZ: GENUS LEVEL -----------------------------

async function buildGenusQuizQuestionsFromVocab() {
  const neededDistractors = CONFIG.OPTIONS_PER_QUESTION - 1;
  const questions = [];

  const availableGroups = Object.entries(genusVocabByGroup).filter(
    ([, list]) => list && list.length > neededDistractors
  );

  console.log(
    "Available groups for genus quiz:",
    availableGroups.map(([k, list]) => [k, list.length])
  );

  if (!availableGroups.length) {
    console.warn("No groups with enough genera to build genus-level questions.");
    return [];
  }

  let attempts = 0;
  const MAX_ATTEMPTS = 200;

  while (
    questions.length < CONFIG.QUESTIONS_COUNT &&
    attempts < MAX_ATTEMPTS
  ) {
    attempts++;

    const [groupKey, genusList] =
      availableGroups[Math.floor(Math.random() * availableGroups.length)];
    if (!genusList || genusList.length <= neededDistractors) continue;

    const correctGenus =
      genusList[Math.floor(Math.random() * genusList.length)];
    const repSpecies = correctGenus.representative;
    const ex = repSpecies.exampleObservation;
    if (!ex || !ex.photoUrl) {
      console.warn(
        "No exampleObservation for representative of genus",
        correctGenus.genusName,
        "– skipping."
      );
      continue;
    }

    let pool = getGenusDistractorPool(
        genusList,
        correctGenus,
        neededDistractors,
        distractorScope
    );
    if (pool.length < neededDistractors) continue;

    const distractorGenera = pickRandomSubset(pool, neededDistractors);


    const options = [
      {
        key: correctGenus.genusName, // genus: key = genusName
        labelSci: correctGenus.genusName,
        labelSwe: null,
      },
      ...distractorGenera.map((g) => ({
        key: g.genusName,
        labelSci: g.genusName,
        labelSwe: null,
      })),
    ];

    questions.push({
      correct: {
        answerKey: correctGenus.genusName,
        labelSci: correctGenus.genusName,
        labelSwe: correctGenus.swedishName,

        obsId: ex.obsId,
        photoUrl: ex.photoUrl,
        observer: ex.observer || "okänd",
        licenseCode: ex.licenseCode || null,
        obsUrl: ex.obsUrl || "#",
        groupKey,
      },
      options: shuffleArray(options),
    });
  }

  console.log(
    `Genus quiz: built ${questions.length} questions after ${attempts} attempts`
  );
  return questions;
}

// ---------------- BUILD QUIZ: FAMILY LEVEL ----------------------------

async function buildFamilyQuizQuestionsFromVocab() {
  const neededDistractors = CONFIG.OPTIONS_PER_QUESTION - 1;
  const questions = [];

  const availableGroups = Object.entries(familyVocabByGroup).filter(
    ([, list]) => list && list.length > neededDistractors
  );

  console.log(
    "Available groups for family quiz:",
    availableGroups.map(([k, list]) => [k, list.length])
  );

  if (!availableGroups.length) {
    console.warn(
      "No groups with enough families to build family-level questions."
    );
    return [];
  }

  let attempts = 0;
  const MAX_ATTEMPTS = 200;

  while (
    questions.length < CONFIG.QUESTIONS_COUNT &&
    attempts < MAX_ATTEMPTS
  ) {
    attempts++;

    const [groupKey, familyList] =
      availableGroups[Math.floor(Math.random() * availableGroups.length)];
    if (!familyList || familyList.length <= neededDistractors) continue;

    const correctFamily =
      familyList[Math.floor(Math.random() * familyList.length)];
    const repSpecies = correctFamily.representative;
    const ex = repSpecies.exampleObservation;
    if (!ex || !ex.photoUrl) {
      console.warn(
        "No exampleObservation for representative of family",
        correctFamily.familyName,
        "– skipping."
      );
      continue;
    }

    let pool = getFamilyDistractorPool(
        familyList,
        correctFamily,
        neededDistractors,
        distractorScope
    );
    if (pool.length < neededDistractors) continue;

    const distractorFamilies = pickRandomSubset(pool, neededDistractors);

    
const sweName = correctFamily.swedishName;
const formattedSwe =
  correctFamily.useExampleSpeciesName && sweName
    ? `t.ex. ${sweName}`
    : sweName;

const options = [
  {
    key: correctFamily.familyName,
    labelSci: correctFamily.familyName,
    labelSwe: formattedSwe,
  },
  ...distractorFamilies.map((f) => {
    const dswe = f.swedishName;
    const formatted =
      f.useExampleSpeciesName && dswe ? `t.ex. ${dswe}` : dswe;
    return {
      key: f.familyName,
      labelSci: f.familyName,
      labelSwe: formatted,
    };
  })
];


    questions.push({
      correct: {
        answerKey: correctFamily.familyName,
        labelSci: correctFamily.familyName,
        labelSwe: correctFamily.swedishName,

        obsId: ex.obsId,
        photoUrl: ex.photoUrl,
        observer: ex.observer || "okänd",
        licenseCode: ex.licenseCode || null,
        obsUrl: ex.obsUrl || "#",
        groupKey,
      },
      options: shuffleArray(options),
    });
  }

  console.log(
    `Family quiz: built ${questions.length} questions after ${attempts} attempts`
  );
  return questions;
}

// ---------------- REBUILD QUIZ FOR CURRENT LEVEL ----------------------

async function rebuildQuizForCurrentLevel() {
  currentIndex = 0;
  score = 0;

  let newQuestions = [];

  if (currentLevel === "species") {
    if (dataSource === "course") {
      statusEl.textContent =
        "Bygger frågor (hämtar observationer från kursprojektet)…";
      newQuestions = await buildSpeciesQuizQuestionsFromCourse();
    } else {
      statusEl.textContent =
        "Bygger frågor (hämtar bilder från iNaturalist)…";
      newQuestions = await buildSpeciesQuizQuestionsFromVocab();
    }
  } else if (currentLevel === "genus") {
    // For now, genus-level quiz always uses iNat vocab
    dataSource = "inat";
    if (dataSourceSelectEl) dataSourceSelectEl.value = "inat";
    statusEl.textContent =
      "Bygger frågor (släkte-nivå, iNaturalist-vokabulär)…";
    newQuestions = await buildGenusQuizQuestionsFromVocab();
  } else {
    // currentLevel === "family"
    dataSource = "inat";
    if (dataSourceSelectEl) dataSourceSelectEl.value = "inat";
    statusEl.textContent =
      "Bygger frågor (familj-nivå, iNaturalist-vokabulär)…";
    newQuestions = await buildFamilyQuizQuestionsFromVocab();
  }

  // Store questions in the state that renderQuestion() actually uses
  quizQuestions = newQuestions;

  if (!quizQuestions.length) {
    statusEl.textContent = "Kunde inte skapa några frågor.";
    questionContainerEl.classList.add("hidden");
    return;
  }

  statusEl.textContent = "";
  questionContainerEl.classList.remove("hidden");
  renderQuestion();
}



// ---------------- RENDERING -------------------------------------------

function renderQuestion() {
  const total = quizQuestions.length;
  if (!total) {
    statusEl.textContent =
      "Kunde inte skapa några frågor. Kontrollera JSON-filerna.";
    questionContainerEl.classList.add("hidden");
    nextBtn.classList.add("hidden");
    return;
  }

  if (currentIndex >= total) {
    renderFinished();
    return;
  }

  const { correct, options } = quizQuestions[currentIndex];

  statusEl.textContent = "";
  controlsEl && controlsEl.classList.remove("hidden");
  progressEl.textContent = `Fråga ${currentIndex + 1} av ${total}`;
  scoreEl.textContent = `Poäng: ${score} / ${total}`;

  // Grey out image while loading
  imageWrapperEl && imageWrapperEl.classList.add("loading-image");
  photoEl.onload = () => {
    imageWrapperEl && imageWrapperEl.classList.remove("loading-image");
  };

  photoEl.src = correct.photoUrl;
  photoEl.alt = "Observation photo";

  const licenseText = correct.licenseCode
    ? `License: ${String(correct.licenseCode).toUpperCase()}`
    : "License: okänd";

  attributionEl.innerHTML = `
    Foto: <a href="${correct.obsUrl}" target="_blank" rel="noopener">
      iNaturalist observation #${correct.obsId}
    </a> av <strong>${correct.observer}</strong>.
    <br />
    ${licenseText}
  `;


// Answers
answersEl.innerHTML = "";
options.forEach((opt) => {
  const btn = document.createElement("button");
  btn.className = "answer-btn";
  // Allow HTML so we can italicize scientific names
  btn.innerHTML = formatLabel(opt.labelSci, opt.labelSwe);
  btn.dataset.key = opt.key;
  btn.addEventListener("click", () => handleAnswerClick(btn, correct));
  answersEl.appendChild(btn);
});

nextBtn.classList.add("hidden");
questionContainerEl.classList.remove("hidden");
}

function handleAnswerClick(clickedBtn, correct) {
  const buttons = answersEl.querySelectorAll(".answer-btn");
  buttons.forEach((b) => {
    b.classList.add("disabled");
    b.disabled = true;
  });

  const chosenKey = clickedBtn.dataset.key;
  const correctKey = String(correct.answerKey);
  const isCorrect = chosenKey === correctKey;

  if (isCorrect) {
    clickedBtn.classList.add("correct");
    score += 1;
  } else {
    clickedBtn.classList.add("incorrect");
    buttons.forEach((b) => {
      if (b.dataset.key === correctKey) {
        b.classList.add("correct");
      }
    });
  }

  const label = formatLabel(correct.labelSci, correct.labelSwe);

  let levelWord = "art";
  if (currentLevel === "genus") levelWord = "släkte";
  else if (currentLevel === "family") levelWord = "familj";

  statusEl.innerHTML = `Korrekt ${levelWord}: ${label}`;

  nextBtn.classList.remove("hidden");
  scoreEl.textContent = `Poäng: ${score} / ${quizQuestions.length}`;
}

function renderFinished() {
  questionContainerEl.classList.add("hidden");
  nextBtn.classList.add("hidden");

  const total = quizQuestions.length;
  statusEl.innerHTML = `
    Quiz klart! Slutpoäng: <strong>${score} / ${total}</strong>.
  `;
  progressEl.textContent = "";
}

// ---------------- INIT & EVENTS ---------------------------------------
async function initQuiz() {
  statusEl.textContent = "Laddar vokabulär från JSON-filer…";

  try {
    // 1) Ladda både iNaturalist-vokabulär (basic/extended) + kursvokabulär
    //    Kräver att du har:
    //    - loadAllVocabAndDerived()  (laddar iNat + bygger genus/familj)
    //    - loadCourseVocab()         (laddar data/course_2025/...)
    //    - loadAllData() som kallar båda
    await loadAllData();

    // 2) Synka kontrollernas startvärden + koppla events

    // Nivå: art/släkte/familj
    if (levelSelectEl) {
      levelSelectEl.value = currentLevel;
      levelSelectEl.addEventListener("change", async () => {
        currentLevel = levelSelectEl.value || "species";

        // Kursläget är bara art-nivå i nuläget
        if (dataSource === "course" && currentLevel !== "species") {
          currentLevel = "species";
          levelSelectEl.value = "species";
        }

        await rebuildQuizForCurrentLevel();
      });
    }

    // Felalternativens släktskap (group / order / family)
    if (distractorScopeSelectEl) {
      distractorScopeSelectEl.value = distractorScope;
      distractorScopeSelectEl.addEventListener("change", async () => {
        distractorScope = distractorScopeSelectEl.value || "group";
        await rebuildQuizForCurrentLevel();
      });
    }

    // Grundlista / stor lista (påverkar bara iNat-delen)
    if (vocabSetSelectEl) {
      vocabSetSelectEl.value = currentVocabSet;
      vocabSetSelectEl.addEventListener("change", async () => {
        currentVocabSet = vocabSetSelectEl.value || "basic";
        statusEl.textContent = "Laddar ny vokabulär…";

        // Ladda om iNat-vokabulären (basic/extended) och bygg genus/familj igen
        await loadAllVocabAndDerived();

        // Om vi står i kursläge, låt kursvokabulären vara,
        // men se till att den är laddad om någon gång försvunnit.
        if (dataSource === "course" && !courseVocab.length) {
          await loadCourseVocab();
        }

        await rebuildQuizForCurrentLevel();
      });
    }

    // Källa: iNaturalist vs Kursprojekt
    if (dataSourceSelectEl) {
      dataSourceSelectEl.value = dataSource;
      dataSourceSelectEl.addEventListener("change", async () => {
        dataSource = dataSourceSelectEl.value || "inat";

        if (dataSource === "course") {  
          // Kursläget: tvinga art-nivå
          if (currentLevel !== "species") {
            currentLevel = "species";
            if (levelSelectEl) levelSelectEl.value = "species";
          }
          // Se till att kursvokabulären finns
          if (!courseVocab.length) {
            await loadCourseVocab();
          }
        }

        await rebuildQuizForCurrentLevel();
      });
    }

    // 3) Bygg första uppsättningen frågor
    await rebuildQuizForCurrentLevel();
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Fel vid laddning av data. Se konsolen för detaljer.";
  }
}

nextBtn.addEventListener("click", () => {
  imageWrapperEl && imageWrapperEl.classList.add("loading-image");
  currentIndex += 1;
  renderQuestion();
});


// Start the quiz
initQuiz();
