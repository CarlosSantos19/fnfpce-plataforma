/**
 * modules/cuentas/cuentas.js
 * Muestra los expedientes del reparto asignados al contador logueado.
 * Admin/administrativo puede ver todos y filtrar por contador.
 */

import { db } from '/firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Verificar rol ─────────────────────────────────────────────────────────────
Auth.requireRole(['administrador', 'administrativo', 'contador']);
renderSidebar('cuentas');

// ── Datos de sesión ───────────────────────────────────────────────────────────
const nombreUsuario = sessionStorage.getItem('contador') || '';
const rolUsuario    = Auth.getRole ? Auth.getRole() : (sessionStorage.getItem('rol') || '');
const esContador    = rolUsuario === 'contador';

// ── Referencias DOM ───────────────────────────────────────────────────────────
const tbody          = document.getElementById('tbody-cuentas');
const buscarInput    = document.getElementById('buscar');
const filtroEstado   = document.getElementById('filtro-estado');
const filtroContador = document.getElementById('filtro-contador');
const statsCount     = document.getElementById('stats-count');
const statsCards     = document.getElementById('stats-cards');

// ── Paginación ────────────────────────────────────────────────────────────────
const POR_PAGINA = 50;
let paginaActual = 1;

// ── Estado local ──────────────────────────────────────────────────────────────
let todosLosExpedientes = [];
let listaFiltrada       = [];

// ── Badge estado ──────────────────────────────────────────────────────────────
function badgeEstado(estado) {
  const e = (estado || '').trim().toUpperCase();
  let cls = 'badge-estado-default';
  if (e.startsWith('CERTIFICADO'))     cls = 'badge-estado-cert';
  else if (e === 'PENDIENTE REVISION') cls = 'badge-estado-pend';
  else if (e === 'VENCIDO')            cls = 'badge-estado-venc';
  else if (e.startsWith('OFICIA'))     cls = 'badge-estado-ofic';
  else if (e.startsWith('REOFI'))      cls = 'badge-estado-reof';
  else if (e === 'REASIGNADO')         cls = 'badge-estado-reas';
  else if (e === 'RETIRADO')           cls = 'badge-estado-reti';
  else if (e === 'INVESTIGACION')      cls = 'badge-estado-inv';
  else if (e === 'DEVUELTA CONTADOR')  cls = 'badge-estado-dev';
  return `<span class="badge-estado ${cls}">${(estado || '').trim() || '—'}</span>`;
}


