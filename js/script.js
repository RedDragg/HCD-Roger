
const panel = document.getElementById('annotationsPanel');
const popup = document.getElementById('annotationPopup');
const input = document.getElementById('annotationInput');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const colorPicker = document.getElementById('colorPicker');
const themeToggle = document.getElementById('themeToggle');
const positionToggle = document.getElementById('menuPositionToggle');
const slider = document.getElementById('speedSlider');
const speedValueText = document.getElementById('speedValue');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValueText = document.getElementById('volumeValue');

let currentSpan = null;
let currentNote = "";
let annotationElements = [];
let inAnnotationMode = false;
let currentAnnotationIndex = 0;
let popupOpen = false;
let currentUtterance = null;
let speechRate = 0.9;
let speechVolume = 1.0;
let rateDebounceTimeout = null;
let volumeDebounceTimeout = null;
let isSelecting = false;
let selectionStartIndex = null;
let selectionEndIndex = null;
let selectionBaseSpan = null;
let selectionWords = [];
let lastSpokenWordIndex = 0;
let lastSpokenWordIndexPerSpan = {}; // nieuw!
let tabPressed = false;


// ✅ Load saved theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') document.body.classList.add('light');

// ✅ Load saved menu position
const savedPosition = localStorage.getItem('menuPosition');
if (savedPosition === 'right') document.body.classList.add('menu-right');

// ✅ Load saved speechRate
const storedRate = localStorage.getItem('speechRate');
if (storedRate) {
  speechRate = parseFloat(storedRate);
  slider.value = speechRate;
  speedValueText.textContent = `Current: ${speechRate.toFixed(1)}x`;
  slider.setAttribute('aria-valuenow', speechRate.toFixed(1));
  slider.setAttribute('aria-valuetext', `Speed: ${speechRate.toFixed(1)}`);
}


function wrapWordsPreservingDivs(element) {
  if (element.hasAttribute('data-wrapped')) return;
  element.setAttribute('data-wrapped', 'true');

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  const toReplace = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;

    // ✅ Skip lege tekst
    if (!node.nodeValue.trim()) continue;

    const parent = node.parentElement;

    // ✅ Skip als dit binnen een handgemaakte annotatie valt
    // Bijvoorbeeld: <span id="s-...">...</span>
    if (
      parent.closest('[id^="s-"]') ||           // jouw annotatie ID's
      parent.classList.contains('annotated') || // handmatig gemarkeerd
      parent.classList.contains('selection-preview') || // tijdelijk selectiestukje
      parent.classList.contains('word')         // al gewrapt
    ) {
      continue;
    }

    toReplace.push(node);
  }

  toReplace.forEach(textNode => {
    const words = textNode.nodeValue.trim().split(/\s+/);
    const spanWords = words.map((word, i) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.setAttribute('data-index', i);
      span.setAttribute('id', `word-${Date.now()}-${i}`); // Voeg een uniek ID toe voor elk woord
      span.textContent = word;
      return span;
    });

    const fragment = document.createDocumentFragment();
    spanWords.forEach((span, idx) => {
      fragment.appendChild(span);
      if (idx < spanWords.length - 1) {
        fragment.appendChild(document.createTextNode(' '));
      }
    });

    textNode.parentNode.replaceChild(fragment, textNode);
  });

}



function speakText(text, spanElement = null) {
  stopSpeaking();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-GB';
  utterance.rate = speechRate;
  utterance.volume = speechVolume;

  if (selectedVoice) utterance.voice = selectedVoice;

  if (!spanElement) {
    speechSynthesis.speak(utterance);
    return;
  }

  // ✅ Zorg dat woorden gewrapt zijn
  wrapWordsPreservingDivs(spanElement);

  // ✅ Nu pas ophalen
  const wordSpans = spanElement.querySelectorAll(".word");

  // ✅ Veiligheidscheck
  if (wordSpans.length === 0) {
    console.warn("⚠️ Geen .word-spans gevonden binnen:", spanElement);
  }

  // ✅ Voor speechSynthesis: volledige platte tekst
  const plainText = spanElement.innerText.trim();
  const words = plainText.split(/\s+/);

  // ✅ Bereken character-offsets per woord
  const wordOffsets = [];
  let total = 0;
  for (let word of words) {
    wordOffsets.push(total);
    total += word.length + 1; // +1 voor spatie
  }

  utterance.text = plainText;

  // ✅ Highlight per woord tijdens voorlezen
  utterance.onboundary = function (event) {
    if (event.name !== "word") return;

    const charIndex = event.charIndex;
    let idx = 0;
    for (let i = 0; i < wordOffsets.length; i++) {
      if (charIndex < wordOffsets[i] + words[i].length) {
        idx = i;
        break;
      }
    }

    if (spanElement && spanElement.id) {
      lastSpokenWordIndexPerSpan[spanElement.id] = idx;
    }

    wordSpans.forEach(w => w.classList.remove("highlighted-word"));
    const current = spanElement.querySelector(`.word[data-index="${idx}"]`);
    if (current) current.classList.add("highlighted-word");
  };

  utterance.onend = () => {
    wordSpans.forEach(w => w.classList.remove("highlighted-word"));
    currentUtterance = null;
  };

  currentUtterance = utterance;
  speechSynthesis.speak(utterance);
}



