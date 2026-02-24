/**
 * login.js
 * Autenticación con validación de nombre + contraseña contra Firestore.
 * Guarda nombre y rol en sessionStorage al autenticar.
 */

import { db } from './firebase-config.js';
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Cargar usuarios activos desde Firestore
async function cargarContadores() {
  const select   = document.getElementById('usuario');
  const errorMsg = document.getElementById('errorMsg');

  try {
    const q        = query(collection(db, 'usuarios'), where('activo', '==', true));
    const snapshot = await getDocs(q);

    const nombres = [];
    snapshot.forEach(doc => nombres.push(doc.data().nombre));
    nombres.sort((a, b) => a.localeCompare(b));

    // Limpiar y poblar el select
    select.innerHTML = '<option value="">— Seleccione su nombre —</option>';
    nombres.forEach(nombre => {
      const opt       = document.createElement('option');
      opt.value       = nombre;
      opt.textContent = nombre;
      select.appendChild(opt);
    });

  } catch (err) {
    console.error('Error cargando usuarios:', err);
    errorMsg.textContent = '⚠ Error al conectar con el servidor. Intente más tarde.';
    errorMsg.classList.add('show');
  }
}

// Validar login contra Firestore
async function validarLogin(e) {
  e.preventDefault();

  const nombre   = document.getElementById('usuario').value;
  const password = document.getElementById('password').value;
  const errorMsg = document.getElementById('errorMsg');
  const btnLogin = document.querySelector('.btn-login span');

  const mostrarError = (msg) => {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('show');
    void errorMsg.offsetWidth;
    errorMsg.classList.add('show');
  };

  if (!nombre) {
    mostrarError('⚠ Seleccione su identificación.');
    return;
  }

  if (!password) {
    mostrarError('⚠ Ingrese su clave de acceso.');
    return;
  }

  btnLogin.textContent = '[ Verificando... ]';

  try {
    const q        = query(collection(db, 'usuarios'),
                           where('nombre', '==', nombre),
                           where('activo', '==', true));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      mostrarError('⚠ Usuario no encontrado o inactivo.');
      btnLogin.textContent = '[ Ingresar al Sistema ]';
      return;
    }

    const userData = snapshot.docs[0].data();

    if (userData.password !== password) {
      mostrarError('⚠ Clave de acceso inválida. Intente nuevamente.');
      document.getElementById('password').value = '';
      document.getElementById('password').focus();
      btnLogin.textContent = '[ Ingresar al Sistema ]';
      return;
    }

    // Autenticación exitosa
    sessionStorage.setItem('contador', userData.nombre);
    sessionStorage.setItem('rol',      userData.rol || 'contador');
    window.location.href = '/dashboard.html';

  } catch (err) {
    console.error('Error en login:', err);
    mostrarError('⚠ Error al conectar con el servidor.');
    btnLogin.textContent = '[ Ingresar al Sistema ]';
  }
}

// Mostrar/ocultar contraseña
function togglePassword() {
  const input = document.getElementById('password');
  const btn   = document.querySelector('.toggle-pass');
  if (input.type === 'password') {
    input.type      = 'text';
    btn.textContent = '🙈';
  } else {
    input.type      = 'password';
    btn.textContent = '👁';
  }
}

// Generar partículas de fondo
(function generarParticulas() {
  const container = document.getElementById('particles');
  for (let i = 0; i < 25; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left              = Math.random() * 100 + 'vw';
    p.style.animationDuration = (8 + Math.random() * 14) + 's';
    p.style.animationDelay    = (Math.random() * 12) + 's';
    p.style.width = p.style.height = (Math.random() > 0.5 ? '2px' : '1px');
    p.style.opacity = Math.random() * 0.5;
    container.appendChild(p);
  }
})();

// Exponer funciones al HTML
window.validarLogin   = validarLogin;
window.togglePassword = togglePassword;

// Iniciar
cargarContadores();
