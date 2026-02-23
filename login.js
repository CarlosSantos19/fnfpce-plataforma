/**
 * login.js
 * Lógica de autenticación del login FNFPCE.
 * Los nombres de contadores se cargan dinámicamente desde Firebase Firestore.
 */

import { db } from './firebase-config.js';
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CLAVE = "contador123";

// Cargar contadores desde Firestore al iniciar
async function cargarContadores() {
  const select   = document.getElementById('usuario');
  const errorMsg = document.getElementById('errorMsg');

  try {
    const q        = query(collection(db, 'contadores'), orderBy('nombre'));
    const snapshot = await getDocs(q);

    snapshot.forEach(docSnap => {
      const { nombre, activo } = docSnap.data();
      if (activo) {
        const option       = document.createElement('option');
        option.value       = nombre;
        option.textContent = nombre;
        select.appendChild(option);
      }
    });

  } catch (err) {
    console.error('Error cargando contadores:', err);
    errorMsg.textContent = '⚠ Error al conectar con el servidor. Intente más tarde.';
    errorMsg.classList.add('show');
  }
}

// Generar partículas de fondo
(function generarParticulas() {
  const container = document.getElementById("particles");
  for (let i = 0; i < 25; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    p.style.left              = Math.random() * 100 + "vw";
    p.style.animationDuration = (8 + Math.random() * 14) + "s";
    p.style.animationDelay    = (Math.random() * 12) + "s";
    p.style.width = p.style.height = (Math.random() > 0.5 ? "2px" : "1px");
    p.style.opacity = Math.random() * 0.5;
    container.appendChild(p);
  }
})();

function validarLogin(e) {
  e.preventDefault();

  const usuario  = document.getElementById("usuario").value;
  const password = document.getElementById("password").value;
  const errorMsg = document.getElementById("errorMsg");

  const mostrarError = (msg) => {
    errorMsg.textContent = msg;
    errorMsg.classList.remove("show");
    void errorMsg.offsetWidth;
    errorMsg.classList.add("show");
  };

  if (!usuario) {
    mostrarError("⚠ Seleccione su identificación.");
    return;
  }

  if (password !== CLAVE) {
    mostrarError("⚠ Clave de acceso inválida. Intente nuevamente.");
    document.getElementById("password").value = "";
    document.getElementById("password").focus();
    return;
  }

  errorMsg.classList.remove("show");
  sessionStorage.setItem("contador", usuario);
  window.location.href = "/dashboard.html";
}

function togglePassword() {
  const input = document.getElementById("password");
  const btn   = document.querySelector(".toggle-pass");
  if (input.type === "password") {
    input.type      = "text";
    btn.textContent = "🙈";
  } else {
    input.type      = "password";
    btn.textContent = "👁";
  }
}

// Exponer funciones al HTML (necesario con módulos ES)
window.validarLogin   = validarLogin;
window.togglePassword = togglePassword;

// Iniciar carga de contadores
cargarContadores();