function stopSpeaking() {
  window.speechSynthesis.cancel();
  currentUtterance = null;
}

function announceRate() {
  const rate = speechRate.toFixed(1).replace('.', ' point ');
  const message = `Speed: ${rate}`;
  const rateUtterance = new SpeechSynthesisUtterance(message);
  rateUtterance.lang = 'en-GB';
  rateUtterance.rate = speechRate;
  window.speechSynthesis.speak(rateUtterance);
}

if (slider && speedValueText) {

  slider.addEventListener('input', () => {
    speechRate = parseFloat(slider.value);
    localStorage.setItem('speechRate', speechRate.toFixed(1));
    slider.setAttribute('aria-valuenow', speechRate.toFixed(1));
    slider.setAttribute('aria-valuetext', `Speed: ${speechRate.toFixed(1)}`);
    speedValueText.textContent = `Current: ${speechRate.toFixed(1)}x`;

    clearTimeout(rateDebounceTimeout);
    rateDebounceTimeout = setTimeout(() => {
      const feedback = new SpeechSynthesisUtterance(`Speed: ${speechRate.toFixed(1)}`);
      feedback.lang = 'en-GB';
      feedback.rate = speechRate;
      feedback.volume = speechVolume;
      window.speechSynthesis.speak(feedback);
    }, 300); // wacht 300ms na laatste input
  });
}

themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('light');
  const mode = document.body.classList.contains('light') ? 'Light modus' : 'Dark modus';
  localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
  speakText(`${mode} activated`);
});

positionToggle.addEventListener('click', () => {
  document.body.classList.toggle('menu-right');
  const pos = document.body.classList.contains('menu-right') ? 'Right' : 'Left';
  localStorage.setItem('menuPosition', document.body.classList.contains('menu-right') ? 'right' : 'left');
  speakText(`Annotation menu location to ${pos}`);
});

// ✅ Annotatiesysteem
function closePopup() {
  popup.style.display = 'none';
  popupOpen = false;
  isInPopup = true;
  input.value = '';
  input.style.display = 'block';
  saveBtn.style.display = 'inline-block';
  colorPicker.style.display = 'none';
  cancelBtn.style.display = 'inline-block';
  currentNote = '';
  currentSpan = null;
  updateTabbables();
}

function selectColor(option) {
  const color = option.getAttribute('data-color');
  if (currentSpan && currentNote) {
    const id = currentSpan.id;
    // Sla de annotatie en kleur op in localStorage
    localStorage.setItem(`note-${id}`, currentNote);
    localStorage.setItem(`color-${id}`, color);
    currentSpan.classList.add('annotated');
    currentSpan.style.backgroundColor = color;
    closePopup();
    speakText("Annotation saved");
    updateAnnotationsPanel(); // Werk het annotatiepaneel bij
  }
}

// ✅ Verwijder de annotatie bij het klikken op de verwijderknop
function updateAnnotationsPanel() {
  const panel = document.getElementById('annotationsPanel');
  panel.innerHTML = '<h2>Annotaties</h2>'; // Clear existing content
  annotationElements = []; // Reset the annotation elements array

  // Loop door alle opgeslagen annotaties in localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith("note-")) {  // Controleer of de sleutel gerelateerd is aan annotaties
      const spanId = key.replace("note-", ""); // Haal het span ID op uit de sleutel
      const note = localStorage.getItem(key); // Haal de annotatie tekst op
      const color = localStorage.getItem("color-" + spanId); // Haal de kleur van de annotatie op

      // Voeg de tekst weer toe aan de oorspronkelijke span
      const span = document.getElementById(spanId);
      if (span) {
        span.classList.add('annotated');
        span.style.backgroundColor = color || '#ffea00'; // De kleur voor de annotatie
      }

      // Maak een nieuw div-element voor de annotatie
      const item = document.createElement('div');
      item.className = 'annotation-item';
      item.style.backgroundColor = color || ''; // Stel de achtergrondkleur van de annotatie in
      item.dataset.ref = spanId; // Verbind de annotatie met het span ID
      item.setAttribute('tabindex', '0'); // Maak de annotatie focusable

      // Maak het tekst-div-element dat de annotatietekst toont
      const text = document.createElement('div');
      text.textContent = note;
      text.addEventListener('click', () => {
        document.getElementById(spanId).scrollIntoView({ behavior: 'smooth', block: 'center' });
        speakText("Annotation opened");
      });

      // Voeg de tekst toe aan het annotatie-item
      item.appendChild(text);

      // Voeg een event listener toe voor het verwijderen van de annotatie
      item.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'x') {
          e.preventDefault(); // Voorkom standaard gedraging van de 'X' toets

          // Laat de screen reader de boodschap "Deleting annotation" zeggen
          speakText("Deleting annotation");

          // Vraag om bevestiging voor het verwijderen van de annotatie
          const confirmDelete = confirm("Weet je zeker dat je deze annotatie wilt verwijderen?");
          if (confirmDelete) {
            deleteAnnotation(spanId); // Verwijder de annotatie en de bijbehorende selectie uit localStorage
          }
        }
      });

      // Voeg het annotatie-item toe aan het paneel
      panel.appendChild(item);

      // Voeg de annotatie toe aan de navigatielijst
      annotationElements.push(item);
    }
  }
}

