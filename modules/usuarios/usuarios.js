/**
 * modules/usuarios/usuarios.js
 * CRUD de usuarios — solo accesible por administrador.
 */

import { db } from '/firebase-config.js';
import {
  collection, getDocs, addDoc, doc, updateDoc, deleteDoc
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
    abogado:        ['ABOGADO',        'badge-abog'],
    asistencial:    ['ASISTENCIAL',    'badge-asis'],
    pago:           ['PAGO',           'badge-pago'],
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

    const btnEditar   = `<button class="btn-action btn-editar"    data-id="${u.id}">Editar</button>`;
    const btnEliminar = `<button class="btn-action btn-eliminar" data-id="${u.id}">Eliminar</button>`;

    return `
      <tr>
        <td>${u.nombre}</td>
        <td>${badgeRol(u.rol)}</td>
        <td>${badgeEstado(u.activo)}</td>
        <td><div class="actions-cell">${btnToggle}${btnEditar}${btnEliminar}</div></td>
      </tr>
    `;
  }).join('');

  // Eventos en botones de toggle
  tbody.querySelectorAll('.btn-toggle-on, .btn-toggle-off').forEach(btn => {
    btn.addEventListener('click', () => {
      const id     = btn.dataset.id;
      const activo = btn.dataset.activo === 'true';
      const user   = todosLosUsuarios.find(u => u.id === id);
      confirmarToggle(user, activo);
    });
  });

  // Eventos en botones de editar
  tbody.querySelectorAll('.btn-editar').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.id;
      const user = todosLosUsuarios.find(u => u.id === id);
      abrirModalEditar(user);
    });
  });

  // Eventos en botones de eliminar
  tbody.querySelectorAll('.btn-eliminar').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.id;
      const user = todosLosUsuarios.find(u => u.id === id);
      confirmarEliminar(user);
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
function confirmarEliminar(user) {
  modalTitle.textContent   = '¿ELIMINAR usuario?';
  modalBody.textContent    = `${user.nombre} — esta acción no se puede deshacer.`;
  btnModalConf.textContent = 'ELIMINAR';
  btnModalConf.style.borderColor = '#ff6080';
  btnModalConf.style.color       = '#ff6080';
  modalCallback = () => eliminarUsuario(user.id, user.nombre);
  modalOverlay.style.display = 'flex';
}

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
  btnModalConf.style.borderColor = '';
  btnModalConf.style.color       = '';
};

async function eliminarUsuario(id, nombre) {
  try {
    await deleteDoc(doc(db, 'usuarios', id));
    todosLosUsuarios = todosLosUsuarios.filter(u => u.id !== id);
    renderTabla();
    msgTabla.textContent = `✔ "${nombre}" eliminado.`;
    msgTabla.style.color = '#ff6080';
    setTimeout(() => { msgTabla.textContent = ''; }, 3000);
  } catch (err) {
    msgTabla.textContent = '✘ Error: ' + err.message;
    msgTabla.style.color = '#ff6080';
  }
}

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

// ── Modal editar usuario ─────────────────────────────────────────────────────
const modalEditar       = document.getElementById('modal-editar');
const editNombreDisplay = document.getElementById('edit-nombre-display');
const editRol           = document.getElementById('edit-rol');
const editPassword      = document.getElementById('edit-password');
const editCcSection     = document.getElementById('edit-cc-section');
const editCcUsuario     = document.getElementById('edit-cc-usuario');
const editCcPassword    = document.getElementById('edit-cc-password');
const btnGuardarEdicion = document.getElementById('btn-guardar-edicion');
const msgEditar         = document.getElementById('msg-editar');

let editUserId = null;

function abrirModalEditar(user) {
  editUserId = user.id;
  editNombreDisplay.textContent = user.nombre;
  editRol.value      = user.rol;
  editPassword.value = '';
  editCcUsuario.value  = user.cc_usuario  || '';
  editCcPassword.value = '';
  // Mostrar sección CC solo para contadores
  editCcSection.style.display = user.rol === 'contador' ? 'block' : 'none';
  msgEditar.textContent = '';
  modalEditar.style.display = 'flex';
}

// Mostrar/ocultar sección CC al cambiar rol
editRol.addEventListener('change', () => {
  editCcSection.style.display = editRol.value === 'contador' ? 'block' : 'none';
});

window.cerrarModalEditar = function () {
  modalEditar.style.display = 'none';
  editUserId = null;
};

