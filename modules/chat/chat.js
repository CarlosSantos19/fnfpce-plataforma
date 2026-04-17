/**
 * modules/chat/chat.js
 * Chat institucional — Canal general + mensajes directos (DM)
 */

import { db } from '/firebase-config.js';
import {
  collection, addDoc, query, orderBy, limit,
  onSnapshot, serverTimestamp, doc, setDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
Auth.requireAuth();
renderSidebar('chat');

const YO_NOMBRE = Auth.getContador() || 'Usuario';
const YO_ROL    = Auth.getRole()     || 'contador';

const ROL_LABELS = {
  administrador:  'Administrador',
  administrativo: 'Administrativo',
  contador:       'Contador',
  abogado:        'Abogado',
  asistencial:    'Asistencial',
  pago:           'Pago',
};

// ── Partículas ────────────────────────────────────────────────────────────────
(function () {
  const c = document.getElementById('particles');
  if (!c) return;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left              = Math.random() * 100 + 'vw';
    p.style.animationDuration = (8 + Math.random() * 14) + 's';
    p.style.animationDelay    = (Math.random() * 12) + 's';
    p.style.width = p.style.height = (Math.random() > 0.5 ? '2px' : '1px');
    p.style.opacity = String(Math.random() * 0.35);
    c.appendChild(p);
  }
})();

// ── DOM ───────────────────────────────────────────────────────────────────────
const messagesEl    = document.getElementById('chat-messages');
const inputEl       = document.getElementById('chat-input');
const sendBtn       = document.getElementById('chat-send');
const charCount     = document.getElementById('char-count');
const convIcon      = document.getElementById('conv-icon');
const convName      = document.getElementById('conv-name');
const convSub       = document.getElementById('conv-sub');
const chatPanel     = document.querySelector('.chat-panel');
const btnGeneral    = document.getElementById('btn-general');
const usuariosEl    = document.getElementById('usuarios-activos');

// ── Estado ────────────────────────────────────────────────────────────────────
let modoActual     = 'general'; // 'general' | 'dm'
let dmDestinatario = null;      // nombre del destinatario en DM
let unsubMensajes  = null;      // listener activo de mensajes

// ID de conversación DM — siempre el mismo sin importar quién inicia
function dmId(a, b) {
  return [a, b].sort().map(n => n.replace(/\s+/g, '_')).join('___');
}

// ── Presencia ─────────────────────────────────────────────────────────────────
const presenciaRef = doc(db, 'chat_presencia', YO_NOMBRE.replace(/\s+/g, '_'));

async function registrarPresencia() {
  await setDoc(presenciaRef, { nombre: YO_NOMBRE, rol: YO_ROL, ts: serverTimestamp() });
}

async function quitarPresencia() {
  try { await deleteDoc(presenciaRef); } catch (_) {}
}

window.addEventListener('beforeunload', quitarPresencia);
registrarPresencia();
setInterval(registrarPresencia, 180_000); // cada 3 min (TTL = 5 min)

// ── Escuchar usuarios presentes ───────────────────────────────────────────────
const PRESENCIA_TTL = 5 * 60 * 1000; // 5 minutos