function deleteAnnotation(spanId) {
  // Verwijder de opgeslagen annotatie uit localStorage
  localStorage.removeItem(spanId);

  // Verwijder het span-element uit de DOM
  const spanToDelete = document.getElementById(spanId);
  if (spanToDelete) {
    spanToDelete.remove();
  }
}



// ✅ Event listeners op tekst-spans

document.querySelectorAll('.text-content p').forEach(span => {

  span.setAttribute('tabindex', '0');
  span.classList.add('text-focusable');


  span.addEventListener('focus', () => {
    const text = span.textContent.trim();
    document.querySelectorAll('.highlighted-word').forEach(el => el.classList.remove('highlighted-word'));
    speakText(text, span);
  });


  span.addEventListener('blur', () => {
    stopSpeaking();

    const hasManualSpan = span.querySelector('[id^="s-"]'); // check op handgemaakte annotatie

    if (hasManualSpan) return; // 🚫 blijf af als er een annotatie-span in zit

    if (span.hasAttribute('data-wrapped')) {
      span.innerHTML = span.textContent;
      span.removeAttribute('data-wrapped');
    }
  });



  span.addEventListener('click', () => speakText(span.textContent));

  document.addEventListener('click', (e) => {
    const insideText = e.target.closest('.text-content p');

    if (!insideText) stopSpeaking();
  });

  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (!isSelecting) {
        // ✅ Eerste keer Enter: selectie starten
        isSelecting = true;
        toggleGlobalTabbing(true);
        selectionBaseSpan = span;
        selectionWords = span.innerText.trim().split(/\s+/);
        const lastIndex = lastSpokenWordIndexPerSpan[span.id] ?? (selectionWords.length - 1);
        selectionStartIndex = lastIndex;
        selectionEndIndex = lastIndex;

        renderSelection();
        speakText("Selection started. Use arrow keys to expand or shrink. Press Enter again to annotate.");
        e.preventDefault();
        return;
      } else {
        // ✅ Tweede keer Enter: selectie bevestigen & annotatie starten
        isSelecting = false;
        toggleGlobalTabbing(false);

        const selectedWords = selectionWords.slice(selectionStartIndex, selectionEndIndex + 1).join(" ");
        const newSpanId = `s-${Date.now()}`;

        // ✨ Zet elk woord in een <span class="word" data-index="...">
        const rebuilt = selectionWords.map((word, i) => {
          const span = `<span class="word" data-index="${i}">${word}</span>`;
          if (i === selectionStartIndex) return `<span id="${newSpanId}" tabindex="0">${span}`;
          else if (i === selectionEndIndex) return `${span}</span>`;
          else return span;
        }).join(" ");

        // ✨ Fix: verwijder 'data-wrapped', zodat wrapWordsPreservingDivs weer werkt
        selectionBaseSpan.removeAttribute('data-wrapped');
        selectionBaseSpan.innerHTML = rebuilt;

        // Setup nieuwe annotatie-span
        const newSpan = document.getElementById(newSpanId);
        newSpan.setAttribute('tabindex', '0');
        currentSpan = newSpan;

        // Reset selectie
        selectionBaseSpan = null;
        selectionWords = [];
        selectionStartIndex = null;
        selectionEndIndex = null;

        // Toon popup
        popup.style.display = 'block';
        popupOpen = true;
        input.value = '';
        input.focus();
        speakText("Add annotation");

        // Focus trap in popup
        const focusables = [input, saveBtn, cancelBtn];
        let trapIndex = 0;
        popup.addEventListener('keydown', function focusTrap(e) {
          if (e.key === 'Tab') {
            e.preventDefault();
            trapIndex = (trapIndex + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
            focusables[trapIndex].focus();
          }
        });

        e.preventDefault();
        return;
      }
    }



    // Later hier: pijltjes en tweede Enter afhandelen
    if (isSelecting) {
      const words = selectionBaseSpan.innerText.trim().split(/\s+/);
      const maxIndex = words.length - 1;

      if (e.key === 'ArrowRight' && !e.shiftKey) {
        // ➡️ Rechts uitbreiden
        if (selectionEndIndex < maxIndex) {
          selectionEndIndex++;
          renderSelection();
        }
        e.preventDefault();
      }

      if (e.key === 'ArrowLeft' && !e.shiftKey) {
        // ⬅️ Links uitbreiden
        if (selectionStartIndex > 0) {
          selectionStartIndex--;
          renderSelection();
        }
        e.preventDefault();
      }

      if (e.key === 'ArrowRight' && e.shiftKey) {
        // ➖ Rechts woord verwijderen
        if (selectionEndIndex > selectionStartIndex) {
          selectionEndIndex--;
          renderSelection();
        }
        e.preventDefault();
      }

      if (e.key === 'ArrowLeft' && e.shiftKey) {
        // ➖ Links woord verwijderen
        if (selectionStartIndex < selectionEndIndex) {
          selectionStartIndex++;
          renderSelection();
        }
        e.preventDefault();
      }

      if (e.key === 'Enter') {
        // ✅ Klaar met selecteren → spring naar annotatie popup
        isSelecting = false;

        // Haal geselecteerde tekst op
        const words = selectionBaseSpan.innerText.trim().split(/\s+/);
        const selectedWords = words.slice(selectionStartIndex, selectionEndIndex + 1).join(" ");

        // Maak een nieuwe span met unieke id
        const newSpanId = `s-${Date.now()}`;
        const fullWords = words.map((word, i) => {
          if (i === selectionStartIndex) {
            return `<span id="${newSpanId}">${word}`;
          } else if (i === selectionEndIndex) {
            return `${word}</span>`;
          } else if (i > selectionStartIndex && i < selectionEndIndex) {
            return word;
          } else {
            return word;
          }
        }).join(" ");

        // Zet de nieuwe inhoud
        selectionBaseSpan.innerHTML = fullWords;

        // Herhaal setup voor nieuwe span
        const newSpan = document.getElementById(newSpanId);
        newSpan.setAttribute('tabindex', '0');
        newSpan.classList.add('annotated');
        currentSpan = newSpan;

        // Herstel selectie-variabelen
        selectionBaseSpan = null;
        selectionStartIndex = null;
        selectionEndIndex = null;

        // Popup openen (zoals bestaande Enter doet)
        popup.style.display = 'block';
        popupOpen = true;
        input.value = '';
        input.focus();
        speakText("Add annotation");

        // Focus trap voorbereiden
        const focusables = [input, saveBtn, cancelBtn];
        let trapIndex = 0;
        popup.addEventListener('keydown', function focusTrap(e) {
          if (e.key === 'Tab') {
            e.preventDefault();
            trapIndex = (trapIndex + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
            focusables[trapIndex].focus();
          }
        });

        e.preventDefault(); // blokkeer enter doorsturen
      }
    }

  });


});

