// ===== Equipaggi CVC - Frontend =====
const API = '';
let state = { corsi: [], corso: null, barche: [], allievi: [], istruttori: [], equipaggi: [] };

// ===== Helpers =====
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => [...document.querySelectorAll(sel)];
const content = () => qs('#content');
const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else el.setAttribute(k, v);
    }
    children.flat().forEach(c => {
        if (c == null) return;
        el.appendChild(typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean'
            ? document.createTextNode(String(c)) : c);
    });
    return el;
};
async function api(url, method = 'GET', body) {
    const opt = { method, headers: {} };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(API + url, opt);
    if (!r.ok) throw new Error(await r.text());
    return r.status === 204 ? null : r.json();
}
function toast(msg, error = false) {
    const t = h('div', { class: 'toast' + (error ? ' error' : '') }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('it-IT') : '';
function age(date) {
    if (!date) return '';
    const d = new Date(date); if (isNaN(d)) return '';
    return `${new Date().getFullYear() - d.getFullYear()} anni`;
}
const badge = (r) => {
    const map = { 'ALLIEVO': 'allievo', 'IS': 'istruttore', 'ADV': 'ADV', 'AT': 'AT' };
    return h('span', { class: 'badge badge-' + map[r] || 'allievo' }, r || '-');
};

// ===== Tabs =====
function setTab(name) {
    qsa('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
}
function enableTabs() {
    const hasCorso = !!state.corso;
    qs('#tab-corso').disabled = !hasCorso;
    qs('#tab-equipaggi').disabled = !hasCorso;
}
qs('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn || btn.disabled) return;
    if (btn.dataset.tab === 'corsi') renderCorsi();
    else if (btn.dataset.tab === 'corso') renderCorsoDetail();
    else if (btn.dataset.tab === 'equipaggi') renderEquipaggi();
});

// ===== Dashboard Corsi =====
async function renderCorsi() {
    setTab('corsi');
    state.corso = null;
    enableTabs();
    state.corsi = await api('/api/corsi');
    content().innerHTML = '';
    content().append(
        h('h2', {}, 'Corsi di Vela'),
        h('div', { class: 'card' },
            h('button', { onclick: showCorsoForm }, '+ Nuovo Corso'),
            state.corsi.length === 0
                ? h('p', { html: '<br>Nessun corso. <a id="seed-link" href="#">Carica dati demo</a>.' })
                : h('table', {},
                    h('thead', {}, h('tr', {},
                        h('th', {}, 'ID'), h('th', {}, 'Sigla'), h('th', { class: 'num' }, 'Turno'),
                        h('th', { class: 'num' }, 'Anno'), h('th', {}, 'Inizio'), h('th', {}, 'Fine'),
                        h('th', { class: 'num' }, 'Giorni'), h('th', { class: 'actions' }, '')
                    )),
                    h('tbody', {}, state.corsi.map(c => h('tr', {},
                        h('td', { class: 'col-id' }, c.Id), h('td', {}, c.Sigla),
                        h('td', { class: 'num' }, c.Turno), h('td', { class: 'num' }, c.Anno),
                        h('td', {}, fmtDate(c.DataInizio)), h('td', {}, fmtDate(c.DataFine)),
                        h('td', { class: 'num' }, c.Giorni),
                        h('td', {},
                            h('button', { class: 'small', onclick: () => openCorso(c.Id) }, 'Apri'),
                            ' ',
                            h('button', { class: 'small danger', onclick: () => delCorso(c.Id) }, '🗑')
                        )
                    )))
                )
        )
    );
    const seeder = qs('#seed-link');
    if (seeder) seeder.onclick = seedDemo;
}
// Ritorna un array di <th> (usato dentro h('tr', {}, th_a([...])))
const th_a = (labels) => labels.map(l => h('th', {}, l));
function nthSaturdayOfYear(year, n) {
    // Turno n = the n-th Saturday of the year, shifted back 1 week
    // (school calendar convention: Turno 1 is 1 week before the 1st Saturday)
    const jan1 = new Date(year, 0, 1);
    const dow = jan1.getDay() || 7; // Mon=1..Sun=7
    const daysToFirstSat = (6 - dow + 7) % 7;
    const sat = new Date(year, 0, 1 + daysToFirstSat + (n - 1) * 7 - 7);
    return sat;
}
const fmtIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function showCorsoForm(corso = null) {
    const c = corso || {};
    const turnoInput = h('input', { id: 'turno', type: 'number', value: c.Turno || 1 });
    const annoInput = h('input', { id: 'anno', type: 'number', value: c.Anno || new Date().getFullYear() });
    const dInInput = h('input', { id: 'dIn', type: 'date', value: c.DataInizio || '' });
    const dFinInput = h('input', { id: 'dFin', type: 'date', value: c.DataFine || '' });
    const giorniInput = h('input', { id: 'giorni', type: 'number', value: c.Giorni || 6 });
        const applyTurnoDates = () => {
            if (c.Id) return; // in modifica non sovrascrivere
            const t = +turnoInput.value || 1;
            const y = +annoInput.value || new Date().getFullYear();
            const start = nthSaturdayOfYear(y, t);
        dInInput.value = fmtIso(start);
        const end = new Date(start);
        end.setDate(end.getDate() + 6); // sabato → venerdì successivo
        dFinInput.value = fmtIso(end);
        giorniInput.value = 6;
    };
    turnoInput.addEventListener('input', applyTurnoDates);
    annoInput.addEventListener('input', applyTurnoDates);
    if (!c.Id) applyTurnoDates(); // precompila date dal turno per i nuovi corsi
    openModal('Corso', h('div', {},
        h('div', { class: 'form-grid' },
            field('Sigla (es. D1, C3)', 'sigla', c.Sigla || ''),
            h('div', {}, h('label', { for: 'turno' }, 'Turno'), turnoInput),
            h('div', {}, h('label', { for: 'anno' }, 'Anno'), annoInput),
        ),
        h('div', { class: 'form-grid' },
            h('div', {}, h('label', { for: 'dIn' }, 'Data Inizio (sabato)'), dInInput),
            h('div', {}, h('label', { for: 'dFin' }, 'Data Fine (venerdì)'), dFinInput),
            h('div', {}, h('label', { for: 'giorni' }, 'Numero Giorni'), giorniInput),
        ),
        h('div', {}, h('label', {}, 'Note'), h('textarea', { id: 'note' }, c.Note || '')),
        h('div', { class: 'form-actions' },
            h('button', { onclick: async () => {
                const body = {
                    Sigla: qs('#sigla').value, Turno: +qs('#turno').value, Anno: +qs('#anno').value,
                    DataInizio: qs('#dIn').value, DataFine: qs('#dFin').value,
                    Giorni: +qs('#giorni').value, Note: qs('#note').value
                };
                try {
                    if (c.Id) { await api('/api/corsi/' + c.Id, 'PUT', body); toast('Corso aggiornato'); }
                    else { await api('/api/corsi', 'POST', body); toast('Corso creato'); }
                    closeModal(); renderCorsi();
                } catch (err) { toast('Errore: ' + err.message, true); }
            }}, c.Id ? 'Salva' : 'Crea'),
            h('button', { class: 'secondary', onclick: closeModal }, 'Annulla')
        )
    ));
}
function field(label, id, val, type = 'text') {
    return h('div', {}, h('label', { for: id }, label), h('input', { id, type, value: val }));
}
async function delCorso(id) {
    if (!confirm('Eliminare il corso e tutti i suoi dati?')) return;
    await api('/api/corsi/' + id, 'DELETE');
    toast('Corso eliminato');
    renderCorsi();
}
async function openCorso(id) {
    state.corso = (await api('/api/corsi')).find(c => c.Id === id);
    state.barche = await api(`/api/corsi/${id}/barche`);
    state.allievi = await api(`/api/corsi/${id}/persone?ruolo=ALLIEVO`);
    state.istruttori = await api(`/api/corsi/${id}/persone`);
    state.equipaggi = await api(`/api/corsi/${id}/equipaggi`);
    renderCorsoDetail();
}

// ===== Dettaglio Corso =====
async function renderCorsoDetail() {
    setTab('corso');
    enableTabs();
    const c = state.corso;
    content().innerHTML = '';
    content().append(
        h('h2', {}, `Corso ${c.Sigla} - Turno ${c.Turno} (${c.Anno})`),
        h('div', { class: 'card' },
            h('div', { class: 'form-actions' },
                h('button', { class: 'secondary', onclick: () => showCorsoForm(c) }, 'Modifica Corso'),
                h('button', { class: 'danger', onclick: () => app.resetCorso() }, 'Reset DB (sviluppo)')
            ),
            h('p', { html: `<strong>Periodo:</strong> ${fmtDate(c.DataInizio)} → ${fmtDate(c.DataFine)} · ${c.Giorni} giorni` }),
            c.Note ? h('p', { html: `<strong>Note:</strong> ${c.Note}` }) : null
        ),
        h('div', { class: 'card' },
            h('h3', {}, 'Barche Assegnate'),
            h('button', { class: 'small secondary', onclick: showBarcaForm }, '+ Aggiungi Barca'),
            state.barche.length === 0
                ? h('p', { html: '<br>Nessuna barca. Aggiungine una per iniziare.' })
                : h('table', {},
                    h('thead', {}, h('tr', {}, th_a(['Nome', 'Capienza', 'Tipo', 'Note', '']))),
                    h('tbody', {}, state.barche.map(b => h('tr', {},
                        h('td', {}, b.Nome), h('td', {}, b.Capienza), h('td', {}, b.Tipo || '-'),
                        h('td', {}, b.Note || '-'),
                        h('td', {},
                            h('button', { class: 'small danger', onclick: () => delBarca(b.Id) }, '🗑')
                        )
                    )))
                )
        ),
        h('div', { class: 'card' },
            h('h3', {}, 'Allievi'),
            h('button', { class: 'small secondary', onclick: updatePesoSesso }, '💾 Salva Peso/Sesso'),
            h('button', { class: 'small secondary', onclick: addPersona }, '+ Nuovo Allievo'),
            h('table', { id: 'allievi-table' },
                h('thead', {}, h('tr', {},
                    th_a(['Foto', 'Nome', 'Età', 'Data Nasc.', 'Ruolo', 'Peso (kg)', 'Sesso', 'Esperienza', 'Tel', 'Note', '']))
                ),
                h('tbody', {}, state.allievi.map(p => allievoRow(p)))
            )
        ),
        h('div', { class: 'card' },
            h('h3', {}, 'Istruttori (IS, ADV, AT)'),
            h('table', {},
                h('thead', {}, h('tr', {}, th_a(['Foto', 'Nome', 'Età', 'Ruolo', 'Data Nasc.', 'Tel', 'Note', '']))),
                h('tbody', {}, state.istruttori.map(istruttoreRow))
            )
        ),
        h('div', { class: 'card' },
            h('h3', {}, 'Equipaggi'),
            h('button', { class: '', onclick: () => generaEquipaggi() }, '⚙ Genera Equipaggi'),
            h('button', { class: 'small secondary', onclick: () => setTab('equipaggi') && renderEquipaggi() }, 'Vai agli Equipaggi →')
        )
    );
}
function allievoRow(p) {
    return h('tr', {},
        h('td', {}, p.Foto ? h('img', { class: 'photo', src: p.Foto }) : '—'),
        h('td', {}, `${p.Nome} ${p.Cognome || ''}`),
        h('td', {}, age(p.DataNascita)),
        h('td', {}, fmtDate(p.DataNascita)),
        h('td', {}, badge(p.Ruolo)),
        h('td', {}, h('input', { type: 'number', step: '0.1', id: 'peso-' + p.Id, value: p.Peso || '' })),
        h('td', {}, (() => {
            const sel = h('select', { id: 'sesso-' + p.Id },
                option('', '—'), option('M', 'Maschio'), option('F', 'Femmina'));
            sel.value = p.Sesso || '';
            return sel;
        })()),
        h('td', {}, h('input', { type: 'number', id: 'esp-' + p.Id, value: p.Esperienza || '' })),
        h('td', {}, p.Telefono || '-'),
        h('td', {}, h('input', { id: 'note-' + p.Id, value: p.Note || '' })),
        h('td', {}, h('button', { class: 'small danger', onclick: () => delPersona(p.Id, 'allievo') }, '🗑'))
    );
}
const option = (val, txt) => {
    const o = h('option', { value: val }, txt);
    return o;
};
function istruttoreRow(p) {
    return h('tr', {},
        h('td', {}, p.Foto ? h('img', { class: 'photo', src: p.Foto }) : '—'),
        h('td', {}, `${p.Nome} ${p.Cognome || ''}`),
        h('td', {}, age(p.DataNascita)),
        h('td', {}, badge(p.Ruolo)),
        h('td', {}, fmtDate(p.DataNascita)),
        h('td', {}, p.Telefono || '-'),
        h('td', {}, p.Note || '-'),
        h('td', {}, h('button', { class: 'small danger', onclick: () => delPersona(p.Id, 'istruttore') }, '🗑'))
    );
}
async function updatePesoSesso() {
    const updates = [];
    state.allievi.forEach(p => {
        updates.push({
            Id: p.Id,
            Peso: parseFloat(qs(`#peso-${p.Id}`).value) || 0,
            Sesso: qs(`#sesso-${p.Id}`).value,
            Esperienza: parseInt(qs(`#esp-${p.Id}`).value) || 0,
            Note: qs(`#note-${p.Id}`).value
        });
    });
    for (const u of updates) {
        const full = { ...state.allievi.find(a => a.Id === u.Id), ...u };
        await api('/api/persone/' + u.Id, 'PUT', full);
    }
    toast('Peso/Sesso/Esperienza salvati');
    state.allievi = await api(`/api/corsi/${state.corso.Id}/persone?ruolo=ALLIEVO`);
}
function showBarcaForm() {
    openModal('Nuova Barca', h('div', {},
        h('div', { class: 'form-grid' },
            field('Nome Barca', 'nome', ''),
            field('Capienza (persone)', 'cap', 4, 'number'),
            field('Tipo', 'tipo', 'Deriva'),
        ),
        h('div', {}, h('label', {}, 'Note'), h('input', { id: 'note' })),
        h('div', { class: 'form-actions' },
            h('button', { onclick: async () => {
                await api(`/api/corsi/${state.corso.Id}/barche`, 'POST', {
                    Nome: qs('#nome').value, Capienza: +qs('#cap').value, Tipo: qs('#tipo').value, Note: qs('#note').value
                });
                closeModal(); state.barche = await api(`/api/corsi/${state.corso.Id}/barche`); renderCorsoDetail();
            }}, 'Aggiungi'),
            h('button', { class: 'secondary', onclick: closeModal }, 'Annulla')
        )
    ));
}
async function delBarca(id) {
    if (!confirm('Eliminare barca?')) return;
    await api('/api/barche/' + id, 'DELETE');
    state.barche = await api(`/api/corsi/${state.corso.Id}/barche`);
    renderCorsoDetail();
}
function addPersona() {
    openModal('Nuova Persona', h('div', {},
        h('div', { class: 'form-grid' },
            field('Nome', 'nome', ''), field('Cognome', 'cognome', ''),
            field('Ruolo', 'ruolo-select', 'ALLIEVO'),
        ),
        h('div', { class: 'form-actions' },
            h('button', { onclick: async () => {
                await api(`/api/corsi/${state.corso.Id}/persone`, 'POST', {
                    Nome: qs('#nome').value, Cognome: qs('#cognome').value, Ruolo: qs('#ruolo-select').value
                });
                closeModal(); renderCorsoDetail();
            }}, 'Aggiungi'),
            h('button', { class: 'secondary', onclick: closeModal }, 'Annulla')
        )
    ));
    const sel = qs('#ruolo-select'); sel.innerHTML = '';
    ['ALLIEVO', 'IS', 'ADV', 'AT'].forEach(r => sel.appendChild(option(r, r)));
}
async function delPersona(id, tipo) {
    if (!confirm('Eliminare persona?')) return;
    await api('/api/persone/' + id, 'DELETE');
    if (tipo === 'allievo') state.allievi = await api(`/api/corsi/${state.corso.Id}/persone?ruolo=ALLIEVO`);
    else state.istruttori = await api(`/api/corsi/${state.corso.Id}/persone?ruolo=IS`);
    renderCorsoDetail();
}
async function generaEquipaggi() {
    if (!confirm('Generare equipaggi con l\'algoritmo (sovrascrive assegnazioni attuali)?')) return;
    const res = await api(`/api/corsi/${state.corso.Id}/genera`);
    toast(`Generati: ${res.giorni} giorni, ${res.allievi} allievi, ${res.istruttori} istruttori, ${res.barche} barche`);
    state.equipaggi = await api(`/api/corsi/${state.corso.Id}/equipaggi`);
    renderEquipaggi();
}

// ===== Equipaggi =====
async function renderEquipaggi() {
    setTab('equipaggi');
    enableTabs();
    await refreshEquipaggi();
    const c = state.corso;
    const giorni = c.Giorni || 1;
    content().innerHTML = '';

    const dayTabs = h('div', { class: 'filters' },
        ...Array.from({ length: giorni }, (_, i) =>
            h('span', { class: 'pill' + (i === 0 ? ' selected' : ''), onclick: () => {
                qsa('.pill').forEach(p => p.classList.toggle('selected', p === this));
                renderGiorno(state, i + 1);
            }}, `Giorno ${i + 1}`)
        )
    );
    content().append(
        h('h2', {}, `Equipaggi - Corso ${c.Sigla}`),
        h('div', { class: 'form-actions' },
            h('button', { onclick: () => generaEquipaggi() }, '⚙ Rigenera con Algoritmo'),
            h('button', { class: 'danger', onclick: () => svuotaEquipaggi() }, '🗑 Svuota Equipaggi')
        ),
        dayTabs
    );
    renderGiorno(state, 1);
}
function renderGiorno(state, giorno) {
    const c = state.corso;
    const eqDay = state.equipaggi.filter(e => e.Giorno === giorno);
    const byBarca = {};
    state.barche.forEach(b => byBarca[b.Id] = eqDay.filter(e => e.BarcaId === b.Id));
    const unpicked = state.allievi.concat(state.istruttori).filter(p => !eqDay.some(e => e.PersonaId === p.Id));
    let grid = qs('#eq-grid'); if (grid) grid.remove();
    grid = h('div', { id: 'eq-grid', class: 'eq-grid' });

    state.barche.forEach(b => {
        const members = byBarca[b.Id] || [];
        grid.appendChild(h('div', { class: 'eq-barca' },
            h('h4', {}, `${b.Nome} (${b.Capienza} posti) · ${members.length}/${b.Capienza}`),
            ...members.map(m => h('div', { class: 'member' },
                h('span', {}, `${m.PersonaNome} ${m.PersonaCognome || ''} `,
                    h('span', { class: 'role' }, m.RuoloBordo)),
                h('div', { class: 'member-actions' },
                    h('button', { class: 'small secondary', onclick: () => setRuolo(m) }, 'Ruolo'),
                    h('button', { class: 'small danger', onclick: () => removeFromBarca(m.Id) }, '✕')
                )
            )),
            members.length === 0 ? h('p', { style: 'color:#9fb6d4;font-size:.85rem' }, 'Vuota') : null,
            h('div', { style: 'margin-top:8px' },
                h('button', { class: 'small secondary', onclick: () => aggiungiABarca(b, giorno) }, '+ Aggiungi')
            )
        ));
    });
    grid.appendChild(h('div', { class: 'eq-barca' },
        h('h4', { style: 'color:#9fb6d4' }, 'Non assegnati (' + unpicked.length + ')'),
        ...unpicked.map(p => h('div', { class: 'member' },
            h('span', {}, p.Nome, ' ', h('span', { class: 'role' }, p.Ruolo || '')),
            h('div', {}, h('button', { class: 'small secondary', onclick: () => assegnaLibero(p, giorno) }, 'Assegna'))
        ))
    ));
    content().appendChild(grid);
}
async function svuotaEquipaggi() {
    if (!confirm('Svuotare tutti gli equipaggi?')) return;
    const eq = state.equipaggi;
    for (const e of eq) await api('/api/equipaggi/' + e.Id, 'DELETE');
    await refreshEquipaggi(); renderEquipaggi();
}
function aggiungiABarca(barca, giorno) {
    const disponibili = dispPerGiorno(giorno).filter(p => !state.equipaggi.some(e => e.Giorno === giorno && e.PersonaId === p.Id));
    openModal(`Aggiungi a ${barca.Nome} - Giorno ${giorno}`, h('div', {},
        h('label', {}, 'Persona'),
        selPersona(disponibili, 'sel-pers'),
        h('div', { class: 'form-actions' },
            h('button', { onclick: async () => {
                const perId = parseInt(qs('#sel-pers').value);
                if (!perId) return;
                await api(`/api/corsi/${state.corso.Id}/equipaggi`, 'POST', {
                    Giorno: giorno, BarcaId: barca.Id, PersonaId: perId, RuoloBordo: 'EQUIPAGGIO'
                });
                closeModal(); await refreshEquipaggi(); renderGiorno(state, giorno);
            }}, 'Aggiungi'),
            h('button', { class: 'secondary', onclick: closeModal }, 'Annulla')
        )
    ));
}
function selPersona(lista, id) {
    const s = h('select', { id }, option('', '— Seleziona —'));
    lista.forEach(p => s.appendChild(option(p.Id, `${p.Nome} ${p.Cognome || ''} (${p.Ruolo})`)));
    return s;
}
function dispPerGiorno(g) {
    return state.allievi.concat(state.istruttori);
}
async function assegnaLibero(p, giorno) {
    // scegli barca con meno membri che non la contiene già
    const eqDay = state.equipaggi.filter(e => e.Giorno === giorno);
    const target = state.barche
        .filter(b => !eqDay.some(e => e.PersonaId === p.Id))
        .sort((a, b) => (eqDay.filter(x => x.BarcaId === a.Id).length) - (eqDay.filter(x => x.BarcaId === b.Id).length))[0];
    if (!target) { toast('Nessuna barca disponibile', true); return; }
    await api(`/api/corsi/${state.corso.Id}/equipaggi`, 'POST', {
        Giorno: giorno, BarcaId: target.Id, PersonaId: p.Id, RuoloBordo: 'EQUIPAGGIO'
    });
    await refreshEquipaggi(); renderGiorno(state, giorno);
}
function setRuolo(m) {
    openModal(`Ruolo di ${m.PersonaNome}`, h('div', {},
            h('label', {}, 'Ruolo a bordo'),
            h('select', { id: 'ruolo' }, option('COMANDANTE', 'Comandante'), option('EQUIPAGGIO', 'Equipaggio')),
        h('div', { class: 'form-actions' },
            h('button', { onclick: async () => {
                const full = { ...m, RuoloBordo: qs('#ruolo').value };
                await api(`/api/corsi/${state.corso.Id}/equipaggi`, 'POST', {
                    Giorno: m.Giorno, BarcaId: m.BarcaId, PersonaId: m.PersonaId, RuoloBordo: qs('#ruolo').value
                });
                await api('/api/equipaggi/' + m.Id, 'DELETE');
                closeModal(); await refreshEquipaggi(); renderEquipaggi();
            }}, 'Aggiorna'),
            h('button', { class: 'secondary', onclick: closeModal }, 'Annulla')
        )
    ));
}
async function removeFromBarca(id) {
    await api('/api/equipaggi/' + id, 'DELETE');
    await refreshEquipaggi(); renderEquipaggi();
}
async function refreshEquipaggi() {
    state.equipaggi = await api(`/api/corsi/${state.corso.Id}/equipaggi`);
}

// ===== Modal =====
function openModal(title, body) {
    qs('#modal-body').innerHTML = '';
    qs('#modal-body').append(h('h3', {}, title), body);
    qs('#modal-overlay').classList.remove('hidden');
}
function closeModal() { qs('#modal-overlay').classList.add('hidden'); }
qs('#modal-close').onclick = closeModal;
qs('#modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

// ===== Demo data =====
async function seedDemo() {
    const c = await api('/api/corsi', 'POST', {
        Sigla: 'D1', Turno: 1, Anno: new Date().getFullYear(), DataInizio: '2026-09-05', DataFine: '2026-09-11', Giorni: 6, Note: 'Corso demo'
    });
    state.corso = { Id: c.Id };
    const boats = [['Gabbiano', 4], ['Lampo', 3], ['Onda', 4]];
    for (const [n, cap] of boats) await api(`/api/corsi/${c.Id}/barche`, 'POST', { Nome: n, Capienza: cap, Tipo: 'Deriva' });
    state.corso = (await api('/api/corsi')).find(x => x.Id === c.Id);
    openCorso(c.Id);
}
const app = {
    resetCorso: async () => {
        if (!confirm('RESET TOTALE del database (sviluppo)?')) return;
        await api('/api/db/reset');
        toast('DB resettato');
        state = { corsi: [], corso: null, barche: [], allievi: [], istruttori: [], equipaggi: [] };
        renderCorsi();
    }
};
qs('#header-actions').append(
    h('button', { class: 'danger', onclick: app.resetCorso }, 'Reset DB')
);

// init
renderCorsi();