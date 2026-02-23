/**
 * core/auth.js
 * Manejo centralizado de sesión para toda la plataforma FNFPCE.
 */

const Auth = {
  getContador() {
    return sessionStorage.getItem('contador');
  },

  requireAuth() {
    const contador = this.getContador();
    if (!contador) {
      window.location.href = '/login.html';
      return null;
    }
    return contador;
  },

  logout() {
    sessionStorage.removeItem('contador');
    window.location.href = '/login.html';
  }
};
