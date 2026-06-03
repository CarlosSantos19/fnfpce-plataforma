Auth.requireAuth();
renderSidebar('revision');

function abrirPortal(proceso) {
  const base = 'https://portal-cc-cne.onrender.com';
  if (proceso === '2023') {
    const rol = Auth.getRole() || '';
    window.open(rol === 'abogado' ? base + '?rol=abogado' : base, '_blank');
  }
}

// ── Congreso 2026 ─────────────────────────────────────────────────────────────
const _fmt     = n => '$' + (n||0).toLocaleString('es-CO', {maximumFractionDigits:0});
const _fmtDate = s => s ? s.substring(0,10) : '—';
const _fmtTot  = v => { const n = parseFloat(String(v||0).replace(/,/g,'')); return isNaN(n) ? (v||'—') : '$'+n.toLocaleString('es-CO',{maximumFractionDigits:0}); };
const _trunc   = (s,n) => s && s.length > n ? s.substring(0,n)+'…' : (s||'');

const _CAND_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8081/data/candidatos_cong'
  : 'https://adrianados-cne.onrender.com/data/candidatos_cong';

let _cngIndex = null;
let _cngLista = [];
let _cngSortCol = '', _cngSortAsc = true;

function _aniBadge(ani) {
  if (!ani || !ani.v) return '<span style="color:rgba(224,244,255,.2);font-size:.65rem">—</span>';
  const v = ani.v;
  const color = v === 'Vigente' ? '#4caf50' : v === 'NO ENCONTRADA' ? 'rgba(224,244,255,.5)' : '#888';
  return `<span class="cng-ani-v" style="color:${color};border-color:${color}">${v === 'Vigente' ? 'Vigente' : v === 'NO ENCONTRADA' ? 'No enc.' : 'Error'}</span>`;
}

async function abrirCongreso() {
  document.querySelector('.revision-grid').style.display = 'none';
  document.getElementById('seccionCongreso').style.display = 'block';
  if (_cngIndex) return;
  try {
    const r = await fetch('/modules/revision/data/cc_index_1.json');
    _cngIndex = await r.json();
    _cngPoblarCorps();
    cngFiltrar();
  } catch(e) {
    document.getElementById('cngTablaBody').innerHTML =
      '<tr><td colspan="8" style="color:#ef5350;text-align:center;padding:20px">Error cargando datos</td></tr>';
  }
}

function cerrarCongreso() {
  document.getElementById('seccionCongreso').style.display = 'none';
  document.querySelector('.revision-grid').style.display = 'grid';
}

function _cngPoblarCorps() {
  const corps = [...new Set(
    Object.values(_cngIndex).flatMap(d =>
      Object.values(d.municipios).flatMap(m => m.candidatos.map(c => c.corp)))
  )].sort();
  document.getElementById('cngSelCorp').innerHTML =
    '<option value="">Todas</option>' + corps.map(c => `<option>${c}</option>`).join('');
}

function cngOnCorpChange() {
  const corp = document.getElementById('cngSelCorp').value;
  const circs = [...new Set(
    Object.keys(_cngIndex).filter(k =>
      !corp || Object.values(_cngIndex[k].municipios).some(m => m.candidatos.some(c => c.corp === corp))
    )
  )].sort();
  document.getElementById('cngSelCirc').innerHTML =
    '<option value="">Todas</option>' + circs.map(k => `<option value="${k}">${_cngIndex[k]?.nombre || k}</option>`).join('');
  cngOnCircChange();
}

function cngOnCircChange() {
  const corp = document.getElementById('cngSelCorp').value;
  const circ = document.getElementById('cngSelCirc').value;
  const partidos = [...new Set(
    Object.entries(_cngIndex)
      .filter(([k]) => !circ || k === circ)
      .flatMap(([, d]) => Object.values(d.municipios)
        .flatMap(m => m.candidatos.filter(c => !corp || c.corp === corp).map(c => c.org)))
  )].sort();
  document.getElementById('cngSelPartido').innerHTML =
    '<option value="">Todos</option>' + partidos.map(p => `<option>${p}</option>`).join('');
  cngFiltrar();
}