btnGuardarEdicion.addEventListener('click', async () => {
  if (!editUserId) return;

  const nuevoRol      = editRol.value;
  const nuevaPassword = editPassword.value.trim();
  const nuevoCcUser   = editCcUsuario.value.trim();
  const nuevoCcPass   = editCcPassword.value.trim();

  const updates = { rol: nuevoRol };
  if (nuevaPassword) updates.password = nuevaPassword;
  if (nuevoRol === 'contador') {
    if (nuevoCcUser) updates.cc_usuario = nuevoCcUser;
    if (nuevoCcPass) updates.cc_password = nuevoCcPass;
  }

  btnGuardarEdicion.disabled = true;
  msgEditar.textContent = 'Guardando...';
  msgEditar.style.color = 'var(--cyan)';

  try {
    await updateDoc(doc(db, 'usuarios', editUserId), updates);
    const u = todosLosUsuarios.find(u => u.id === editUserId);
    if (u) {
      u.rol = nuevoRol;
      if (nuevaPassword) u.password = nuevaPassword;
      if (nuevoCcUser)   u.cc_usuario = nuevoCcUser;
      if (nuevoCcPass)   u.cc_password = nuevoCcPass;
    }
    renderTabla();
    msgEditar.textContent = '✔ Cambios guardados.';
    msgEditar.style.color = '#00ff88';
    setTimeout(() => cerrarModalEditar(), 1200);
  } catch (err) {
    msgEditar.textContent = '✘ Error: ' + err.message;
    msgEditar.style.color = '#ff6080';
  } finally {
    btnGuardarEdicion.disabled = false;
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────
cargarUsuarios();

// ═══════════════════════════════════════════════════════════════════════════════
// USUARIOS MÓDULO ANÁLISIS  (colección: analisis_usuarios)
// ═══════════════════════════════════════════════════════════════════════════════

const formNuevoAnalisis  = document.getElementById('form-nuevo-analisis');
const auUsuario          = document.getElementById('au-usuario');
const auPassword         = document.getElementById('au-password');
const btnCrearAnalisis   = document.getElementById('btn-crear-analisis');
const msgFormAnalisis    = document.getElementById('msg-form-analisis');
const tbodyAnalisis      = document.getElementById('tbody-analisis');
const msgTablaAnalisis   = document.getElementById('msg-tabla-analisis');

let analisisUsuarios = [];

async function cargarAnalisisUsuarios() {
  tbodyAnalisis.innerHTML = '<tr><td colspan="2" class="table-loading">Cargando...</td></tr>';
  try {
    const snap = await getDocs(collection(db, 'analisis_usuarios'));
    analisisUsuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    analisisUsuarios.sort((a, b) => a.usuario.localeCompare(b.usuario));
    renderTablaAnalisis();
  } catch (err) {
    tbodyAnalisis.innerHTML = `<tr><td colspan="2" class="table-loading">Error: ${err.message}</td></tr>`;
  }
}

function renderTablaAnalisis() {
  if (!analisisUsuarios.length) {
    tbodyAnalisis.innerHTML = '<tr><td colspan="2" class="table-empty">Sin usuarios registrados.</td></tr>';
    return;
  }
  tbodyAnalisis.innerHTML = analisisUsuarios.map(u => `
    <tr>
      <td>${u.usuario}</td>
      <td><div class="actions-cell">
        <button class="btn-action btn-eliminar" data-aid="${u.id}" data-ausu="${u.usuario}">Eliminar</button>
      </div></td>
    </tr>
  `).join('');

  tbodyAnalisis.querySelectorAll('.btn-eliminar').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.aid;
      const user = btn.dataset.ausu;
      modalTitle.textContent   = '¿ELIMINAR usuario Análisis?';
      modalBody.textContent    = `"${user}" — esta acción no se puede deshacer.`;
      btnModalConf.textContent = 'ELIMINAR';
      btnModalConf.style.borderColor = '#ff6080';
      btnModalConf.style.color       = '#ff6080';
      modalCallback = () => eliminarAnalisisUsuario(id, user);
      modalOverlay.style.display = 'flex';
    });
  });
}

formNuevoAnalisis.addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario  = auUsuario.value.trim();
  const password = auPassword.value.trim();
  if (!usuario || !password) {
    showMsg(msgFormAnalisis, 'Complete todos los campos.', 'err');
    return;
  }
  btnCrearAnalisis.disabled = true;
  showMsg(msgFormAnalisis, 'Guardando...', '');
  try {
    await addDoc(collection(db, 'analisis_usuarios'), { usuario, password });
    showMsg(msgFormAnalisis, '✔ Usuario creado correctamente.', 'ok');
    formNuevoAnalisis.reset();
    await cargarAnalisisUsuarios();
  } catch (err) {
    showMsg(msgFormAnalisis, '✘ Error: ' + err.message, 'err');
  } finally {
    btnCrearAnalisis.disabled = false;
  }
});

async function eliminarAnalisisUsuario(id, usuario) {
  try {
    await deleteDoc(doc(db, 'analisis_usuarios', id));
    analisisUsuarios = analisisUsuarios.filter(u => u.id !== id);
    renderTablaAnalisis();
    msgTablaAnalisis.textContent = `✔ "${usuario}" eliminado.`;
    msgTablaAnalisis.style.color = '#ff6080';
    setTimeout(() => { msgTablaAnalisis.textContent = ''; }, 3000);
  } catch (err) {
    msgTablaAnalisis.textContent = '✘ Error: ' + err.message;
    msgTablaAnalisis.style.color = '#ff6080';
  }
}

cargarAnalisisUsuarios();
