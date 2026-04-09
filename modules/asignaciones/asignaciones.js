/**
 * modules/asignaciones/asignaciones.js
 * Consulta y selección prioritaria de candidatos pendientes.
 */

import { db } from '/firebase-config.js';
import { collection, getDocs, query, where, writeBatch, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

Auth.requireRole(['administrador', 'administrativo']);
renderSidebar('asignaciones');

// ── Referencias DOM ───────────────────────────────────────────────────────────
const tbody       = document.getElementById('tbody-asig');
const buscarInput = document.getElementById('buscar');
const filtroCorp  = document.getElementById('filtro-corporacion');
const filtroDept  = document.getElementById('filtro-departamento');
const filtroColor = document.getElementById('filtro-color');
const statsCount  = document.getElementById('stats-count');

// ── Paginación ────────────────────────────────────────────────────────────────
const POR_PAGINA = 50;
let paginaActual = 1;

// ── Estado ────────────────────────────────────────────────────────────────────
let todosLosRegistros = [];
let listaFiltrada     = [];
let seleccionados     = new Set();  // Set de _id seleccionados
let paginaActualIds   = [];         // _ids de la página visible

// ── Normalizar categoría ──────────────────────────────────────────────────────
function normCat(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim().toUpperCase()
    .replace('PRIMERA',   '1').replace('SEGUNDA', '2')
    .replace('TERCERA',   '3').replace('CUARTA',  '4')
    .replace('QUINTA',    '5').replace('SEXTA',   '6')
    .replace('°','').replace('ª','').replace('A','').trim();
  return s; // ESPECIAL, 1, 2, 3, 4, 5, 6
}

// ── Normalizar tipo de corporación ────────────────────────────────────────────
function normTipo(corp) {
  const c = (corp || '').toUpperCase().trim();
  if (c.startsWith('ALCALD'))   return 'ALCALDIA';
  if (c.startsWith('CONCEJO'))  return 'CONCEJO';
  if (c.startsWith('ASAMBLEA')) return 'ASAMBLEA';
  if (c.startsWith('GOBERN'))   return 'GOBERNACION';
  if (c.startsWith('JUNTA'))    return 'JUNTA';
  return 'OTRO';
}

// ── Badge de color ────────────────────────────────────────────────────────────
function badgeColor(color) {
  if (!color) return '<span class="badge-sin-color">—</span>';
  return `<span class="badge-color" style="background:${color};border-color:${color};" title="${color}"></span>`;
}

// ── Cargar desde Firestore ────────────────────────────────────────────────────
async function cargarRegistros() {
  tbody.innerHTML = '<tr><td colspan="12" class="table-loading">Cargando registros...</td></tr>';
  try {
    const snap = await getDocs(collection(db, 'pendientes'));
    todosLosRegistros = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    todosLosRegistros.sort((a, b) => {
      const da = (a.departamento || '').localeCompare(b.departamento || '');
      if (da !== 0) return da;
      const ma = (a.municipio || '').localeCompare(b.municipio || '');
      if (ma !== 0) return ma;
      return (a.agrupacion || '').localeCompare(b.agrupacion || '');
    });

    poblarFiltros();
    aplicarFiltros();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" class="table-loading">Error al cargar: ${err.message}</td></tr>`;
  }
}

// ── Poblar selects dinámicamente ──────────────────────────────────────────────
function poblarFiltros() {
  const corps  = [...new Set(todosLosRegistros.map(e => e.corporacion).filter(Boolean))].sort();
  const depts  = [...new Set(todosLosRegistros.map(e => e.departamento).filter(Boolean))].sort();
  const colors = [...new Set(todosLosRegistros.map(e => e.color).filter(Boolean))].sort();

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
  colors.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    opt.style.background = c;
    filtroColor.appendChild(opt);
  });
}