function trapColorFocus(e) {
  const colorOptions = popup.querySelectorAll('.color-option');
  const first = colorOptions[0];
  const last = colorOptions[colorOptions.length - 1];

  if (e.key === 'Tab') {
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
saveBtn.addEventListener('click', () => {
  if (input.value.trim() !== "") {
    currentNote = input.value.trim();
    input.style.display = 'none';
    saveBtn.style.display = 'none';
    colorPicker.style.display = 'block';
    cancelBtn.style.display = 'none';

    // Spreek eerst de boodschap uit: Kies een kleur voor de annotatie
    speakText("Choose a color for the annotation");

    // Wacht even voordat we de focus naar de kleurkiezer verplaatsen
    setTimeout(() => {
      const colorOptions = popup.querySelectorAll('.color-option');
      if (colorOptions.length === 0) return;

      let trapIndex = 0;
      colorOptions.forEach((opt, i) => {
        if (opt === document.activeElement) trapIndex = i;
      });

      // Focus op de eerste kleurkiezeroptie
      colorOptions[0].focus();

      // Voeg een event listener toe voor het vastleggen van tab- en shift-tab-bewegingen
      popup.addEventListener('keydown', trapColorKeys);

      function trapColorKeys(e) {
        const active = document.activeElement;
        const isColorFocused = Array.from(colorOptions).includes(active);

        if (e.key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) {
            trapIndex = (trapIndex - 1 + colorOptions.length) % colorOptions.length;
          } else {
            trapIndex = (trapIndex + 1) % colorOptions.length;
          }
          colorOptions[trapIndex].focus();
        }
      }
    }, 300); // Hier 300ms vertraging voordat de focus naar de kleurkiezer gaat

    // Na de focus, spreek de boodschap uit voor de kleurkiezer
    setTimeout(() => {
      speakText("Pick a color for your annotation");
    }, 350); // Wacht nog iets langer om de focusovergang goed te laten gebeuren
  }
});




cancelBtn.addEventListener('click', () => {
  closePopup();
  speakText("Annotation canceled");
});

// 🎧 Spreek knoptekst uit bij focus (zowel voor toevoegen als aanpassen)
saveBtn.addEventListener('focus', () => {
  speakText("Save annotation");
});

saveBtn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    // Spreek de boodschap uit wanneer de opslaan knop wordt ingedrukt.
    speakText("Saving annotation");

    // Hier kunnen we de annotatie opslaan of verder gaan met de opslaan logica
  }
});


cancelBtn.addEventListener('focus', () => {
  speakText("Cancel");
});


const colorOptions = document.querySelectorAll('.color-option');
colorOptions.forEach((option, index) => {
  option.addEventListener('click', () => selectColor(option));
  option.addEventListener('focus', () => speakText(option.getAttribute('data-label') || 'Kleur'));
  option.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = colorOptions[index + 1] || colorOptions[0];
      next.focus();
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = colorOptions[index - 1] || colorOptions[colorOptions.length - 1];
      prev.focus();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      selectColor(option);
    }
  });
});

input.addEventListener('keydown', (e) => {
  if (e.key === "Shift" && e.shiftKey && input.value.trim() !== "") speakText(input.value);
  if (e.key === 'Escape') {
    closePopup();
    speakText("Annotation canceled");
  }
});

