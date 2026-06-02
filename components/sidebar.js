/**
 * components/sidebar.js
 * Genera el sidebar de navegación dinámicamente, filtrando módulos por rol.
 */

const ALL_MODULES = [
  { id: 'noticias',     label: 'Noticias',          icon: '◉', path: '/modules/noticias/noticias.html',           desc: 'Comunicados y avisos institucionales' },
  { id: 'usuarios',     label: 'Gestión Usuarios',  icon: '◇', path: '/modules/usuarios/usuarios.html',           desc: 'Administración de usuarios' },
  { id: 'reparto',      label: 'Reparto',            icon: '◈', path: '/modules/reparto/reparto.html',             desc: 'Distribución de expedientes' },
  { id: 'asignaciones', label: 'Asignaciones',       icon: '◎', path: '/modules/asignaciones/asignaciones.html',  desc: 'Asignación de casos' },
  { id: 'actas',        label: 'Actas',              icon: '◉', path: '/modules/actas/actas.html',                 desc: 'Gestión de actas' },
  { id: 'cuentas',      label: 'Cuentas',            icon: '◆', path: '/modules/cuentas/cuentas.html',             desc: 'Control de cuentas' },
  { id: 'revision',          label: 'Revisión',           icon: '◌', path: '/modules/revision/revision.html',                      desc: 'Revisión y auditoría ET2023' },
  { id: 'resumen',      label: 'Resumen',            icon: '◑', path: '/modules/resumen/resumen.html',             desc: 'Indicadores generales' },
  { id: 'sorteo',       label: 'Sorteo',             icon: '⬡', path: '/modules/sorteo/sorteo.html',               desc: 'Sorteo de cuentas' },
  { id: 'carpetas',          label: 'Carpetas',        icon: '▣', path: '/modules/carpetas/carpetas.html',                     desc: 'Carpetas por número de acta' },
  { id: 'revision-carpetas', label: 'Rev. Carpetas',  icon: '◧', path: '/modules/revision-carpetas/revision-carpetas.html', desc: 'Revisión de carpetas por acta' },
  { id: 'tablero',           label: 'Tablero',         icon: '⬡', path: '/modules/tablero/tablero.html',                      desc: 'Vista general de indicadores ET2023' },
  { id: 'analisis',          label: 'Análisis',        icon: '◫', path: '/modules/analisis/analisis.html',                    desc: 'Análisis de cuentas electorales' },
  { id: 'consultor',         label: 'Consultas ET2023',icon: '⬟', path: '/modules/consultor/consultor.html',                  desc: 'Consultor de expedientes ET2023' },
  { id: 'chat',              label: 'Chat',            icon: '◈', path: '/modules/chat/chat.html',                             desc: 'Chat institucional' },
  { id: 'descarga-pdf',      label: 'Descarga PDF',    icon: '◧', path: '/modules/descarga-pdf/descarga-pdf.html',             desc: 'Descarga de documentos AUTOCASH' },
  { id: 'horas-extras',      label: 'Horas Extras',    icon: '⏱', path: '/modules/horas-extras/horas-extras.html',             desc: 'Registro y seguimiento de horas extras' },
  { id: 'pagos',             label: 'Pagos',           icon: '◈', path: '/modules/pagos/pagos.html',                           desc: 'Registro de reconocimientos y pagos' },
  { id: 'carlitos',          label: 'Carlitos',        icon: '🤖', path: '/modules/carlitos/carlitos.html',                     desc: 'Asistente IA para análisis CNE' },
  { id: 'reportes',          label: 'Reportes',        icon: '◫', path: '/modules/reportes/reportes.html',                     desc: 'Exportación de reportes ET2023' },
  { id: 'calendario',           label: 'Calendario',          icon: '◈', path: '/modules/calendario/calendario.html',                    desc: 'Fechas clave y plazos ET2023' },
  { id: 'dashboard-ejecutivo',  label: 'Dashboard Ejecutivo', icon: '◑', path: '/modules/dashboard-ejecutivo/dashboard-ejecutivo.html', desc: 'Indicadores ejecutivos del proceso' },
  { id: 'requerimientos',       label: 'Requerimientos',      icon: '◌', path: '/modules/requerimientos/requerimientos.html',            desc: 'Oficios y requerimientos a partidos' },
];

const MODULES_BY_ROLE = {
  administrador:  ['noticias', 'usuarios', 'reparto', 'asignaciones', 'actas', 'cuentas', 'revision', 'resumen', 'tablero', 'sorteo', 'carpetas', 'revision-carpetas', 'analisis', 'consultor', 'chat', 'descarga-pdf', 'horas-extras', 'pagos', 'carlitos', 'reportes', 'calendario', 'dashboard-ejecutivo', 'requerimientos'],
  administrativo: ['noticias', 'reparto', 'asignaciones', 'resumen', 'tablero', 'sorteo', 'revision-carpetas', 'consultor', 'chat', 'horas-extras', 'carlitos', 'reportes', 'calendario', 'dashboard-ejecutivo', 'requerimientos'],
  contador:       ['noticias', 'actas', 'cuentas', 'revision', 'resumen', 'tablero', 'carpetas', 'analisis', 'chat', 'descarga-pdf', 'horas-extras', 'carlitos', 'reportes', 'calendario', 'requerimientos'],
  abogado:        ['noticias', 'revision', 'consultor', 'chat', 'horas-extras', 'carlitos'],
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

// ── Notificaciones ────────────────────────────────────────────────────────────
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
  if (!visible) cargarNotificaciones();
};

