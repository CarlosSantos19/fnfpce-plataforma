Auth.requireAuth();
renderSidebar('revision');

function abrirPortal(proceso) {
  const base = 'https://portal-cc-cne.onrender.com';
  if (proceso === '2023') {
    const rol = Auth.getRole() || '';
    const url  = rol === 'abogado' ? base + '?rol=abogado' : base;
    window.open(url, '_blank');
  } else if (proceso === '2026') {
    window.location.href = '/modules/congreso/congreso.html';
  }
}
