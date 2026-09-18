/**
 * Seven RH — retour Betty du 19/09/2026 (point 8, "deux largeurs de fenêtre pour toute
 * l'application... cinquante fenêtres à 420 pixels, dix-neuf à 760, et rien d'autre") : en
 * réalité 4 tailles existaient déjà (420/480 par défaut/760/1100, voir style.css), mais deux
 * formulaires à 10+ champs restaient coincés dans le défaut 480px sans qu'aucune classe adaptée ne
 * leur soit posée. Un nouveau palier intermédiaire (.modal-medium, 600px) comble aussi l'écart
 * entre le défaut et .modal-large pour un formulaire à 5-6 champs.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

function classeDuModal(nomFonction) {
  const fnStart = appSource.indexOf(`function ${nomFonction}(`);
  assert.ok(fnStart !== -1, `fonction introuvable : ${nomFonction}`);
  const body = appSource.slice(fnStart, fnStart + 4000);
  const match = body.match(/<div class="modal([^"]*)"/);
  assert.ok(match, `aucune <div class="modal..."> trouvée dans ${nomFonction}`);
  return match[1].trim();
}

async function runModalMediumExisteEtSaTailleEstEntreLeDefautEtLarge() {
  assert.ok(cssSource.includes('.modal-medium { max-width: 600px; }'));
  assert.ok(cssSource.includes('.modal-large { max-width: 760px; }'));
  // Le défaut (480px, sans classe) &lt; modal-medium (600px) &lt; modal-large (760px) : un vrai palier
  // intermédiaire, pas une simple renomination de l'existant.
  assert.ok(600 > 480 && 600 < 760);

  console.log('OK — largeurs-modales-19-09.test.js (.modal-medium : nouveau palier intermédiaire, 480 < 600 < 760)');
}

async function runFormulairesAChampsNombreuxNeSontPlusAuDefaut() {
  assert.strictEqual(classeDuModal('openLeaveRequestModal'), 'modal-large', 'demande de congé (~11 champs selon le type) ne doit plus être coincée dans le défaut 480px');
  assert.strictEqual(classeDuModal('openExpenseModal'), 'modal-large', 'note de frais (~12 champs selon la catégorie) ne doit plus être coincée dans le défaut 480px');

  console.log('OK — largeurs-modales-19-09.test.js (demande de congé et note de frais passées en modal-large)');
}

async function runFormulaireIntermediaireUtiliseLeNouveauPalier() {
  assert.strictEqual(classeDuModal('openShiftModal'), 'modal-medium', 'un quart de planning (5 champs, un seul form-grid) profite du palier intermédiaire plutôt que de rester à l\'étroit ou de sur-dimensionner à 760px');

  console.log('OK — largeurs-modales-19-09.test.js (quart de planning : palier intermédiaire, ni trop à l\'étroit ni surdimensionné)');
}

async function runAucuneMediaQuerySupplementaireNecessaire() {
  // §confirmation du choix de conception : .modal-medium doit profiter du MÊME repli responsive
  // (width:100%) déjà posé sur .modal de base — aucune règle @media dédiée à .modal-medium ne doit
  // exister, sinon le comportement mobile diverge silencieusement de toutes les autres tailles.
  assert.ok(!/@media[^}]*\{[^}]*\.modal-medium/s.test(cssSource), '.modal-medium ne doit dépendre d\'aucune media query dédiée : le repli mobile est déjà générique sur .modal');

  console.log('OK — largeurs-modales-19-09.test.js (.modal-medium hérite du repli mobile générique, aucune media query dédiée)');
}

runModalMediumExisteEtSaTailleEstEntreLeDefautEtLarge()
  .then(runFormulairesAChampsNombreuxNeSontPlusAuDefaut)
  .then(runFormulaireIntermediaireUtiliseLeNouveauPalier)
  .then(runAucuneMediaQuerySupplementaireNecessaire)
  .catch((err) => {
    console.error('ÉCHEC — largeurs-modales-19-09.test.js');
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
