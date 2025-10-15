// auth-protect.js
import { auth } from './firebase-init.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  const currentPath = location.pathname.split('/').pop();
  // Si on est sur login.html et user existe -> rediriger vers index.html
  if (user) {
    if (currentPath === '' || currentPath === 'login.html') {
      // redirect to app
      location.replace('index.html');
    } else {
      // on est dans l'app ; tu peux déclencher un évènement pour charger les données
      window.dispatchEvent(new CustomEvent('firebase-user', { detail: { uid: user.uid, user } }));
    }
  } else {
    // Pas connecté -> forcer vers login.html (sauf si on est déjà sur la page publique)
    if (currentPath !== 'login.html') {
      location.replace('login.html');
    }
  }
});