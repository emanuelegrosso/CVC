// ===== CVC Equipaggi Importer - Content Script =====
// Estrae allievi e volontari/istruttori dalla pagina CVC e li invia al backend locale.
// Il backend è raggiungibile su http://localhost:1967
//
// La pagina CVC marca le righe con classi CSS:
//   <tr class="allievo consegnata">              → ALLIEVO
//   <tr class="volontario consegnata hide_row">  → VOLONTARIO / ISTRUTTORE
// L'estrazione usa queste classi (metodo principale) e ripiega sulla scansione
// generica delle tabelle solo se le classi non sono presenti.

const API_URL = 'http://localhost:1967';

// Header che identificano una riga di intestazione (da ignorare)
const HEADER_TERMS = [
    'nome', 'cognome', 'data', 'nascita', 'ruolo', 'telefono', 'tel', 'note',
    'peso', 'sesso', 'età', 'eta', 'foto', 'immagine', 'avatar', 'anno',
    'allievo', 'istruttore', 'corso', 'equipaggio', 'barca', 'capienza',
    'turno', 'giorno', 'sito', 'id', 'azioni', 'stato',
    'allievi', 'istruttori', 'equipaggi', 'corsi', 'ricerca', 'cerca', 'filtri', 'elenco'
];

// Termini che segnalano un titolo di sezione / header (es. "Storico") — vanno esclusi
const SECTION_MARKERS = ['storico', 'storici', 'archivio', 'archivi'];

