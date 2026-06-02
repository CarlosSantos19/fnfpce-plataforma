/**
 * dashboard.js
 * Panel principal — muestra módulos según el rol del usuario autenticado.
 */

const CARDS_CONFIG = {
  usuarios:     { icon: '◇', titulo: 'Gestión Usuarios', desc: 'Crear, editar y administrar usuarios del sistema',    path: '/modules/usuarios/usuarios.html' },
  reparto:      { icon: '◈', titulo: 'Reparto',           desc: 'Distribución y gestión de expedientes asignados',     path: '/modules/reparto/reparto.html' },
  asignaciones: { icon: '◎', titulo: 'Asignaciones',      desc: 'Consulta y seguimiento de casos asignados',           path: '/modules/asignaciones/asignaciones.html' },
  actas:        { icon: '◉', titulo: 'Actas',             desc: 'Gestión de actas de entrega, control y seguimiento',  path: '/modules/actas/actas.html' },
  cuentas:      { icon: '◆', titulo: 'Cuentas',           desc: 'Control y revisión de cuentas claras por entidad',    path: '/modules/cuentas/cuentas.html' },
  revision:     { icon: '◌', titulo: 'Revisión',          desc: 'Auditoría y revisión del estado de expedientes',      path: '/modules/revision/revision.html' },
  resumen:      { icon: '◑', titulo: 'Resumen',           desc: 'Indicadores generales del reparto ET2023',             path: '/modules/resumen/resumen.html' },
  sorteo:       { icon: '⬡', titulo: 'Sorteo',            desc: 'Distribución y sorteo de cuentas entre contadores',   path: '/modules/sorteo/sorteo.html' },
  carpetas:            { icon: '▣', titulo: 'Carpetas',       desc: 'Expedientes organizados por número de acta',           path: '/modules/carpetas/carpetas.html' },
  'revision-carpetas': { icon: '◧', titulo: 'Rev. Carpetas',  desc: 'Verificación de archivos PDF por acta y contador',     path: '/modules/revision-carpetas/revision-carpetas.html' },
  tablero:             { icon: '⬡', titulo: 'Tablero',        desc: 'Vista general de indicadores y avance del proceso',    path: '/modules/tablero/tablero.html' },
  analisis:            { icon: '◫', titulo: 'Análisis',       desc: 'Análisis de cuentas de campañas electorales ET2023',   path: 'https://proyectoswyad.com/' },
  victorboot:          { icon: '⬟', titulo: 'VictorBoot',     desc: 'Módulo VictorBoot',                                    path: '/modules/victorboot/victorboot.html' },
  chat:                { icon: '◈', titulo: 'Chat',           desc: 'Canal de comunicación institucional en tiempo real',   path: '/modules/chat/chat.html' },
  'descarga-pdf':      { icon: '◧', titulo: 'Descarga PDF',   desc: 'Gestión de descarga de documentos AUTOCASH por organización', path: '/modules/descarga-pdf/descarga-pdf.html' },
  'horas-extras':      { icon: '⏱', titulo: 'Horas Extras',  desc: 'Registro y seguimiento de horas extras autorizadas', path: '/modules/horas-extras/horas-extras.html' },
  pagos:               { icon: '◈', titulo: 'Pagos',         desc: 'Registro de reconocimientos y pagos ET2023',          path: '/modules/pagos/pagos.html' },
  carlitos:            { icon: '🤖', titulo: 'Carlitos',      desc: 'Asistente IA para análisis de informes financieros CNE', path: '/modules/carlitos/carlitos.html' },
};

// MODULES_BY_ROLE se toma de components/sidebar.js (ya cargado en la misma página)

const usuario = Auth.requireAuth();
if (usuario) {
  const rol     = Auth.getRole() || 'contador';
  const allowed = MODULES_BY_ROLE[rol] || [];

  // Nombre y fecha
  document.getElementById('nombre-contador').textContent = usuario;
  const fecha = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  document.getElementById('fecha-actual').textContent = fecha.toUpperCase();

  // Renderizar sidebar
  renderSidebar('');

  // Renderizar tarjetas según rol
  const grid = document.getElementById('modules-grid');
  grid.innerHTML = allowed.filter(id => CARDS_CONFIG[id]).map(id => {
    const c = CARDS_CONFIG[id];
    return `
      <div class="module-card" onclick="window.location.href='${c.path}'">
        <div class="card-scan"></div>
        <div class="card-icon">${c.icon}</div>
        <div class="card-body">
          <h3>${c.titulo}</h3>
          <p>${c.desc}</p>
        </div>
        <div class="card-footer">
          <span class="card-status"><span class="dot-sm"></span>Activo</span>
          <span class="card-action">Acceder →</span>
        </div>
      </div>`;
  }).join('');

  // Partículas
  const container = document.getElementById('particles');
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left              = Math.random() * 100 + 'vw';
    p.style.animationDuration = (10 + Math.random() * 14) + 's';
    p.style.animationDelay    = (Math.random() * 10) + 's';
    p.style.width = p.style.height = (Math.random() > 0.5 ? '2px' : '1px');
    container.appendChild(p);
  }
}
