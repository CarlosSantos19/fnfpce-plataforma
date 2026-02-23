/**
 * dashboard.js
 * Lógica del panel principal de la plataforma FNFPCE.
 */

// Verificar autenticación
const contador = Auth.requireAuth();
if (contador) {
  // Mostrar nombre del contador
  document.getElementById('nombre-contador').textContent = contador;

  // Renderizar sidebar sin módulo activo (estamos en el dashboard)
  renderSidebar('');

  // Mostrar fecha actual
  const fecha = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  document.getElementById('fecha-actual').textContent = fecha.toUpperCase();

  // Generar partículas
  (function generarParticulas() {
    const container = document.getElementById('particles');
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left              = Math.random() * 100 + 'vw';
      p.style.animationDuration = (10 + Math.random() * 14) + 's';
      p.style.animationDelay   = (Math.random() * 10) + 's';
      p.style.width = p.style.height = (Math.random() > 0.5 ? '2px' : '1px');
      container.appendChild(p);
    }
  })();
}
