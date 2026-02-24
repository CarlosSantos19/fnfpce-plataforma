/**
 * modules/usuarios/usuarios.js
 * CRUD de usuarios — solo accesible por administrador.
 */

import { db } from '/firebase-config.js';
import {
  collection, getDocs, addDoc, doc, updateDoc, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Verificar rol ────────────────────────────────────────────────────────────
Auth.requireRole(['administrador']);
renderSidebar('usuarios');

// ── Referencias DOM ──────────────────────────────────────────────────────────
const formNuevo     = document.getElementById('form-nuevo-usuario');
const inputNombre   = document.getElementById('input-nombre');
const inputRol      = document.getElementById('input-rol');
const inputPassword = document.getElementById('input-password');
const btnCrear      = document.getElementById('btn-crear');
const msgForm       = document.getElementById('msg-form');
const tbody         = document.getElementById('tbody-usuarios');
const msgTabla      = document.getElementById('msg-tabla');
const filtroRol     = document.getElementById('filtro-rol');
const filtroEstado  = document.getElementById('filtro-estado');
const modalOverlay  = document.getElementById('modal-confirm');
const modalTitle    = document.getElementById('modal-title');
const modalBody     = document.getElementById('modal-body');
const btnModalConf  = document.getElementById('btn-modal-confirm');

// ── Estado local ─────────────────────────────────────────────────────────────
let todosLosUsuarios = [];
let modalCallback    = null;

// ── Helpers ──────────────────────────────────────────────────────────────────
function showMsg(el, texto, tipo) {
  el.textContent = texto;
  el.className   = 'form-msg ' + tipo;
  if (tipo === 'ok') setTimeout(() => { el.textContent = ''; el.className = 'form-msg'; }, 3000);
}

function badgeRol(rol) {
  const map = {
    administrador:  ['ADMINISTRADOR', 'badge-admin'],
    administrativo: ['ADMINISTRATIVO', 'badge-adm'],
    contador:       ['CONTADOR',       'badge-cont'],
  };
  const [label, cls] = map[rol] || [rol, ''];
  return `<span class="badge ${cls}">${label}</span>`;
}

function badgeEstado(activo) {
  return activo
    ? '<span class="badge badge-activo">ACTIVO</span>'
    : '<span class="badge badge-inactivo">INACTIVO</span>';
}

// ── Cargar usuarios desde Firestore ─────────────────────────────────────────
async function cargarUsuarios() {
  tbody.innerHTML = '<tr><td colspan="4" class="table-loading">Cargando...</td></tr>';
  try {
    const snap = await getDocs(collection(db, 'usuarios'));
    todosLosUsuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todosLosUsuarios.sort((a, b) => a.nombre.localeCompare(b.nombre));
    renderTabla();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-loading">Error al cargar: ${err.message}</td></tr>`;
  }
}

// ── Renderizar tabla con filtros ─────────────────────────────────────────────
function renderTabla() {
  const rfil = filtroRol.value;
  const efil = filtroEstado.value;

  let lista = todosLosUsuarios;
  if (rfil)  lista = lista.filter(u => u.rol === rfil);
  if (efil !== '') lista = lista.filter(u => String(u.activo) === efil);

  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Sin usuarios para los filtros seleccionados.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(u => {
    const btnToggle = u.activo
      ? `<button class="btn-action btn-toggle-on"  data-id="${u.id}" data-activo="false">Desactivar</button>`
      : `<button class="btn-action btn-toggle-off" data-id="${u.id}" data-activo="true">Activar</button>`;

    return `
      <tr>
        <td>${u.nombre}</td>
        <td>${badgeRol(u.rol)}</td>
        <td>${badgeEstado(u.activo)}</td>
        <td><div class="actions-cell">${btnToggle}</div></td>
      </tr>
    `;
  }).join('');

  // Eventos en botones de toggle
  tbody.querySelectorAll('.btn-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const id     = btn.dataset.id;
      const activo = btn.dataset.activo === 'true';
      const user   = todosLosUsuarios.find(u => u.id === id);
      confirmarToggle(user, activo);
    });
  });
}

// ── Filtros ──────────────────────────────────────────────────────────────────
filtroRol.addEventListener('change', renderTabla);
filtroEstado.addEventListener('change', renderTabla);

// ── Crear usuario ────────────────────────────────────────────────────────────
formNuevo.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre   = inputNombre.value.trim();
  const rol      = inputRol.value;
  const password = inputPassword.value.trim();

  if (!nombre || !rol || !password) {
    showMsg(msgForm, 'Complete todos los campos.', 'err');
    return;
  }

  btnCrear.disabled = true;
  showMsg(msgForm, 'Guardando...', '');

  try {
    await addDoc(collection(db, 'usuarios'), { nombre, rol, password, activo: true });
    showMsg(msgForm, '✔ Usuario creado correctamente.', 'ok');
    formNuevo.reset();
    await cargarUsuarios();
  } catch (err) {
    showMsg(msgForm, '✘ Error: ' + err.message, 'err');
  } finally {
    btnCrear.disabled = false;
  }
});

// ── Modal de confirmación ────────────────────────────────────────────────────
function confirmarToggle(user, nuevoActivo) {
  const accion = nuevoActivo ? 'ACTIVAR' : 'DESACTIVAR';
  modalTitle.textContent = `¿${accion} usuario?`;
  modalBody.textContent  = `${user.nombre} — ${user.rol}`;
  btnModalConf.textContent = accion;
  modalCallback = () => toggleUsuario(user.id, nuevoActivo);
  modalOverlay.style.display = 'flex';
}

btnModalConf.addEventListener('click', () => {
  if (modalCallback) modalCallback();
  cerrarModal();
});

window.cerrarModal = function () {
  modalOverlay.style.display = 'none';
  modalCallback = null;
};

async function toggleUsuario(id, activo) {
  try {
    await updateDoc(doc(db, 'usuarios', id), { activo });
    const u = todosLosUsuarios.find(u => u.id === id);
    if (u) u.activo = activo;
    renderTabla();
    msgTabla.textContent = activo ? '✔ Usuario activado.' : '✔ Usuario desactivado.';
    msgTabla.style.color = activo ? '#00ff88' : '#ff6080';
    setTimeout(() => { msgTabla.textContent = ''; }, 3000);
  } catch (err) {
    msgTabla.textContent = '✘ Error: ' + err.message;
    msgTabla.style.color = '#ff6080';
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
cargarUsuarios();
