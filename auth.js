// auth.js
import { auth, rtdb } from './firebase-init.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";

/** Inscription */
export async function signUp({ email, password, displayName }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  // optionnel : ajouter displayName
  if (displayName) await updateProfile(cred.user, { displayName });
  // créer profil initial dans la Realtime DB
  await set(ref(rtdb, `users/${uid}/profile`), {
    email,
    displayName: displayName || '',
    createdAt: Date.now()
  });
  // initialiser données applicatives
  await set(ref(rtdb, `users/${uid}/appData`), {
    // donne un squelette par défaut si tu veux
    members: [],
    lots: [],
    payments: []
  });
  return cred.user;
}

/** Connexion */
export async function signIn({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** Déconnexion */
export async function signOutUser() {
  await signOut(auth);
}

/** Helpers pour lire/écrire les données de l'utilisateur */
export function listenToUserData(uid, callback) {
  const node = ref(rtdb, `users/${uid}/appData`);
  // onValue garde la synchro en temps réel
  return onValue(node, snapshot => {
    callback(snapshot.val());
  });
}

export async function writeUserData(uid, data) {
  await set(ref(rtdb, `users/${uid}/appData`), data);
}
