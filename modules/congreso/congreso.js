Auth.requireAuth();
Auth.requireRole(['administrador','administrativo','contador','abogado','asistencial','pago']);
renderSidebar('congreso');

const fmt = n => '$' + (n||0).toLocaleString('es-CO', {maximumFractionDigits:0});

const _CAND_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8081/data/candidatos_cong'
  : 'https://adrianados-cne.onrender.com/data/candidatos_cong';

let _index = null;       // cc_index_1.json completo
let _candidatos = [];    // lista plana actual
let _sortCol = '';
let _sortAsc = true;

// ── Carga del índice ──────────────────────────────────────────────────────────
async function cargarIndice() {
  try {
    const r = await fetch('/modules/congreso/data/cc_index_1.json');
    _index = await r.json();
    poblarCorps();
    filtrar();
  } catch(e) {
    document.getElementById('tablaBody').innerHTML =
      '<tr><td colspan="7" style="color:#ef5350;text-align:center">Error cargando datos</td></tr>';
  }
}

// ── Selectores cascada ────────────────────────────────────────────────────────
function poblarCorps() {
  const corps = [...new Set(
    Object.values(_index).flatMap(d =>
      Object.values(d.municipios).flatMap(m =>
        m.candidatos.map(c => c.corp)))
  )].sort();
  const sel = document.getElementById('selCorp');
  sel.innerHTML = '<option value="">Todas las corporaciones</option>' +
    corps.map(c => `<option value="${c}">${c}</option>`).join('');
}

function onCorpChange() {
  const corp = document.getElementById('selCorp').value;
  const circs = [...new Set(
    Object.keys(_index).filter(k => {
      if (!corp) return true;
      return Object.values(_index[k].municipios).some(m =>
        m.candidatos.some(c => c.corp === corp));
    })
  )].sort();
  const sel = document.getElementById('selCirc');
  sel.innerHTML = '<option value="">Todas las circunscripciones</option>' +
    circs.map(c => `<option value="${c}">${_index[c]?.nombre || c}</option>`).join('');
  onCircChange();
}

function onCircChange() {
  const corp = document.getElementById('selCorp').value;
  const circ = document.getElementById('selCirc').value;
  const partidos = [...new Set(
    Object.entries(_index)
      .filter(([k]) => !circ || k === circ)
      .flatMap(([, d]) => Object.values(d.municipios)
        .flatMap(m => m.candidatos
          .filter(c => !corp || c.corp === corp)
          .map(c => c.org)))
  )].sort();
  const sel = document.getElementById('selPartido');
  sel.innerHTML = '<option value="">Todos los partidos</option>' +
    partidos.map(p => `<option value="${p}">${p}</option>`).join('');
  filtrar();
}

