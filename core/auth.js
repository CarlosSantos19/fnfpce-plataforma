/**
 * core/auth.js
 * Manejo centralizado de sesión y roles para la plataforma FNFPCE.
 */

const Auth = {
  getContador() {
    return sessionStorage.getItem('contador');
  },

  getRole() {
    return sessionStorage.getItem('rol');
  },

  requireAuth() {
    const contador = this.getContador();
    if (!contador) {
      window.location.href = '/login.html';
      return null;
    }
    return contador;
  },

  requireRole(rolesPermitidos) {
    const contador = this.requireAuth();
    if (!contador) return null;

    const rol = this.getRole();
    if (!rolesPermitidos.includes(rol)) {
      window.location.href = '/dashboard.html';
      return null;
    }
    return contador;
  },

  logout() {
    sessionStorage.removeItem('contador');
    sessionStorage.removeItem('rol');
    window.location.href = '/login.html';
  }
};