// Event listener voor 'keydown'
document.addEventListener('keydown', (e) => {
  const activeEl = document.activeElement;
  const isTyping = activeEl === input || popupOpen;  // Controleer of we in de annotatiepopup aan het typen zijn

  // 🚀 Spatiebalk: Focus verplaatsen naar de bijbehorende span met de geannoteerde tekst
  if (e.key === 'z' && activeEl.classList.contains('annotation-item')) {
    e.preventDefault(); // Voorkom standaard spatiegedrag

    const spanId = activeEl.dataset.ref; // Haal het bijbehorende span-id op uit de annotatie
    const spanToFocus = document.getElementById(spanId); // Vind de span die bij de annotatie hoort

    // Verplaats de focus naar de bijbehorende span
    if (spanToFocus) {
      spanToFocus.focus(); // Focus op de span met het juiste ID
      speakText(spanToFocus.textContent.trim()); // Laat de screen reader de tekst lezen
    }
  }

  // 📚 Alleen tabben door de tekstcontainer als we niet in de annotaties zijn
  if (e.key === 'Tab' && activeEl.closest('.text-content') && !activeEl.closest('.annotations-panel')) {
    e.preventDefault(); // Voorkom standaard tab-functie

    const focusables = document.querySelectorAll('.text-content p');
    let currentIndex = Array.from(focusables).indexOf(activeEl);

    // Zorg ervoor dat de index correct wordt aangepast zonder dubbele stappen
    if (e.shiftKey) {
      // Shift-tab naar vorige
      currentIndex = (currentIndex - 1 + focusables.length) % focusables.length;
    } else {
      // Normale tab naar volgende
      currentIndex = (currentIndex + 1) % focusables.length;
    }

    // Focus naar de berekende index (1 stap vooruit, 1 stap achteruit)
    focusables[currentIndex].focus();
  }

  // Als de popup open is of we in de tekstinvoer staan, blokkeren we de a-toets niet
  if (isTyping && e.key === 'a') {
    // Als de focus in de input staat, laat de 'a' toets toe
    return;
  }

  // 🔁 Alleen tabben door annotaties met de 'a' toets (volgende annotatie)
  if (e.key.toLowerCase() === 'a' && !isTyping) { // Normale 'a' (volgende annotatie)
    e.preventDefault();
    if (annotationElements.length > 0) {
      const currentFocus = document.activeElement;
      let currentIndex = annotationElements.indexOf(currentFocus);

      // Als er geen focus is, begin dan vanaf de eerste annotatie
      if (currentIndex === -1) {
        currentIndex = 0;
      } else {
        currentIndex = (currentIndex + 1) % annotationElements.length;
      }

      // Focus naar de geselecteerde annotatie
      const nextAnnotation = annotationElements[currentIndex];
      nextAnnotation.focus();

      // Lees de tekst van de annotatie voor, als deze gefocust is
      speakText(nextAnnotation.textContent.trim());
    }
  }

  if (e.key.toLowerCase() === 'a' && e.shiftKey) { // Shift + A (vorige annotatie)
    e.preventDefault();
    if (annotationElements.length > 0) {
      const currentFocus = document.activeElement;
      let currentIndex = annotationElements.indexOf(currentFocus);

      // Als er geen focus is, begin dan vanaf de laatste annotatie
      if (currentIndex === -1) {
        currentIndex = annotationElements.length - 1;
      } else {
        currentIndex = (currentIndex - 1 + annotationElements.length) % annotationElements.length;
      }

      // Focus naar de geselecteerde annotatie
      const previousAnnotation = annotationElements[currentIndex];
      previousAnnotation.focus();

      // Lees de tekst van de annotatie voor, als deze gefocust is
      speakText(previousAnnotation.textContent.trim());
    }
  }

  // 🧭 Als we in de annotaties zijn en Tab indrukken, focus dan direct terug naar de tekstcontainer
  if (e.key === 'Tab' && activeEl.closest('.annotations-panel')) {
    e.preventDefault(); // Voorkom standaard tab-functie
    const firstTextElement = document.querySelector('.text-content p');
    if (firstTextElement) {
      firstTextElement.focus(); // Focus direct op de tekstcontainer
    }
  }

// Handle Shift + Q combination
if (e.key.toLowerCase() === 'q' && e.shiftKey) {
    e.preventDefault(); // Prevent default tab behavior
    const headers = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));

    if (document.activeElement === document.body || !document.activeElement) {
        headers[0]?.focus(); // Focus on the first header
        e.preventDefault();
    } else {
        const activeIndex = headers.indexOf(document.activeElement);
        const nextHeader = (activeIndex + 1) % headers.length;
        headers[nextHeader].focus(); // Move focus to the next header
        e.preventDefault();
    }
}

});


function focusCurrentAnnotation() {
  if (annotationElements.length > 0) {
    annotationElements[currentAnnotationIndex].focus();
  }
}

const storedVolume = localStorage.getItem('speechVolume');
if (storedVolume) {
  speechVolume = parseFloat(storedVolume);
  volumeSlider.value = speechVolume;
  volumeValueText.textContent = `Current: ${speechVolume.toFixed(1)}`;
}

if (volumeSlider && volumeValueText) {
  volumeSlider.addEventListener('input', () => {
    speechVolume = parseFloat(volumeSlider.value);
    localStorage.setItem('speechVolume', speechVolume.toFixed(1));
    volumeValueText.textContent = `Current: ${speechVolume.toFixed(1)}`;

    clearTimeout(volumeDebounceTimeout);
    volumeDebounceTimeout = setTimeout(() => {
      const feedback = new SpeechSynthesisUtterance(`Volume: ${speechVolume.toFixed(1)}`);
      feedback.lang = 'en-GB';
      feedback.rate = speechRate;
      feedback.volume = speechVolume;
      window.speechSynthesis.speak(feedback);
    }, 300); // wacht 300ms na laatste input
  });
}

const settingsPanel = document.getElementById('settingsPanel');
let settingsOpen = false;

