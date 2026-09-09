// ===== CVC Equipaggi Importer - Popup =====
const $ = (id) => document.getElementById(id);
let extractedAllievi = [];
let extractedIstruttori = [];

// Scarica le foto direttamente nel MAIN world della pagina CVC
// (qui i cookie HttpOnly della sessione vengono inviati dalla fetch)
// Accetta anche URL relativi e li risolve rispetto all'origine della pagina.
// Non si fida solo del Content-Type: accetta blob con tipo image/*, application/octet-stream o vuoto,
// purché la dimensione sia sufficiente (>200 bytes, per scartare pagine di errore minuscole).
async function scaricaFotoMainWorld(tabId, urls) {
    if (!urls.length) return [];
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (lista) => {
            const out = [];
            for (let i = 0; i < lista.length; i++) {
                let url = lista[i];
                try {
                    // Risolvi URL relativi rispetto all'origine della pagina
                    if (url && !url.startsWith('http')) {
                        url = new URL(url, window.location.origin).href;
                    }
                    const res = await fetch(url, { credentials: 'include', redirect: 'follow' });
                    if (!res.ok) {
                        console.warn(`[CVC] Foto ${i}: HTTP ${res.status} per ${url}`);
                        out.push({ i, d: '' });
                        continue;
                    }
                    const blob = await res.blob();
                    const ct = (blob.type || '').toLowerCase();
                    const isImage = ct.startsWith('image/') || ct === 'application/octet-stream' || ct === '';
                    if (!blob || blob.size < 200 || !isImage) {
                        console.warn(`[CVC] Foto ${i}: scartata (size=${blob.size}, type=${ct})`);
                        out.push({ i, d: '' });
                        continue;
                    }
                    const d = await new Promise(r => {
                        const fr = new FileReader();
                        fr.onload = () => r(fr.result);
                        fr.onerror = () => r('');
                        fr.readAsDataURL(blob);
                    });
                    out.push({ i, d: d || '' });
                } catch (e) {
                    console.warn(`[CVC] Foto ${i}: errore fetch - ${e.message}`);
                    out.push({ i, d: '' });
                }
            }
            return out;
        },
        args: [urls],
    });
    return results[0]?.result || [];
}

const status = (msg, cls = 'info') => {
    $('status').textContent = msg;
    $('status').className = cls;
};

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function sendToContent(type, corsoId) {
    const tab = await getActiveTab();
    if (!tab || !tab.id) { status('Nessuna tab attiva', 'err'); return null; }
    try {
        const res = await chrome.tabs.sendMessage(tab.id, { type, corsoId: parseInt(corsoId) || 0 });
        return res;
    } catch (e) {
        status('Errore: content script non presente nella pagina. Ricarica la pagina CVC.', 'err');
        return null;
    }
}

// Mostra/nasconde una sezione di anteprima e gestisce il bottone di importazione
function renderPreview(id, lista, label) {
    const el = $(id);
    const header = $('preview-header-' + id.replace('preview-', ''));
    const list = $('preview-list-' + id.replace('preview-', ''));
    const importBtn = $('import-' + id.replace('preview-', ''));
    if (!lista || lista.length === 0) {
        el.style.display = 'none';
        if (importBtn) importBtn.disabled = true;
        return;
    }
    el.style.display = 'block';
    header.innerHTML = `${label} estratti <span class="count-badge">${lista.length}</span>`;
    list.innerHTML = '';
    lista.forEach(p => {
        const div = document.createElement('div');
        div.className = 'preview-item';
        const meta = p.DataNascita || p.Telefono || (p.Foto ? 'con foto' : '');
        div.innerHTML = `<span class="name">${p.Nome} ${p.Cognome || ''}</span><span class="meta">${meta}</span>`;
        list.appendChild(div);
    });
    if (importBtn) importBtn.disabled = false;
}

async function doExtract(tipo, extractMsgType, label, previewId) {
    const cid = $('cid').value;
    if (!cid) { status('Inserisci l\'ID del corso', 'err'); return; }
    const extractBtnId = tipo === 'allievi' ? 'extract-allievi' : 'extract-istruttori';
    $(extractBtnId).disabled = true;
    status(`Estrazione ${label} in corso…`, 'info');
    const res = await sendToContent(extractMsgType, cid);
    $(extractBtnId).disabled = false;
    if (!res) return;
    if (res.ok) {
        const list = res.persons || [];
        const dbg = res.debug;
        if (tipo === 'allievi') {
            extractedAllievi = list;
            renderPreview('preview-allievi', extractedAllievi, 'Allievi');
        } else {
            extractedIstruttori = list;
            renderPreview('preview-istruttori', extractedIstruttori, 'Istruttori');
        }
        updateImportAllBtn();
        if (list.length > 0) {
            status(`${label} estratti: ${list.length}. Controlla l'anteprima, poi Importa.`, 'ok');
        } else {
            let msg = `Nessun ${label.toLowerCase()} trovato.`;
            if (tipo === 'allievi') msg += ' Apri la pagina ALLIEVI della lista equipaggio.';
            else msg += ' Apri la pagina ISTRUTTORI della lista equipaggio.';
            if (dbg) {
                const dettaglio = (dbg.dettaglio || []).map(t => {
                    const sample = (t.sample || []).slice(0, 3).map(r => `  ${r}`).join('\n');
                    return `tab ${t.rows} righe → "${t.first}"${sample ? '\n' + sample : ''}`;
                }).join('\n');
                msg += `\n\nTabelle trovate: ${dbg.tabelle}.\n${dettaglio}`;
            }
            status(msg, 'err');
        }
    } else {
        status('Errore estrazione: ' + res.error, 'err');
    }
}

