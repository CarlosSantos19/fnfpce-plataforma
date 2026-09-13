/**
 * modules/panel-abogado/panel-abogado.js
 * Workspace jurídico: requerimientos activos, vencimientos y herramientas legales.
 */

import { db } from '/firebase-config.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

Auth.requireRole(['abogado', 'administrador', 'administrativo']);
renderSidebar('panel-abogado');

const NOTAS_KEY    = 'pa_notas_'    + (Auth.getContador() || 'default');
const CHECKLIST_KEY= 'pa_checklist_'+ (Auth.getContador() || 'default');

// ── Checklist items ───────────────────────────────────────────────────────────
const CHECKLIST_ITEMS = [
  'Revisar cumplimiento topes de financiación (RES. 0480/2026)',
  'Verificar fuentes de financiación permitidas',
  'Analizar correcta clasificación de ingresos y gastos',
  'Revisar soportes contables de transacciones relevantes',
  'Verificar que ingresos estén dentro del plazo legal',
  'Identificar gastos no permitidos o sin soporte',
  'Revisar reporte en Cuentas Claras vs documentación física',
  'Analizar diferencias entre informe candidato y organización',
  'Verificar radicación oportuna del informe (plazo legal)',
  'Verificar aplicación de normas de inhabilidades (arts. 179, 197 C.P.)',
  'Estudiar procedencia jurídica de reposición de votos/gastos',
  'Revisar posibles irregularidades para remisión a CNE',
  'Proyectar concepto jurídico o requerimiento si hay inconsistencias',
];

// ── DOM ───────────────────────────────────────────────────────────────────────
const tbody        = document.getElementById('pa-tbody');
const buscarInput  = document.getElementById('pa-buscar');
const filtroEstado = document.getElementById('pa-filtro-estado');
const filtroOrden  = document.getElementById('pa-filtro-orden');
const statsEl      = document.getElementById('pa-stats');
const proximosEl   = document.getElementById('pa-proximos');

const kpiTotal = document.getElementById('kpi-total');
const kpiPend  = document.getElementById('kpi-pend');
const kpiVenc  = document.getElementById('kpi-venc');
const kpiResp  = document.getElementById('kpi-resp');

// ── Estado ────────────────────────────────────────────────────────────────────
let todosReq    = [];
let listaFilt   = [];

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

// ── Notas ─────────────────────────────────────────────────────────────────────
(function initNotas() {
  const ta = document.getElementById('pa-notas');
  ta.value = localStorage.getItem(NOTAS_KEY) || '';
})();

window.guardarNotas = function () {
  const ta  = document.getElementById('pa-notas');
  const msg = document.getElementById('pa-notas-msg');
  localStorage.setItem(NOTAS_KEY, ta.value);
  msg.textContent = '✓ Notas guardadas';
  setTimeout(() => { msg.textContent = ''; }, 2500);
};

// ── Checklist ─────────────────────────────────────────────────────────────────
function initChecklist() {
  const container = document.getElementById('pa-checklist');
  let estado = {};
  try { estado = JSON.parse(localStorage.getItem(CHECKLIST_KEY) || '{}'); } catch (_) {}

  container.innerHTML = CHECKLIST_ITEMS.map((txt, i) => {
    const checked = !!estado[i];
    return `
      <label class="pa-check-item${checked ? ' checked' : ''}" id="chk-item-${i}">
        <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleCheck(${i}, this)">
        <span>${txt}</span>
      </label>`;
  }).join('');
}

window.toggleCheck = function (i, el) {
  let estado = {};
  try { estado = JSON.parse(localStorage.getItem(CHECKLIST_KEY) || '{}'); } catch (_) {}
  estado[i] = el.checked;
  localStorage.setItem(CHECKLIST_KEY, JSON.stringify(estado));
  const item = document.getElementById('chk-item-' + i);
  if (item) item.classList.toggle('checked', el.checked);
};

window.resetChecklist = function () {
  localStorage.removeItem(CHECKLIST_KEY);
  initChecklist();
};

initChecklist();

