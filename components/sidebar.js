/**
 * components/sidebar.js
 * Genera el sidebar de navegación dinámicamente, filtrando módulos por rol.
 */

const ALL_MODULES = [
  { id: 'noticias',     label: 'Noticias',         icon: '◉', path: '/modules/noticias/noticias.html',         desc: 'Comunicados y avisos institucionales' },
  { id: 'usuarios',     label: 'Gestión Usuarios', icon: '◇', path: '/modules/usuarios/usuarios.html',         desc: 'Administración de usuarios' },
  { id: 'reparto',      label: 'Reparto',           icon: '◈', path: '/modules/reparto/reparto.html',           desc: 'Distribución de expedientes' },
  { id: 'asignaciones', label: 'Asignaciones',      icon: '◎', path: '/modules/asignaciones/asignaciones.html', desc: 'Asignación de casos' },
  { id: 'actas',        label: 'Actas',             icon: '◉', path: '/modules/actas/actas.html',               desc: 'Gestión de actas' },
  { id: 'cuentas',      label: 'Cuentas',           icon: '◆', path: '/modules/cuentas/cuentas.html',           desc: 'Control de cuentas' },
  { id: 'revision',     label: 'Revisión',          icon: '◌', path: 'https://portal-cc-cne.onrender.com', desc: 'Revisión y auditoría — Portal Cuentas Claras' },
  { id: 'resumen',      label: 'Resumen',            icon: '◑', path: '/modules/resumen/resumen.html',             desc: 'Indicadores generales' },
  { id: 'sorteo',       label: 'Sorteo',             icon: '⬡', path: '/modules/sorteo/sorteo.html',               desc: 'Sorteo de cuentas' },
  { id: 'carpetas',          label: 'Carpetas',       icon: '▣', path: '/modules/carpetas/carpetas.html',                      desc: 'Carpetas por número de acta' },
  { id: 'revision-carpetas', label: 'Rev. Carpetas',  icon: '◧', path: '/modules/revision-carpetas/revision-carpetas.html',  desc: 'Revisión de carpetas por acta' },
  { id: 'tablero',           label: 'Tablero',        icon: '⬡', path: '/modules/tablero/tablero.html',                       desc: 'Vista general de indicadores ET2023' },

  { id: 'consultor',         label: 'Consultor ET2023', icon: '⬟', path: '/modules/consultor/consultor.html',                   desc: 'Consultor ET2023' },
  { id: 'chat',              label: 'Chat',           icon: '◈', path: '/modules/chat/chat.html',                              desc: 'Chat institucional' },
  { id: 'descarga-pdf',      label: 'Descarga PDF',   icon: '◧', path: '/modules/descarga-pdf/descarga-pdf.html',              desc: 'Descarga de documentos AUTOCASH' },
  { id: 'horas-extras',      label: 'Horas Extras',   icon: '⏱', path: '/modules/horas-extras/horas-extras.html',              desc: 'Registro y seguimiento de horas extras' },
  { id: 'verificacion',      label: 'Verificación',   icon: '◉', path: '/modules/horas-extras/horas-extras.html',              desc: 'Verificación de horas extras' },
  { id: 'pagos',             label: 'Pagos',          icon: '◈', path: '/modules/pagos/pagos.html',                            desc: 'Registro de reconocimientos y pagos' },
  { id: 'carlitos',          label: 'Carlitos',       icon: '🤖', path: '/modules/carlitos/carlitos.html',                        desc: 'Asistente IA para análisis CNE' },
  { id: 'reportes',          label: 'Reportes',       icon: '◫', path: '/modules/reportes/reportes.html',                        desc: 'Exportación de reportes ET2023' },
  { id: 'calendario',           label: 'Calendario',        icon: '◈', path: '/modules/calendario/calendario.html',                             desc: 'Fechas clave y plazos ET2023' },
  { id: 'dashboard-ejecutivo', label: 'Dashboard Ejecutivo', icon: '◑', path: '/modules/dashboard-ejecutivo/dashboard-ejecutivo.html',           desc: 'Indicadores ejecutivos del proceso' },
  { id: 'requerimientos',      label: 'Requerimientos',      icon: '◌', path: '/modules/requerimientos/requerimientos.html',                      desc: 'Oficios y requerimientos a partidos' },
];