document.addEventListener('keydown', (e) => {
  const activeElement = document.activeElement;
  const isTyping = activeElement === input || popupOpen;

  function updateTabFocus() {
    const isMenuOpen = settingsPanel.classList.contains('open');
    const textFocusables = document.querySelectorAll('.text-focusable');
    const menuFocusables = settingsPanel.querySelectorAll('button, input');

    textFocusables.forEach(el => {
      el.setAttribute('tabindex', isMenuOpen ? '-1' : '0');
    });

    menuFocusables.forEach(el => {
      el.setAttribute('tabindex', isMenuOpen ? '0' : '-1');
    });
  }

  if (e.key.toLowerCase() === 'j' && !isTyping) {
    e.preventDefault();
    settingsOpen = !settingsOpen;

    settingsPanel.classList.toggle('open', settingsOpen);
    updateTabbables();
    updateTabFocus();
    if (settingsOpen) {
      const first = settingsPanel.querySelector('button, input');
      first && first.focus();
      speakText("Settings menu opened");
    } else {
      speakText("Settings menu closed");
    }
  }

});



// ✅ Focus trap binnen het instellingenmenu
settingsPanel.addEventListener('keydown', function (e) {
  if (!settingsOpen) return;
  const focusable = settingsPanel.querySelectorAll('button, input');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.key === 'Tab') {
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

const settingsFocusable = settingsPanel.querySelectorAll('button, input[type="range"]');

settingsFocusable.forEach(element => {
  element.addEventListener('focus', () => {
    let label = element.getAttribute('aria-label') || element.innerText || element.id;

    // Voor sliders kun je ook de current value zeggen:
    if (element.type === 'range') {
      label += `, current value ${parseFloat(element.value).toFixed(1)}`;
    }

    speakText(label);
  });
});

const textContainer = document.querySelector('.text-content');

// 🔠 Font size
const fontSizeSlider = document.getElementById('fontSizeSlider');
const fontSizeValue = document.getElementById('fontSizeValue');
fontSizeSlider.addEventListener('input', () => {
  const size = `${fontSizeSlider.value}px`;
  textContainer.style.fontSize = size;
  fontSizeValue.textContent = `Current: ${size}`;
  speakText(`Font size ${fontSizeSlider.value} pixels`);
});

// 🅱️ Font weight
const fontWeightSlider = document.getElementById('fontWeightSlider');
const fontWeightValue = document.getElementById('fontWeightValue');
fontWeightSlider.addEventListener('input', () => {
  textContainer.style.fontWeight = fontWeightSlider.value;
  fontWeightValue.textContent = `Current: ${fontWeightSlider.value}`;
  speakText(`Font weight ${fontWeightSlider.value}`);
});

// 📏 Line height
const lineHeightSlider = document.getElementById('lineHeightSlider');
const lineHeightValue = document.getElementById('lineHeightValue');
lineHeightSlider.addEventListener('input', () => {
  textContainer.style.lineHeight = lineHeightSlider.value;
  lineHeightValue.textContent = `Current: ${lineHeightSlider.value}`;
  speakText(`Line height ${lineHeightSlider.value}`);
});

// 🔡 Letter spacing
const letterSpacingSlider = document.getElementById('letterSpacingSlider');
const letterSpacingValue = document.getElementById('letterSpacingValue');
letterSpacingSlider.addEventListener('input', () => {
  textContainer.style.letterSpacing = `${letterSpacingSlider.value}px`;
  letterSpacingValue.textContent = `Current: ${letterSpacingSlider.value}`;
  speakText(`Letter spacing ${letterSpacingSlider.value}`);
});

document.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const isInTextContent = active.closest('.text-content');
  const annotatedSpans = Array.from(document.querySelectorAll('.text-content .annotated'));

  if (e.key === 'Escape' && isSelecting) {
    isSelecting = false;
    toggleGlobalTabbing(false);
    speakText("Selection cancelled");
    renderSelection(); // evt de selectie visueel verwijderen
  }

  // ⌨️ Ctrl ingedrukt (alleen Ctrl)
  if (e.ctrlKey && e.key === 'Control' && isInTextContent && annotatedSpans.length) {
    e.preventDefault();

    const currentIndex = annotatedSpans.findIndex(span => span === active);

    // Ga naar vorige annotatie (of laatste als je op iets anders stond)
    let prevIndex = currentIndex > 0
      ? currentIndex - 1
      : annotatedSpans.length - 1;

    annotatedSpans[prevIndex].focus();
    speakText("Previous annotated span");
  }
});

if ('webkitSpeechRecognition' in window) {
  const recognition = new webkitSpeechRecognition();
  recognition.lang = 'en-GB';
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
    console.log("🎤 Gesproken:", transcript);

    if (transcript.includes("stop")) {
      stopSpeaking();
      speakText("Reading stopped");
    }
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
  };

  recognition.start();
}

function renderSelection() {
  if (!selectionBaseSpan || selectionStartIndex === null || selectionEndIndex === null) return;

  const result = selectionWords.map((word, i) => {
    if (i >= selectionStartIndex && i <= selectionEndIndex) {
      return `<span class="selection-preview">${word}</span>`;
    }
    return word;
  }).join(" ");

  selectionBaseSpan.innerHTML = result;
}