// ── Cargar desde Firestore ────────────────────────────────────────────────────
async function cargarExpedientes() {
  tbody.innerHTML = '<tr><td colspan="15" class="table-loading">Cargando expedientes...</td></tr>';
  try {
    const snap = await getDocs(collection(db, 'reparto'));
    let todos  = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    // Contador solo ve los suyos
    if (esContador) {
      todos = todos.filter(e =>
        (e.nombreContador || '').trim().toLowerCase() === nombreUsuario.trim().toLowerCase()
      );
      document.getElementById('desc-usuario').textContent =
        `Expedientes asignados a: ${nombreUsuario}`;
    } else {
      // Admin/administrativo: mostrar filtro de contador
      filtroContador.style.display = '';
      const contadores = [...new Set(todos.map(e => e.nombreContador).filter(Boolean))].sort();
      contadores.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        filtroContador.appendChild(opt);
      });
      filtroContador.addEventListener('change', aplicarFiltros);
      document.getElementById('desc-usuario').textContent =
        'Expedientes del reparto por contador';
    }

    // Ordenar: consecutivo numérico
    todos.sort((a, b) => {
      const parse = s => { const m = (s||'').match(/^([A-Za-z]+)(\d+)/); return m ? [m[1], parseInt(m[2],10)] : [s||'',0]; };
      const [pa, na] = parse(a.consecutivo);
      const [pb, nb] = parse(b.consecutivo);
      return pa !== pb ? pa.localeCompare(pb) : na - nb;
    });

    todosLosExpedientes = todos;
    actualizarTarjetas(todos);
    statsCards.style.display = '';
    aplicarFiltros();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="15" class="table-loading">Error al cargar: ${err.message}</td></tr>`;
  }
}

// ── Tarjetas resumen ──────────────────────────────────────────────────────────
function actualizarTarjetas(lista) {
  const total = lista.length;
  const cert  = lista.filter(e => (e.estado||'').toUpperCase().startsWith('CERTIFICADO')).length;
  const ofic  = lista.filter(e => (e.estado||'').toUpperCase().startsWith('OFICIA') || (e.estado||'').toUpperCase().startsWith('REOFI')).length;
  const pend  = lista.filter(e => (e.estado||'').toUpperCase() === 'PENDIENTE REVISION').length;
  const venc  = lista.filter(e => (e.tiempoRevision||'').toUpperCase() === 'VENCIDO').length;

  document.getElementById('st-total').textContent = total.toLocaleString();
  document.getElementById('st-cert').textContent  = cert.toLocaleString();
  document.getElementById('st-ofic').textContent  = ofic.toLocaleString();
  document.getElementById('st-pend').textContent  = pend.toLocaleString();
  document.getElementById('st-venc').textContent  = venc.toLocaleString();
}

// ── Aplicar filtros ───────────────────────────────────────────────────────────
function aplicarFiltros() {
  const texto   = buscarInput.value.trim().toLowerCase();
  const fEst    = filtroEstado.value.trim().toUpperCase();
  const fCont   = filtroContador.value;

  listaFiltrada = todosLosExpedientes.filter(e => {
    if (fEst  && (e.estado||'').trim().toUpperCase() !== fEst) return false;
    if (fCont && e.nombreContador !== fCont) return false;
    if (texto) {
      const haystack = [
        e.consecutivo, e.municipio, e.agrupacion, e.departamento
      ].join(' ').toLowerCase();
      if (!haystack.includes(texto)) return false;
    }
    return true;
  });

  paginaActual = 1;
  renderTabla();
}

// ── Renderizar tabla ──────────────────────────────────────────────────────────
function renderTabla() {
  const total     = listaFiltrada.length;
  const inicio    = (paginaActual - 1) * POR_PAGINA;
  const fin       = Math.min(inicio + POR_PAGINA, total);
  const pagina    = listaFiltrada.slice(inicio, fin);
  const totalPags = Math.ceil(total / POR_PAGINA) || 1;

  statsCount.textContent = `${total.toLocaleString()} expediente${total !== 1 ? 's' : ''}`;

  const pagTxt = `Pág. ${paginaActual} / ${totalPags}  (${inicio + 1}–${fin})`;
  document.getElementById('pag-info-top').textContent = pagTxt;
  document.getElementById('pag-info-bot').textContent = pagTxt;

  ['input-pag-top','input-pag-bot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.max = totalPags; el.placeholder = `/${totalPags}`; }
  });

  const enPrimera = paginaActual <= 1;
  const enUltima  = paginaActual >= totalPags;
  ['btn-prev-top','btn-prev-bot','btn-first-top','btn-first-bot'].forEach(id => {
    document.getElementById(id).disabled = enPrimera;
  });
  ['btn-next-top','btn-next-bot','btn-last-top','btn-last-bot'].forEach(id => {
    document.getElementById(id).disabled = enUltima;
  });

  if (!pagina.length) {
    tbody.innerHTML = '<tr><td colspan="15" class="table-empty">Sin expedientes para los filtros aplicados.</td></tr>';
    return;
  }

  tbody.innerHTML = pagina.map(e => `
    <tr>
      <td class="col-consec">${e.consecutivo || '—'}</td>
      <td>${e.corporacion || '—'}</td>
      <td>${e.departamento || '—'}</td>
      <td>${e.municipio || '—'}</td>
      <td class="col-agrup" title="${e.agrupacion || ''}">${e.agrupacion || '—'}</td>
      <td class="col-fecha">${e.fechaActaReparto || '—'}</td>
      <td>${badgeEstado(e.estado)}</td>
      <td class="col-oficio">${e.primerOficioNo || '—'}</td>
      <td class="col-fecha">${e.primerOficioFecha || '—'}</td>
      <td class="col-centro">${e.primerOficioRespuesta || '—'}</td>
      <td class="col-oficio">${e.segundoOficioNo || '—'}</td>
      <td class="col-fecha">${e.segundoOficioFecha || '—'}</td>
      <td class="col-centro">${e.segundoOficioRespuesta || '—'}</td>
    </tr>
  `).join('');
}

// ── Navegación de páginas ─────────────────────────────────────────────────────
function scrollArriba() {
  const mc = document.querySelector('.main-content');
  if (mc) mc.scrollTop = 0;
  else window.scrollTo(0, 0);
}

window.cambiarPagina = function(delta) {
  const totalPags = Math.ceil(listaFiltrada.length / POR_PAGINA) || 1;
  paginaActual = Math.max(1, Math.min(paginaActual + delta, totalPags));
  renderTabla();
  scrollArriba();
};

window.irPagina = function(n) {
  const totalPags = Math.ceil(listaFiltrada.length / POR_PAGINA) || 1;
  const num = parseInt(n, 10);
  if (!num || num < 1 || num > totalPags) return;
  paginaActual = num;
  renderTabla();
  scrollArriba();
};

window.irUltimaPagina = function() {
  paginaActual = Math.ceil(listaFiltrada.length / POR_PAGINA) || 1;
  renderTabla();
  scrollArriba();
};

// ── Listeners ─────────────────────────────────────────────────────────────────
buscarInput.addEventListener('input', aplicarFiltros);
filtroEstado.addEventListener('change', aplicarFiltros);

// ── Init ──────────────────────────────────────────────────────────────────────
cargarExpedientes();