// ── Filtrado principal ────────────────────────────────────────────────────────
function filtrar() {
  if (!_index) return;
  const corp    = document.getElementById('selCorp').value;
  const circ    = document.getElementById('selCirc').value;
  const partido = document.getElementById('selPartido').value;
  const txt     = (document.getElementById('txtBuscar').value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');

  _candidatos = [];
  for (const [dkey, ddata] of Object.entries(_index)) {
    if (circ && dkey !== circ) continue;
    for (const mun of Object.values(ddata.municipios)) {
      for (const c of mun.candidatos) {
        if (corp    && c.corp !== corp)       continue;
        if (partido && c.org  !== partido)    continue;
        if (txt) {
          const haystack = (c.nombre + ' ' + c.cedula).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
          if (!haystack.includes(txt)) continue;
        }
        _candidatos.push({...c, _circ: dkey, _circ_nom: ddata.nombre});
      }
    }
  }
  actualizarStats();
  renderTabla();
}

function actualizarStats() {
  const total     = _candidatos.length;
  const con_ing   = _candidatos.filter(c => c.total_ingresos > 0).length;
  const tot_ing   = _candidatos.reduce((s,c) => s + (c.total_ingresos||0), 0);
  const tot_gas   = _candidatos.reduce((s,c) => s + (c.total_gastos||0), 0);
  document.getElementById('statTotal').textContent   = total.toLocaleString('es-CO');
  document.getElementById('statConIng').textContent  = con_ing.toLocaleString('es-CO');
  document.getElementById('statTotIng').textContent  = fmt(tot_ing);
  document.getElementById('statTotGas').textContent  = fmt(tot_gas);
}

// ── Tabla ─────────────────────────────────────────────────────────────────────
function renderTabla() {
  const tbody = document.getElementById('tablaBody');
  if (!_candidatos.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:rgba(224,244,255,0.3)">Sin resultados</td></tr>';
    return;
  }
  let lista = [..._candidatos];
  if (_sortCol) {
    lista.sort((a,b) => {
      const va = a[_sortCol] ?? '';
      const vb = b[_sortCol] ?? '';
      return _sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }
  tbody.innerHTML = lista.slice(0, 500).map(c => `
    <tr onclick="abrirDetalle(${c.cand_id})">
      <td>${c.nombre}</td>
      <td>${c.org}</td>
      <td><span class="badge-corp">${c.corp}</span></td>
      <td>${c._circ_nom}</td>
      <td class="monto-pos">${fmt(c.total_ingresos)}</td>
      <td class="monto-neg">${fmt(c.total_gastos)}</td>
      <td>${c.contador ? c.contador.nombre : '<span style="color:rgba(224,244,255,0.3)">—</span>'}</td>
    </tr>`).join('');
}

function sortBy(col) {
  if (_sortCol === col) _sortAsc = !_sortAsc;
  else { _sortCol = col; _sortAsc = true; }
  renderTabla();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function activarTab(nombre) {
  ['consolidado','ingresos','gastos','ani'].forEach(t => {
    document.getElementById('panel' + t.charAt(0).toUpperCase() + t.slice(1)).style.display = 'none';
    document.getElementById('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1)).classList.remove('cong-tab-active');
  });
  document.getElementById('panel' + nombre.charAt(0).toUpperCase() + nombre.slice(1)).style.display = 'block';
  document.getElementById('tabBtn'  + nombre.charAt(0).toUpperCase() + nombre.slice(1)).classList.add('cong-tab-active');
}

// ── Modal detalle ─────────────────────────────────────────────────────────────
async function abrirDetalle(candId) {
  const c = _candidatos.find(x => x.cand_id === candId);
  if (!c) return;

  document.getElementById('modalTitulo').textContent = c.nombre;
  document.getElementById('modalOrg').textContent    = c.org;
  document.getElementById('modalCorp').textContent   = c.corp;
  document.getElementById('modalCirc').textContent   = c._circ_nom;

  // Financiero base (desde índice)
  document.getElementById('modalTotIng').textContent = fmt(c.total_ingresos);
  document.getElementById('modalNumIng').textContent = (c.num_ingresos || 0) + ' registros';
  document.getElementById('modalTotGas').textContent = fmt(c.total_gastos);
  document.getElementById('modalNumGas').textContent = (c.num_gastos || 0) + ' registros';

  // Contador
  const cont = c.contador || {};
  document.getElementById('modalContNombre').textContent   = cont.nombre   || '—';
  document.getElementById('modalContDoc').textContent      = cont.documento || '—';
  document.getElementById('modalContTarjeta').textContent  = cont.tarjeta  || '—';
  document.getElementById('modalContEmail').textContent    = cont.email    || '—';
  document.getElementById('modalContTel').textContent      = cont.telefono || '—';

  // Gerente
  const ger = c.gerente || {};
  document.getElementById('modalGerNombre').textContent  = ger.nombre   || '—';
  document.getElementById('modalGerDoc').textContent     = ger.documento || '—';
  document.getElementById('modalGerBanco').textContent   = (ger.banco || '—') + (ger.tipo_cta ? ' · ' + ger.tipo_cta : '');
  document.getElementById('modalGerCuenta').textContent  = ger.cuenta   || '—';
  document.getElementById('modalGerEmail').textContent   = ger.email    || '—';
  document.getElementById('modalGerTel').textContent     = ger.telefono || '—';

  // Actualizar badges de tabs
  document.getElementById('tabBtnIngresos').textContent = `Ingresos (${c.num_ingresos || 0})`;
  document.getElementById('tabBtnGastos').textContent   = `Gastos (${c.num_gastos || 0})`;

  // Resetear tabs al consolidado
  activarTab('consolidado');

  document.getElementById('ingresosContent').innerHTML = '<p class="cong-tab-loading">Cargando…</p>';
  document.getElementById('gastosContent').innerHTML   = '<p class="cong-tab-loading">Cargando…</p>';
  document.getElementById('aniContent').innerHTML      = '<p class="cong-tab-loading">Cargando…</p>';

  document.getElementById('modalOverlay').classList.add('open');

  // Cargar detalle slim
  try {
    const r   = await fetch(`${_CAND_BASE}/${candId}.json`);
    const det = await r.json();
    _renderIngresos(det.ingresos || []);
    _renderGastos(det.gastos   || []);
    _renderANI(det.ani || {}, det.cedula || '');
    // Actualizar financiero desde slim (más preciso)
    if (det.total_ingresos !== undefined) {
      document.getElementById('modalTotIng').textContent = fmt(det.total_ingresos);
      document.getElementById('modalNumIng').textContent = (det.num_ingresos || 0) + ' registros';
    }
    if (det.total_gastos !== undefined) {
      document.getElementById('modalTotGas').textContent = fmt(det.total_gastos);
      document.getElementById('modalNumGas').textContent = (det.num_gastos || 0) + ' registros';
    }
  } catch(e) {
    document.getElementById('ingresosContent').innerHTML = '<p class="cong-tab-err">No se pudo cargar el detalle</p>';
    document.getElementById('gastosContent').innerHTML   = '<p class="cong-tab-err">No se pudo cargar el detalle</p>';
    document.getElementById('aniContent').innerHTML      = '<p class="cong-tab-err">No se pudo cargar el detalle</p>';
  }
}

const _fmtDate = s => s ? s.substring(0,10) : '—';
const _fmtTot  = v => { const n = parseFloat(String(v||0).replace(/,/g,'')); return isNaN(n) ? (v||'—') : '$'+n.toLocaleString('es-CO',{maximumFractionDigits:0}); };
const _trunc   = (s,n) => s && s.length > n ? s.substring(0,n)+'…' : (s||'');

function _renderIngresos(rows) {
  if (!rows.length) {
    document.getElementById('ingresosContent').innerHTML = '<p class="cong-tab-empty">Sin registros de ingresos</p>';
    return;
  }
  const tbody = rows.map(r => `<tr>
    <td>${_fmtDate(r.fecha_registro_movimiento)}</td>
    <td title="${r.nom_formato||''}">${_trunc(r.nom_formato,40)}</td>
    <td title="${r.nom_ingreso||''}">${_trunc(r.nom_ingreso,45)}</td>
    <td title="${r.nombre_persona||''}">${_trunc(r.nombre_persona,30)}</td>
    <td>${r.nit_cedula||'—'}</td>
    <td>${r.no_comprobante_interno||'—'}</td>
    <td class="monto-pos">${_fmtTot(r.total)}</td>
  </tr>`).join('');
  document.getElementById('ingresosContent').innerHTML = `
    <div class="cong-det-table-wrap">
      <table class="cong-det-table">
        <thead><tr><th>Fecha</th><th>Formato</th><th>Descripción</th><th>Tercero</th><th>NIT/Cédula</th><th>Comprobante</th><th>Total</th></tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;
}

function _renderGastos(rows) {
  if (!rows.length) {
    document.getElementById('gastosContent').innerHTML = '<p class="cong-tab-empty">Sin registros de gastos</p>';
    return;
  }
  const tbody = rows.map(r => `<tr>
    <td>${_fmtDate(r.fecha_registro_movimiento)}</td>
    <td title="${r.nom_formato||''}">${_trunc(r.nom_formato,40)}</td>
    <td title="${r.nom_ingreso||''}">${_trunc(r.nom_ingreso,45)}</td>
    <td title="${r.nombre_persona||''}">${_trunc(r.nombre_persona,30)}</td>
    <td>${r.nit_cedula||'—'}</td>
    <td>${r.clasificacion||'—'}</td>
    <td class="monto-neg">${_fmtTot(r.total)}</td>
  </tr>`).join('');
  document.getElementById('gastosContent').innerHTML = `
    <div class="cong-det-table-wrap">
      <table class="cong-det-table">
        <thead><tr><th>Fecha</th><th>Formato</th><th>Descripción</th><th>Tercero</th><th>NIT/Cédula</th><th>Clasificación</th><th>Total</th></tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;
}

function _renderANI(ani, cedula) {
  const v = ani.v || '';
  const n = ani.n || '';

  let color, label, detalle;
  if (!v) {
    color = 'rgba(224,244,255,0.2)';
    label = 'Sin consulta ANI';
    detalle = 'No se realizó consulta para este candidato.';
  } else if (v === 'Vigente') {
    color = '#4caf50';
    label = 'Vigente en ANI';
    detalle = (n && n !== 'No se encontraron registros...')
      ? n
      : 'Cédula registrada en ANI · Sin contratos ni sanciones encontrados.';
  } else if (v === 'NO ENCONTRADA') {
    color = 'rgba(224,244,255,0.45)';
    label = 'No encontrada en ANI';
    detalle = 'La cédula no figura en el sistema ANI.';
  } else {
    color = '#ef9a50';
    label = 'Error en consulta';
    detalle = 'El scraping ANI falló para este candidato.';
  }

  const badge    = `<span class="cong-ani-badge" style="color:${color};border-color:${color}">${label}</span>`;
  const cedHtml  = cedula ? `<div class="cong-detail-row" style="margin-top:12px"><span>Cédula consultada</span><span>${cedula}</span></div>` : '';

  document.getElementById('aniContent').innerHTML = `
    <div class="cong-detail-box" style="max-width:520px;margin:16px auto">
      <h4>Consulta ANI · Antecedentes disciplinarios y contratos</h4>
      <div style="margin-bottom:10px">${badge}</div>
      <div class="cong-ani-nota">${detalle}</div>
      ${cedHtml}
    </div>`;
}

function cerrarDetalle() {
  document.getElementById('modalOverlay').classList.remove('open');
}

document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) cerrarDetalle();
});

// ── Init ──────────────────────────────────────────────────────────────────────
cargarIndice();