function updateTabbables() {
  const isMenuOpen = settingsPanel.classList.contains('open');

  const textEls = document.querySelectorAll('.text-content .text-focusable');
  const menuEls = settingsPanel.querySelectorAll('button, input, select, textarea');

  textEls.forEach(el => el.setAttribute('tabindex', isMenuOpen ? '-1' : '0'));
  menuEls.forEach(el => el.setAttribute('tabindex', isMenuOpen ? '0' : '-1'));
}
function toggleGlobalTabbing(disable = false) {
  const focusables = document.querySelectorAll('[tabindex]');
  focusables.forEach(el => {
    if (disable) {
      el.dataset.prevTabIndex = el.getAttribute('tabindex');
      el.setAttribute('tabindex', '-1');
    } else if (el.dataset.prevTabIndex !== undefined) {
      el.setAttribute('tabindex', el.dataset.prevTabIndex);
      delete el.dataset.prevTabIndex;
    }
  });
}


document.querySelectorAll('.text-content span').forEach(span => {
  span.setAttribute('tabindex', '0');

  span.addEventListener('focus', () => {
    const text = span.textContent.trim();
    document.querySelectorAll('.highlighted-word').forEach(el => el.classList.remove('highlighted-word'));
    speakText(text, span);
  });

  span.addEventListener('blur', () => {
    stopSpeaking();
    // Zorg ervoor dat de tekst weer normaal wordt weergegeven na verlies van focus
    if (span.hasAttribute('data-wrapped')) {
      span.innerHTML = span.textContent;
      span.removeAttribute('data-wrapped');
    }
  });

  span.addEventListener('click', () => speakText(span.textContent));

  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      currentSpan = span;

      // Leeg het invoerveld voor de annotatie
      input.value = '';
      popup.style.display = 'block';
      popupOpen = true;
      input.focus();

      // Focus trap voor popup
      const focusables = [input, saveBtn, cancelBtn];
      let trapIndex = 0;

      popup.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) {
            trapIndex = (trapIndex - 1 + focusables.length) % focusables.length;
          } else {
            trapIndex = (trapIndex + 1) % focusables.length;
          }
          focusables[trapIndex].focus();
        }
      });

      speakText("Add annotation");

      // Reset het inputvak
      setTimeout(() => {
        input.selectionStart = 0;
        input.selectionEnd = 0;
      }, 0);

      colorPicker.style.display = 'none';
    }
  });
});

// Log all saved annotations in localStorage
function logAnnotations() {
  const annotations = [];
  // Loop through all saved annotations in localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith("note-")) {  // Check if the key is related to annotations
      const note = localStorage.getItem(key);
      const color = localStorage.getItem(key.replace("note-", "color-"));
      annotations.push({ key, note, color });
    }
  }

  console.log("Saved annotations:", annotations);
}

// Call this function to log the saved annotations
logAnnotations();

// Wanneer de annotatiepopup verschijnt, tonen we de kleurkiezer
function openAnnotationPopup() {
  popup.style.display = 'block';
  popupOpen = true;
  isInPopup = true;
  input.value = '';
  input.focus();
  speakText("Add annotation");

  // Toon de kleurkiezer zodra het invoerveld voor de annotatie zichtbaar is
  colorPicker.style.display = 'block'; // Kleurkiezer zichtbaar maken

  // Focus op het invoerveld voor de annotatie
  const focusables = [input, saveBtn, cancelBtn];
  let trapIndex = 0;
  popup.addEventListener('keydown', function focusTrap(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      trapIndex = (trapIndex + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
      focusables[trapIndex].focus();
    }
  });
}

function deleteAnnotation(spanId) {
  // Verwijder de annotatie uit localStorage
  localStorage.removeItem(`note-${spanId}`);
  localStorage.removeItem(`color-${spanId}`);

  // Verwijder de annotatie uit de DOM
  const spanToDelete = document.getElementById(spanId);
  if (spanToDelete) {
    spanToDelete.classList.remove('annotated');
    spanToDelete.style.backgroundColor = ''; // Verwijder de achtergrondkleur
  }

  // Werk het annotatiepaneel bij
  updateAnnotationsPanel();
  speakText("Annotation and selection deleted.");
}


// Verwijder de annotatie bij het klikken op de verwijderknop
const annotationItems = document.querySelectorAll('.annotation-item');
annotationItems.forEach(item => {
  item.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();

    const confirmDelete = confirm("Weet je zeker dat je deze annotatie wilt verwijderen?");
    if (confirmDelete) {
      const spanId = item.dataset.ref; // Haal het bijbehorende span-id op
      deleteAnnotation(spanId); // Verwijder de annotatie en de span
    }
  });
});

// Functie voor het opslaan van annotaties
function saveAnnotation(selectedText, color) {
  const spanId = `annotation-${Date.now()}`; // Unieke ID voor de annotatie

  // Sla de geselecteerde tekst en de kleur op in localStorage
  localStorage.setItem(spanId, JSON.stringify({
    text: selectedText,
    color: color
  }));

  // Maak een span-element met de geselecteerde tekst
  const span = document.createElement('span');
  span.id = spanId;
  span.textContent = selectedText;
  span.style.backgroundColor = color;

  // Voeg het span-element toe aan de DOM
  document.querySelector('.text-content').appendChild(span);
}