// ── Utilidades de fecha ───────────────────────────────────────────────────────
function parseDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function fmtFecha(v) {
  const d = parseDate(v);
  if (!d) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function diasRestantes(fechaVencimiento) {
  const venc = parseDate(fechaVencimiento);
  if (!venc) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  venc.setHours(0, 0, 0, 0);
  return Math.ceil((venc - hoy) / 86400000);
}

// ── Badges ────────────────────────────────────────────────────────────────────
function badgeEstado(estado) {
  const e = (estado || '').trim().toUpperCase();
  if (e === 'RESPONDIDO') return '<span class="pa-badge pa-badge--resp">RESPONDIDO</span>';
  if (e === 'VENCIDO')    return '<span class="pa-badge pa-badge--venc">VENCIDO</span>';
  return '<span class="pa-badge pa-badge--pend">PENDIENTE</span>';
}

function renderDias(req) {
  const est = (req.estado || '').trim().toUpperCase();
  if (est === 'RESPONDIDO') return '<span class="pa-dias pa-dias--resp">—</span>';
  const d = diasRestantes(req.fechaVencimiento);
  if (d === null) return '<span class="pa-dias pa-dias--resp">—</span>';
  if (d < 0)   return `<span class="pa-dias pa-dias--venc">${Math.abs(d)}d venc.</span>`;
  if (d <= 5)  return `<span class="pa-dias pa-dias--venc">${d}d</span>`;
  if (d <= 10) return `<span class="pa-dias pa-dias--warn">${d}d</span>`;
  return `<span class="pa-dias pa-dias--ok">${d}d</span>`;
}

// ── Cargar requerimientos ─────────────────────────────────────────────────────
async function cargar() {
  tbody.innerHTML = '<tr><td colspan="8" class="table-loading">Cargando requerimientos…</td></tr>';
  try {
    const snap = await getDocs(collection(db, 'requerimientos'));
    todosReq = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    actualizarKPIs();
    renderProximos();
    aplicarFiltros();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-loading">Error al cargar: ${err.message}</td></tr>`;
    proximosEl.innerHTML = '<div class="pa-vacio">Sin datos.</div>';
  }
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function actualizarKPIs() {
  let pend = 0, venc = 0, resp = 0;
  todosReq.forEach(r => {
    const e = (r.estado || '').trim().toUpperCase();
    if (e === 'RESPONDIDO')    resp++;
    else if (e === 'VENCIDO')  venc++;
    else {
      // Auto-detectar vencimiento
      const d = diasRestantes(r.fechaVencimiento);
      if (d !== null && d < 0) venc++;
      else pend++;
    }
  });
  kpiTotal.textContent = todosReq.length;
  kpiPend.textContent  = pend;
  kpiVenc.textContent  = venc;
  kpiResp.textContent  = resp;
}

// ── Próximos a vencer (≤ 10 días, no respondidos) ─────────────────────────────
function renderProximos() {
  const activos = todosReq.filter(r => {
    const e = (r.estado || '').trim().toUpperCase();
    if (e === 'RESPONDIDO') return false;
    const d = diasRestantes(r.fechaVencimiento);
    return d !== null && d >= 0 && d <= 10;
  }).sort((a, b) => diasRestantes(a.fechaVencimiento) - diasRestantes(b.fechaVencimiento));

  if (!activos.length) {
    proximosEl.innerHTML = '<div class="pa-vacio">Sin vencimientos en los próximos 10 días.</div>';
    return;
  }

  proximosEl.innerHTML = activos.slice(0, 8).map(r => {
    const d = diasRestantes(r.fechaVencimiento);
    const warn = d > 5;
    return `
      <div class="pa-prox-item${warn ? ' pa-prox-item--warn' : ''}">
        <div class="pa-prox-dias">${d}</div>
        <div class="pa-prox-info">
          <div class="pa-prox-num">${r.numero || '—'}</div>
          <div class="pa-prox-nom" title="${(r.partido || r.organizacion || '').replace(/"/g,'&quot;')}">${r.partido || r.organizacion || '—'}</div>
          <div class="pa-prox-asunto" title="${(r.asunto || '').replace(/"/g,'&quot;')}">${r.asunto || '—'}</div>
        </div>
      </div>`;
  }).join('');
}

// ── Filtros y render tabla ────────────────────────────────────────────────────
function aplicarFiltros() {
  const texto = buscarInput.value.trim().toLowerCase();
  const fEst  = filtroEstado.value.trim().toUpperCase();
  const orden = filtroOrden.value;

  listaFilt = todosReq.filter(r => {
    if (fEst) {
      const e = (r.estado || '').trim().toUpperCase();
      if (fEst !== e) return false;
    }
    if (texto) {
      const hay = [r.numero, r.partido, r.organizacion, r.asunto, r.estado]
        .map(v => (v || '').toLowerCase()).join(' ');
      if (!hay.includes(texto)) return false;
    }
    return true;
  });

  // Ordenar
  listaFilt.sort((a, b) => {
    if (orden === 'venc-asc') {
      const da = diasRestantes(a.fechaVencimiento) ?? 9999;
      const db = diasRestantes(b.fechaVencimiento) ?? 9999;
      return da - db;
    }
    if (orden === 'partido-asc') {
      return (a.partido || a.organizacion || '').localeCompare(b.partido || b.organizacion || '');
    }
    // fecha-desc: más reciente primero
    const fa = parseDate(a.fechaEnvio) || new Date(0);
    const fb = parseDate(b.fechaEnvio) || new Date(0);
    return fb - fa;
  });

  statsEl.textContent = `${listaFilt.length} de ${todosReq.length} requerimientos`;
  renderTabla();
}

function renderTabla() {
  if (!listaFilt.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-loading">Sin resultados.</td></tr>';
    return;
  }
  tbody.innerHTML = listaFilt.map(r => {
    const partido = r.partido || r.organizacion || '—';
    const radicado = r.radicadoRespuesta || r.radicado_respuesta || r.radicadoResp || '—';
    return `
      <tr>
        <td><span class="pa-num">${r.numero || '—'}</span></td>
        <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${partido}">${partido}</td>
        <td><span class="pa-asunto" title="${(r.asunto||'').replace(/"/g,'&quot;')}">${r.asunto || '—'}</span></td>
        <td><span class="pa-fecha">${fmtFecha(r.fechaEnvio)}</span></td>
        <td><span class="pa-fecha">${fmtFecha(r.fechaVencimiento)}</span></td>
        <td>${renderDias(r)}</td>
        <td>${badgeEstado(r.estado)}</td>
        <td style="font-size:12px;color:rgba(237,240,247,0.5)">${radicado}</td>
      </tr>`;
  }).join('');
}

// ── Listeners ─────────────────────────────────────────────────────────────────
buscarInput.addEventListener('input',   aplicarFiltros);
filtroEstado.addEventListener('change', aplicarFiltros);
filtroOrden.addEventListener('change',  aplicarFiltros);

// ── Init ──────────────────────────────────────────────────────────────────────
cargar();
