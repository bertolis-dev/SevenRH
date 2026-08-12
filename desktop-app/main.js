const { app, BrowserWindow, shell, Menu } = require('electron');

// ?desktop=1 : signale au site (voir app.js, isDesktopApp()) qu'on est dans l'appli de bureau, pour
// sauter la page d'accueil publique (déjà "vue" au moment d'installer) et aller droit à la connexion.
const APP_URL = 'https://nexus-rh.com/?desktop=1';

// Une seule instance : un second lancement (double-clic sur l'icône alors que l'appli tourne déjà)
// remet simplement la fenêtre existante au premier plan plutôt que d'en ouvrir une seconde.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1360,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      title: 'Nexus',
      icon: __dirname + '/icon.png',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    Menu.setApplicationMenu(null);
    mainWindow.loadURL(APP_URL);

    // Liens ouverts par l'appli web (ex. documents exportés, portail Stripe si jamais en popup) —
    // dans le navigateur par défaut de l'utilisateur, pas dans une nouvelle fenêtre Electron.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    app.quit();
  });
}