onSnapshot(collection(db, 'chat_presencia'), snap => {
  const ahora = Date.now();
  const otros = snap.docs
    .map(d => d.data())
    .filter(u => {
      if (u.nombre === YO_NOMBRE) return false;
      if (!u.ts) return false;
      const tsMs = u.ts.toMillis ? u.ts.toMillis() : 0;
      return (ahora - tsMs) < PRESENCIA_TTL;
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  if (!otros.length) {
    usuariosEl.innerHTML = '<div class="conv-empty">Nadie más en línea</div>';
    return;
  }

  usuariosEl.innerHTML = otros.map(u => {
    const rolLabel = ROL_LABELS[u.rol] || u.rol;
    const esDmActivo = modoActual === 'dm' && dmDestinatario === u.nombre;
    return `
      <div class="conv-item ${esDmActivo ? 'active' : ''}"
           onclick="abrirDM('${escapeAttr(u.nombre)}', '${escapeAttr(u.rol)}')">
        <span class="conv-dot"></span>
        <div class="conv-info">
          <span class="conv-name">${escapeHtml(u.nombre)}</span>
          <span class="conv-sub">${rolLabel}</span>
        </div>
      </div>
    `;
  }).join('');
});

// ── Abrir canal general ───────────────────────────────────────────────────────
window.abrirGeneral = function () {
  modoActual     = 'general';
  dmDestinatario = null;

  btnGeneral.classList.add('active');
  chatPanel.classList.remove('dm');
  convIcon.textContent = '◎';
  convName.textContent = 'Canal General';
  convSub.textContent  = 'Todos los usuarios';
  inputEl.placeholder  = 'Escribe un mensaje al canal…';

  actualizarActivosUI();
  escucharMensajesGeneral();
};

// ── Abrir DM ──────────────────────────────────────────────────────────────────
window.abrirDM = function (nombre, rol) {
  modoActual     = 'dm';
  dmDestinatario = nombre;

  btnGeneral.classList.remove('active');
  chatPanel.classList.add('dm');
  convIcon.textContent = '◈';
  convName.textContent = escapeHtml(nombre);
  convSub.textContent  = 'Mensaje directo · ' + (ROL_LABELS[rol] || rol);
  inputEl.placeholder  = `Escribe a ${nombre}…`;
  inputEl.focus();

  actualizarActivosUI();
  escucharMensajesDM(nombre);
};

function actualizarActivosUI() {
  // Re-aplica clase active en items de usuarios
  document.querySelectorAll('#usuarios-activos .conv-item').forEach(el => {
    const onclick = el.getAttribute('onclick') || '';
    const match   = onclick.match(/abrirDM\('([^']+)'/);
    if (!match) return;
    el.classList.toggle('active', modoActual === 'dm' && dmDestinatario === match[1]);
  });
}

// ── Listener canal general ────────────────────────────────────────────────────
function escucharMensajesGeneral() {
  if (unsubMensajes) unsubMensajes();
  messagesEl.innerHTML = '<div class="chat-loading">Cargando…</div>';

  const q = query(
    collection(db, 'chat_mensajes'),
    orderBy('ts', 'asc'),
    limit(200)
  );

  let primera = true;
  unsubMensajes = onSnapshot(q, snap => {
    if (snap.empty) {
      messagesEl.innerHTML = '<div class="chat-loading">Sin mensajes aún. ¡Escribe el primero!</div>';
      primera = false;
      return;
    }
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMensajes(msgs);
    if (primera) { scrollAbajo(false); primera = false; }
    else scrollAbajo(true);
  });
}

// ── Listener DM ───────────────────────────────────────────────────────────────
function escucharMensajesDM(destino) {
  if (unsubMensajes) unsubMensajes();
  messagesEl.innerHTML = '<div class="chat-loading">Cargando…</div>';

  const convRef = doc(db, 'chat_dm', dmId(YO_NOMBRE, destino));
  const q = query(
    collection(convRef, 'mensajes'),
    orderBy('ts', 'asc'),
    limit(200)
  );

  let primera = true;
  unsubMensajes = onSnapshot(q, snap => {
    if (snap.empty) {
      messagesEl.innerHTML = `<div class="chat-loading">Sin mensajes con ${escapeHtml(destino)} aún.</div>`;
      primera = false;
      return;
    }
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMensajes(msgs);
    if (primera) { scrollAbajo(false); primera = false; }
    else scrollAbajo(true);
  });
}

// ── Enviar mensaje ────────────────────────────────────────────────────────────
async function enviarMensaje() {
  const texto = inputEl.value.trim();
  if (!texto) return;

  sendBtn.disabled = true;
  inputEl.disabled = true;

  try {
    const payload = { nombre: YO_NOMBRE, rol: YO_ROL, texto, ts: serverTimestamp() };

    if (modoActual === 'general') {
      await addDoc(collection(db, 'chat_mensajes'), payload);
    } else {
      const convRef = doc(db, 'chat_dm', dmId(YO_NOMBRE, dmDestinatario));
      // Guardar metadato del DM (para futuros listados)
      await setDoc(convRef, {
        participantes: [YO_NOMBRE, dmDestinatario].sort(),
        ultimoTs: serverTimestamp(),
      }, { merge: true });
      await addDoc(collection(convRef, 'mensajes'), payload);
    }

    inputEl.value = '';
    charCount.textContent = '0';
  } catch (err) {
    console.error('Error al enviar:', err);
  } finally {
    sendBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.focus();
  }
}

window.enviarMensaje = enviarMensaje;

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensaje(); }
});

inputEl.addEventListener('input', () => {
  charCount.textContent = inputEl.value.length;
});

// ── Renderizar mensajes agrupados ─────────────────────────────────────────────
function renderMensajes(msgs) {
  const grupos = [];
  let actual   = null;

  msgs.forEach(m => {
    if (!actual || actual.nombre !== m.nombre) {
      actual = { nombre: m.nombre, rol: m.rol, bubbles: [] };
      grupos.push(actual);
    }
    actual.bubbles.push({ texto: m.texto, ts: m.ts });
  });

  messagesEl.innerHTML = grupos.map(g => {
    const esPropio  = g.nombre === YO_NOMBRE;
    const rolClass  = 'role-' + (g.rol || 'contador');
    const rolLabel  = ROL_LABELS[g.rol] || g.rol;

    const burbujas = g.bubbles.map((b, i) => {
      const hora = b.ts?.toDate ? formatHora(b.ts.toDate()) : '';
      const esUltima = i === g.bubbles.length - 1;
      return `
        <div class="msg-bubble">${escapeHtml(b.texto)}</div>
        ${esUltima ? `<span class="msg-time">${hora}</span>` : ''}
      `;
    }).join('');

    return `
      <div class="msg-group ${esPropio ? 'own' : ''}">
        <div class="msg-meta">
          <span class="msg-author">${escapeHtml(g.nombre)}</span>
          <span class="msg-role-badge ${rolClass}">${rolLabel}</span>
        </div>
        ${burbujas}
      </div>
    `;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function scrollAbajo(suave) {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: suave ? 'smooth' : 'instant' });
}

function formatHora(date) {
  return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

// ── Iniciar en canal general ──────────────────────────────────────────────────
abrirGeneral();
