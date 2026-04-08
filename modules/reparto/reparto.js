/**
 * modules/reparto/reparto.js
 * Consulta y edición de expedientes del Reparto ET2023.
 */

import { db } from '/firebase-config.js';
import {
  collection, getDocs, doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Verificar rol ────────────────────────────────────────────────────────────
Auth.requireRole(['administrador', 'administrativo']);
renderSidebar('reparto');

// ── Referencias DOM ──────────────────────────────────────────────────────────
const tbody            = document.getElementById('tbody-reparto');
const buscarInput      = document.getElementById('buscar');
const filtroEstado     = document.getElementById('filtro-estado');
const filtroCorp       = document.getElementById('filtro-corporacion');
const filtroDept       = document.getElementById('filtro-departamento');
const statsCount       = document.getElementById('stats-count');
const msgTabla         = document.getElementById('msg-tabla');
const modalEditar      = document.getElementById('modal-editar');
const editInfo         = document.getElementById('edit-info');
const editEstado       = document.getElementById('edit-estado');
const editContador     = document.getElementById('edit-contador');
const editConsecAplic  = document.getElementById('edit-consec-aplic');
const editDerRepos     = document.getElementById('edit-der-repos');
const editActaEntrega  = document.getElementById('edit-acta-entrega');
const editActaReparto  = document.getElementById('edit-acta-reparto');
const editFechaActa    = document.getElementById('edit-fecha-acta');
const editDias         = document.getElementById('edit-dias');
const editTiempoRev    = document.getElementById('edit-tiempo-rev');
const editObservacion  = document.getElementById('edit-observacion');
const editP1No         = document.getElementById('edit-p1-no');
const editP1Fecha      = document.getElementById('edit-p1-fecha');
const editP1Respuesta  = document.getElementById('edit-p1-respuesta');
const editP1Radicado   = document.getElementById('edit-p1-radicado');
const editP2No         = document.getElementById('edit-p2-no');
const editP2Fecha      = document.getElementById('edit-p2-fecha');
const editP2Respuesta  = document.getElementById('edit-p2-respuesta');
const editP2Radicado   = document.getElementById('edit-p2-radicado');
const btnGuardar       = document.getElementById('btn-guardar');
const msgEditar        = document.getElementById('msg-editar');

// ── Paginación ───────────────────────────────────────────────────────────────
const POR_PAGINA = 50;
let paginaActual = 1;

// ── Estado local ─────────────────────────────────────────────────────────────
let todosLosExpedientes = [];
let listaFiltrada       = [];
let editDocId           = null;
let ultimoSorteoIds     = new Set();

// ── Badges de estado ──────────────────────────────────────────────────────────
function badgeEstado(estado) {
  const e = (estado || '').trim().toUpperCase();
  let cls = 'badge-estado-default';
  if (e.startsWith('CERTIFICADO'))      cls = 'badge-estado-cert';
  else if (e === 'PENDIENTE REVISION')  cls = 'badge-estado-pend';
  else if (e === 'VENCIDO')             cls = 'badge-estado-venc';
  else if (e.startsWith('OFICIA'))      cls = 'badge-estado-ofic';
  else if (e.startsWith('REOFI'))       cls = 'badge-estado-reof';
  else if (e === 'REASIGNADO')          cls = 'badge-estado-reas';
  else if (e === 'RETIRADO')            cls = 'badge-estado-reti';
  else if (e === 'INVESTIGACION')       cls = 'badge-estado-inv';
  else if (e === 'DEVUELTA CONTADOR')   cls = 'badge-estado-dev';
  return `<span class="badge-estado ${cls}">${(estado || '').trim() || '—'}</span>`;
}

function badgeTiempo(t) {
  const v = (t || '').trim().toUpperCase();
  if (v === 'VENCIDO') return '<span class="badge-tiempo vencido">VENCIDO</span>';
  if (v === 'EN TERMINO') return '<span class="badge-tiempo en-termino">EN TÉRMINO</span>';
  return t ? `<span class="badge-tiempo">${t}</span>` : '—';
}

// ── Cargar último sorteo activo ───────────────────────────────────────────────
async function cargarUltimoSorteo() {
  try {
    const snap = await getDocs(collection(db, 'sorteos'));
    const activos = snap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .filter(s => s.estado === 'activo')
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    if (activos.length) {
      ultimoSorteoIds = new Set(activos[0].docIdsCreados || []);
    }
  } catch (_) {}
}

// ── Cargar desde Firestore ───────────────────────────────────────────────────
async function cargarExpedientes() {
  tbody.innerHTML = '<tr><td colspan="10" class="table-loading">Cargando expedientes...</td></tr>';
  try {
    const [snap] = await Promise.all([
      getDocs(collection(db, 'reparto')),
      cargarUltimoSorteo()
    ]);
    todosLosExpedientes = snap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .filter(e => !(e.agrupacion || '').trim().startsWith('-'));
    // Orden numérico: primero por prefijo (AL, CN…) luego por número
    todosLosExpedientes.sort((a, b) => {
      const parse = s => { const m = (s||'').match(/^([A-Za-z]+)(\d+)/); return m ? [m[1], parseInt(m[2],10)] : [s||'',0]; };
      const [pa, na] = parse(a.consecutivo);
      const [pb, nb] = parse(b.consecutivo);
      return pa !== pb ? pa.localeCompare(pb) : na - nb;
    });

    poblarFiltros();
    aplicarFiltros();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="26" class="table-loading">Error al cargar: ${err.message}</td></tr>`;
  }
}

// ── Poblar selects de filtro dinámicamente ───────────────────────────────────
function poblarFiltros() {
  const corps  = [...new Set(todosLosExpedientes.map(e => e.corporacion).filter(Boolean))].sort();
  const depts  = [...new Set(todosLosExpedientes.map(e => e.departamento).filter(Boolean))].sort();

  corps.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    filtroCorp.appendChild(opt);
  });
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    filtroDept.appendChild(opt);
  });
}

// ── Aplicar filtros + búsqueda ───────────────────────────────────────────────
function aplicarFiltros() {
  const texto = buscarInput.value.trim().toLowerCase();
  const fEst  = filtroEstado.value.trim().toUpperCase();
  const fCorp = filtroCorp.value;
  const fDept = filtroDept.value;

  listaFiltrada = todosLosExpedientes.filter(e => {
    if (fEst  && (e.estado || '').trim().toUpperCase() !== fEst) return false;
    if (fCorp && e.corporacion !== fCorp) return false;
    if (fDept && e.departamento !== fDept) return false;
    if (texto) {
      const haystack = [
        e.consecutivo, e.municipio, e.nombreContador,
        e.agrupacion, e.numeroActaEntrega
      ].join(' ').toLowerCase();
      if (!haystack.includes(texto)) return false;
    }
    return true;
  });

  paginaActual = 1;
  renderTabla();
}

// ── Renderizar tabla ─────────────────────────────────────────────────────────
function renderTabla() {
  const total  = listaFiltrada.length;
  const inicio = (paginaActual - 1) * POR_PAGINA;
  const fin    = Math.min(inicio + POR_PAGINA, total);
  const pagina = listaFiltrada.slice(inicio, fin);
  const totalPags = Math.ceil(total / POR_PAGINA) || 1;

  // Stats
  statsCount.textContent = `${total.toLocaleString()} expediente${total !== 1 ? 's' : ''}`;

  // Info de paginación
  const pagTxt = `Pág. ${paginaActual} / ${totalPags}  (${inicio + 1}–${fin})`;
  document.getElementById('pag-info-top').textContent = pagTxt;
  document.getElementById('pag-info-bot').textContent = pagTxt;

  // Limpiar inputs de página
  ['input-pag-top','input-pag-bot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.max = totalPags; el.placeholder = `/${totalPags}`; }
  });

  // Estado botones paginación
  const enPrimera = paginaActual <= 1;
  const enUltima  = paginaActual >= totalPags;
  ['btn-prev-top','btn-prev-bot','btn-first-top','btn-first-bot'].forEach(id => {
    document.getElementById(id).disabled = enPrimera;
  });
  ['btn-next-top','btn-next-bot','btn-last-top','btn-last-bot'].forEach(id => {
    document.getElementById(id).disabled = enUltima;
  });

  if (!pagina.length) {
    tbody.innerHTML = '<tr><td colspan="26" class="table-empty">Sin resultados para los filtros aplicados.</td></tr>';
    return;
  }

  tbody.innerHTML = pagina.map(e => `
    <tr class="${ultimoSorteoIds.has(e._id) ? 'row-ultimo-sorteo' : ''}">
      <td class="col-consec">${e.consecutivo || '—'}</td>
      <td class="col-consec">${e.consecutivoAplicativo || '—'}</td>
      <td>${e.corporacion || '—'}</td>
      <td>${e.circunscripcion || '—'}</td>
      <td>${e.departamento || '—'}</td>
      <td>${e.municipio || '—'}</td>
      <td class="col-agrup" title="${e.agrupacion || ''}">${e.agrupacion || '—'}</td>
      <td class="col-centro">${e.derechoReposicion || '—'}</td>
      <td class="col-centro">${e.cajaDigital ?? '—'}</td>
      <td class="col-obs"   title="${e.observacion || ''}">${e.observacion || '—'}</td>
      <td class="col-acta"  title="${e.numeroActaEntrega || ''}">${e.numeroActaEntrega || '—'}</td>
      <td class="col-cont"  title="${e.nombreContador || ''}">${e.nombreContador || '—'}</td>
      <td class="col-centro">${e.numeroActaReparto ?? '—'}</td>
      <td class="col-fecha">${e.fechaActaReparto || '—'}</td>
      <td class="col-dias">${e.dias ?? '—'}</td>
      <td>${badgeTiempo(e.tiempoRevision)}</td>
      <td>${badgeEstado(e.estado)}</td>
      <td class="col-consec">${e.primerOficioNo || '—'}</td>
      <td class="col-fecha">${e.primerOficioFecha || '—'}</td>
      <td class="col-centro">${e.primerOficioRespuesta || '—'}</td>
      <td>${e.primerOficioRadicado || '—'}</td>
      <td class="col-consec">${e.segundoOficioNo || '—'}</td>
      <td class="col-fecha">${e.segundoOficioFecha || '—'}</td>
      <td class="col-centro">${e.segundoOficioRespuesta || '—'}</td>
      <td>${e.segundoOficioRadicado || '—'}</td>
      <td><button class="btn-action btn-editar-exp" data-id="${e._id}">Editar</button></td>
    </tr>
  `).join('');

  // Eventos de editar
  tbody.querySelectorAll('.btn-editar-exp').forEach(btn => {
    btn.addEventListener('click', () => {
      const exp = todosLosExpedientes.find(e => e._id === btn.dataset.id);
      if (exp) abrirModalEditar(exp);
    });
  });
}

// ── Navegación de páginas ────────────────────────────────────────────────────
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

// ── Modal editar ─────────────────────────────────────────────────────────────
function abrirModalEditar(exp) {
  editDocId = exp._id;

  editInfo.innerHTML = `
    <div class="info-item"><span class="info-lbl">CONSECUTIVO MANUAL</span><span class="info-val">${exp.consecutivo || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">CONSEC. APLICATIVO</span><span class="info-val">${exp.consecutivoAplicativo || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">CORPORACIÓN</span><span class="info-val">${exp.corporacion || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">CIRCUNSCRIPCIÓN</span><span class="info-val">${exp.circunscripcion || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">DEPARTAMENTO</span><span class="info-val">${exp.departamento || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">MUNICIPIO</span><span class="info-val">${exp.municipio || '—'}</span></div>
    <div class="info-item info-item--full"><span class="info-lbl">AGRUPACIÓN POLÍTICA</span><span class="info-val">${exp.agrupacion || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">DERECHO A REPOSICIÓN</span><span class="info-val">${exp.derechoReposicion || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">CAJA DIGITAL</span><span class="info-val">${exp.cajaDigital ?? '—'}</span></div>
    <div class="info-item info-item--full"><span class="info-lbl">OBSERVACIÓN REPARTO</span><span class="info-val">${exp.observacion || '—'}</span></div>
    <div class="info-item info-item--full"><span class="info-lbl">N° ACTA DE ENTREGA</span><span class="info-val">${exp.numeroActaEntrega || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">N° ACTA REPARTO</span><span class="info-val">${exp.numeroActaReparto ?? '—'}</span></div>
    <div class="info-item"><span class="info-lbl">FECHA ACTA REPARTO</span><span class="info-val">${exp.fechaActaReparto || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">DÍAS</span><span class="info-val">${exp.dias ?? '—'}</span></div>
    <div class="info-item"><span class="info-lbl">TIEMPO DE REVISIÓN</span><span class="info-val">${exp.tiempoRevision || '—'}</span></div>
    <div style="height:1px;background:rgba(0,212,255,.1);margin:6px 0;grid-column:1/-1;"></div>
    <div class="info-item"><span class="info-lbl">1° N° OFICIO</span><span class="info-val">${exp.primerOficioNo || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">1° FECHA OFICIO</span><span class="info-val">${exp.primerOficioFecha || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">1° RESPUESTA</span><span class="info-val">${exp.primerOficioRespuesta || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">1° RADICADO EPX</span><span class="info-val">${exp.primerOficioRadicado || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">2° N° OFICIO</span><span class="info-val">${exp.segundoOficioNo || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">2° FECHA OFICIO</span><span class="info-val">${exp.segundoOficioFecha || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">2° RESPUESTA</span><span class="info-val">${exp.segundoOficioRespuesta || '—'}</span></div>
    <div class="info-item"><span class="info-lbl">2° RADICADO EPX</span><span class="info-val">${exp.segundoOficioRadicado || '—'}</span></div>
  `;

  // Pre-seleccionar estado actual (comparación flexible)
  const estadoActual = (exp.estado || '').trim();
  const opcion = [...editEstado.options].find(o => o.value.toUpperCase() === estadoActual.toUpperCase());
  editEstado.value = opcion ? opcion.value : estadoActual;

  editContador.value    = exp.nombreContador         || '';
  editConsecAplic.value = exp.consecutivoAplicativo  || '';
  editDerRepos.value    = exp.derechoReposicion       || '';
  editActaEntrega.value = exp.numeroActaEntrega       || '';
  editActaReparto.value = String(exp.numeroActaReparto ?? '');
  editFechaActa.value   = exp.fechaActaReparto        || '';
  editDias.value        = String(exp.dias ?? '');
  editTiempoRev.value   = exp.tiempoRevision          || '';
  editObservacion.value = exp.observacion             || '';
  editP1No.value        = exp.primerOficioNo          || '';
  editP1Fecha.value     = exp.primerOficioFecha       || '';
  editP1Respuesta.value = exp.primerOficioRespuesta   || '';
  editP1Radicado.value  = exp.primerOficioRadicado    || '';
  editP2No.value        = exp.segundoOficioNo         || '';
  editP2Fecha.value     = exp.segundoOficioFecha      || '';
  editP2Respuesta.value = exp.segundoOficioRespuesta  || '';
  editP2Radicado.value  = exp.segundoOficioRadicado   || '';

  msgEditar.textContent = '';
  modalEditar.style.display = 'flex';
}

window.cerrarModalEditar = function () {
  modalEditar.style.display = 'none';
  editDocId = null;
};

btnGuardar.addEventListener('click', async () => {
  if (!editDocId) return;

  btnGuardar.disabled   = true;
  msgEditar.textContent = 'Guardando...';
  msgEditar.style.color = 'var(--cyan)';

  const cambios = {
    estado:                 editEstado.value,
    nombreContador:         editContador.value.trim(),
    consecutivoAplicativo:  editConsecAplic.value.trim(),
    derechoReposicion:      editDerRepos.value.trim(),
    numeroActaEntrega:      editActaEntrega.value.trim(),
    numeroActaReparto:      editActaReparto.value.trim(),
    fechaActaReparto:       editFechaActa.value.trim(),
    dias:                   editDias.value.trim(),
    tiempoRevision:         editTiempoRev.value,
    observacion:            editObservacion.value.trim(),
    primerOficioNo:         editP1No.value.trim(),
    primerOficioFecha:      editP1Fecha.value.trim(),
    primerOficioRespuesta:  editP1Respuesta.value,
    primerOficioRadicado:   editP1Radicado.value.trim(),
    segundoOficioNo:        editP2No.value.trim(),
    segundoOficioFecha:     editP2Fecha.value.trim(),
    segundoOficioRespuesta: editP2Respuesta.value,
    segundoOficioRadicado:  editP2Radicado.value.trim(),
  };

  try {
    await updateDoc(doc(db, 'reparto', editDocId), cambios);

    // Actualizar estado local
    const exp = todosLosExpedientes.find(e => e._id === editDocId);
    if (exp) Object.assign(exp, cambios);

    aplicarFiltros();
    msgEditar.textContent = '✔ Cambios guardados.';
    msgEditar.style.color = '#00ff88';
    setTimeout(() => cerrarModalEditar(), 1000);
  } catch (err) {
    msgEditar.textContent = '✘ Error: ' + err.message;
    msgEditar.style.color = '#ff6080';
  } finally {
    btnGuardar.disabled = false;
  }
});

// ── Descargar Excel ───────────────────────────────────────────────────────────
window.descargarExcel = function() {
  if (!listaFiltrada.length) return;

  const filas = listaFiltrada.map(e => ({
    'CONSEC. MANUAL':      e.consecutivo            || '',
    'CONSEC. APLICATIVO':  e.consecutivoAplicativo  || '',
    'CORPORACIÓN':         e.corporacion            || '',
    'CIRCUNSCRIPCIÓN':     e.circunscripcion        || '',
    'DEPARTAMENTO':        e.departamento           || '',
    'MUNICIPIO':           e.municipio              || '',
    'AGRUPACIÓN POLÍTICA': e.agrupacion             || '',
    'DERECHO REPOSICIÓN':  e.derechoReposicion      || '',
    'CAJA DIGITAL':        e.cajaDigital            ?? '',
    'OBSERVACIÓN':         e.observacion            || '',
    'N° ACTA ENTREGA':     e.numeroActaEntrega      || '',
    'NOMBRE CONTADOR':     e.nombreContador         || '',
    'N° ACTA REPARTO':     e.numeroActaReparto      ?? '',
    'FECHA ACTA':          e.fechaActaReparto       || '',
    'DÍAS':                e.dias                   ?? '',
    'T. REVISIÓN':         e.tiempoRevision         || '',
    'ESTADO':              e.estado                 || '',
    '1° N° OFICIO':        e.primerOficioNo         || '',
    '1° FECHA OFICIO':     e.primerOficioFecha      || '',
    '1° RESPUESTA':        e.primerOficioRespuesta  || '',
    '1° RADICADO EPX':     e.primerOficioRadicado   || '',
    '2° N° OFICIO':        e.segundoOficioNo        || '',
    '2° FECHA OFICIO':     e.segundoOficioFecha     || '',
    '2° RESPUESTA':        e.segundoOficioRespuesta || '',
    '2° RADICADO EPX':     e.segundoOficioRadicado  || '',
  }));

  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reparto');

  const fecha = new Date().toLocaleDateString('es-CO').replace(/\//g, '-');
  XLSX.writeFile(wb, `Reparto_ET2023_${fecha}.xlsx`);
};

// ── Listeners filtros ────────────────────────────────────────────────────────
buscarInput.addEventListener('input', aplicarFiltros);
filtroEstado.addEventListener('change', aplicarFiltros);
filtroCorp.addEventListener('change', aplicarFiltros);
filtroDept.addEventListener('change', aplicarFiltros);

// ── Init ─────────────────────────────────────────────────────────────────────
cargarExpedientes();