function doExtractAllievi() { doExtract('allievi', 'EXTRACT_ALLIEVI', 'Allievi', 'preview-allievi'); }
function doExtractIstruttori() { doExtract('istruttori', 'EXTRACT_ISTRUTTORI', 'Istruttori', 'preview-istruttori'); }

// Funzione interna: scarica foto e importa un gruppo di persone
async function doImportPersons(persons, label, tipo, cid) {
    if (persons.length === 0) return 0;
    const tab = await getActiveTab();
    if (!tab || !tab.id) { status('Nessuna tab attiva', 'err'); return 0; }

    // 1. Scarica le foto nel MAIN world della pagina CVC (i cookie vengono inviati correttamente)
    const urlList = persons.map(p => p.Foto).filter(Boolean);
    if (urlList.length > 0) {
        status(`Scaricamento ${urlList.length} foto ${label} dalla pagina CVC…`, 'info');
        const fotoResults = await scaricaFotoMainWorld(tab.id, urlList);
        const fotoMap = {};
        for (const r of fotoResults) {
            fotoMap[r.i] = r.d;
        }
        let idx = 0;
        for (const p of persons) {
            if (p.Foto) {
                const dataUrl = fotoMap[idx];
                p.Foto = dataUrl || '';
                idx++;
            }
        }
    }

    // 2. Invia al content script (le foto sono già data URL)
    const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'IMPORT',
        persons: persons,
        tipo: tipo,
        corsoId: parseInt(cid)
    });
    if (res && res.ok) {
        const fotoOk = persons.filter(p => p.Foto && p.Foto.startsWith('data:')).length;
        const msg = `Importati ${res.data.imported} ${label} nel corso ${cid}.` + (fotoOk > 0 ? ` Foto scaricate: ${fotoOk}.` : '');
        status(msg, 'ok');
        return res.data.imported;
    }
    throw new Error(res ? res.error : 'Nessuna risposta dal content script');
}

async function doImportAllievi() {
    const cid = $('cid').value;
    if (!cid) { status('Inserisci l\'ID del corso', 'err'); return; }
    if (extractedAllievi.length === 0) { status('Nessun allievo estratto.', 'err'); return; }
    try {
        const tot = await doImportPersons(extractedAllievi, 'allievi', 'allievi', cid);
        extractedAllievi = [];
        $('import-allievi').disabled = true;
        $('preview-allievi').style.display = 'none';
        updateImportAllBtn();
    } catch (e) {
        status('Errore import allievi: ' + e.message, 'err');
    }
}

async function doImportIstruttori() {
    const cid = $('cid').value;
    if (!cid) { status('Inserisci l\'ID del corso', 'err'); return; }
    if (extractedIstruttori.length === 0) { status('Nessun istruttore estratto.', 'err'); return; }
    try {
        const tot = await doImportPersons(extractedIstruttori, 'istruttori', 'istruttori', cid);
        extractedIstruttori = [];
        $('import-istruttori').disabled = true;
        $('preview-istruttori').style.display = 'none';
        updateImportAllBtn();
    } catch (e) {
        status('Errore import istruttori: ' + e.message, 'err');
    }
}

function updateImportAllBtn() {
    $('import-all').disabled = extractedAllievi.length === 0 && extractedIstruttori.length === 0;
}

async function doImportAll() {
    const cid = $('cid').value;
    if (!cid) { status('Inserisci l\'ID del corso', 'err'); return; }
    if (extractedAllievi.length === 0 && extractedIstruttori.length === 0) {
        status('Prima estrai i dati dalla pagina.', 'err');
        return;
    }
    try {
        let tot = 0;
        if (extractedAllievi.length > 0) {
            tot += await doImportPersons(extractedAllievi, 'allievi', 'allievi', cid);
            extractedAllievi = [];
            $('import-allievi').disabled = true;
            $('preview-allievi').style.display = 'none';
        }
        if (extractedIstruttori.length > 0) {
            tot += await doImportPersons(extractedIstruttori, 'istruttori', 'istruttori', cid);
            extractedIstruttori = [];
            $('import-istruttori').disabled = true;
            $('preview-istruttori').style.display = 'none';
        }
        updateImportAllBtn();
        if (tot > 0) status(`Importati ${tot} tra allievi e istruttori nel corso ${cid}.`, 'ok');
    } catch (e) {
        status('Errore: ' + e.message, 'err');
    }
}

$('extract-allievi').addEventListener('click', doExtractAllievi);
$('extract-istruttori').addEventListener('click', doExtractIstruttori);
$('import-all').addEventListener('click', doImportAll);
$('import-allievi').addEventListener('click', doImportAllievi);
$('import-istruttori').addEventListener('click', doImportIstruttori);
