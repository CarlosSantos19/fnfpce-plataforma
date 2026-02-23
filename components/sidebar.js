/**
 * components/sidebar.js
 * Genera el sidebar de navegación dinámicamente.
 * Uso: renderSidebar('id-modulo-activo')
 */

const MODULES = [
  { id: 'reparto',       label: 'Reparto',       icon: '◈', path: '/modules/reparto/reparto.html',           desc: 'Distribución de expedientes' },
  { id: 'asignaciones',  label: 'Asignaciones',  icon: '◎', path: '/modules/asignaciones/asignaciones.html', desc: 'Asignación de casos' },
  { id: 'actas',         label: 'Actas',         icon: '◉', path: '/modules/actas/actas.html',               desc: 'Gestión de actas' },
  { id: 'cuentas',       label: 'Cuentas',       icon: '◆', path: '/modules/cuentas/cuentas.html',           desc: 'Control de cuentas' },
  { id: 'revision',      label: 'Revisión',      icon: '◌', path: '/modules/revision/revision.html',         desc: 'Revisión y auditoría' },
];

function renderSidebar(activeId = '') {
  const contador = Auth.getContador() || 'Contador';

  const navItems = MODULES.map(m => `
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
          <div class="user-name">${contador}</div>
          <div class="user-role">// Contador</div>
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
