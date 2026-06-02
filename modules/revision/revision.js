Auth.requireAuth();
renderSidebar('revision');

function abrirPortal(proceso) {
  if (proceso === '2023') {
    const rol = Auth.getRole() || '';
    const base = 'https://portal-cc-cne.onrender.com';
    const url  = rol === 'abogado' ? base + '?rol=abogado' : base;
    window.open(url, '_blank');
  }
}
