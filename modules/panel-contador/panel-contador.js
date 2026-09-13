/**
 * modules/panel-contador/panel-contador.js
 * Workspace personal del contador: expedientes propios + herramientas de revisión.
 */

import { db } from '/firebase-config.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

Auth.requireRole(['contador', 'administrador']);
renderSidebar('panel-contador');

const NOTAS_KEY = 'pc_notas_' + (Auth.getContador() || 'default');

// ── DOM ───────────────────────────────────────────────────────────────────────
const tbody        = document.getElementById('pc-tbody');
const buscarInput  = document.getElementById('pc-buscar');
const filtroEstado = document.getElementById('pc-filtro-estado');
const statsEl      = document.getElementById('pc-stats');

// KPIs
const kpiTotal   = document.getElementById('kpi-total');
const kpiTermino = document.getElementById('kpi-termino');
const kpiVencido = document.getElementById('kpi-vencido');
const kpiCert    = document.getElementById('kpi-cert');
const kpiPend    = document.getElementById('kpi-pend');

// ── Estado ────────────────────────────────────────────────────────────────────
let misExpedientes  = [];
let listaFiltrada   = [];
const usuarioActual = (Auth.getContador() || '').trim().toLowerCase();

// ── Partículas ────────────────────────────────────────────────────────────────
(function initParticles() {
  const c = document.getElementById('particles');
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const s = 1 + Math.random() * 2;
    p.style.cssText = `width:${s}px;height:${s}px;left:${Math.random()*100}vw;animation-duration:${10+Math.random()*14}s;animation-delay:${Math.random()*10}s`;
    c.appendChild(p);
  }
})();

// ── Notas personales ──────────────────────────────────────────────────────────
(function initNotas() {
  const ta = document.getElementById('pc-notas');
  ta.value = localStorage.getItem(NOTAS_KEY) || '';
})();

window.guardarNotas = function () {
  const ta  = document.getElementById('pc-notas');
  const msg = document.getElementById('pc-notas-msg');
  localStorage.setItem(NOTAS_KEY, ta.value);
  msg.textContent = '✓ Notas guardadas';
  setTimeout(() => { msg.textContent = ''; }, 2500);
};

// ── Badges ────────────────────────────────────────────────────────────────────
function badgeEstado(estado) {
  const e = (estado || '').trim().toUpperCase();
  let cls = 'pc-badge--other';
  if (e === 'PENDIENTE REVISION')      cls = 'pc-badge--pend';
  else if (e.startsWith('CERTIFICADO'))cls = 'pc-badge--cert';
  else if (e === 'VENCIDO')            cls = 'pc-badge--venc';
  else if (e.startsWith('OFICI'))      cls = 'pc-badge--ofic';
  else if (e === 'INVESTIGACION')      cls = 'pc-badge--inv';
  else if (e === 'DEVUELTA CONTADOR')  cls = 'pc-badge--dev';
  else if (e === 'REASIGNADO')         cls = 'pc-badge--reas';
  const label = e === 'PENDIENTE REVISION' ? 'PENDIENTE' : (e || '—');
  return `<span class="pc-badge ${cls}">${label}</span>`;
}

function calcDias(fechaActa) {
  if (!fechaActa) return null;
  const inicio = new Date(fechaActa);
  const hoy = new Date();
  inicio.setHours(0, 0, 0, 0);
  hoy.setHours(0, 0, 0, 0);
  return Math.floor((hoy - inicio) / 86400000) + 1;
}

function renderTiempo(e) {
  const dias = calcDias(e.fechaActaReparto);
  if (dias !== null) {
    const vencido = dias >= 30;
    return `<span class="pc-tiempo ${vencido ? 'pc-tiempo--venc' : 'pc-tiempo--ok'}">${vencido ? 'VENCIDO' : 'EN TÉRMINO'}</span>`;
  }
  const t = (e.tiempoRev || '').trim().toUpperCase();
  if (!t) return '<span class="pc-tiempo pc-tiempo--nd">—</span>';
  return `<span class="pc-tiempo ${t === 'VENCIDO' ? 'pc-tiempo--venc' : 'pc-tiempo--ok'}">${t}</span>`;
}