// Cella vuota o composta solo da trattini/punteggiatura (es. "-", "--", "—")
function isEmptyCell(s) {
    if (!s) return true;
    return /^[\s\-–—_.:;|«»"']*$/.test(s.trim());
}

// Cella che sembra un'intestazione di colonna
function isHeaderCell(s) {
    if (!s) return false;
    if (isEmptyCell(s)) return false;
    const t = s.trim().toLowerCase().replace(/[:\s]+$/, '');
    return HEADER_TERMS.some(h => t === h || t.startsWith(h + ' ') || t.endsWith(' ' + h));
}

// Cella che segnala un titolo di sezione / header (es. "Storico", "Archivio")
function isSectionMarker(s) {
    if (!s) return false;
    const low = s.toLowerCase().trim();
    return SECTION_MARKERS.some(m =>
        low === m ||
        low.startsWith(m + ' ') ||
        low.startsWith(m + ':') ||
        low.endsWith(' ' + m)
    );
}

// Cella probabilmente "nome e cognome"
function isName(s) {
    if (!s) return false;
    const t = s.trim();
    if (isEmptyCell(t)) return false;
    if (isHeaderCell(t)) return false;
    if (isSectionMarker(t)) return false;
    if (/^\d{2}[\/\-\.]\d{2}[\/\-\.]\d{2,4}$/.test(t)) return false;
    if (/^\d+$/.test(t)) return false;
    if (/^(lun|mar|mer|gio|ven|sab|dom)$/i.test(t)) return false;
    if (/^(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)$/i.test(t)) return false;
    const words = t.split(/\s+/);
    if (words.length > 5) return false;
    if (words.length === 1 && words[0].length > 15) return false;
    return /^[A-Za-zÀ-ù' \-]+$/.test(t);
}

// === METODO PRINCIPALE: estrazione per classe CSS della riga ===
// La pagina usa:
//   class="allievo consegnata"              → ALLIEVO
//   class="volontario consegnata hide_row"  → VOLONTARIO / ISTRUTTORE

function findRowsByRole(tipo) {
    if (tipo === 'ALLIEVO') {
        return [...document.querySelectorAll('tr.allievo')];
    }
    // Volontari/istruttori: accetta anche eventuali righe class="istruttore"
    return [...document.querySelectorAll('tr.volontario, tr.istruttore')];
}

// Converte una singola riga (<tr>) in un oggetto Persona
function personFromRow(tr, tipo) {
    const cells = [...tr.querySelectorAll('td')].map(c => c.textContent.trim().replace(/\s+/g, ' '));
    if (cells.length < 2) return null;

    // Trova la cella che sembra "Nome Cognome"
    let nomeCell = null;
    let nomeIdx = -1;
    cells.forEach((c, i) => {
        if (nomeIdx !== -1) return;
        if (c && isName(c) && !isHeaderCell(c) && !isSectionMarker(c)) {
            const words = c.trim().split(/\s+/);
            if (words.length >= 2 || !/^\d+$/.test(c)) {
                nomeCell = c;
                nomeIdx = i;
            }
        }
    });
    if (!nomeCell) return null;

    const parts = nomeCell.split(/\s+/).filter(Boolean);
    // Rileva il ruolo reale dalla colonna "Ruolo" della tabella CVC (IS, ADV, AT)
    const KNOWN_ROLES = ['IS', 'ADV', 'AT'];
    const cellRole = tipo === 'IS' ? cells.find(c => KNOWN_ROLES.includes(c)) : null;
    const p = {
        Nome: parts[0] || '?',
        Cognome: parts.slice(1).join(' ') || '',
        Ruolo: cellRole || tipo,
        Foto: '',
        SitoId: '',
        Telefono: '',
        DataNascita: ''
    };

    // SitoId dal data attribute
    p.SitoId = tr.getAttribute('data-allievo_id') || '';

    // Foto dalla prima <img> della riga — usa data-original-src catturato da capture.js
    p.Foto = extractFotoUrl(tr, p.SitoId);

    // Telefono e data di nascita dalle altre celle
    applyMetaFields(cells, p);

    return p;
}

// === Estrazione URL foto con cascata di fallback ===
// Priorità: data-original-src (capture.js) > img.src > performance API > costruzione URL
// capture.js intercetta l'errore di caricamento in fase di cattura (document_start)
// e salva l'URL originale in data-original-src PRIMA che l'inline onError della
// pagina CVC lo sostituisca con img_placeholder.png.
function extractFotoUrl(tr, sitoId) {
    const img = tr.querySelector('td img');
    if (!img) return '';

    // 1. data-original-src: catturato da capture.js PRIMA dell'onError inline
    let fotoUrl = img.getAttribute('data-original-src') || '';

    // 2. img.src: potrebbe ancora essere l'originale se l'immagine non ha dato errore
    if (!fotoUrl || fotoUrl.includes('img_placeholder')) {
        const src = img.getAttribute('src') || '';
        if (src && !src.includes('img_placeholder')) {
            fotoUrl = src;
        }
    }

    // 3. performance API: ultimo tentativo per recuperare l'URL originale
    const isPlaceholder = !fotoUrl || fotoUrl.includes('img_placeholder');
    if (isPlaceholder && sitoId) {
        try {
            const entries = performance.getEntriesByType('resource');
            const hit = entries.find(e => {
                const n = e.name || '';
                return n.includes('getDocs.php') && n.includes(sitoId);
            });
            if (hit) fotoUrl = hit.name;
        } catch { /* performance API non disponibile */ }
    }

    // 4. Nessun URL trovato — non è possibile ricostruire il path completo
    //    solo dall'ID. I primi 3 step dovrebbero essere sufficienti.
    //    Se capture.js ha funzionato (step 1), il URL originale è preservato.

    const isStillPlaceholder = !fotoUrl || fotoUrl.includes('img_placeholder');
    return isStillPlaceholder ? '' : fotoUrl;
}

// Estrae le persone dalle righe con la classe CSS del ruolo
function extractByClass(tipo) {
    const persons = [];
    const seen = new Set();
    findRowsByRole(tipo).forEach(tr => {
        const p = personFromRow(tr, tipo);
        if (!p) return;
        const key = `${p.Nome}|${p.Cognome}|${p.DataNascita}`;
        if (seen.has(key)) return;
        seen.add(key);
        persons.push(p);
    });
    return persons;
}

// === FALLBACK: scansione generica delle tabelle (se le classi non sono presenti) ===
// Sceglie la tabella con più righe simili a persone e restituisce le sue righe in ordine.
function extractTableRows() {
    const tables = document.querySelectorAll('table');
    if (!tables.length) return [];
    let bestTable = null;
    let bestScore = 0;
    tables.forEach(table => {
        const trs = table.querySelectorAll('tr');
        let score = 0;
        trs.forEach(tr => {
            const cells = [...tr.querySelectorAll('td')].map(c => c.textContent.trim().replace(/\s+/g, ' '));
            if (cells.some(c => isName(c))) score++;
        });
        if (score > bestScore) { bestScore = score; bestTable = table; }
    });
    if (!bestTable) {
        let maxRows = -1;
        tables.forEach(table => {
            const n = table.querySelectorAll('tr').length;
            if (n > maxRows) { maxRows = n; bestTable = table; }
        });
        if (!bestTable) return [];
    }
    const rows = [];
    bestTable.querySelectorAll('tr').forEach(tr => {
        const cells = [...tr.querySelectorAll('td')].map(c => c.textContent.trim().replace(/\s+/g, ' '));
        rows.push(cells);
    });
    return rows;
}

// Trova l'elemento <tr> a partire dalla riga estratta (cerca per contenuto nome)
function findTrForRow(row, nomeIdx) {
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
        for (const tr of table.querySelectorAll('tr')) {
            const cells = [...tr.querySelectorAll('td')].map(c => c.textContent.trim().replace(/\s+/g, ' '));
            if (cells.length !== row.length) continue;
            if (cells[nomeIdx] === row[nomeIdx]) return tr;
        }
    }
    return null;
}

// Fallback: parse senza classi, fermandosi dopo l'ultima riga valida
function extractByTable(tipo) {
    const data = extractTableRows();
    const persons = [];
    const seen = new Set();
    let foundAny = false;
    let stop = false;
    data.forEach((row, idx) => {
        if (stop) return;
        if (!Array.isArray(row) || row.length < 2) return;
        // Riga vuota o fatta solo di trattini (es. "-") → non è una persona.
        // Dopo almeno un allievo, una riga del genere segna la fine della lista.
        if (row.every(c => isEmptyCell(c))) {
            if (foundAny) stop = true;
            return;
        }
        // Riga di header colonne / titolo di sezione (es. "Storico") → non è una persona.
        if (row.every(c => isEmptyCell(c) || isHeaderCell(c) || isSectionMarker(c))) {
            if (foundAny) stop = true;
            return;
        }
        // Trova la cella che sembra "Nome Cognome"
        let nomeCell = null;
        let nomeIdx = -1;
        row.forEach((c, i) => {
            if (nomeIdx !== -1) return;
            if (c && isName(c) && !isHeaderCell(c) && !isSectionMarker(c)) {
                const words = c.trim().split(/\s+/);
                if (words.length >= 2 || !/^\d+$/.test(c)) {
                    nomeCell = c;
                    nomeIdx = i;
                }
            }
        });
        // Riga senza nome: dopo aver trovato allievi, è roba successiva → fine lista
        if (!nomeCell) {
            if (foundAny) stop = true;
            return;
        }
        const parts = nomeCell.split(/\s+/).filter(Boolean);
        // Rileva il ruolo reale dalla colonna "Ruolo" della tabella CVC (IS, ADV, AT)
        const KNOWN_ROLES = ['IS', 'ADV', 'AT'];
        const cellRole = tipo === 'IS' ? row.find(c => KNOWN_ROLES.includes(c)) : null;
        const p = {
            Nome: parts[0] || '?',
            Cognome: parts.slice(1).join(' ') || '',
            Ruolo: cellRole || tipo,
            Foto: '',
            SitoId: '',
            Telefono: '',
            DataNascita: ''
        };
        const tr = findTrForRow(row, nomeIdx);
        if (tr) {
            // SitoId dal data attribute
            p.SitoId = tr.getAttribute('data-allievo_id') || '';
            // Foto: usa la funzione centralizzata con cascata di fallback
            p.Foto = extractFotoUrl(tr, p.SitoId);
        }
        applyMetaFields(row, p);
        const key = `${p.Nome}|${p.Cognome}|${p.DataNascita}`;
        if (seen.has(key)) return;
        seen.add(key);
        foundAny = true;
        persons.push(p);
    });
    return persons;
}

// --- Estrae telefono e data di nascita dalle celle ---
function applyMetaFields(cells, p) {
    cells.forEach(c => {
        if (!c) return;
        // Data di nascita: formato GG/MM/AAAA o GG-MM-AAAA (anche AAAA-MM-GG)
        const mDate4 = c.match(/(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})/);
        const mDate2 = c.match(/(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{2,4})/);
        let dd, mm, yyyy;
        if (mDate4) {
            [, yyyy, mm, dd] = mDate4;
        } else if (mDate2) {
            let [, d1, d2, d3] = mDate2;
            // Se il primo gruppo è > 31 oppure il terzo ha 4 cifre → anno è il 3°
            if (parseInt(d3) > 31 && d3.length === 4) { yyyy = d3; dd = d1; mm = d2; }
            else if (parseInt(d1) > 31) { yyyy = d1; dd = d2; mm = d3; }
            else { dd = d1; mm = d2; yyyy = d3; }
        }
        if (yyyy && !p.DataNascita) {
            if (yyyy.length === 2) {
                const y2 = parseInt(yyyy);
                yyyy = String(y2 >= 70 ? 1900 + y2 : 2000 + y2);
            }
            dd = dd.padStart(2, '0');
            mm = mm.padStart(2, '0');
            if (parseInt(dd) >= 1 && parseInt(dd) <= 31 && parseInt(mm) >= 1 && parseInt(mm) <= 12) {
                p.DataNascita = `${yyyy}-${mm}-${dd}`;
            }
        }
        // Telefono: 9-12 cifre (con eventuale +)
        const tel = c.replace(/[\s\.\-\(\)]/g, '');
        if (/^\+?\d{9,12}$/.test(tel) && !/^\d{4}$/.test(tel) && !p.Telefono) {
            p.Telefono = tel;
        }
    });
}