window.cargarNotificaciones = async function() {
  const lista = document.getElementById('sb-notif-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="notif-empty">Cargando…</div>';
  try {
    const { getFirestore, collection, getDocs, orderBy, query, limit } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { app } = await import('/firebase-config.js');
    const db = getFirestore(app);
    const q    = query(collection(db, 'notificaciones'), orderBy('fecha', 'desc'), limit(30));
    const snap = await getDocs(q);
    const usuario = Auth.getContador() || '';
    const rol     = Auth.getRole()     || '';
    const leidas  = getLeidas();
    const items   = snap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .filter(n => !n.para || n.para === usuario || n.para === rol || n.para === 'todos');
    window._notifDatos = items;
    const noLeidas = items.filter(n => !leidas.has(n._id)).length;
    // Actualizar badge
    const badge = document.getElementById('sb-notif-badge');
    if (badge) { badge.textContent = noLeidas; badge.style.display = noLeidas > 0 ? '' : 'none'; }
    if (!items.length) { lista.innerHTML = '<div class="notif-empty">Sin notificaciones</div>'; return; }
    lista.innerHTML = items.map(n => {
      const leida = leidas.has(n._id);
      const fecha = n.fecha?.toDate ? n.fecha.toDate().toLocaleDateString('es-CO') : '';
      return `<div class="notif-item ${leida ? '' : 'no-leida'}" onclick="marcarLeida('${n._id}',this)">
        <div class="notif-item-txt">${n.texto || n.mensaje || ''}</div>
        <div class="notif-item-meta">${fecha}</div>
      </div>`;
    }).join('');
  } catch(e) {
    lista.innerHTML = '<div class="notif-empty">Error al cargar</div>';
  }
};

window.marcarLeida = function(id, el) {
  const leidas = getLeidas();
  leidas.add(id);
  guardarLeidas(leidas);
  el.classList.remove('no-leida');
  const noLeidas = window._notifDatos.filter(n => !leidas.has(n._id)).length;
  const badge = document.getElementById('sb-notif-badge');
  if (badge) { badge.textContent = noLeidas; badge.style.display = noLeidas > 0 ? '' : 'none'; }
};

window.marcarTodasLeidas = function() {
  const leidas = getLeidas();
  window._notifDatos.forEach(n => leidas.add(n._id));
  guardarLeidas(leidas);
  document.querySelectorAll('.notif-item').forEach(el => el.classList.remove('no-leida'));
  const badge = document.getElementById('sb-notif-badge');
  if (badge) { badge.textContent = '0'; badge.style.display = 'none'; }
};

// ── renderSidebar ─────────────────────────────────────────────────────────────
function renderSidebar(activeId = '') {
  const nombre  = Auth.getContador() || 'Usuario';
  const rol     = Auth.getRole()     || 'contador';
  const allowed = MODULES_BY_ROLE[rol] || [];
  const modules = ALL_MODULES.filter(m => allowed.includes(m.id));

  const navItems = modules.map(m => {
    const isExternal = m.path.startsWith('http');
    const href = isExternal ? m.path : m.path;
    const target = isExternal ? ' target="_blank" rel="noopener"' : '';
    return `<li class="nav-item ${m.id === activeId ? 'active' : ''}">
      <a href="${href}"${target} class="nav-link">
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
        <!-- Panel de notificaciones -->
        <div id="sb-notif-panel" class="notif-panel" style="display:none">
          <div class="notif-panel-title">
            ◉ NOTIFICACIONES
            <button class="notif-marcar-btn" onclick="marcarTodasLeidas()" style="float:right">Marcar todas</button>
          </div>
          <div id="sb-notif-lista" class="notif-lista"></div>
        </div>

        <button class="btn-notif" onclick="toggleNotifPanel()">
          <span>◉ Notificaciones</span>
          <span id="sb-notif-badge" class="notif-badge" style="display:none">0</span>
        </button>

        <button class="btn-logout" onclick="Auth.logout()">⏻ Cerrar Sesión</button>
        <div class="sidebar-version">v1.0 &mdash; ET2023</div>
      </div>
    </aside>
  `;

  const container = document.getElementById('sidebar-container');
  if (container) container.innerHTML = html;

  // Cargar badge de notificaciones al iniciar
  setTimeout(() => {
    try {
      cargarNotificaciones();
    } catch(e) {}
  }, 800);
}