function cngFiltrar() {
  if (!_cngIndex) return;
  const corp    = document.getElementById('cngSelCorp').value;
  const circ    = document.getElementById('cngSelCirc').value;
  const partido = document.getElementById('cngSelPartido').value;
  const aniF    = document.getElementById('cngSelANI').value;
  const txt     = (document.getElementById('cngTxtBuscar').value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');

  _cngLista = [];
  for (const [dkey, ddata] of Object.entries(_cngIndex)) {
    if (circ && dkey !== circ) continue;
    for (const mun of Object.values(ddata.municipios)) {
      for (const c of mun.candidatos) {
        if (corp    && c.corp !== corp)    continue;
        if (partido && c.org  !== partido) continue;
        if (txt) {
          const h = (c.nombre + ' ' + (c.cedula||'')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
          if (!h.includes(txt)) continue;
        }
        if (aniF) {
          const av = (c.ani && c.ani.v) || 'ERROR';
          if (aniF === 'ERROR' && av !== 'ERROR') continue;
          if (aniF !== 'ERROR' && av !== aniF) continue;
        }
        _cngLista.push({...c, _circ: dkey, _circ_nom: ddata.nombre});
      }
    }
  }
  document.getElementById('cng-stat-total').textContent = _cngLista.length.toLocaleString('es-CO') + ' candidatos';
  _cngRenderTabla();
}

function _cngRenderTabla() {
  const tbody = document.getElementById('cngTablaBody');
  if (!_cngLista.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:rgba(224,244,255,.3);padding:20px">Sin resultados</td></tr>';
    return;
  }
  let lista = [..._cngLista];
  if (_cngSortCol) {
    lista.sort((a,b) => {
      const va = a[_cngSortCol] ?? '', vb = b[_cngSortCol] ?? '';
      return _cngSortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }
  tbody.innerHTML = lista.slice(0,500).map(c => `
    <tr onclick="cngAbrirDetalle(${c.cand_id})">
      <td>${c.nombre}</td>
      <td>${c.org}</td>
      <td><span class="cng-badge-corp">${c.corp}</span></td>
      <td>${c._circ_nom}</td>
      <td class="monto-pos">${_fmt(c.total_ingresos)}</td>
      <td class="monto-neg">${_fmt(c.total_gastos)}</td>
      <td>${c.contador ? c.contador.nombre : '<span style="color:rgba(224,244,255,.3)">—</span>'}</td>
      <td>${_aniBadge(c.ani)}</td>
    </tr>`).join('');
}

function cngSort(col) {
  if (_cngSortCol === col) _cngSortAsc = !_cngSortAsc;
  else { _cngSortCol = col; _cngSortAsc = true; }
  _cngRenderTabla();
}

// ── Tabs modal ────────────────────────────────────────────────────────────────
function cngActivarTab(nombre) {
  const tabs = ['consolidado','ingresos','gastos','ani'];
  tabs.forEach(t => {
    const pid = 'cngPanel' + t.charAt(0).toUpperCase() + t.slice(1);
    const bid = t === 'gastos' ? 'cng-tabBtnGastos' : 'cngTabBtn' + t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById(pid).style.display = 'none';
    document.getElementById(bid).classList.remove('cng-tab-active');
  });
  const selPid = 'cngPanel' + nombre.charAt(0).toUpperCase() + nombre.slice(1);
  const selBid = nombre === 'gastos' ? 'cng-tabBtnGastos' : 'cngTabBtn' + nombre.charAt(0).toUpperCase() + nombre.slice(1);
  document.getElementById(selPid).style.display = 'block';
  document.getElementById(selBid).classList.add('cng-tab-active');
}

// ── Detalle ───────────────────────────────────────────────────────────────────
async function cngAbrirDetalle(candId) {
  const c = _cngLista.find(x => x.cand_id === candId);
  if (!c) return;

  document.getElementById('cngModalTitulo').textContent = c.nombre;
  document.getElementById('cngMOrg').textContent   = c.org;
  document.getElementById('cngMCorp').textContent  = c.corp;
  document.getElementById('cngMCirc').textContent  = c._circ_nom;
  document.getElementById('cngMTotIng').textContent = _fmt(c.total_ingresos);
  document.getElementById('cngMNumIng').textContent = (c.num_ingresos||0) + ' registros';
  document.getElementById('cngMTotGas').textContent = _fmt(c.total_gastos);
  document.getElementById('cngMNumGas').textContent = (c.num_gastos||0) + ' registros';

  const cont = c.contador || {};
  document.getElementById('cngMContNombre').textContent  = cont.nombre    || '—';
  document.getElementById('cngMContDoc').textContent     = cont.documento || '—';
  document.getElementById('cngMContTarjeta').textContent = cont.tarjeta   || '—';
  document.getElementById('cngMContEmail').textContent   = cont.email     || '—';
  document.getElementById('cngMContTel').textContent     = cont.telefono  || '—';

  const ger = c.gerente || {};
  document.getElementById('cngMGerNombre').textContent = ger.nombre    || '—';
  document.getElementById('cngMGerDoc').textContent    = ger.documento || '—';
  document.getElementById('cngMGerBanco').textContent  = (ger.banco||'—') + (ger.tipo_cta ? ' · '+ger.tipo_cta : '');
  document.getElementById('cngMGerCuenta').textContent = ger.cuenta    || '—';
  document.getElementById('cngMGerEmail').textContent  = ger.email     || '—';
  document.getElementById('cngMGerTel').textContent    = ger.telefono  || '—';

  document.getElementById('cngTabBtnIngresos').textContent = `Ingresos (${c.num_ingresos||0})`;
  document.getElementById('cng-tabBtnGastos').textContent  = `Gastos (${c.num_gastos||0})`;

  cngActivarTab('consolidado');
  document.getElementById('cngIngContent').innerHTML = '<p class="cng-tab-msg">Cargando…</p>';
  document.getElementById('cngGasContent').innerHTML = '<p class="cng-tab-msg">Cargando…</p>';
  document.getElementById('cngAniContent').innerHTML = '<p class="cng-tab-msg">Cargando…</p>';
  document.getElementById('cngModalOverlay').classList.add('open');

  try {
    const r   = await fetch(`${_CAND_BASE}/${candId}.json`);
    const det = await r.json();
    _cngRenderIngresos(det.ingresos || []);
    _cngRenderGastos(det.gastos    || []);
    _cngRenderANI(det.ani || c.ani || {}, det.cedula || '');
  } catch(e) {
    const msg = '<p class="cng-tab-msg" style="color:#ef9a50">Portal de datos no disponible en este momento</p>';
    document.getElementById('cngIngContent').innerHTML = msg;
    document.getElementById('cngGasContent').innerHTML = msg;
    _cngRenderANI(c.ani || {}, '');
  }
}

function _cngRenderIngresos(rows) {
  if (!rows.length) { document.getElementById('cngIngContent').innerHTML = '<p class="cng-tab-msg">Sin registros</p>'; return; }
  const tbody = rows.map(r => `<tr>
    <td>${_fmtDate(r.fecha_registro_movimiento)}</td>
    <td title="${r.nom_formato||''}">${_trunc(r.nom_formato,38)}</td>
    <td title="${r.nom_ingreso||''}">${_trunc(r.nom_ingreso,42)}</td>
    <td title="${r.nombre_persona||''}">${_trunc(r.nombre_persona,28)}</td>
    <td>${r.nit_cedula||'—'}</td>
    <td class="monto-pos">${_fmtTot(r.total)}</td>
  </tr>`).join('');
  document.getElementById('cngIngContent').innerHTML = `<div class="cng-det-wrap"><table class="cng-det-tbl">
    <thead><tr><th>Fecha</th><th>Formato</th><th>Descripción</th><th>Tercero</th><th>NIT/Cédula</th><th>Total</th></tr></thead>
    <tbody>${tbody}</tbody></table></div>`;
}

function _cngRenderGastos(rows) {
  if (!rows.length) { document.getElementById('cngGasContent').innerHTML = '<p class="cng-tab-msg">Sin registros</p>'; return; }
  const tbody = rows.map(r => `<tr>
    <td>${_fmtDate(r.fecha_registro_movimiento)}</td>
    <td title="${r.nom_formato||''}">${_trunc(r.nom_formato,38)}</td>
    <td title="${r.nom_ingreso||''}">${_trunc(r.nom_ingreso,42)}</td>
    <td title="${r.nombre_persona||''}">${_trunc(r.nombre_persona,28)}</td>
    <td>${r.nit_cedula||'—'}</td>
    <td class="monto-neg">${_fmtTot(r.total)}</td>
  </tr>`).join('');
  document.getElementById('cngGasContent').innerHTML = `<div class="cng-det-wrap"><table class="cng-det-tbl">
    <thead><tr><th>Fecha</th><th>Formato</th><th>Descripción</th><th>Tercero</th><th>NIT/Cédula</th><th>Total</th></tr></thead>
    <tbody>${tbody}</tbody></table></div>`;
}

function _cngRenderANI(ani, cedula) {
  const v = ani.v || '';
  let color, label, detalle;
  if (!v) {
    color = 'rgba(224,244,255,.2)'; label = 'Sin consulta ANI';
    detalle = 'No se realizó consulta para este candidato.';
  } else if (v === 'Vigente') {
    color = '#4caf50'; label = 'Vigente en ANI';
    detalle = (ani.n && ani.n !== 'No se encontraron registros...')
      ? ani.n : 'Cédula registrada · Sin contratos ni sanciones encontrados.';
  } else if (v === 'NO ENCONTRADA') {
    color = 'rgba(224,244,255,.45)'; label = 'No encontrada en ANI';
    detalle = 'La cédula no figura en el sistema ANI.';
  } else {
    color = '#ef9a50'; label = 'Error en consulta';
    detalle = 'El scraping ANI falló para este candidato.';
  }
  const cedHtml = cedula ? `<div class="cng-detail-row" style="margin-top:10px"><span>Cédula consultada</span><span>${cedula}</span></div>` : '';
  document.getElementById('cngAniContent').innerHTML = `
    <div class="cng-detail-box" style="max-width:500px;margin:14px auto">
      <h4>Consulta ANI · Antecedentes y contratos</h4>
      <div style="margin-bottom:10px"><span class="cng-ani-v" style="color:${color};border-color:${color}">${label}</span></div>
      <div style="font-size:.74rem;color:rgba(224,244,255,.55);background:rgba(0,0,0,.2);border-radius:6px;padding:8px 10px">${detalle}</div>
      ${cedHtml}
    </div>`;
}

function cngCerrarDetalle() {
  document.getElementById('cngModalOverlay').classList.remove('open');
}
document.getElementById('cngModalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('cngModalOverlay')) cngCerrarDetalle();
});