// Punto di ingresso: prova prima le classi CSS, poi la scansione generica
function parsePersons(tipo) {
    const persons = extractByClass(tipo);
    if (persons.length > 0) return persons;
    return extractByTable(tipo);
}

// --- Info diagnostiche (utili se l'estrazione trova 0 risultati) ---
function getDebugInfo() {
    const tables = document.querySelectorAll('table');
    const infos = [...tables].map(t => {
        const rows = t.querySelectorAll('tr');
        const first = rows[0] ? (rows[0].textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100) : '';
        const sample = [...rows].slice(0, 5).map(tr =>
            [...tr.querySelectorAll('td')].map(cd => (cd.textContent || '').trim().replace(/\s+/g, ' ')).join(' | ')
        );
        return { rows: rows.length, first: first, sample: sample };
    });
    return { tabelle: tables.length, dettaglio: infos };
}

// --- Invia al backend ---
async function sendToBackend(personas, tipo, cid) {
    const url = tipo === 'istruttori'
        ? `${API_URL}/api/import/${cid}/istruttori`
        : `${API_URL}/api/import/${cid}/allievi`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(personas)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        return data;
    } catch (e) {
        throw new Error('Impossibile contattare backend: ' + e.message);
    }
}

// --- Download foto spostato in popup.js (eseguito nel MAIN world della pagina) ---
// La popup usa chrome.scripting.executeScript con world:'MAIN' per fare fetch()
// con i cookie CVC della sessione autenticata, poi invia al content script
// le personas con Foto già in formato data URL base64.

