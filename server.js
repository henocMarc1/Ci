const express = require('express');
const path = require('path');
const app = express();
const PORT = 5000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Serveur CI Habitat GESTION démarré sur http://0.0.0.0:${PORT}`);
  console.log(`🌐 L'application est accessible en ligne`);
  console.log(`🔒 Authentification Firebase activée`);
  console.log(`💾 Chaque utilisateur a ses propres données dans Firebase`);
});