function renderDias(e) {
  const dias = calcDias(e.fechaActaReparto);
  if (dias === null) return '<span class="pc-dias" style="color:var(--text-muted)">—</span>';
  const color = dias >= 30 ? '#ff5252' : dias >= 25 ? '#ffab40' : '#00e676';
  return `<span class="pc-dias" style="color:${color}">${dias}</span>`;
}

// ── Cargar datos ──────────────────────────────────────────────────────────────
async function cargar() {
  tbody.innerHTML = '<tr><td colspan="8" class="table-loading">Cargando expedientes…</td></tr>';
  try {
    const snap = await getDocs(collection(db, 'reparto'));
    const todos = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    // Filtrar por el contador actual (comparación sin distinguir mayúsculas)
    misExpedientes = todos.filter(e => {
      const asignado = (e.contador || '').trim().toLowerCase();
      return asignado === usuarioActual || asignado.includes(usuarioActual);
    });

    actualizarKPIs();
    aplicarFiltros();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-loading">Error al cargar: ${err.message}</td></tr>`;
  }
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function actualizarKPIs() {
  const total   = misExpedientes.length;
  let termino = 0, vencido = 0, cert = 0, pend = 0;

  misExpedientes.forEach(e => {
    const est = (e.estado || '').trim().toUpperCase();
    if (est.startsWith('CERTIFICADO')) { cert++; return; }
    const dias = calcDias(e.fechaActaReparto);
    const esVenc = dias !== null ? dias >= 30 : (e.tiempoRev || '').toUpperCase() === 'VENCIDO';
    if (esVenc) vencido++;
    else if (est === 'PENDIENTE REVISION') { pend++; termino++; }
    else termino++;
  });

  kpiTotal.textContent   = total;
  kpiTermino.textContent = termino;
  kpiVencido.textContent = vencido;
  kpiCert.textContent    = cert;
  kpiPend.textContent    = pend;
}

// ── Filtros y render ──────────────────────────────────────────────────────────
function aplicarFiltros() {
  const texto = buscarInput.value.trim().toLowerCase();
  const fEst  = filtroEstado.value.trim().toUpperCase();

  listaFiltrada = misExpedientes.filter(e => {
    if (fEst) {
      const est = (e.estado || '').trim().toUpperCase();
      if (fEst === 'OFICIAR' && !est.startsWith('OFICI')) return false;
      else if (fEst !== 'OFICIAR' && est !== fEst) return false;
    }
    if (texto) {
      const haystack = [e.consecutivo, e.agrupacion, e.partido, e.departamento, e.corporacion, e.estado]
        .map(v => (v || '').toLowerCase()).join(' ');
      if (!haystack.includes(texto)) return false;
    }
    return true;
  });

  // Ordenar: vencidos primero, luego por días descendente
  listaFiltrada.sort((a, b) => {
    const da = calcDias(a.fechaActaReparto) ?? 0;
    const db = calcDias(b.fechaActaReparto) ?? 0;
    return db - da;
  });

  statsEl.textContent = `${listaFiltrada.length} de ${misExpedientes.length} expedientes`;
  renderTabla();
}

function renderTabla() {
  if (!listaFiltrada.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-loading">Sin resultados.</td></tr>';
    return;
  }
  tbody.innerHTML = listaFiltrada.map(e => `
    <tr>
      <td><span class="pc-consec">${e.consecutivo || '—'}</span></td>
      <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${(e.agrupacion||e.partido||'')}">
        ${e.agrupacion || e.partido || '—'}
      </td>
      <td style="font-size:11px;white-space:nowrap">${e.corporacion || '—'}</td>
      <td style="font-size:12px;white-space:nowrap">${e.departamento || '—'}</td>
      <td>${badgeEstado(e.estado)}</td>
      <td>${renderTiempo(e)}</td>
      <td>${renderDias(e)}</td>
      <td><span class="pc-obs" title="${(e.observacion||'').replace(/"/g,'&quot;')}">${e.observacion || '—'}</span></td>
    </tr>
  `).join('');
}

// ── Listeners ─────────────────────────────────────────────────────────────────
buscarInput.addEventListener('input', aplicarFiltros);
filtroEstado.addEventListener('change', aplicarFiltros);

// ── Init ──────────────────────────────────────────────────────────────────────
cargar();
