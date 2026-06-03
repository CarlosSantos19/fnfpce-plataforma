/**
 * firebase-config.js
 * Configuración del SDK de Firebase para la plataforma FNFPCE.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDBN-eGu_5WrU29670uhe1YeFyhSiErmxk",
  authDomain:        "fnfpce-plataforma.firebaseapp.com",
  projectId:         "fnfpce-plataforma",
  storageBucket:     "fnfpce-plataforma.firebasestorage.app",
  messagingSenderId: "212533194863",
  appId:             "1:212533194863:web:e290a71756aa55dfb1dd9a"
};

const app     = initializeApp(firebaseConfig);
const db      = getFirestore(app);
const storage = getStorage(app);

export { db, storage };