// Wanneer je de selectie maakt en bevestigt:
function handleSelection(spanId) {
  // Veronderstel dat je de geselecteerde tekst uit de interface haalt
  const selectedText = getSelectedText();  // Dit is een voorbeeld van het ophalen van de geselecteerde tekst

  if (selectedText) {
    saveAnnotation(spanId, selectedText); // Sla de annotatie en de tekst op in localStorage
  }
}

// Voorbeeldfunctie om geselecteerde tekst op te halen
function getSelectedText() {
  const selection = window.getSelection();
  return selection.toString().trim();
}



window.addEventListener('load', () => {
  updateAnnotationsPanel();

  updateTabbables();
});

window.addEventListener('load', () => {
  // Laad de opgeslagen annotaties bij het laden van de pagina
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('annotation-')) { // Filter op annotatiesleutels
      const data = JSON.parse(localStorage.getItem(key));

      // Maak een nieuw span-element met de opgeslagen tekst en kleur
      const span = document.createElement('span');
      span.id = key; // Gebruik het opgeslagen ID
      span.textContent = data.text;
      span.style.backgroundColor = data.color;

      // Voeg de span toe aan de juiste plek in de DOM
      document.querySelector('.text-content').appendChild(span);
    }
  }
});


const controlsBtn = document.getElementById('controlsBtn');
const controlsPopup = document.getElementById('controlsPopup');
const closeControlsBtn = document.getElementById('closeControlsBtn');

controlsBtn.addEventListener('click', () => {
  controlsPopup.style.display = 'block';
  speakText("Controls opened");
  closeControlsBtn.focus();
});

closeControlsBtn.addEventListener('click', () => {
  controlsPopup.style.display = 'none';
  speakText("Controls closed");
});

const controlRows = document.querySelectorAll('#controlsPopup tr[tabindex="0"]');

controlRows.forEach((row, index) => {
  row.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = controlRows[index + 1] || controlRows[0];
      next.focus();
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = controlRows[index - 1] || controlRows[controlRows.length - 1];
      prev.focus();
    }

    // ✅ Enter = lees deze rij voor
    if (e.key === 'Enter') {
      e.preventDefault();
      const cells = row.querySelectorAll('td');
      const text = Array.from(cells).map(cell => cell.textContent.trim()).join(', ');
      speakText(text);
    }
  });


  row.addEventListener('focus', () => {
    const cells = row.querySelectorAll('td');
    const text = Array.from(cells).map(cell => cell.textContent.trim()).join(', ');
    speakText(text); // Laat screen reader voorlezen wat er staat
  });
});

let controlsTrapElements = [];

controlsBtn.addEventListener('click', () => {
  controlsPopup.style.display = 'block';
  speakText("Controls opened");

  // Verzamel alle tabbables in popup
  controlsTrapElements = Array.from(controlsPopup.querySelectorAll('[tabindex="0"], button'));
  const first = controlsTrapElements[0];
  const last = controlsTrapElements[controlsTrapElements.length - 1];

  first.focus();

  // Trap tab-navigatie binnen popup
  controlsPopup.addEventListener('keydown', function trapTab(e) {
    if (e.key === 'Tab') {
      const active = document.activeElement;
      const currentIndex = controlsTrapElements.indexOf(active);

      if (e.shiftKey) {
        // Shift + Tab
        e.preventDefault();
        const prev = controlsTrapElements[currentIndex - 1] || last;
        prev.focus();
      } else {
        // Tab
        e.preventDefault();
        const next = controlsTrapElements[currentIndex + 1] || first;
        next.focus();
      }
    }

    // Esc = sluiten
    if (e.key === 'Escape') {
      controlsPopup.style.display = 'none';
      speakText("Controls closed");
      controlsBtn.focus();
    }
  });
});

const voiceSelector = document.getElementById('voiceSelector');
let availableVoices = [];
let selectedVoice = null;

function loadVoices() {
  const allVoices = speechSynthesis.getVoices();
  const desiredLangs = {
    'en': 'Engels',
    'nl': 'Nederlands',
    'fr': 'Frans',
    'de': 'Duits'
  };

  availableVoices = [];

  // Clear oude opties
  voiceSelector.innerHTML = '';

  Object.entries(desiredLangs).forEach(([langCode, label]) => {
    const matchingVoice = allVoices.find(v => v.lang.startsWith(langCode));
    if (matchingVoice) {
      availableVoices.push(matchingVoice);

      const option = document.createElement('option');
      option.value = availableVoices.length - 1;
      option.textContent = `${label} - ${matchingVoice.name}`;
      voiceSelector.appendChild(option);
    }
  });

  // Kies eerder opgeslagen stem
  const savedVoiceIndex = localStorage.getItem('selectedVoiceIndex');
  if (savedVoiceIndex !== null && availableVoices[savedVoiceIndex]) {
    voiceSelector.value = savedVoiceIndex;
    selectedVoice = availableVoices[savedVoiceIndex];
  } else {
    voiceSelector.selectedIndex = 0;
    selectedVoice = availableVoices[0];
  }
}

// Stem wijzigen
voiceSelector.addEventListener('change', () => {
  const index = parseInt(voiceSelector.value);
  selectedVoice = availableVoices[index];
  localStorage.setItem('selectedVoiceIndex', index);
  speakText(`Je hebt gekozen voor: ${selectedVoice.name}`);
});

// Wacht tot stemmen geladen zijn
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();