// ── Aplicar filtros + búsqueda ────────────────────────────────────────────────
function aplicarFiltros() {
  const texto  = buscarInput.value.trim().toLowerCase();
  const fCorp  = filtroCorp.value;
  const fDept  = filtroDept.value;
  const fColor = filtroColor.value;

  listaFiltrada = todosLosRegistros.filter(e => {
    if (fCorp  && e.corporacion  !== fCorp)  return false;
    if (fDept  && e.departamento !== fDept)  return false;
    if (fColor && e.color        !== fColor) return false;
    if (texto) {
      const haystack = [
        e.municipio, e.agrupacion, e.corporacion,
        e.departamento, e.tipoAgrupacion
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

  paginaActualIds = pagina.map(e => e._id);

  const nSel = seleccionados.size;
  statsCount.textContent =
    `${total.toLocaleString()} registro${total !== 1 ? 's' : ''}` +
    (nSel ? `  ·  ${nSel} seleccionado${nSel !== 1 ? 's' : ''}` : '');

  // Badge y botón excel-sel
  const badge = document.getElementById('sel-badge');
  const btnDlSel = document.getElementById('btn-dl-sel');
  if (nSel > 0) {
    document.getElementById('sel-count').textContent = nSel;
    badge.style.display = '';
    btnDlSel.style.display = '';
  } else {
    badge.style.display = 'none';
    btnDlSel.style.display = 'none';
  }

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

  // Checkbox "seleccionar todos" de cabecera
  const chkTodos = document.getElementById('chk-todos');
  const todosEnPag = paginaActualIds.length > 0 && paginaActualIds.every(id => seleccionados.has(id));
  chkTodos.checked = todosEnPag;
  chkTodos.indeterminate = !todosEnPag && paginaActualIds.some(id => seleccionados.has(id));

  if (!pagina.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="table-empty">Sin resultados para los filtros aplicados.</td></tr>';
    return;
  }

  tbody.innerHTML = pagina.map(e => {
    const selec = seleccionados.has(e._id);
    return `
      <tr class="${selec ? 'row-seleccionada' : ''}">
        <td class="col-chk">
          <input type="checkbox" class="chk-row" data-id="${e._id}"
                 ${selec ? 'checked' : ''} onchange="toggleRow(this)" />
        </td>
        <td class="col-centro">${e.numeroCandidatos ?? '—'}</td>
        <td>${e.corporacion || '—'}</td>
        <td>${e.circunscripcion || '—'}</td>
        <td>${e.departamento || '—'}</td>
        <td class="col-centro">${e.codDepto || '—'}</td>
        <td>${e.municipio || '—'}</td>
        <td class="col-centro">${e.codMunpio || '—'}</td>
        <td class="col-centro col-cat">${e.categoriaMunicipio ?? '—'}</td>
        <td class="col-tipo" title="${e.tipoAgrupacion || ''}">${e.tipoAgrupacion || '—'}</td>
        <td class="col-agrup" title="${e.agrupacion || ''}">${e.agrupacion || '—'}</td>
        <td class="col-centro">${badgeColor(e.color)}</td>
      </tr>
    `;
  }).join('');
}

// ── Toggle checkbox de fila ───────────────────────────────────────────────────
window.toggleRow = function(chk) {
  if (chk.checked) seleccionados.add(chk.dataset.id);
  else             seleccionados.delete(chk.dataset.id);
  renderTabla();
};

// ── Toggle todos los visibles en la página ────────────────────────────────────
window.toggleTodosVisibles = function(checked) {
  paginaActualIds.forEach(id => {
    if (checked) seleccionados.add(id);
    else         seleccionados.delete(id);
  });
  renderTabla();
};

// ── PANEL PRIORITARIO: Seleccionar por tipo ───────────────────────────────────
window.selTipo = function(tipo) {
  // Toggle visual del botón
  const btn = document.querySelector(`.btn-tipo[data-tipo="${tipo}"]`);
  if (btn) btn.classList.toggle('activo');
};

// ── PANEL PRIORITARIO: Aplicar selección prioritaria ─────────────────────────
window.aplicarSelPrioritaria = function() {
  // Tipos activos (botones toggled)
  const tiposActivos = [...document.querySelectorAll('.btn-tipo.activo')]
    .map(b => b.dataset.tipo);

  // Categorías seleccionadas
  const catsActivas = [...document.querySelectorAll('.chk-cat:checked')]
    .map(c => c.value.toUpperCase());

  // Si no se eligió nada, seleccionar todo el filtro actual
  if (!tiposActivos.length && !catsActivas.length) {
    listaFiltrada.forEach(e => seleccionados.add(e._id));
    renderTabla();
    return;
  }

  // Seleccionar registros que cumplan tipo Y categoría (si se especificaron ambos)
  listaFiltrada.forEach(e => {
    const tipo = normTipo(e.corporacion);
    const cat  = normCat(e.categoriaMunicipio);

    const cumpleTipo = !tiposActivos.length || tiposActivos.includes(tipo);
    const cumpleCat  = !catsActivas.length  || catsActivas.includes(cat);

    if (cumpleTipo && cumpleCat) seleccionados.add(e._id);
  });

  renderTabla();
};

// ── Seleccionar todos los de la lista filtrada ────────────────────────────────
window.selTodos = function() {
  listaFiltrada.forEach(e => seleccionados.add(e._id));
  renderTabla();
};

// ── Limpiar selección ─────────────────────────────────────────────────────────
window.limpiarSeleccion = function() {
  seleccionados.clear();
  document.querySelectorAll('.btn-tipo.activo').forEach(b => b.classList.remove('activo'));
  document.querySelectorAll('.chk-cat').forEach(c => c.checked = false);
  renderTabla();
};

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

// ── Descargar Excel — todos los filtrados ─────────────────────────────────────
window.descargarExcel = function() {
  if (!listaFiltrada.length) return;
  exportarExcel(listaFiltrada, 'Asignaciones_ET2023');
};

// ── Descargar Excel — solo seleccionados (con motivo) ─────────────────────────
window.descargarSeleccionados = function() {
  const data = todosLosRegistros.filter(e => seleccionados.has(e._id));
  if (!data.length) return;

  // Recopilar motivos
  const motivos = [...document.querySelectorAll('.chk-motivo:checked')]
    .map(c => c.value);
  const custom  = (document.getElementById('motivo-custom').value || '').trim();
  if (custom) motivos.push(custom);
  const motivoStr = motivos.join(' | ') || '';

  exportarExcel(data, 'Asignaciones_Prioritarias', motivoStr);
};

function exportarExcel(lista, nombreBase, motivo = '') {
  const filas = lista.map(e => {
    const fila = {
      'N° CAND.':            e.numeroCandidatos   ?? '',
      'CORPORACIÓN':         e.corporacion        || '',
      'CIRCUNSCRIPCIÓN':     e.circunscripcion    || '',
      'DEPARTAMENTO':        e.departamento       || '',
      'COD. DEPTO':          e.codDepto           || '',
      'MUNICIPIO':           e.municipio          || '',
      'COD. MPIO':           e.codMunpio          || '',
      'CATEGORÍA':           e.categoriaMunicipio ?? '',
      'TIPO AGRUPACIÓN':     e.tipoAgrupacion     || '',
      'AGRUPACIÓN POLÍTICA': e.agrupacion         || '',
      'COLOR':               e.color              || '',
    };
    if (motivo) fila['MOTIVO PRIORIDAD'] = motivo;
    return fila;
  });

  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asignaciones');

  const fecha = new Date().toLocaleDateString('es-CO').replace(/\//g, '-');
  XLSX.writeFile(wb, `${nombreBase}_${fecha}.xlsx`);
}

// ── Listeners filtros ─────────────────────────────────────────────────────────
buscarInput.addEventListener('input', aplicarFiltros);
filtroCorp.addEventListener('change', aplicarFiltros);
filtroDept.addEventListener('change', aplicarFiltros);
filtroColor.addEventListener('change', aplicarFiltros);

// ── Init ──────────────────────────────────────────────────────────────────────
cargarRegistros();

// ══════════════════════════════════════════════════════════════════════════════
// NUEVO REPARTO
// ══════════════════════════════════════════════════════════════════════════════
let _repartoPaso       = 1;
let _repartoContadores = [];
let _repartoRegistros  = [];
let _cajasReparto      = [];   // [{num, registros, contador}]
let _sorteoInterval    = null;
let _ultimoRepartoId   = null;

window.abrirNuevoReparto = async function() {
  _repartoPaso = 1;
  _repartoContadores = [];
  _repartoRegistros  = [];
  document.querySelectorAll('.btn-tipo-r').forEach(b => b.classList.remove('activo'));
  document.querySelectorAll('.chk-rcat').forEach(c => { c.checked = false; });
  document.getElementById('reparto-criterio-tabla-wrap').innerHTML = '';
  document.getElementById('reparto-resumen-criterio').textContent  = '';
  document.getElementById('rtab-criterio').classList.add('active');
  document.getElementById('rtab-manual').classList.remove('active');
  document.getElementById('rpanel-criterio').style.display = '';
  document.getElementById('rpanel-manual').style.display   = 'none';
  mostrarPasoReparto(1);
  document.getElementById('modal-nuevo-reparto').style.display = 'flex';
  await cargarContadoresReparto();
};

window.cerrarNuevoReparto = function() {
  document.getElementById('modal-nuevo-reparto').style.display = 'none';
};

async function cargarContadoresReparto() {
  const wrap = document.getElementById('reparto-contadores-lista');
  wrap.innerHTML = '<p style="color:rgba(224,244,255,.4);font-size:12px">Cargando…</p>';
  try {
    const snap = await getDocs(collection(db, 'usuarios'));
    const lista = [];
    snap.forEach(d => { const dt = d.data(); if (dt.rol === 'contador') lista.push(dt.nombre); });
    lista.sort();
    wrap.innerHTML = lista.map(n =>
      `<label class="auth-item">
        <input type="checkbox" class="chk-contador-r" value="${n}" onchange="actualizarResumenContadores()">
        <span>${n}</span>
      </label>`
    ).join('');
    actualizarResumenContadores();
  } catch (e) {
    wrap.innerHTML = `<p style="color:#ff6080;font-size:12px">Error: ${e.message}</p>`;
  }
}

window.actualizarResumenContadores = function() {
  _repartoContadores = [...document.querySelectorAll('.chk-contador-r:checked')].map(c => c.value);
  document.getElementById('reparto-resumen-contadores').textContent = _repartoContadores.length
    ? `${_repartoContadores.length} contador${_repartoContadores.length !== 1 ? 'es' : ''} seleccionado${_repartoContadores.length !== 1 ? 's' : ''}`
    : '';
};

window.repartoTab = function(tab) {
  document.getElementById('rtab-criterio').classList.toggle('active', tab === 'criterio');
  document.getElementById('rtab-manual').classList.toggle('active', tab === 'manual');
  document.getElementById('rpanel-criterio').style.display = tab === 'criterio' ? '' : 'none';
  document.getElementById('rpanel-manual').style.display   = tab === 'manual'   ? '' : 'none';
  if (tab === 'manual') {
    const n = seleccionados.size;
    document.getElementById('reparto-resumen-manual').textContent = n
      ? `${n} registro${n !== 1 ? 's' : ''} seleccionado${n !== 1 ? 's' : ''} en la tabla`
      : 'No hay registros seleccionados. Usa los checkboxes de la tabla principal primero.';
  }
};

window.rSelTipo = function(btn) {
  btn.classList.toggle('activo');
  actualizarTablaReparto();
};

window.actualizarTablaReparto = function() {
  const tiposActivos = [...document.querySelectorAll('.btn-tipo-r.activo')].map(b => b.dataset.tipo);
  const catsActivas  = [...document.querySelectorAll('.chk-rcat:checked')].map(c => c.value.toUpperCase());
  const wrap = document.getElementById('reparto-criterio-tabla-wrap');

  if (!tiposActivos.length && !catsActivas.length) {
    wrap.innerHTML = '';
    document.getElementById('reparto-resumen-criterio').textContent = '';
    return;
  }

  const combinaciones = {};
  todosLosRegistros.forEach(e => {
    const tipo = normTipo(e.corporacion);
    const cat  = normCat(e.categoriaMunicipio);
    if (tiposActivos.length && !tiposActivos.includes(tipo)) return;
    if (catsActivas.length  && !catsActivas.includes(cat))  return;
    const key = `${tipo}||${cat}`;
    if (!combinaciones[key]) combinaciones[key] = { tipo, cat, count: 0 };
    combinaciones[key].count++;
  });

  const keys = Object.keys(combinaciones).sort();
  if (!keys.length) {
    wrap.innerHTML = '<p style="color:rgba(224,244,255,.3);font-size:12px;text-align:center;padding:16px">Sin registros para los criterios seleccionados.</p>';
    document.getElementById('reparto-resumen-criterio').textContent = '';
    return;
  }

  let totalDisp = keys.reduce((s, k) => s + combinaciones[k].count, 0);

  wrap.innerHTML = `
    <table class="reparto-criterio-table">
      <thead><tr><th>Corporación</th><th>Categoría</th><th>Disponibles</th><th>Cantidad a incluir</th></tr></thead>
      <tbody>
        ${keys.map(k => {
          const c = combinaciones[k];
          return `<tr>
            <td>${c.tipo}</td>
            <td>${c.cat || '—'}</td>
            <td style="text-align:center">${c.count}</td>
            <td><input type="number" class="inp-cant-criterio" data-key="${k}"
                 min="1" max="${c.count}" placeholder="Todos (${c.count})" style="width:120px" /></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  document.getElementById('reparto-resumen-criterio').textContent = `${totalDisp} registros disponibles en total`;
};

function mostrarPasoReparto(paso) {
  _repartoPaso = paso;
  [1, 2, 3].forEach(p => {
    document.getElementById(`reparto-paso-${p}`).style.display = p === paso ? '' : 'none';
    const ind = document.getElementById(`step-ind-${p}`);
    ind.classList.toggle('active', p === paso);
    ind.classList.toggle('done', p < paso);
  });
  document.getElementById('btn-rep-atras').style.display     = paso > 1 ? '' : 'none';
  document.getElementById('btn-rep-siguiente').style.display = paso < 3 ? '' : 'none';
  document.getElementById('btn-rep-confirmar').style.display = paso === 3 ? '' : 'none';
}

window.repartoPasoSiguiente = function() {
  if (_repartoPaso === 1) {
    _repartoContadores = [...document.querySelectorAll('.chk-contador-r:checked')].map(c => c.value);
    if (!_repartoContadores.length) { alert('Selecciona al menos un contador.'); return; }
    mostrarPasoReparto(2);

  } else if (_repartoPaso === 2) {
    const esCriterio = document.getElementById('rtab-criterio').classList.contains('active');

    if (esCriterio) {
      const tiposActivos = [...document.querySelectorAll('.btn-tipo-r.activo')].map(b => b.dataset.tipo);
      const catsActivas  = [...document.querySelectorAll('.chk-rcat:checked')].map(c => c.value.toUpperCase());
      if (!tiposActivos.length && !catsActivas.length) { alert('Selecciona al menos un tipo de corporación o categoría.'); return; }

      const cantPorKey = {};
      document.querySelectorAll('.inp-cant-criterio').forEach(inp => {
        const val = parseInt(inp.value);
        if (!isNaN(val) && val > 0) cantPorKey[inp.dataset.key] = val;
      });

      const porKey = {};
      todosLosRegistros.forEach(e => {
        const tipo = normTipo(e.corporacion);
        const cat  = normCat(e.categoriaMunicipio);
        if (tiposActivos.length && !tiposActivos.includes(tipo)) return;
        if (catsActivas.length  && !catsActivas.includes(cat))  return;
        const key = `${tipo}||${cat}`;
        if (!porKey[key]) porKey[key] = [];
        porKey[key].push(e);
      });

      const usados = new Set();
      _repartoRegistros = [];
      Object.entries(porKey).forEach(([key, regs]) => {
        const limite = cantPorKey[key] ?? regs.length;
        regs.slice(0, limite).forEach(e => { if (!usados.has(e._id)) { usados.add(e._id); _repartoRegistros.push(e); } });
      });
    } else {
      _repartoRegistros = todosLosRegistros.filter(e => seleccionados.has(e._id));
    }

    if (!_repartoRegistros.length) { alert('No hay registros para repartir.'); return; }
    mostrarPreviewReparto();
    mostrarPasoReparto(3);
  }
};

window.repartoPasoAtras = function() { mostrarPasoReparto(_repartoPaso - 1); };

function mostrarPreviewReparto() {
  const wrap  = document.getElementById('reparto-preview-wrap');
  const n     = _repartoContadores.length;
  const total = _repartoRegistros.length;
  const min   = Math.floor(total / n);
  const max   = Math.ceil(total / n);

  // Mezclar registros al azar y dividir en N cajas
  const shuffled = [..._repartoRegistros].sort(() => Math.random() - 0.5);
  _cajasReparto = Array.from({ length: n }, (_, i) => ({
    num: i + 1,
    registros: shuffled.filter((_, j) => j % n === i),
    contador: null
  }));

  // Ocultar confirmar hasta que se haga el sorteo
  document.getElementById('btn-rep-confirmar').style.display = 'none';

  wrap.innerHTML = `
    <div class="reparto-preview-resumen">
      <span><strong>${total}</strong> registros</span>
      <span>÷</span>
      <span><strong>${n}</strong> cajas</span>
      <span>=</span>
      <span><strong>${min === max ? min : min + '–' + max}</strong> por caja</span>
    </div>
    <div class="cajas-grid">
      ${_cajasReparto.map(c => `
        <div class="caja-card" id="caja-card-${c.num}">
          <div class="caja-num">CAJA ${c.num}</div>
          <div class="caja-count">${c.registros.length} registros</div>
          <div class="caja-contador" id="caja-asig-${c.num}">—</div>
        </div>`).join('')}
    </div>
    <div class="sorteo-controles">
      <button class="btn-sorteo btn-sorteo-iniciar" id="btn-iniciar-sorteo" onclick="iniciarSorteo()">▶ Iniciar sorteo</button>
      <button class="btn-sorteo btn-sorteo-parar"   id="btn-parar-sorteo"  onclick="pararSorteo()" disabled>⏹ Parar</button>
    </div>
    <div id="sorteo-resultado"></div>`;
}

window.iniciarSorteo = function() {
  if (_sorteoInterval) return;
  // Limpiar resultado anterior
  document.getElementById('sorteo-resultado').innerHTML = '';
  document.getElementById('btn-rep-confirmar').style.display = 'none';
  document.getElementById('btn-iniciar-sorteo').disabled = true;
  document.getElementById('btn-parar-sorteo').disabled = false;
  _cajasReparto.forEach(c => {
    const card = document.getElementById(`caja-card-${c.num}`);
    if (card) card.classList.remove('sorteada');
    const el = document.getElementById(`caja-asig-${c.num}`);
    if (el) { el.classList.remove('asignado'); }
  });

  _sorteoInterval = setInterval(() => {
    const mezclados = [..._repartoContadores].sort(() => Math.random() - 0.5);
    _cajasReparto.forEach((caja, i) => {
      const el = document.getElementById(`caja-asig-${caja.num}`);
      if (el) el.textContent = mezclados[i];
    });
  }, 80);
};

window.pararSorteo = function() {
  if (!_sorteoInterval) return;
  clearInterval(_sorteoInterval);
  _sorteoInterval = null;

  document.getElementById('btn-parar-sorteo').disabled = true;
  document.getElementById('btn-iniciar-sorteo').disabled = false;

  // Asignación final al azar
  const final = [..._repartoContadores].sort(() => Math.random() - 0.5);
  _cajasReparto.forEach((caja, i) => {
    caja.contador = final[i];
    const el = document.getElementById(`caja-asig-${caja.num}`);
    if (el) { el.textContent = final[i]; el.classList.add('asignado'); }
    const card = document.getElementById(`caja-card-${caja.num}`);
    if (card) card.classList.add('sorteada');
  });

  document.getElementById('sorteo-resultado').innerHTML = `
    <div class="reparto-preview-tabla-wrap" style="margin-top:16px">
      <table class="reparto-preview-tabla">
        <thead><tr><th style="text-align:center">Caja</th><th>Contador asignado</th><th style="text-align:center">Registros</th></tr></thead>
        <tbody>
          ${_cajasReparto.map(c => `
            <tr>
              <td style="text-align:center;font-weight:700">Caja ${c.num}</td>
              <td>${c.contador}</td>
              <td style="text-align:center;font-variant-numeric:tabular-nums">${c.registros.length}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.getElementById('btn-rep-confirmar').style.display = '';
};

// Prefijos de consecutivo por tipo de corporación
const CORP_PREFIX = {
  ALCALDIA:    'AL',
  CONCEJO:     'CO',
  ASAMBLEA:    'AS',
  GOBERNACION: 'GO',
  JUNTA:       'JA',
};

window.ejecutarReparto = async function() {
  const btn = document.getElementById('btn-rep-confirmar');
  btn.disabled = true; btn.textContent = 'Procesando…';
  try {
    // ── 1. Leer reparto actual para obtener máximos ──────────────────────────
    const snapReparto = await getDocs(collection(db, 'reparto'));
    const maxConsec = {};  // prefix → número más alto
    let   maxActa   = 0;

    snapReparto.forEach(d => {
      const data = d.data();
      // Consecutivo manual
      const mc = (data.consecutivo || '').match(/^([A-Za-z]+)(\d+)$/);
      if (mc) {
        const pfx = mc[1].toUpperCase();
        const num = parseInt(mc[2], 10);
        if (!maxConsec[pfx] || num > maxConsec[pfx]) maxConsec[pfx] = num;
      }
      // Número de acta
      const ma = String(data.numeroActaEntrega || '').match(/(\d{5,6})$/);
      if (ma) {
        const num = parseInt(ma[1], 10);
        if (num > maxActa) maxActa = num;
      }
    });

    // ── 2. Contadores incrementales para este lote ───────────────────────────
    const nextConsec = { ...maxConsec };  // prefix → próximo a asignar
    let   nextActa   = maxActa;

    const fechaHoy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // ── 3. Construir escrituras con campos automáticos ───────────────────────
    const repartoId = Date.now().toString();
    const escrituras = [];

    _cajasReparto.forEach(({ contador, registros, num }) => {
      // Un número de acta por caja/contador
      nextActa++;
      const numeroActaEntrega = `CNE-FNFPCE-ACTA-E-ET2023-${String(nextActa).padStart(6, '0')}`;

      registros.forEach(reg => {
        const { _id, ...campos } = reg;

        // Prefijo según corporación
        const tipo = normTipo(reg.corporacion);
        const pfx  = CORP_PREFIX[tipo] || 'XX';

        if (!nextConsec[pfx]) nextConsec[pfx] = 0;
        nextConsec[pfx]++;

        const consecutivo = pfx + String(nextConsec[pfx]).padStart(5, '0');

        escrituras.push({
          id: _id,
          data: {
            ...campos,
            consecutivo,
            numeroActaEntrega,
            fechaActaReparto: fechaHoy,
            nombreContador:   contador,
            cajaNum:          num,
            estado:           'PENDIENTE REVISION',
            repartoId,
          }
        });
      });
    });

    // ── 4. Escribir en batches ───────────────────────────────────────────────
    const CHUNK = 250;
    for (let i = 0; i < escrituras.length; i += CHUNK) {
      const batch = writeBatch(db);
      escrituras.slice(i, i + CHUNK).forEach(w => {
        batch.set(doc(db, 'reparto', w.id), w.data);
        batch.delete(doc(db, 'pendientes', w.id));
      });
      await batch.commit();
    }

    _ultimoRepartoId = repartoId;
    const idsEliminados = new Set(escrituras.map(w => w.id));
    todosLosRegistros = todosLosRegistros.filter(r => !idsEliminados.has(r._id));
    seleccionados = new Set([...seleccionados].filter(id => !idsEliminados.has(id)));
    aplicarFiltros();

    cerrarNuevoReparto();
    const msg = document.getElementById('msg-tabla');
    msg.innerHTML = `✔ Reparto realizado: ${escrituras.length} registros asignados a ${_cajasReparto.length} contadores. &nbsp;<button class="btn-deshacer-reparto" onclick="deshacerUltimoReparto()">↩ Deshacer</button>`;
    msg.style.color = '#00ff88';
  } catch (e) {
    btn.disabled = false; btn.textContent = '✓ Confirmar Reparto';
    alert('Error al ejecutar el reparto: ' + e.message);
  }
};

window.deshacerTodoReparto = async function() {
  const msg = document.getElementById('msg-tabla');
  try {
    const snap = await getDocs(collection(db, 'reparto'));
    // Solo los que NO tienen repartoId (reparto hecho antes de la nueva función)
    const sinId = snap.docs.filter(d => !d.data().repartoId);
    if (!sinId.length) { alert('No hay registros pendientes de deshacer.'); return; }
    if (!confirm(`Se devolverán ${sinId.length} registro(s) a Pendientes. ¿Continuar?`)) return;
    msg.textContent = 'Deshaciendo reparto…';
    msg.style.color = 'rgba(224,244,255,.5)';

    const CHUNK = 250;
    for (let i = 0; i < sinId.length; i += CHUNK) {
      const batch = writeBatch(db);
      sinId.slice(i, i + CHUNK).forEach(d => {
        const { nombreContador, estado, repartoId: _rid, ...campos } = d.data();
        batch.set(doc(db, 'pendientes', d.id), campos);
        batch.delete(doc(db, 'reparto', d.id));
      });
      await batch.commit();
    }

    _ultimoRepartoId = null;
    await cargarRegistros();
    msg.textContent = `✔ ${sinId.length} registro(s) devueltos a Pendientes.`;
    msg.style.color = '#00ff88';
    setTimeout(() => { msg.textContent = ''; }, 5000);
  } catch (e) {
    msg.textContent = 'Error al deshacer: ' + e.message;
    msg.style.color = '#ff6080';
  }
};

window.deshacerUltimoReparto = async function() {
  if (!_ultimoRepartoId) return;
  if (!confirm('¿Deshacer el último reparto? Los registros volverán a Pendientes.')) return;
  const msg = document.getElementById('msg-tabla');
  msg.textContent = 'Deshaciendo reparto…';
  msg.style.color = 'rgba(224,244,255,.5)';
  try {
    const snap = await getDocs(query(collection(db, 'reparto'), where('repartoId', '==', _ultimoRepartoId)));
    if (snap.empty) { msg.textContent = 'No se encontraron registros del último reparto.'; return; }

    const CHUNK = 250;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      docs.slice(i, i + CHUNK).forEach(d => {
        const { nombreContador, estado, repartoId: _rid, ...campos } = d.data();
        batch.set(doc(db, 'pendientes', d.id), campos);
        batch.delete(doc(db, 'reparto', d.id));
      });
      await batch.commit();
    }

    _ultimoRepartoId = null;
    await cargarRegistros();
    msg.textContent = `✔ Reparto deshecho: ${docs.length} registros devueltos a Pendientes.`;
    msg.style.color = '#00ff88';
    setTimeout(() => { msg.textContent = ''; }, 5000);
  } catch (e) {
    msg.textContent = 'Error al deshacer: ' + e.message;
    msg.style.color = '#ff6080';
  }
};
