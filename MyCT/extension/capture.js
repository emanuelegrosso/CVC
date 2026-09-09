// ===== CVC Equipaggi Importer - Capture Script =====
// Eseguito a document_start PRIMA che qualsiasi immagine venga caricata.
// Intercetta il phase di cattura (capturing) degli eventi error sugli <img>
// e salva l'URL originale in data-original-src PRIMA che l'inline onError
// della pagina CVC lo sostituisca con img_placeholder.png.
//
// La pagina CVC usa:
//   <img src="/wp-content/.../getDocs.php?url=..." onError="this.onerror=null;this.src='...img_placeholder.png';">
// Quando l'immagine fallisce, l'onError inline sovrascrive il src.
// Questo script salva l'URL originale prima che accada.

(function () {
    'use strict';

    // Parole chiave che identificano URL di foto del sito CVC
    var PHOTO_KEYWORDS = ['getDocs.php', 'uploads/documenti', 'uploads/personal'];

    document.addEventListener('error', function (e) {
        var target = e.target;
        if (!target || target.tagName !== 'IMG') return;

        // Evita di sovrascrivere se già catturato
        if (target.getAttribute('data-original-src')) return;

        var src = target.getAttribute('src');
        if (!src) return;

        // Salva solo se sembra un URL di foto CVC (non placeholder)
        var isPlaceholder = src.indexOf('img_placeholder') !== -1;
        if (isPlaceholder) return;

        var isPhoto = PHOTO_KEYWORDS.some(function (kw) { return src.indexOf(kw) !== -1; });
        if (!isPhoto) return;

        target.setAttribute('data-original-src', src);
    }, true); // capturing phase: si esegue PRIMA dell'inline onError
})();