import { db } from './firebase-config.js';
import {
  collection, getDocs, query, where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Cargar usuarios activos en el select
async function cargarUsuarios() {
  const select = document.getElementById('usuario');
  try {
    const snap = await getDocs(query(collection(db, 'usuarios'), where('activo', '==', true)));
    const usuarios = [];
    snap.forEach(d => usuarios.push(d.data()));
    usuarios.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

    select.innerHTML = '<option value="">— Seleccione su nombre —</option>';
    usuarios.forEach(u => {
      const opt = document.createElement('option');
      opt.value       = u.nombre;
      opt.textContent = u.nombre;
      opt.dataset.rol         = u.rol         || '';
      opt.dataset.password    = u.password    || '';
      opt.dataset.ccUsuario   = u.cc_usuario  || '';
      opt.dataset.ccPassword  = u.cc_password || '';
      select.appendChild(opt);
    });
  } catch (err) {
    select.innerHTML = '<option value="">Error al cargar usuarios</option>';
    console.error(err);
  }
}

// Validar login
async function validarLogin(e) {
  e.preventDefault();

  const select    = document.getElementById('usuario');
  const opt       = select.options[select.selectedIndex];
  const nombre    = opt?.value || '';
  const password  = document.getElementById('password').value;
  const errorMsg  = document.getElementById('errorMsg');
  const btnSpan   = document.querySelector('.btn-login span');

  const mostrarError = (msg) => {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('show');
    void errorMsg.offsetWidth;
    errorMsg.classList.add('show');
    btnSpan.textContent = '[ Ingresar al Sistema ]';
  };

  if (!nombre)   return mostrarError('⚠ Seleccione su nombre de usuario.');
  if (!password) return mostrarError('⚠ Ingrese su clave de acceso.');

  btnSpan.textContent = '[ Verificando... ]';
  errorMsg.classList.remove('show');

  if (opt.dataset.password !== password) {
    return mostrarError('⚠ Clave incorrecta.');
  }

  // Guardar sesión
  sessionStorage.setItem('contador', nombre);
  sessionStorage.setItem('rol',      opt.dataset.rol);
  if (opt.dataset.ccUsuario)  sessionStorage.setItem('cc_usuario',  opt.dataset.ccUsuario);
  if (opt.dataset.ccPassword) sessionStorage.setItem('cc_password', opt.dataset.ccPassword);

  window.location.href = '/dashboard.html';
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

// Partículas de fondo
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

window.validarLogin   = validarLogin;
window.togglePassword = togglePassword;

cargarUsuarios();