const MODULES_BY_ROLE = {
  administrador:  ['noticias', 'usuarios', 'reparto', 'asignaciones', 'actas', 'cuentas', 'revision', 'resumen', 'tablero', 'sorteo', 'carpetas', 'revision-carpetas', 'consultor', 'chat', 'descarga-pdf', 'horas-extras', 'pagos', 'carlitos', 'reportes', 'calendario', 'dashboard-ejecutivo', 'requerimientos'],
  administrativo: ['noticias', 'reparto', 'asignaciones', 'resumen', 'tablero', 'sorteo', 'revision-carpetas', 'consultor', 'chat', 'horas-extras', 'carlitos', 'reportes', 'calendario', 'dashboard-ejecutivo', 'requerimientos'],
  contador:       ['noticias', 'actas', 'cuentas', 'revision', 'resumen', 'tablero', 'carpetas', 'chat', 'descarga-pdf', 'horas-extras', 'carlitos', 'reportes', 'calendario', 'requerimientos'],
  abogado:        ['noticias', 'consultor', 'chat', 'horas-extras', 'carlitos'],
  asistencial:    ['noticias', 'chat', 'horas-extras', 'carlitos'],
  pago:           ['noticias', 'reparto', 'consultor', 'chat', 'horas-extras', 'pagos', 'carlitos'],
};

const ROL_LABELS = {
  administrador:  'Administrador',
  administrativo: 'Administrativo',
  contador:       'Contador',
  abogado:        'Abogado',
  asistencial:    'Asistencial',
  pago:           'Pago',
};

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICACIONES
// ══════════════════════════════════════════════════════════════════════════════
const NOTIF_KEY = 'fnfpce_notif_leidas';

function getLeidas() {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]')); } catch { return new Set(); }
}
function guardarLeidas(set) {
  localStorage.setItem(NOTIF_KEY, JSON.stringify([...set]));
}

window._notifDatos = [];

window.toggleNotifPanel = function() {
  const panel = document.getElementById('sb-notif-panel');
  if (!panel) return;
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'flex';
  panel.style.flexDirection = 'column';
  if (!visible) cargarNotificaciones();
};