// --- API esposta al popup ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Estrae allievi E volontari in un solo passaggio
    if (msg.type === 'EXTRACT_ALL') {
        try {
            const allievi = parsePersons('ALLIEVO');
            const istruttori = parsePersons('IS');
            sendResponse({ ok: true, allievi, istruttori, debug: getDebugInfo() });
        } catch (e) {
            sendResponse({ ok: false, error: e.message });
        }
        return true;
    }
    if (msg.type === 'EXTRACT_ALLIEVI') {
        try {
            const persons = parsePersons('ALLIEVO');
            sendResponse({ ok: true, count: persons.length, persons, debug: getDebugInfo() });
        } catch (e) {
            sendResponse({ ok: false, error: e.message });
        }
        return true;
    }
    if (msg.type === 'EXTRACT_ISTRUTTORI') {
        try {
            const persons = parsePersons('IS');
            sendResponse({ ok: true, count: persons.length, persons, debug: getDebugInfo() });
        } catch (e) {
            sendResponse({ ok: false, error: e.message });
        }
        return true;
    }
    if (msg.type === 'IMPORT') {
        const { persons, tipo, corsoId } = msg;
        // Le foto sono già state scaricate dalla popup come data URL (nel main world con i cookie CVC).
        // Le inoltro direttamente al backend, che decodifica il base64 e salva in wwwroot/foto/{cid}/.
        sendToBackend(persons, tipo, corsoId)
            .then(data => sendResponse({ ok: true, data }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }
});