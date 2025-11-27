// =====================================================================
// Minimal faunistics quiz: species-level, vocab-only
// Images & attribution are pre-baked in the vocab JSON (exampleObservation).
// =====================================================================

// ---------------- CONFIG ----------------------------------------------
const CONFIG = {
  QUESTIONS_COUNT: 10,
  OPTIONS_PER_QUESTION: 4,

  // Vocab files (species-level), one per broad group
  VOCAB_FILES: {
    insects: "data/insects_vocab_sweden.json",
    plants: "data/plants_vocab_sweden.json",
    mosses: "data/mosses_vocab_sweden.json",
    lichens: "data/lichens_vocab_sweden.json",
    mammals: "data/mammals_vocab_sweden.json",
    birds: "data/birds_vocab_sweden.json",
    fungi: "data/fungi_vocab_sweden.json",
    spiders: "data/spiders_vocab_sweden.json",
  },
};

// ---------------- STATE -----------------------------------------------
let vocabByGroup = {}; // { groupKey: [vocabEntry, ...] }
let quizQuestions = []; // [{ correct, options }]
let currentIndex = 0;
let score = 0;

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

// ---------------- HELPERS ---------------------------------------------

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

function formatSpeciesLabel(scientificName, swedishName) {
  return swedishName ? `${scientificName} (${swedishName})` : scientificName;
}

// ---------------- LOAD VOCAB ------------------------------------------

async function loadVocab() {
  const entries = Object.entries(CONFIG.VOCAB_FILES);
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
      // Keep only entries that actually have an exampleObservation with photoUrl
      const filtered = list.filter(
        (e) =>
          e.exampleObservation &&
          e.exampleObservation.photoUrl &&
          e.exampleObservation.obsId
      );
      result[groupKey] = filtered;
      console.log(
        `Loaded ${list.length} species for group "${groupKey}", ` +
          `${filtered.length} with exampleObservation`
      );
    } catch (err) {
      console.warn(`Error loading vocab for ${groupKey} from ${path}`, err);
      result[groupKey] = [];
    }
  }

  vocabByGroup = result;
}

// ---------------- BUILD QUIZ (SPECIES FROM VOCAB) ---------------------

async function buildSpeciesQuizQuestionsFromVocab() {
  const neededDistractors = CONFIG.OPTIONS_PER_QUESTION - 1;
  const questions = [];

  // Groups that have enough species (with exampleObservation) to build questions
  const availableGroups = Object.entries(vocabByGroup).filter(
    ([, list]) => list && list.length > neededDistractors
  );

  console.log(
    "Available groups for vocab quiz:",
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

    // Pick a correct species from that group
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

    // Build distractors: other species from the same group
    const pool = list.filter((s) => s.taxonId !== correctEntry.taxonId);
    if (pool.length < neededDistractors) continue;

    const distractorEntries = pickRandomSubset(pool, neededDistractors);

    const options = [
      {
        taxonId: correctEntry.taxonId,
        scientificName: correctEntry.scientificName,
        swedishName: correctEntry.swedishName,
      },
      ...distractorEntries.map((d) => ({
        taxonId: d.taxonId,
        scientificName: d.scientificName,
        swedishName: d.swedishName,
      })),
    ];

    questions.push({
      correct: {
        // Use vocab for naming + exampleObservation for image/attribution
        obsId: ex.obsId,
        taxonId: correctEntry.taxonId,
        photoUrl: ex.photoUrl,
        scientificName: correctEntry.scientificName,
        swedishName: correctEntry.swedishName,
        observer: ex.observer || "okänd",
        licenseCode: ex.licenseCode || null,
        obsUrl: ex.obsUrl || "#",
        groupKey,
      },
      options: shuffleArray(options),
    });
  }

  console.log(
    `Finished building questions: ${questions.length} questions after ${attempts} attempts`
  );
  return questions;
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
    btn.textContent = formatSpeciesLabel(
      opt.scientificName,
      opt.swedishName
    );
    btn.dataset.taxonId = String(opt.taxonId);
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

  const chosenTaxonId = clickedBtn.dataset.taxonId;
  const correctTaxonId = String(correct.taxonId);
  const isCorrect = chosenTaxonId === correctTaxonId;

  if (isCorrect) {
    clickedBtn.classList.add("correct");
    score += 1;
  } else {
    clickedBtn.classList.add("incorrect");
    buttons.forEach((b) => {
      if (b.dataset.taxonId === correctTaxonId) {
        b.classList.add("correct");
      }
    });
  }

  const label = formatSpeciesLabel(
    correct.scientificName,
    correct.swedishName
  );
  statusEl.textContent = `Korrekt art: ${label}`;

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
    await loadVocab();

    statusEl.textContent = "Bygger frågor från vokabulären…";
    quizQuestions = await buildSpeciesQuizQuestionsFromVocab();
    currentIndex = 0;
    score = 0;

    if (!quizQuestions.length) {
      statusEl.textContent =
        "Kunde inte skapa några frågor. Kontrollera JSON-filerna.";
      return;
    }

    renderQuestion();
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
