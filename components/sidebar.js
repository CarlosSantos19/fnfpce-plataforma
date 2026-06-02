/**
 * components/sidebar.js
 * Genera el sidebar de navegación dinámicamente, filtrando módulos por rol.
 */

const ALL_MODULES = [
  { id: 'usuarios',     label: 'Gestión Usuarios', icon: '◇', path: '/modules/usuarios/usuarios.html',         desc: 'Administración de usuarios' },
  { id: 'reparto',      label: 'Reparto',           icon: '◈', path: '/modules/reparto/reparto.html',           desc: 'Distribución de expedientes' },
  { id: 'asignaciones', label: 'Asignaciones',      icon: '◎', path: '/modules/asignaciones/asignaciones.html', desc: 'Asignación de casos' },
  { id: 'actas',        label: 'Actas',             icon: '◉', path: '/modules/actas/actas.html',               desc: 'Gestión de actas' },
  { id: 'cuentas',      label: 'Cuentas',           icon: '◆', path: '/modules/cuentas/cuentas.html',           desc: 'Control de cuentas' },
  { id: 'revision',     label: 'Revisión',          icon: '◌', path: '/modules/revision/revision.html',         desc: 'Revisión y auditoría' },
  { id: 'resumen',      label: 'Resumen',            icon: '◑', path: '/modules/resumen/resumen.html',             desc: 'Indicadores generales' },
  { id: 'sorteo',       label: 'Sorteo',             icon: '⬡', path: '/modules/sorteo/sorteo.html',               desc: 'Sorteo de cuentas' },
  { id: 'carpetas',          label: 'Carpetas',       icon: '▣', path: '/modules/carpetas/carpetas.html',                      desc: 'Carpetas por número de acta' },
  { id: 'revision-carpetas', label: 'Rev. Carpetas',  icon: '◧', path: '/modules/revision-carpetas/revision-carpetas.html',  desc: 'Revisión de carpetas por acta' },
  { id: 'tablero',           label: 'Tablero',        icon: '⬡', path: '/modules/tablero/tablero.html',                       desc: 'Vista general de indicadores ET2023' },
  { id: 'analisis',          label: 'Análisis',       icon: '◫', path: 'https://proyectoswyad.com/',                          desc: 'Análisis de cuentas electorales' },
  { id: 'victorboot',        label: 'VictorBoot',     icon: '⬟', path: '/modules/victorboot/victorboot.html',                  desc: 'Módulo VictorBoot' },
  { id: 'chat',              label: 'Chat',           icon: '◈', path: '/modules/chat/chat.html',                              desc: 'Chat institucional' },
  { id: 'descarga-pdf',      label: 'Descarga PDF',   icon: '◧', path: '/modules/descarga-pdf/descarga-pdf.html',              desc: 'Descarga de documentos AUTOCASH' },
  { id: 'horas-extras',      label: 'Horas Extras',   icon: '⏱', path: '/modules/horas-extras/horas-extras.html',              desc: 'Registro y seguimiento de horas extras' },
  { id: 'verificacion',      label: 'Verificación',   icon: '◉', path: '/modules/horas-extras/horas-extras.html',              desc: 'Verificación de horas extras' },
  { id: 'pagos',             label: 'Pagos',          icon: '◈', path: '/modules/pagos/pagos.html',                            desc: 'Registro de reconocimientos y pagos' },
  { id: 'carlitos',          label: 'Carlitos',       icon: '🤖', path: '/modules/carlitos/carlitos.html',                        desc: 'Asistente IA para análisis CNE' },
];

const MODULES_BY_ROLE = {
  administrador:  ['usuarios', 'reparto', 'asignaciones', 'actas', 'cuentas', 'revision', 'resumen', 'tablero', 'sorteo', 'carpetas', 'revision-carpetas', 'analisis', 'victorboot', 'chat', 'descarga-pdf', 'horas-extras', 'pagos', 'carlitos'],
  administrativo: ['reparto', 'asignaciones', 'resumen', 'tablero', 'sorteo', 'revision-carpetas', 'victorboot', 'chat', 'horas-extras', 'carlitos'],
  contador:       ['actas', 'cuentas', 'revision', 'resumen', 'tablero', 'carpetas', 'analisis', 'chat', 'descarga-pdf', 'horas-extras', 'carlitos'],
  abogado:        ['victorboot', 'chat', 'horas-extras', 'carlitos'],
  asistencial:    ['chat', 'horas-extras', 'carlitos'],
  pago:           ['reparto', 'victorboot', 'chat', 'horas-extras', 'pagos', 'carlitos'],
};

const ROL_LABELS = {
  administrador:  'Administrador',
  administrativo: 'Administrativo',
  contador:       'Contador',
  abogado:        'Abogado',
  asistencial:    'Asistencial',
  pago:           'Pago',
};

function renderSidebar(activeId = '') {
  const nombre  = Auth.getContador() || 'Usuario';
  const rol     = Auth.getRole() || 'contador';
  const allowed = MODULES_BY_ROLE[rol] || [];

  const modules = ALL_MODULES.filter(m => allowed.includes(m.id));

  const navItems = modules.map(m => `
    <li class="nav-item ${m.id === activeId ? 'active' : ''}">
      <a href="${m.path}" class="nav-link">
        <span class="nav-icon">${m.icon}</span>
        <span class="nav-label">${m.label}</span>
      </a>
    </li>
  `).join('');

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
        <button class="btn-logout" onclick="Auth.logout()">⏻ Cerrar Sesión</button>
        <div class="sidebar-version">v1.0 &mdash; ET2023</div>
      </div>
    </aside>
  `;

  const container = document.getElementById('sidebar-container');
  if (container) container.innerHTML = html;
}