window.cargarNotificaciones = async function() {
  const lista = document.getElementById('sb-notif-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="notif-empty">Cargando…</div>';

  // Importar Firestore dinámicamente para no romper páginas sin Firebase
  try {
    const { getFirestore, collection, getDocs, orderBy, query, limit } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { app } = await import('/firebase-config.js');
    const db = getFirestore(app);

    const q    = query(collection(db, 'notificaciones'), orderBy('fecha', 'desc'), limit(30));
    const snap = await getDocs(q);
    const usuario = Auth.getContador() || '';
    const rol     = Auth.getRole()     || '';

    const leidas = getLeidas();
    // Filtrar solo las del usuario actual o globales
    const items = snap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .filter(n => !n.para || n.para === usuario || n.para === rol || n.para === 'todos');

    window._notifDatos = items;
    const noLeidas = items.filter(n => !leidas.has(n._id)).length;

    // Badge
    const badge = document.getElementById('sb-notif-badge');
    if (badge) {
      badge.style.display = noLeidas > 0 ? '' : 'none';
      badge.textContent   = noLeidas;
    }

    if (!items.length) {
      lista.innerHTML = '<div class="notif-empty">Sin notificaciones</div>';
      return;
    }

    lista.innerHTML = items.map(n => {
      const leida = leidas.has(n._id);
      const fecha = n.fecha ? new Date(n.fecha).toLocaleDateString('es-CO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
      return `<div class="notif-item ${leida ? '' : 'no-leida'}">
        <div class="notif-item-txt">${n.texto || ''}</div>
        <div class="notif-item-meta">${n.modulo || ''} · ${fecha}</div>
      </div>`;
    }).join('');
  } catch (e) {
    lista.innerHTML = `<div class="notif-empty">Error: ${e.message}</div>`;
  }
};

window.marcarTodasLeidas = function() {
  const leidas = getLeidas();
  window._notifDatos.forEach(n => leidas.add(n._id));
  guardarLeidas(leidas);
  const badge = document.getElementById('sb-notif-badge');
  if (badge) badge.style.display = 'none';
  cargarNotificaciones();
};

// ── Alertas automáticas de vencimiento ───────────────────────────────────────
// Revisa eventos del calendario y requerimientos que vencen en los próximos 3 días
// y publica notificaciones si aún no existen.
window.verificarVencimientos = async function() {
  try {
    const { getFirestore, collection, getDocs, addDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { app } = await import('/firebase-config.js');
    const db = getFirestore(app);

    const HOY = new Date();
    HOY.setHours(0, 0, 0, 0);
    const LIMITE = new Date(HOY);
    LIMITE.setDate(LIMITE.getDate() + 3); // próximos 3 días
    const hoyStr   = HOY.toISOString().slice(0, 10);
    const limStr   = LIMITE.toISOString().slice(0, 10);

    // Leer eventos del calendario
    const snapEv = await getDocs(collection(db, 'eventos_calendario'));
    const eventos = snapEv.docs.map(d => ({ _id: d.id, ...d.data() }));

    // Leer requerimientos pendientes
    const snapReq = await getDocs(collection(db, 'requerimientos'));
    const reqs = snapReq.docs.map(d => ({ _id: d.id, ...d.data() }));

    // Leer notificaciones ya existentes de hoy para no duplicar
    const snapNotif = await getDocs(collection(db, 'notificaciones'));
    const notifHoy = new Set(
      snapNotif.docs
        .map(d => d.data())
        .filter(n => (n.fecha || '').slice(0, 10) === hoyStr && n.autoAlerta)
        .map(n => n.refId)
    );

    const nuevas = [];

    // Alertas de eventos próximos
    eventos
      .filter(e => e.fecha >= hoyStr && e.fecha <= limStr)
      .forEach(e => {
        const key = `ev_${e._id}`;
        if (!notifHoy.has(key)) {
          const dias = Math.round((new Date(e.fecha) - HOY) / 86400000);
          const cuandoStr = dias === 0 ? 'hoy' : `en ${dias} día${dias > 1 ? 's' : ''}`;
          nuevas.push({
            texto: `⚠ Evento "${e.titulo}" vence ${cuandoStr} (${e.fecha})`,
            modulo: 'Calendario',
            para: 'todos',
            fecha: new Date().toISOString(),
            autor: 'Sistema',
            autoAlerta: true,
            refId: key,
          });
        }
      });

    // Alertas de requerimientos con plazo próximo
    reqs
      .filter(r => r.estado === 'PENDIENTE' && r.plazoRespuesta >= hoyStr && r.plazoRespuesta <= limStr)
      .forEach(r => {
        const key = `req_${r._id}`;
        if (!notifHoy.has(key)) {
          const dias = Math.round((new Date(r.plazoRespuesta) - HOY) / 86400000);
          const cuandoStr = dias === 0 ? 'hoy' : `en ${dias} día${dias > 1 ? 's' : ''}`;
          nuevas.push({
            texto: `⚠ Requerimiento "${r.numero}" a ${r.partido} vence ${cuandoStr}`,
            modulo: 'Requerimientos',
            para: 'todos',
            fecha: new Date().toISOString(),
            autor: 'Sistema',
            autoAlerta: true,
            refId: key,
          });
        }
      });

    // Publicar nuevas alertas
    for (const n of nuevas) {
      await addDoc(collection(db, 'notificaciones'), n);
    }

    // Actualizar badge si hay nuevas
    if (nuevas.length > 0) cargarNotificaciones();
  } catch (_) { /* silencioso en páginas sin Firebase */ }
};

// Publicar notificación (se llama desde otros módulos)
window.publicarNotificacion = async function(texto, modulo, para) {
  try {
    const { getFirestore, collection, addDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { app } = await import('/firebase-config.js');
    const db = getFirestore(app);
    await addDoc(collection(db, 'notificaciones'), {
      texto,
      modulo: modulo || '',
      para:   para   || 'todos',
      fecha:  new Date().toISOString(),
      autor:  Auth.getContador() || '',
    });
  } catch (_) { /* silencioso */ }
};

function renderSidebar(activeId = '') {
  const nombre  = Auth.getContador() || 'Usuario';
  const rol     = Auth.getRole() || 'contador';
  const allowed = MODULES_BY_ROLE[rol] || [];

  const modules = ALL_MODULES.filter(m => allowed.includes(m.id));

  const navItems = modules.map(m => {
    const isExternal = m.path.startsWith('http');
    return `
    <li class="nav-item ${m.id === activeId ? 'active' : ''}">
      <a href="${m.path}" class="nav-link" ${isExternal ? 'target="_blank" rel="noopener"' : ''}>
        <span class="nav-icon">${m.icon}</span>
        <span class="nav-label">${m.label}</span>
      </a>
    </li>`;
  }).join('');

  const html = `
    <aside class="sidebar">
      <div class="sidebar-scan"></div>

      <div class="sidebar-brand">
        <div class="sidebar-logo">F</div>
        <div class="sidebar-brand-text">
          <div class="brand-name">FNFPCE</div>
          <div class="brand-sub">Sistema ET2023</div>
        </div>
      </div>

      <div class="sidebar-user">
        <div class="user-avatar">◈</div>
        <div class="user-info">
          <div class="user-name">${nombre}</div>
          <div class="user-role">// ${ROL_LABELS[rol] || rol}</div>
        </div>
      </div>

      <nav class="sidebar-nav">
        <div class="nav-title">MÓDULOS</div>
        <ul>${navItems}</ul>
      </nav>

      <div class="sidebar-footer">
        <button class="btn-buscar" onclick="abrirBusquedaGlobal ? abrirBusquedaGlobal() : null" title="Búsqueda global (Ctrl+K)">⌕ Buscar <kbd style="font-size:9px;opacity:.5;border:1px solid rgba(0,212,255,.3);border-radius:3px;padding:0 4px">Ctrl K</kbd></button>
        <button class="btn-notif" id="sb-notif-btn" onclick="toggleNotifPanel()">
          🔔 <span id="sb-notif-badge" class="notif-badge" style="display:none">0</span>
        </button>
        <button class="btn-logout" onclick="Auth.logout()">⏻ Cerrar Sesión</button>
        <div class="sidebar-version">v1.0 &mdash; ET2023</div>
      </div>
      <!-- Panel notificaciones -->
      <div id="sb-notif-panel" class="notif-panel" style="display:none">
        <div class="notif-panel-title">🔔 NOTIFICACIONES</div>
        <div id="sb-notif-lista" class="notif-lista">
          <div class="notif-empty">Sin notificaciones nuevas</div>
        </div>
        <button class="notif-marcar-btn" onclick="marcarTodasLeidas()">✓ Marcar todas como leídas</button>
      </div>
    </aside>
  `;

  const container = document.getElementById('sidebar-container');
  if (container) container.innerHTML = html;

  // Cargar notif badge y verificar vencimientos al iniciar
  setTimeout(() => {
    cargarNotificaciones();
    verificarVencimientos();
  }, 1200);

  // Inyectar búsqueda global si no está ya cargada
  if (!document.getElementById('bg-overlay')) {
    const s = document.createElement('script');
    s.src = '/components/busqueda-global.js';
    document.body.appendChild(s);
  }
}
