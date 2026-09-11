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
  ? '/modules/revision/data/candidatos'
  : 'https://carlos-cne.onrender.com/data/candidatos_cong';
const _PROXY2026 = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8081'
  : 'https://carlos-cne.onrender.com';

let _cne2026Logueado = false;

async function _cne2026CheckLogin() {
  try {
    const r = await fetch(_PROXY2026 + '/api/cne_status');
    const d = await r.json();
    _cne2026Logueado = d.sesion_activa || false;
  } catch(e) { _cne2026Logueado = false; }
}

function cne2026AbrirLogin() {
  document.getElementById('cne2026LoginOverlay').style.display = 'flex';
}

async function _cne2026Ping() {
  // Despierta el servidor Render antes del login (puede tardar hasta 50 seg en cold start)
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 55000);
    await fetch(_PROXY2026 + '/api/cne_status', { signal: ctrl.signal });
    clearTimeout(tid);
  } catch(_) {}
}

async function cne2026Login() {
  const u = document.getElementById('cne2026User').value.trim();
  const p = document.getElementById('cne2026Pass').value.trim();
  const msg = document.getElementById('cne2026Msg');
  const btn = document.getElementById('cne2026Btn');
  if (!u || !p) { msg.textContent = 'Ingrese usuario y contraseña'; return; }
  btn.disabled = true;

  // Paso 1: despertar el servidor si está dormido
  msg.textContent = 'Despertando servidor… (puede tardar hasta 60 segundos la primera vez)';
  await _cne2026Ping();

  // Paso 2: login
  msg.textContent = 'Conectando con CNE…';
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 90000);
    const r = await fetch(_PROXY2026 + '/api/cne_login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({usuario: u, password: p}),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    const d = await r.json();
    if (d.ok || d.sesion_activa) {
      _cne2026Logueado = true;
      document.getElementById('cne2026LoginOverlay').style.display = 'none';
      document.getElementById('cne2026ConectarBtn').textContent = '● CNE Conectado';
      document.getElementById('cne2026ConectarBtn').style.color = '#4caf50';
    } else {
      msg.textContent = d.mensaje || d.msg || 'Error de autenticación';
    }
  } catch(e) {
    if (e && e.name === 'AbortError') {
      msg.textContent = 'Tiempo de espera agotado. El servidor puede estar sobrecargado — intente de nuevo.';
    } else {
      msg.textContent = 'Error de conexión. Verifique su internet e intente de nuevo.';
    }
  }
  btn.disabled = false;
}

function cne2026AbrirArchivo(archivoEnc) {
  if (!_cne2026Logueado) { cne2026AbrirLogin(); return; }
  const archivo = decodeURIComponent(archivoEnc);
  const sep = archivo.startsWith('/') ? '' : '/';
  window.open(`${_PROXY2026}/api/cne${sep}${archivo}`, '_blank');
}

function cngMostrarEnVisor(archivoEnc) {
  if (!_cne2026Logueado) { cne2026AbrirLogin(); return; }
  const archivo = decodeURIComponent(archivoEnc);
  const sep = archivo.startsWith('/') ? '' : '/';
  _cngSetVisor(`${_PROXY2026}/api/cne${sep}${archivo}`);
}

// Abre documentos locales sin requerir sesión CNE (servidos por el proxy server directamente)
function cngAbrirLocal(pathEnc) {
  const path = decodeURIComponent(pathEnc);
  const sep = path.startsWith('/') ? '' : '/';
  window.open(`${_PROXY2026}${sep}${path}`, '_blank');
}

function cngVerLocal(pathEnc) {
  const path = decodeURIComponent(pathEnc);
  const sep = path.startsWith('/') ? '' : '/';
  _cngSetVisor(`${_PROXY2026}${sep}${path}`);
}

function _cngSetVisor(url) {
  document.getElementById('cngVisorEmpty').style.display = 'none';
  document.getElementById('cngVisorWrap').style.display = 'block';
  document.getElementById('cngVisorFrame').src = url;
  cngActivarTab('visor');
}

let _cngIndex = null;
let _cngLista = [];
let _cngSortCol = '', _cngSortAsc = true;
let _cngPartidosArray = [];
let _cngPartidoActivo = '';
let _cngCorpActiva = '';
let _cngDptosArray  = [];   // [{label, count, type:'dpto'|'circ', dpto_key?, circ_key?}]
let _cngDptoActivo  = null; // entrada seleccionada de _cngDptosArray
let _cngAllCands    = {};   // candId → candidato con _circ/_circ_nom (lookup global)

function _aniBadge(ani) {
  if (!ani || !ani.v) return '<span style="color:rgba(224,244,255,.2);font-size:.65rem">—</span>';
  const v = ani.v;
  const color = v === 'Vigente' ? '#4caf50' : v === 'NO ENCONTRADA' ? 'rgba(224,244,255,.5)' : '#888';
  return `<span class="cng-ani-v" style="color:${color};border-color:${color}">${v === 'Vigente' ? 'Vigente' : v === 'NO ENCONTRADA' ? 'No enc.' : 'Error'}</span>`;
}

// ── Índice RNEC etapas por candidato ─────────────────────────────────────────
// key: "orgId|CAMARA" o "orgId|SENADO" → Set(['E6','E7','E8'])
let _rnecEtapaIdx = null;

async function _buildRnecEtapaIdx() {
  const lookup = await _loadRnecLookup();
  _rnecEtapaIdx = {};
  for (const [orgId, docs] of Object.entries(lookup)) {
    for (const d of docs) {
      const key = orgId + '|' + (d.c || '');
      if (!_rnecEtapaIdx[key]) _rnecEtapaIdx[key] = new Set();
      _rnecEtapaIdx[key].add(d.et);
    }
  }
}

function _rnecBadges(cand) {
  if (!_rnecEtapaIdx) return '';
  const orgId  = String(cand.org_id || '').padStart(5, '0');
  const congr  = (cand.corp || '').toUpperCase().includes('SENADO') ? 'SENADO' : 'CAMARA';
  const etapas = _rnecEtapaIdx[orgId + '|' + congr] || new Set();
  if (!etapas.size) return '';
  const ST = {
    E6: 'background:#dbeafe;color:#1e40af',
    E7: 'background:#dcfce7;color:#15803d',
    E8: 'background:#fef3c7;color:#92400e',
  };
  return [...etapas].sort().map(e =>
    `<span style="${ST[e]||''};border-radius:8px;padding:1px 6px;font-size:.58rem;font-weight:700;margin-left:2px;white-space:nowrap">${e}</span>`
  ).join('');
}

async function abrirCongreso() {
  window.open('https://carlos-cne.onrender.com', '_blank');
}
/* --- implementación inline desactivada (ahora abre URL externa) ---
async function _abrirCongresoInline() {
  document.querySelector('.revision-grid').style.display = 'none';
  document.getElementById('seccionCongreso').style.display = 'block';
  if (_cngIndex) {
    _cngMostrarSeleccionCorp();
    return;
  }
  try {
    const _nc = { cache: 'no-cache' };
    const [rIdx, rAni] = await Promise.all([
      fetch('/modules/revision/data/cc_index_1.json', _nc),
      fetch('/modules/revision/data/ani_summary.json', _nc)
    ]);
    _cngIndex = await rIdx.json();
    const aniMap = await rAni.json();
    for (const ddata of Object.values(_cngIndex)) {
      for (const mun of Object.values(ddata.municipios)) {
        for (const c of mun.candidatos) {
          const a = aniMap[String(c.cand_id)];
          c.ani = a ? { v: a.v, cedula: a.c } : {};
        }
      }
    }
    // Lookup global para abrir modal desde cualquier vista
    _cngAllCands = {};
    for (const [dkey, ddata] of Object.entries(_cngIndex)) {
      for (const mun of Object.values(ddata.municipios)) {
        for (const c of mun.candidatos) {
          _cngAllCands[c.cand_id] = {...c, _circ: dkey, _circ_nom: ddata.nombre};
        }
      }
    }
    _cngPoblarCorps();
    _cngMostrarSeleccionCorp();
    _buildRnecEtapaIdx().catch(() => {});
  } catch(e) {
    document.getElementById('cngPartidosBody').innerHTML =
      '<div style="color:#ef5350;text-align:center;padding:20px">Error cargando datos</div>';
  }
}
--- fin implementación inline desactivada --- */

function _cngMostrarSeleccionCorp() {
  _cngCorpActiva = '';
  _cngPartidoActivo = '';
  _cngDptoActivo = null;
  document.getElementById('cngSeccionCorp').style.display = '';
  document.getElementById('cngSeccionDpto').style.display = 'none';
  document.getElementById('cngSeccionPartidos').style.display = 'none';
  document.getElementById('cngSeccionCandidatos').style.display = 'none';
  document.getElementById('cngBtnVolverCorp').style.display = 'none';
  document.getElementById('cngBtnVolverDpto').style.display = 'none';
  document.getElementById('cngBtnVolverPartidos').style.display = 'none';
  document.getElementById('cngCorpLabel').style.display = 'none';
  document.getElementById('cngDptoLabel').style.display = 'none';
  document.getElementById('cngPartidoLabel').style.display = 'none';
  document.getElementById('cng-stat-total').textContent = '';
}

function cngSeleccionarCorp(corp) {
  _cngCorpActiva = corp;
  _cngDptoActivo = null;
  document.getElementById('cngSeccionCorp').style.display = 'none';
  document.getElementById('cngBtnVolverCorp').style.display = '';
  document.getElementById('cngCorpLabel').style.display = '';
  document.getElementById('cngCorpLabel').textContent =
    corp === 'SENADO DE LA REPUBLICA' ? 'Senado' : 'Cámara';

  if (corp === 'CAMARA DE REPRESENTANTES') {
    _cngRenderDptos();
  } else {
    _cngRenderPartidos();
  }
}

function cngVolverCorp() {
  _cngMostrarSeleccionCorp();
}

function _cngRenderDptos() {
  if (!_cngIndex) return;

  // Construir mapa zona → { count, partidos: {org: count} }
  const zonas = {};
  for (const [dkey, ddata] of Object.entries(_cngIndex)) {
    for (const mun of Object.values(ddata.municipios)) {
      for (const c of mun.candidatos) {
        if (c.corp !== 'CAMARA DE REPRESENTANTES') continue;
        const zona  = c.dpto || dkey;
        const type  = c.dpto ? 'dpto' : 'circ';
        const key   = c.dpto ? c.dpto : dkey;
        if (!zonas[zona]) zonas[zona] = { type, key, count: 0, partidos: {} };
        zonas[zona].count++;
        zonas[zona].partidos[c.org] = (zonas[zona].partidos[c.org] || 0) + 1;
      }
    }
  }

  // Separar departamentos regulares y circunscripciones especiales
  const dptos = Object.entries(zonas)
    .filter(([,z]) => z.type === 'dpto')
    .sort((a,b) => a[0].localeCompare(b[0]));
  const circs = Object.entries(zonas)
    .filter(([,z]) => z.type === 'circ')
    .sort((a,b) => a[0].localeCompare(b[0]));
  _cngDptosArray = [...dptos, ...circs].map(([label, z]) => ({label, ...z}));

  document.getElementById('cngSeccionDpto').style.display = '';
  document.getElementById('cngSeccionPartidos').style.display = 'none';
  document.getElementById('cngSeccionCandidatos').style.display = 'none';
  document.getElementById('cngBtnVolverDpto').style.display = 'none';
  document.getElementById('cngDptoLabel').style.display = 'none';
  document.getElementById('cngPartidoLabel').style.display = 'none';
  document.getElementById('cng-stat-total').textContent = _cngDptosArray.length + ' departamentos';

  // Construir mapa zona → partido → [candidatos]
  const zonaPartidoCands = {};
  for (const [dkey, ddata] of Object.entries(_cngIndex)) {
    for (const mun of Object.values(ddata.municipios)) {
      for (const c of mun.candidatos) {
        if (c.corp !== 'CAMARA DE REPRESENTANTES') continue;
        const zona = c.dpto || dkey;
        if (!zonaPartidoCands[zona]) zonaPartidoCands[zona] = {};
        if (!zonaPartidoCands[zona][c.org]) zonaPartidoCands[zona][c.org] = [];
        zonaPartidoCands[zona][c.org].push({...c, _circ: dkey, _circ_nom: ddata.nombre});
      }
    }
  }

  const rows = _cngDptosArray.map((d, di) => {
    const partidos = Object.entries(zonaPartidoCands[d.label] || {})
      .sort((a,b) => b[1].length - a[1].length)
      .map(([org, cands], pi) => {
        const candRows = cands
          .sort((a,b) => (b.total_ingresos||0) - (a.total_ingresos||0))
          .map(c => `
            <div onclick="event.stopPropagation();cngAbrirDetalle(${c.cand_id})"
              style="display:flex;align-items:center;gap:10px;padding:5px 14px 5px 52px;
              border-bottom:1px solid rgba(0,212,255,.04);cursor:pointer;transition:background .12s"
              onmouseover="this.style.background='rgba(252,209,22,.03)'" onmouseout="this.style.background=''">
              <span style="flex:1;font-size:.73rem;color:rgba(224,244,255,.7)">${c.nombre}</span>
              <span style="font-size:.68rem;color:#4caf50;white-space:nowrap">${_fmt(c.total_ingresos)}</span>
              <span style="font-size:.68rem;color:#ef5350;white-space:nowrap">${_fmt(c.total_gastos)}</span>
            </div>`).join('');
        return `
          <div style="border-bottom:1px solid rgba(0,212,255,.06)">
            <div onclick="event.stopPropagation();cngTogglePartidoAcordeon('${di}-${pi}')"
              style="display:flex;align-items:center;padding:6px 14px 6px 32px;cursor:pointer;transition:background .12s;background:rgba(0,0,0,.15)"
              onmouseover="this.style.background='rgba(0,212,255,.05)'" onmouseout="this.style.background='rgba(0,0,0,.15)'">
              <span style="flex:1;font-size:.75rem;color:rgba(224,244,255,.8)">${org}</span>
              <span style="font-size:.65rem;color:rgba(0,212,255,.55);font-family:'Share Tech Mono',monospace;margin-right:8px">${cands.length}</span>
              <span id="cng-part-arr-${di}-${pi}" style="font-size:.65rem;color:rgba(0,212,255,.35);transition:transform .2s">▶</span>
            </div>
            <div id="cng-part-body-${di}-${pi}" style="display:none">${candRows}</div>
          </div>`;
      }).join('');
    return `
      <div style="border-bottom:1px solid rgba(0,212,255,.12)">
        <div onclick="cngToggleDpto(${di})"
          style="display:flex;align-items:center;padding:10px 14px;cursor:pointer;transition:background .15s"
          onmouseover="this.style.background='rgba(0,212,255,.04)'" onmouseout="this.style.background=''">
          <span style="font-size:.82rem;font-weight:600;color:var(--text);flex:1">${d.label}</span>
          <span style="font-size:.68rem;color:rgba(0,212,255,.5);font-family:'Share Tech Mono',monospace;margin-right:10px">${d.count} cands.</span>
          <span id="cng-dpto-arr-${di}" style="font-size:.7rem;color:rgba(0,212,255,.4);transition:transform .2s">▶</span>
        </div>
        <div id="cng-dpto-body-${di}" style="display:none">${partidos}</div>
      </div>`;
  }).join('');

  document.getElementById('cngDptosBody').innerHTML =
    `<div class="card" style="margin-bottom:0">
       <div class="card-body" style="padding:0">${rows}</div>
     </div>`;
}

function cngToggleDpto(idx) {
  const body = document.getElementById(`cng-dpto-body-${idx}`);
  const arr  = document.getElementById(`cng-dpto-arr-${idx}`);
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  arr.style.transform = open ? '' : 'rotate(90deg)';
}

function cngTogglePartidoAcordeon(key) {
  const body = document.getElementById(`cng-part-body-${key}`);
  const arr  = document.getElementById(`cng-part-arr-${key}`);
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  arr.style.transform = open ? '' : 'rotate(90deg)';
}

function cngVerPartidoEnDpto(dptoIdx, org) {
  _cngDptoActivo  = _cngDptosArray[dptoIdx];
  _cngPartidoActivo = org;

  document.getElementById('cngSeccionDpto').style.display = 'none';
  document.getElementById('cngSeccionPartidos').style.display = 'none';
  document.getElementById('cngSeccionCandidatos').style.display = '';
  document.getElementById('cngBtnVolverDpto').style.display = '';
  document.getElementById('cngBtnVolverCorp').style.display = 'none';
  document.getElementById('cngBtnVolverPartidos').style.display = 'none';
  document.getElementById('cngDptoLabel').style.display = '';
  document.getElementById('cngDptoLabel').textContent = _cngDptoActivo.label;
  document.getElementById('cngPartidoLabel').style.display = '';
  document.getElementById('cngPartidoLabel').textContent = org;

  // Resetear filtros y panel RNEC
  document.getElementById('cngSelCorp').value = '';
  document.getElementById('cngSelCirc').innerHTML = '<option value="">Todas</option>';
  document.getElementById('cngSelDpto').value = '';
  document.getElementById('cngSelANI').value = '';
  document.getElementById('cngTxtBuscar').value = '';
  document.getElementById('cngDptoWrap').style.display = 'none';
  const rnecPanel = document.getElementById('cngRnecPanelPartido');
  rnecPanel.style.display = 'none';
  const rnecContent = document.getElementById('cngRnecPanelContent');
  rnecContent.innerHTML = '<p class="cng-tab-msg">Cargando…</p>';
  delete rnecContent.dataset.loaded;
  document.getElementById('cngRnecToggleBtn').querySelector('span').textContent = 'Ver documentos RNEC E6 / E7 / E8';
  cngFiltrar();
}

function cngVolverDpto() {
  _cngDptoActivo = null;
  _cngPartidoActivo = '';
  document.getElementById('cngSeccionDpto').style.display = '';
  document.getElementById('cngSeccionPartidos').style.display = 'none';
  document.getElementById('cngSeccionCandidatos').style.display = 'none';
  document.getElementById('cngBtnVolverDpto').style.display = 'none';
  document.getElementById('cngBtnVolverPartidos').style.display = 'none';
  document.getElementById('cngBtnVolverCorp').style.display = '';
  document.getElementById('cngDptoLabel').style.display = 'none';
  document.getElementById('cngPartidoLabel').style.display = 'none';
  document.getElementById('cng-stat-total').textContent = _cngDptosArray.length + ' departamentos';
}

function _cngRenderPartidos() {
  if (!_cngIndex) return;
  const counts = {};
  for (const [dkey, ddata] of Object.entries(_cngIndex)) {
    if (_cngDptoActivo && _cngDptoActivo.type === 'circ' && dkey !== _cngDptoActivo.circ_key) continue;
    for (const mun of Object.values(ddata.municipios)) {
      for (const c of mun.candidatos) {
        if (_cngCorpActiva && c.corp !== _cngCorpActiva) continue;
        if (_cngDptoActivo && _cngDptoActivo.type === 'dpto' && c.dpto !== _cngDptoActivo.dpto_key) continue;
        counts[c.org] = (counts[c.org] || 0) + 1;
      }
    }
  }
  _cngPartidosArray = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  document.getElementById('cng-stat-total').textContent = _cngPartidosArray.length + ' partidos';
  document.getElementById('cngPartidosBody').innerHTML = `
    <div class="card" style="margin-bottom:0">
      <div class="card-body" style="padding:0;overflow-x:auto">
        <table class="cng-table">
          <thead><tr>
            <th>Partido</th>
            <th style="width:130px;text-align:right">Candidatos</th>
          </tr></thead>
          <tbody>${_cngPartidosArray.map(([org, cnt], idx) => `
            <tr onclick="cngVerPartido(${idx})">
              <td>${org}</td>
              <td style="text-align:right;color:rgba(0,212,255,.7);font-family:'Share Tech Mono',monospace">${cnt}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function cngVerPartido(idx) {
  const [org] = _cngPartidosArray[idx];
  _cngPartidoActivo = org;
  document.getElementById('cngSeccionPartidos').style.display = 'none';
  document.getElementById('cngSeccionCandidatos').style.display = '';
  document.getElementById('cngBtnVolverPartidos').style.display = '';
  document.getElementById('cngBtnVolverDpto').style.display = 'none';
  document.getElementById('cngBtnVolverCorp').style.display = 'none';
  document.getElementById('cngPartidoLabel').style.display = '';
  document.getElementById('cngPartidoLabel').textContent = org;
  // Resetear filtros secundarios
  document.getElementById('cngSelCorp').value = '';
  document.getElementById('cngSelCirc').innerHTML = '<option value="">Todas</option>';
  document.getElementById('cngSelDpto').value = '';
  document.getElementById('cngSelANI').value = '';
  document.getElementById('cngTxtBuscar').value = '';
  document.getElementById('cngDptoWrap').style.display = 'none';
  // Resetear panel RNEC
  const rnecPanel = document.getElementById('cngRnecPanelPartido');
  rnecPanel.style.display = 'none';
  const rnecContent = document.getElementById('cngRnecPanelContent');
  rnecContent.innerHTML = '<p class="cng-tab-msg">Cargando…</p>';
  delete rnecContent.dataset.loaded;
  document.getElementById('cngRnecToggleBtn').querySelector('span').textContent = 'Ver documentos RNEC E6 / E7 / E8';
  cngFiltrar();
}

async function cngToggleRnecPartido() {
  const panel   = document.getElementById('cngRnecPanelPartido');
  const btnSpan = document.getElementById('cngRnecToggleBtn').querySelector('span');
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    btnSpan.textContent = 'Ver documentos RNEC E6 / E7 / E8';
    return;
  }
  panel.style.display = '';
  btnSpan.textContent = 'Ocultar documentos RNEC';
  const content = document.getElementById('cngRnecPanelContent');
  if (content.dataset.loaded) return;
  // Candidato sintético: usa el primer candidato de la lista para obtener org_id
  // circ_nom vacío → muestra todos los docs del partido sin filtrar por circunscripción
  const primero = _cngLista[0];
  if (!primero) {
    content.innerHTML = '<p class="cng-tab-msg">Sin candidatos cargados</p>';
    return;
  }
  const synthCand = {
    org_id:   primero.org_id,
    corp:     _cngCorpActiva,
    org:      _cngPartidoActivo,
    _circ_nom: '',
  };
  await _loadRnecForCand(synthCand, 'cngRnecPanelContent');
  content.dataset.loaded = '1';
}

function cngVolverPartidos() {
  // Para Cámara: "← Partidos" vuelve al acordeón de departamentos
  if (_cngCorpActiva === 'CAMARA DE REPRESENTANTES') {
    cngVolverDpto();
    return;
  }
  // Para Senado: vuelve al listado de partidos
  _cngPartidoActivo = '';
  document.getElementById('cngSeccionPartidos').style.display = '';
  document.getElementById('cngSeccionCandidatos').style.display = 'none';
  document.getElementById('cngBtnVolverPartidos').style.display = 'none';
  document.getElementById('cngPartidoLabel').style.display = 'none';
  document.getElementById('cngBtnVolverCorp').style.display = '';
  document.getElementById('cng-stat-total').textContent = _cngPartidosArray.length + ' partidos';
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

  // Mostrar filtro departamento solo para CÁMARA
  const dptoWrap = document.getElementById('cngDptoWrap');
  const esCamara = corp === 'CAMARA DE REPRESENTANTES';
  dptoWrap.style.display = esCamara ? '' : 'none';
  if (!esCamara) document.getElementById('cngSelDpto').value = '';

  cngOnCircChange();
}

function cngOnCircChange() {
  const corp = document.getElementById('cngSelCorp').value;
  const circ = document.getElementById('cngSelCirc').value;
  const esCamara = corp === 'CAMARA DE REPRESENTANTES';

  // Poblar departamentos si es CÁMARA
  if (esCamara) {
    const dptos = [...new Set(
      Object.entries(_cngIndex)
        .filter(([k]) => !circ || k === circ)
        .flatMap(([, d]) => Object.values(d.municipios)
          .flatMap(m => m.candidatos
            .filter(c => c.corp === corp && c.dpto)
            .map(c => c.dpto)))
    )].sort();
    document.getElementById('cngSelDpto').innerHTML =
      '<option value="">Todos</option>' + dptos.map(d => `<option>${d}</option>`).join('');
  }

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
  const dpto    = document.getElementById('cngSelDpto').value;
  const aniF    = document.getElementById('cngSelANI').value;
  const txt     = (document.getElementById('cngTxtBuscar').value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');

  _cngLista = [];
  for (const [dkey, ddata] of Object.entries(_cngIndex)) {
    if (circ && dkey !== circ) continue;
    for (const mun of Object.values(ddata.municipios)) {
      for (const c of mun.candidatos) {
        if (_cngCorpActiva  && c.corp !== _cngCorpActiva)  continue;
        if (_cngDptoActivo && _cngDptoActivo.type === 'dpto' && c.dpto !== _cngDptoActivo.dpto_key) continue;
        if (_cngDptoActivo && _cngDptoActivo.type === 'circ' && dkey !== _cngDptoActivo.circ_key) continue;
        if (_cngPartidoActivo && c.org !== _cngPartidoActivo) continue;
        if (corp && c.corp !== corp) continue;
        if (dpto && c.dpto !== dpto) continue;
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
const _TABS = {
  consolidado: {btn:'cngTabBtnConsolidado', panel:'cngPanelConsolidado'},
  ingresos:    {btn:'cngTabBtnIngresos',    panel:'cngPanelIngresos'},
  gastos:      {btn:'cng-tabBtnGastos',     panel:'cngPanelGastos'},
  ani:         {btn:'cngTabBtnAni',         panel:'cngPanelAni'},
  docs:        {btn:'cngTabBtnDocs',        panel:'cngPanelDocs'},
  gestion:     {btn:'cngTabBtnGestion',     panel:'cngPanelGestion'},
  visor:       {btn:'cngTabBtnVisor',       panel:'cngPanelVisor'},
};

function cngActivarTab(nombre) {
  Object.values(_TABS).forEach(({btn, panel}) => {
    document.getElementById(panel).style.display = 'none';
    document.getElementById(btn).classList.remove('cng-tab-active');
  });
  document.getElementById(_TABS[nombre].panel).style.display = 'block';
  document.getElementById(_TABS[nombre].btn).classList.add('cng-tab-active');
  document.getElementById('cngTxHeader').style.display =
    (nombre === 'ingresos' || nombre === 'gastos') ? 'flex' : 'none';
}

// Helper para copiar ruta desde data-attribute (evita problemas de encoding en onclick)
window._rnecCopiarRuta = function(btn) {
  const unc = btn.getAttribute('data-unc');
  navigator.clipboard.writeText(unc).then(() => {
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = '⎘', 1800);
  });
};
// Abre documento RNEC: copia la ruta UNC al portapapeles y muestra aviso
window._rnecAbrir = function(url, unc) {
  // Intentar protocolo rnec:// primero (si está configurado)
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Siempre copiar la ruta UNC al portapapeles como fallback
  const ruta = unc || url.replace('rnec://', '\\\\').replace(/\//g, '\\');
  navigator.clipboard.writeText(ruta).catch(() => {});

  // Mostrar toast con instrucción
  let toast = document.getElementById('_rnecToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_rnecToast';
    toast.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
      background:#1a2a3a;border:1px solid rgba(0,212,255,.4);color:var(--text);
      border-radius:8px;padding:10px 18px;font-size:.78rem;z-index:9999;
      box-shadow:0 4px 20px rgba(0,0,0,.5);max-width:420px;text-align:center;
      transition:opacity .3s;pointer-events:none`;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `📋 Ruta copiada al portapapeles<br>
    <span style="font-size:.68rem;color:rgba(0,212,255,.7)">
      Abre el Explorador de archivos <kbd style="background:rgba(255,255,255,.1);padding:1px 5px;border-radius:3px">Win + E</kbd>
      y pega con <kbd style="background:rgba(255,255,255,.1);padding:1px 5px;border-radius:3px">Ctrl + V</kbd>
    </span>`;
  toast.style.opacity = '1';
  clearTimeout(toast._tid);
  toast._tid = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
};

// Genera y descarga el script .bat que registra el protocolo rnec: en Windows
// Usa VBScript como handler para evitar conflictos de % en las rutas
window._rnecDescargarSetup = function() {
  const bat = [
    '@echo off',
    'title Configurar RNEC',
    'echo.',
    'echo  Paso 1: Creando el manejador VBScript...',
    '(',
    'echo Set oShell = CreateObject^("WScript.Shell"^)',
    'echo url = WScript.Arguments^(0^)',
    'echo path = Mid^(url, 8^)',
    'echo path = Replace^(path, "%%20", " "^)',
    'echo path = Replace^(path, "%%2520", " "^)',
    'echo path = Replace^(path, "/", "\\"^)',
    'echo oShell.Run Chr^(34^) ^& "\\\\" ^& path ^& Chr^(34^)',
    ') > "%APPDATA%\\rnec_handler.vbs"',
    '',
    'echo  Paso 2: Registrando protocolo rnec: ...',
    'reg add "HKCU\\SOFTWARE\\Classes\\rnec" /ve /d "URL:RNEC Documentos CNE" /f >nul 2>nul',
    'reg add "HKCU\\SOFTWARE\\Classes\\rnec" /v "URL Protocol" /d "" /f >nul 2>nul',
    'reg add "HKCU\\SOFTWARE\\Classes\\rnec\\shell\\open\\command" /ve /d "wscript.exe //nologo \\"%APPDATA%\\rnec_handler.vbs\\" \\"%%1\\"" /f >nul 2>nul',
    '',
    'echo.',
    'echo  Listo. Cierre el navegador, vuelva a abrirlo y pruebe el boton Carpeta.',
    'echo  La primera vez el navegador preguntara "Abrir rnec?" - haga clic en Abrir.',
    'echo.',
    'pause'
  ].join('\r\n');
  const blob = new Blob([bat], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'configurar_rnec.bat';
  a.click();
  URL.revokeObjectURL(a.href);
};

// ── RNEC lookup (lazy) ────────────────────────────────────────────────────────
let _rnecLookup = null;
async function _loadRnecLookup() {
  if (_rnecLookup) return _rnecLookup;
  try {
    const r = await fetch('/modules/revision/data/rnec_lookup.json', {cache:'force-cache'});
    _rnecLookup = await r.json();
  } catch(e) { _rnecLookup = {}; }
  return _rnecLookup;
}

async function _loadRnecForCand(cand, placeholderId) {
  const el = document.getElementById(placeholderId);
  if (!el) return;
  const lookup = await _loadRnecLookup();
  const orgId  = String(cand.org_id || '').padStart(5, '0');
  const docs   = lookup[orgId] || [];

  if (!docs.length) {
    el.innerHTML = `<div class="cng-gest-section">◈ Documentos RNEC (E6 / E7 / E8)</div>
      <p style="font-size:.71rem;color:rgba(224,244,255,.25);margin:4px 0">Sin documentos RNEC indexados para este partido</p>`;
    return;
  }

  const corp    = (cand.corp || '').toUpperCase();
  const esSen   = corp.includes('SENADO');
  const norm    = s => (s||'').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const circ    = norm(cand._circ_nom || '');

  // Filtrar por corporación y territorio
  let filtered = docs.filter(d => {
    if (esSen  && d.c !== 'SENADO')  return false;
    if (!esSen && d.c !== 'CAMARA')  return false;
    if (!esSen && circ && d.te) {
      const te = norm(d.te);
      if (!te.includes(circ.slice(0,6)) && !circ.includes(te.slice(0,6))) return false;
    }
    return true;
  });
  if (!filtered.length) filtered = docs; // fallback: mostrar todos

  // Agrupar por etapa
  const groups = {};
  filtered.forEach(d => { (groups[d.et] = groups[d.et]||[]).push(d); });

  const STYLE = {
    E6: 'color:#1e40af;background:#dbeafe;border-radius:10px;padding:2px 9px;font-weight:700',
    E7: 'color:#15803d;background:#dcfce7;border-radius:10px;padding:2px 9px;font-weight:700',
    E8: 'color:#92400e;background:#fef3c7;border-radius:10px;padding:2px 9px;font-weight:700',
  };
  const LABEL = { E6:'E6 APROBADOS', E7:'E7 APROBADOS', E8:'E8 GENERADOS' };

  // Genera visor HTML local con los documentos filtrados del partido
  function _generarVisorHtml(partido, circ2, corp2, docs2) {
    const etColors = { E6:'#1e40af;#dbeafe', E7:'#15803d;#dcfce7', E8:'#92400e;#fef3c7' };
    const etLabel  = { E6:'E6 APROBADOS', E7:'E7 APROBADOS', E8:'E8 GENERADOS' };
    const grupos   = {};
    docs2.forEach(d => { (grupos[d.et] = grupos[d.et]||[]).push(d); });

    let rows = '';
    for (const et of ['E6','E7','E8']) {
      const items = grupos[et] || [];
      if (!items.length) continue;
      const [fgColor, bgColor] = (etColors[et]||'#333;#eee').split(';');
      rows += `<tr><td colspan="2" style="background:#f0f4f8;font-weight:700;font-size:11px;padding:6px 12px">
        <span style="display:inline-block;background:${bgColor};color:${fgColor};border-radius:9px;padding:2px 10px;font-size:10px;font-weight:700">${etLabel[et]}</span>
        <span style="color:#666;font-size:10px;margin-left:8px">${items.length} archivos</span>
      </td></tr>`;
      items.forEach(d => {
        const unc = d.u.replace('file://', '\\\\').replace(/%20/g,' ').replace(/\//g,'\\');
        const sop = d.s ? '<span style="font-size:9px;color:#999;margin-right:4px">Soporte</span>' : '';
        rows += `<tr>
          <td style="padding:5px 12px;font-size:11px">${sop}${d.n}</td>
          <td style="padding:5px 12px;text-align:right">
            <a href="${d.u}" target="_blank" style="background:#003580;color:#fff;padding:3px 10px;border-radius:3px;text-decoration:none;font-size:11px;font-weight:700;margin-right:6px">↗ Abrir</a>
            <span style="font-size:9px;color:#999;word-break:break-all">${unc}</span>
          </td>
        </tr>`;
      });
    }

    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>RNEC · ${partido} · ${corp2} · ${circ2}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:13px;background:#f0f3f8;color:#222}
header{background:linear-gradient(135deg,#003580 0%,#005bb5 100%);color:#fff;padding:16px 24px}
h1{font-size:15px;font-weight:700}p{font-size:11px;opacity:.7;margin-top:4px}
.wrap{padding:18px 20px}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.1)}
td{border-bottom:1px solid #eef0f4}tr:last-child td{border-bottom:none}tr:hover td{background:#f5f8ff}
.nota{font-size:11px;color:#555;margin-top:12px;padding:10px 14px;background:#fff3cd;border-radius:6px;border:1px solid #ffc107}
</style></head><body>
<header><h1>Documentos RNEC — Congreso 2026</h1>
<p>${partido} · ${corp2} · ${circ2} · \\\\fs.cne.gov.co</p></header>
<div class="wrap">
<table>${rows}</table>
<p class="nota">⚠ Los botones "↗ Abrir" funcionan solo si este archivo está abierto <strong>localmente</strong> (doble clic) y tienes acceso a la carpeta de red del CNE.</p>
</div></body></html>`;
  }

  function toUNC(url) {
    return url.replace('file://', '\\\\').replace(/%20/g,' ').replace(/\//g,'\\');
  }

  const partNombre = cand.org || orgId;
  const corpLabel  = esSen ? 'SENADO' : 'CÁMARA';

  const _rnecYaConfig = localStorage.getItem('rnec_configurado');
  const _rnecSetupBanner = _rnecYaConfig ? '' :
    `<div style="background:rgba(252,209,22,.07);border:1px solid rgba(252,209,22,.25);border-radius:6px;padding:7px 10px;margin-bottom:8px;font-size:.64rem;color:rgba(224,244,255,.7);line-height:1.5">
      ⚙ <strong style="color:#fcd116">Primera vez:</strong> descarga y ejecuta
      <button class="cng-doc-btn-sm" style="color:#fcd116;border-color:#fcd116;font-size:.6rem;margin:0 4px" onclick="_rnecDescargarSetup()">configurar_rnec.bat</button>
      una sola vez, luego cierra y reabre el navegador.
      <button onclick="localStorage.setItem('rnec_configurado','1');this.closest('div').remove()" style="float:right;background:none;border:none;color:rgba(224,244,255,.3);cursor:pointer;font-size:.7rem">✕ Ya lo hice</button>
    </div>`;

  let html = `<div class="cng-gest-section" style="display:flex;align-items:center;justify-content:space-between;gap:6px">
    <span>◈ Documentos RNEC — ${filtered.length} archivos</span>
    <button class="cng-doc-btn-sm" style="color:#666;border-color:#444;font-size:.6rem;margin-left:auto"
      onclick="_rnecDescargarSetup()"
      title="Configurar apertura directa (una vez por PC)">
      ⚙
    </button>
  </div>
  ${_rnecSetupBanner}`;

  for (const et of ['E6','E7','E8']) {
    const items = groups[et] || [];
    if (!items.length) continue;

    // Carpeta del primer documento (quitar nombre del archivo)
    const primerUrl      = items[0].u;
    const folderUrl      = primerUrl.substring(0, primerUrl.lastIndexOf('/') + 1);
    const rnecFolderUrl  = folderUrl.replace(/^file:\/\//, 'rnec://');
    const folderUnc      = toUNC(folderUrl);
    const folderUncAttr  = folderUnc.replace(/&/g,'&amp;').replace(/"/g,'&quot;');

    html += `<div style="margin-bottom:10px">
      <div style="font-size:.68rem;margin-bottom:6px;display:flex;align-items:center;gap:8px">
        <span style="${STYLE[et]}">${LABEL[et]}</span>
        <span style="font-size:.62rem;color:rgba(224,244,255,.35)">${items.length} archivos</span>
        <button class="cng-doc-btn-sm" style="color:#fcd116;border-color:#fcd116;margin-left:auto"
          onclick="_rnecAbrir('${rnecFolderUrl}')"
          title="Abre la carpeta en Explorer · requiere configuración una vez (botón ⚙)">
          📁 Carpeta
        </button>
        <button class="cng-doc-btn-sm" style="color:#888;border-color:#555;font-size:.6rem"
          data-unc="${folderUncAttr}" onclick="_rnecCopiarCarpeta(this)"
          title="Copiar ruta → Win+E → Ctrl+V">⎘</button>
      </div>`;
    items.slice(0, 20).forEach(d => {
      const sop        = d.s ? `<span style="font-size:.58rem;color:rgba(224,244,255,.35);flex-shrink:0">Soporte</span>` : '';
      const terr       = (d.te && !circ.includes(norm(d.te).slice(0,6)))
        ? `<span style="font-size:.58rem;color:rgba(0,212,255,.4);flex-shrink:0">${d.te}</span>` : '';
      const unc        = toUNC(d.u);
      const uncAttr    = unc.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
      const rnecFileUrl = d.u.replace(/^file:\/\//, 'rnec://');
      const uncEsc      = unc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      html += `<div class="cng-sop-row" style="cursor:pointer" title="${d.n}"
          onclick="_rnecAbrir('${rnecFileUrl}','${uncEsc}')">
        ${sop}
        <span class="cng-sop-desc">${d.n}</span>
        ${terr}
        <button class="cng-doc-btn-sm" style="color:#4caf50;border-color:#4caf50;font-size:.6rem"
          onclick="event.stopPropagation();_rnecAbrir('${rnecFileUrl}','${uncEsc}')"
          title="Abrir">↗</button>
        <button class="cng-doc-btn-sm" title="Copiar ruta \\fs.cne.gov.co"
          data-unc="${uncAttr}" onclick="event.stopPropagation();_rnecCopiarRuta(this)">⎘</button>
      </div>`;
    });
    if (items.length > 20) {
      html += `<p style="font-size:.63rem;color:rgba(224,244,255,.25);margin:3px 0">… y ${items.length-20} más en la carpeta</p>`;
    }
    html += '</div>';
  }

  el._rnecFilteredDocs = filtered;
  el.innerHTML = html;
}

// Descarga el visor HTML local con TODOS los documentos del partido/circunscripción
async function _rnecDescargarVisor(partido, circ, corp, cand) {
  const lookup = await _loadRnecLookup();
  const orgId  = String(cand.org_id || '').padStart(5, '0');
  const docs   = lookup[orgId] || [];
  const norm   = s => (s||'').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const esSen  = corp.includes('SENADO');
  const circN  = norm(circ);

  let filtered = docs.filter(d => {
    if (esSen  && d.c !== 'SENADO')  return false;
    if (!esSen && d.c !== 'CAMARA')  return false;
    if (!esSen && circN && d.te) {
      const te = norm(d.te);
      if (!te.includes(circN.slice(0,6)) && !circN.includes(te.slice(0,6))) return false;
    }
    return true;
  });
  if (!filtered.length) filtered = docs;

  const etColors = { E6:'#1e40af;#dbeafe', E7:'#15803d;#dcfce7', E8:'#92400e;#fef3c7' };
  const etLabel  = { E6:'E6 APROBADOS', E7:'E7 APROBADOS', E8:'E8 GENERADOS' };
  const grupos   = {};
  filtered.forEach(d => { (grupos[d.et] = grupos[d.et]||[]).push(d); });

  let rows = '';
  for (const et of ['E6','E7','E8']) {
    const items = grupos[et] || [];
    if (!items.length) continue;
    const [fgC, bgC] = (etColors[et]||'#333;#eee').split(';');
    rows += `<tr><td colspan="2" style="background:#f0f4f8;padding:7px 14px">
      <span style="background:${bgC};color:${fgC};border-radius:9px;padding:2px 10px;font-size:10px;font-weight:700">${etLabel[et]}</span>
      <span style="color:#888;font-size:10px;margin-left:8px">${items.length} archivos</span>
    </td></tr>`;
    items.forEach(d => {
      const unc = d.u.replace('file://', '\\\\').replace(/%20/g,' ').replace(/\//g,'\\');
      const sop = d.s ? '<span style="font-size:9px;color:#aaa;margin-right:5px">Soporte</span>' : '';
      rows += `<tr>
        <td style="padding:5px 14px;font-size:11px">${sop}${d.n}${d.te?` <span style="font-size:9px;color:#888">[${d.te}]</span>`:''}</td>
        <td style="padding:5px 14px;text-align:right;width:110px">
          <a href="${d.u}" target="_blank" style="display:inline-block;background:#003580;color:#fff;padding:4px 12px;border-radius:4px;text-decoration:none;font-size:11px;font-weight:700">↗ Abrir</a>
        </td>
      </tr>`;
    });
  }

  const htmlContent = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>RNEC · ${partido} · ${corp} · ${circ}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:13px;background:#f0f3f8}
header{background:linear-gradient(135deg,#003580,#005bb5);color:#fff;padding:16px 24px}
h1{font-size:15px;font-weight:700}header p{font-size:11px;opacity:.7;margin-top:4px}
.wrap{padding:18px 20px;max-width:900px;margin:0 auto}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)}
td{border-bottom:1px solid #eef0f4;color:#222}tr:last-child td{border-bottom:none}tr:hover td{background:#f5f8ff}
.nota{font-size:11px;color:#664d03;margin-top:14px;padding:10px 14px;background:#fff3cd;border-radius:6px;border:1px solid #ffc107;line-height:1.5}
</style></head><body>
<header>
  <h1>Documentos RNEC — Elecciones Congreso 2026</h1>
  <p>${partido} · ${corp} · ${circ} &nbsp;|&nbsp; Total: ${filtered.length} archivos &nbsp;|&nbsp; \\\\fs.cne.gov.co</p>
</header>
<div class="wrap">
  <table>${rows}</table>
  <p class="nota">⚠ Los botones "↗ Abrir" funcionan solo si:<br>
  1. Este archivo HTML está abierto <strong>directamente desde tu equipo</strong> (doble clic, no desde Firefox/Chrome web).<br>
  2. Tienes acceso a la carpeta de red del CNE (<code>\\\\fs.cne.gov.co\\CNE\\FNFP\\...</code>).<br>
  Si Chrome bloquea los links, prueba abrirlo con <strong>Internet Explorer</strong> o <strong>Edge</strong> en modo compatibilidad.</p>
</div></body></html>`;

  const blob = new Blob([htmlContent], {type:'text/html;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `RNEC_${partido.replace(/[^a-zA-Z0-9]/g,'_').slice(0,25)}_${circ.replace(/[^a-zA-Z0-9]/g,'_').slice(0,15)}_${corp}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Docs tab ──────────────────────────────────────────────────────────────────
function _cngRenderDocs(cand) {
  const id = cand.cand_id;

  // det se pasa como segundo argumento para los soportes locales
  const det = arguments[1] || {};
  const todos = [...(det.ingresos || []), ...(det.gastos || [])];
  const soportes = todos.filter(r => r.archivo);

  // Soportes locales: archivos/... ya están en ADRIANA, sin sesión CNE
  function _sopCard(r) {
    const enc = encodeURIComponent(r.archivo);
    const esGasto = !!r.id_gasto;
    return `<div class="cng-sop-row">
      <span style="font-size:.75rem">${esGasto ? '📤' : '📥'}</span>
      <span class="cng-sop-desc">${_trunc(r.nom_formato || r.nom_ingreso || r.archivo, 42)}</span>
      <span class="${esGasto ? 'monto-neg' : 'monto-pos'}" style="font-size:.68rem;flex-shrink:0">${_fmtTot(r.total)}</span>
      <button class="cng-doc-btn-sm" onclick="cngAbrirLocal('${enc}')">↗</button>
      <button class="cng-doc-btn-sm" onclick="cngVerLocal('${enc}')">👁</button>
    </div>`;
  }

  // Documentos CNE: requieren sesión activa (proxiados a app_cng_2026.cne.gov.co)
  const docsCNE = [
    { label:'Libro Contable',  icon:'📒', path:`/libroContable?idcandidato=${id}&idproceso=1` },
    { label:'Inf. Ingresos',   icon:'📥', path:`/ingreso/imprimirIngresos?idcandidato=${id}&idproceso=1` },
    { label:'Inf. Gastos',     icon:'📤', path:`/gasto/imprimirGastos?idcandidato=${id}&idproceso=1` },
    { label:'Consolidado',     icon:'📊', path:`/descargar-consolidado?idcandidato=${id}&idproceso=1` },
    { label:'Oficio CNE',      icon:'📩', path:`/oficio/candidato?idcandidato=${id}&idproceso=1` },
    { label:'Certificado',     icon:'🏅', path:`/certificado/candidato?idcandidato=${id}&idproceso=1` },
    { label:'Liquidación',     icon:'🧾', path:`/liquidacion-de-calculo?idcandidato=${id}&idproceso=1` },
  ];

  function _cneCard(d) {
    const enc = encodeURIComponent(d.path);
    return `<div class="cng-doc-item">
      <span class="cng-doc-item-icon">${d.icon}</span>
      <span class="cng-doc-item-label">${d.label}</span>
      <div class="cng-doc-item-btns">
        <button class="cng-doc-btn-sm" onclick="cne2026AbrirArchivo('${enc}')">↗ Abrir</button>
        <button class="cng-doc-btn-sm" onclick="cngMostrarEnVisor('${enc}')">👁 Ver</button>
      </div>
    </div>`;
  }

  const alertaCNE = !_cne2026Logueado
    ? '<p style="font-size:.71rem;color:#ef9a50;margin:6px 0 8px">⚠ Conecta CNE para acceder a estos documentos</p>'
    : '';

  const sopHtml = soportes.length
    ? `<div class="cng-sop-list">${soportes.map(_sopCard).join('')}</div>`
    : '<p style="font-size:.71rem;color:rgba(224,244,255,.3);margin:4px 0">Sin soportes descargados para este candidato</p>';

  // Docs tab: generadores, soportes y portal CNE (RNEC va al tab Visor)
  document.getElementById('cngDocsContent').innerHTML = `
    <div class="cng-gest-section">◈ Generar documentos locales (sin conexión CNE)</div>
    ${_cngRenderGeneradores(cand, det)}

    <div class="cng-gest-section" style="margin-top:14px">◈ Soportes transacciones (${soportes.length} archivos · requiere CNE)</div>
    ${sopHtml}

    <div class="cng-gest-section" style="margin-top:14px">◈ Documentos del portal CNE (requiere conexión)</div>
    ${alertaCNE}
    <div class="cng-doc-grid">${docsCNE.map(_cneCard).join('')}</div>`;

  // Visor tab: sección RNEC E6/E7/E8
  const rnecEl = document.getElementById('cngRnecContent');
  if (rnecEl) {
    rnecEl.innerHTML = `<div class="cng-gest-section">◈ Documentos RNEC (E6 / E7 / E8)</div>
      <p class="cng-tab-msg" style="font-size:.72rem;color:rgba(224,244,255,.35)">Cargando…</p>`;
    _loadRnecForCand(cand, 'cngRnecContent');
  }
}

// ── Generadores locales (sin CNE) ─────────────────────────────────────────────
function _genDescargar(idTexto, nombreArchivo) {
  const el = document.getElementById(idTexto);
  const txt = el ? (el.innerText || el.textContent || '') : '';
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Descarga DOCX desde plantilla ─────────────────────────────────────────────
async function _genDescargarDocx(plantilla, reemplazos, nombreArchivo) {
  try {
    const r = await fetch(`/modules/revision/plantillas/${plantilla}`);
    if (!r.ok) throw new Error('Plantilla no encontrada');
    const buf = await r.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    let xml = await zip.file('word/document.xml').async('string');

    // Aplicar reemplazos (más largo primero para evitar conflictos parciales)
    const sorted = reemplazos.sort((a, b) => b[0].length - a[0].length);
    for (const [desde, hacia] of sorted) {
      xml = xml.split(desde).join(hacia || '');
    }

    zip.file('word/document.xml', xml);
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombreArchivo;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch(e) {
    alert('Error generando Word: ' + e.message);
  }
}

// ── Descarga XLSX de liquidación (generado con SheetJS) ───────────────────────
function _genDescargarLiqXlsx(id) {
  const cand = _cngGetCand(id);
  const det  = _cngGetDet(id);
  const get  = sfx => parseFloat((document.getElementById(`liq_${id}_${sfx}`) || {}).value) || 0;
  const getT = sfx => (document.getElementById(`liq_${id}_${sfx}`) || {}).textContent || '$0';

  const gastos    = get('gastos');
  const votos     = get('votos');
  const valorVoto = get('valorvoto');
  const anticipos = get('anticipos');
  const repVotos  = votos * valorVoto;
  const repGastos = gastos;
  const valBruto  = Math.min(repVotos, repGastos);
  const descAud   = Math.round(repVotos * 0.01);
  const totalNeto = Math.max(0, valBruto - descAud - anticipos);

  const wb = XLSX.utils.book_new();
  const tope = CONGRESO2026.getTope(cand.corp, cand._circ_nom || cand.circ_id, 0);

  const filas = [
    ['FONDO NACIONAL DE FINANCIACIÓN DE PARTIDOS Y CAMPAÑAS ELECTORALES'],
    ['LIQUIDACIÓN DE REPOSICIÓN — CONGRESO DE LA REPÚBLICA 2026'],
    ['Elecciones 8 de marzo de 2026'],
    [],
    ['Candidato:', cand.nombre || ''],
    ['Partido/Movimiento:', cand.org || ''],
    ['Corporación:', cand.corp || ''],
    ['Circunscripción:', cand._circ_nom || ''],
    ['Tope máximo gastos (Res. ' + CONGRESO2026.RES_TOPES + '):', tope || ''],
    ['Valor del voto (Res. ' + CONGRESO2026.RES_VALOR_VOTO + '):', CONGRESO2026.VALOR_VOTO],
    [],
    ['VOTOS CERTIFICADO ELECTORAL', '', 'GASTOS CONSOLIDADOS CAMPAÑA', ''],
    ['TOTAL VOTOS VÁLIDOS DE LA LISTA', votos, 'TOTAL GASTOS CONSOLIDADOS', gastos],
    ['', '', '(-) TRANSFERENCIAS', 0],
    ['', '', '(-) GASTOS SIN RELACIÓN DE CAUSALIDAD', 0],
    ['', '', '(-) GASTOS CANDIDATOS NO PRESENTARON EN DEBIDA FORMA', 0],
    ['', '', '(-) GASTOS CANDIDATOS QUE NO PRESENTARON EL INFORME', 0],
    ['', '', '(-) GASTOS CANDIDATOS REVOCADOS', 0],
    ['', '', '(-) GASTOS CON POSTERIORIDAD A LA FECHA DEL DEBATE', 0],
    ['', '', '(-) GASTOS QUE NO ESTÁN DEBIDAMENTE SOPORTADOS', 0],
    ['TOTAL VOTOS A DESCONTAR CANDIDATOS', 0, 'TOTAL GASTOS A DESCONTAR CANDIDATOS', 0],
    ['TOTAL VOTOS NETOS A LIQUIDAR', votos, 'TOTAL GASTOS NETOS', gastos],
    [],
    ['CONSOLIDADO LIQUIDACIÓN'],
    ['VALOR DEL VOTO (Res. CNE 2026)', valorVoto],
    ['VALOR LIQUIDACIÓN POR VOTOS NETOS', repVotos],
    ['VALOR REPOSICIÓN POR GASTOS NETOS', repGastos],
    ['VALOR BRUTO A RECONOCER', valBruto],
    ['Descuento Auditoría Externa 1%', descAud],
    ['(-) MENOS ANTICIPOS', anticipos],
    ['VALOR NETO A REPONER', valBruto - descAud],
    ['TOTAL NETO A REPONER', totalNeto],
  ];
  const ws = XLSX.utils.aoa_to_sheet(filas);

  // Ancho de columnas
  ws['!cols'] = [{wch:50},{wch:18},{wch:50},{wch:18}];

  // Merge celdas título
  ws['!merges'] = [
    {s:{r:0,c:0}, e:{r:0,c:3}},
    {s:{r:1,c:0}, e:{r:1,c:3}},
    {s:{r:20,c:0}, e:{r:20,c:3}},
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Liquidación');
  const nombre = `Liquidacion_${(cand.nombre||'').replace(/\s+/g,'_').substring(0,25)}_Congreso2026.xlsx`;
  XLSX.writeFile(wb, nombre);
}

function _genCopiar(idTexto, btn) {
  const el = document.getElementById(idTexto);
  const txt = el ? (el.innerText || el.textContent || '') : '';
  navigator.clipboard.writeText(txt).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copiado';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  });
}

function _genToggle(id) {
  const body = document.getElementById(id);
  if (!body) return;
  const open = body.classList.toggle('open');
  const btn = body.previousElementSibling.querySelector('.cng-gen-toggle');
  if (btn) btn.textContent = open ? '▲ Cerrar' : '▼ Abrir';
  // Auto-generar contenido al abrir por primera vez
  if (open) {
    const candId = body.dataset.candId;
    if (!candId) return;
    if (id.startsWith('cert_body_'))   _cngGenerarCert(_cngGetCand(candId), _cngGetDet(candId));
    if (id.startsWith('oficio_body_')) _cngGenerarOficio(_cngGetCand(candId), _cngGetDet(candId));
  }
}

function _fmtCOP(n) {
  return '$' + (n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

// Convierte un número a texto en español (para el párrafo del censo)
function _numPalabrasSimple(n) {
  const U=['','UN','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE',
           'DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE'];
  const D=['','','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
  const C=['','CIEN','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
  if (n === 0) return 'CERO';
  if (n < 0) return 'MENOS ' + _numPalabrasSimple(-n);
  let r = '';
  if (n >= 1000000) {
    const m = Math.floor(n / 1000000);
    r += (m === 1 ? 'UN MILLÓN' : _numPalabrasSimple(m) + ' MILLONES') + ' ';
    n %= 1000000;
  }
  if (n >= 1000) {
    const k = Math.floor(n / 1000);
    r += (k === 1 ? 'MIL' : _numPalabrasSimple(k) + ' MIL') + ' ';
    n %= 1000;
  }
  if (n >= 100) {
    const c = Math.floor(n / 100);
    r += (n === 100 ? 'CIEN' : C[c]) + ' ';
    n %= 100;
  }
  if (n >= 20) {
    const d = Math.floor(n / 10);
    r += D[d] + (n % 10 ? ' Y ' + U[n % 10] : '') + ' ';
  } else if (n > 0) {
    r += U[n] + ' ';
  }
  return r.trim();
}

function _onCoalicionChange(id) {
  const esCoal = (document.getElementById(`cert_${id}_es_coalicion`) || {}).value === '1';
  const w1  = document.getElementById(`cert_${id}_coal_wrap1`);
  const w2  = document.getElementById(`cert_${id}_coal_wrap2`);
  const lbl = document.getElementById(`cert_${id}_partido_lbl`);
  if (w1)  w1.style.display  = esCoal ? '' : 'none';
  if (w2)  w2.style.display  = esCoal ? '' : 'none';
  if (lbl) lbl.textContent   = esCoal ? 'Partido responsable' : 'Partido / Movimiento';
}

function _cngGenerarCert(cand, det) {
  const cont = cand.contador || {};
  const g    = id => (document.getElementById('cert_' + cand.cand_id + '_' + id) || {}).value || '';

  const esCoal       = g('es_coalicion') === '1';
  const partido      = g('partido')          || cand.org || '';
  const coalNombre   = g('coalicion_nombre') || '';
  const coalPartidos = g('coalicion_partidos') || '';
  const acta         = g('acta')      || '';
  const dia          = g('dia')       || '';
  const mes          = g('mes')       || '';
  const anio         = g('anio')      || new Date().getFullYear();
  const jefe         = g('jefe')      || 'JEFE DE OFICINA';
  const audNom       = g('audnom')    || cont.nombre   || '';
  const audTP        = g('audtp')     || cont.tarjeta  || '';
  const audCC        = g('audcc')     || cont.documento|| '';
  const radicado     = g('radicado')  || '';
  const fechaPres    = g('fechapres') || '';

  const corp    = cand.corp || '';
  const circ    = cand._circ_nom || cand.circ_id || '';
  const ing     = _fmtCOP(det.total_ingresos || cand.total_ingresos || 0);
  const gas     = _fmtCOP(det.total_gastos   || cand.total_gastos   || 0);
  const esSenado = corp.includes('SENADO');
  const esCamara = corp.includes('CAMARA') || corp.includes('CÁMARA');

  // Censo real del departamento (solo Cámara territorial)
  const censoDpto = (esCamara && circ) ? CONGRESO2026.getCensoDpto(circ) : 0;

  // Texto de corporación con artículo y circunscripción
  const corpTxt = esSenado
    ? 'la lista al Senado de la República — Circunscripción Nacional'
    : esCamara
      ? `la lista a la Cámara de Representantes — Circunscripción ${circ || '[CIRCUNSCRIPCIÓN]'}`
      : `${corp}${circ ? ' — Circunscripción: ' + circ : ''}`;

  const tope     = CONGRESO2026.getTope(corp, cand._circ_nom || cand.circ_id, censoDpto);
  const topeText = tope ? `$${tope.toLocaleString('es-CO')} PESOS M/CTE` : '[TOPE SEGÚN RESOLUCIÓN]';

  let t = '';
  t += `FONDO NACIONAL DE FINANCIACIÓN DE PARTIDOS Y CAMPAÑAS ELECTORALES\n`;
  t += `CERTIFICACIÓN DE INGRESOS Y GASTOS DE CAMPAÑA — CONGRESO 2026\n`;
  t += `${'─'.repeat(70)}\n\n`;
  t += `LA JEFE DE OFICINA DEL FONDO NACIONAL DE FINANCIACIÓN DE PARTIDOS\nY CAMPAÑAS ELECTORALES\n\n`;
  t += `HACE CONSTAR:\n\n`;

  // ── Párrafo de presentación ──
  if (esCoal) {
    t += `Que el ${partido}, como responsable de la presentación del Informe de Ingresos y Gastos de Campaña de la Coalición denominada "${coalNombre || '[NOMBRE COALICIÓN]'}"`;
    if (coalPartidos) t += `, conformada por el ${coalPartidos}`;
    t += `, presentó a través del Software Aplicativo Cuentas Claras`;
  } else {
    t += `Que el ${partido} presentó a través del Software Aplicativo Cuentas Claras`;
  }
  if (radicado) t += ` el Informe de Ingresos y Gastos de Campaña radicado con el Consecutivo ${radicado}`;
  if (fechaPres) t += `, con fecha ${fechaPres}`;
  t += `, correspondiente a la campaña electoral adelantada para ${corpTxt}.\n\n`;

  // ── Identificación ──
  t += `CANDIDATO(A): ${cand.nombre}\n`;
  if (esCoal) {
    t += `COALICIÓN: ${coalNombre || '[NOMBRE COALICIÓN]'}\n`;
    if (coalPartidos) t += `PARTIDOS INTEGRANTES: ${coalPartidos}\n`;
    t += `PARTIDO RESPONSABLE: ${partido}\n`;
  } else {
    t += `PARTIDO/MOVIMIENTO: ${partido}\n`;
  }
  t += `CORPORACIÓN: ${corp}\n\n`;

  // ── Asignación auditor ──
  t += `CERTIFICAR:\n\n`;
  t += `Que la información de ingresos y gastos evidenciada en el Software Aplicativo CUENTAS CLARAS`;
  if (radicado) t += ` radicado con el Consecutivo ${radicado}`;
  t += `, fue asignado – reasignado mediante reparto según Acta No. ${acta || '[XX]'} del ${dia || '[día]'} de ${mes || '[mes]'} de ${anio} al(a la) Contador(a) Público(a) ${audNom || '[NOMBRE]'} con Tarjeta Profesional No. ${audTP || '[T.P.]'}, identificado(a) con C.C. No. ${audCC || '[C.C.]'}, perteneciente al grupo de trabajo adscrito al Fondo Nacional de Financiación de Partidos y Campañas Electorales, quien una vez concluido el proceso de revisión y la generación de los requerimientos que fue necesario realizar en desarrollo de este, si a ello hubo lugar, como lo prevén los artículos 12 y 13 de la Resolución No. 4737 de 2023, modificada transitoriamente por la Resolución No. 02240 de 2024, se permite:\n\n`;
  t += `CERTIFICAR:\n\n`;

  // ── Documentos contentivos ──
  if (esCoal) {
    t += `Que hacen parte de los documentos contentivos del informe integral de ingresos y gastos de la coalición: el formulario 9B y sus respectivos anexos, el Acuerdo Programático de Coalición, al igual que los formularios 8B de cada uno de los partidos y movimientos integrantes con sus respectivos anexos y demás documentos.\n\n`;
  } else {
    t += `Que hacen parte de los documentos contentivos del informe integral de ingresos y gastos: el formulario 9B y sus respectivos anexos, al igual que el/los formularios 8B con sus respectivos anexos y demás documentos.\n\n`;
  }

  // ── Consolidado financiero ──
  t += `CONSOLIDADO FINANCIERO:\n`;
  t += `  Total Ingresos reportados:  ${ing}\n`;
  t += `  Total Gastos reportados:    ${gas}\n\n`;

  // ── Párrafo del censo electoral (solo Cámara territorial) ──
  if (esCamara && censoDpto > 0) {
    t += `Que, el censo electoral del departamento de ${circ} vigente para la fecha en que se realizó el debate electoral, según el archivo facilitado por la Dirección de Censo Electoral de la Registraduría Nacional del Estado Civil, es de ${censoDpto.toLocaleString('es-CO')} (${_numPalabrasSimple(censoDpto)}) ciudadanos aptos para votar.\n\n`;
  }

  // ── Tope y valor del voto ──
  t += `Que, cotejado el censo con la ${CONGRESO2026.textoResolucionTopes()}, se puede establecer que en la referenciada campaña se podía invertir por cada lista la suma de hasta ${topeText}.\n\n`;
  t += `Que mediante la ${CONGRESO2026.textoResolucionVoto()}, se fijó el valor de reposición por voto válido obtenido en la suma de OCHO MIL OCHOCIENTOS SESENTA Y TRES PESOS ($${CONGRESO2026.VALOR_VOTO.toLocaleString('es-CO')}) MONEDA LEGAL COLOMBIANA para las Elecciones al Congreso de la República del 8 de marzo de 2026.\n\n`;
  t += `Que a la fecha el informe se halla sin observación alguna.\n\n`;

  // ── Artículos legales de coalición ──
  if (esCoal) {
    t += `Que el inciso sexto del artículo 13 de la Ley 130 de 1994 establece: "…Los partidos y movimientos que concurran a las elecciones formando coaliciones determinarán previamente la forma de distribución de la reposición de gastos de campaña entre ellos…".\n\n`;
    t += `Que el parágrafo 1º del artículo 29 de la Ley 1475 de 2011 establece: "…Antes de la inscripción del candidato, la coalición debe haber determinado los siguientes aspectos; mecanismo mediante el cual se realizará la designación del candidato; el programa que va a presentar el candidato; la forma de distribución de la financiación Estatal y de los gastos de la campaña entre los miembros de la coalición, incluyendo las pólizas y demás garantías a que haya lugar, y la filiación política del candidato para efectos de su ingreso al Congreso…".\n\n`;
    t += `Que el Acuerdo de Coalición suscrito el día [día] de [mes] de [año] entre el ${coalPartidos || '[PARTIDOS INTEGRANTES]'}, presentado ante la Organización Electoral, se dispuso lo siguiente:\n\n`;
    t += `"[CLÁUSULA: Transcribir tal cual aparece en el acuerdo de coalición]"\n\n`;
    t += `Que, en virtud de lo anterior, la citada campaña de coalición cumplió con los presupuestos normativos para acceder a la reposición de gastos de campaña.\n\n`;
  }

  // ── Firma ──
  t += `${'─'.repeat(70)}\n`;
  t += `${audNom}\nT.P. No. ${audTP}\n\n`;
  t += `${jefe}\nJefe de Oficina\nFondo Nacional de Financiación de Partidos y Campañas Electorales\n\n`;
  t += `Expedido el ${dia || '[día]'} de ${mes || '[mes]'} de ${anio}.\n`;

  const el = document.getElementById(`cert_texto_${cand.cand_id}`);
  if (el) el.innerText = t;
}

function _cngGenerarOficio(cand, det) {
  const g = id => (document.getElementById('oficio_' + cand.cand_id + '_' + id) || {}).value || '';
  const partido  = g('partido') || cand.org || '';
  const asunto   = g('asunto')  || 'REQUERIMIENTO DE INFORMACIÓN';
  const obs      = g('obs')     || '[Describa aquí las observaciones o solicitudes de información]';
  const jefe     = g('jefe')    || 'JEFE DE OFICINA';
  const dia      = g('dia')     || '';
  const mes      = g('mes')     || '';
  const anio     = g('anio')    || new Date().getFullYear();
  const plazo    = g('plazo')   || '5 días hábiles';

  let t = '';
  t += `FONDO NACIONAL DE FINANCIACIÓN DE PARTIDOS Y CAMPAÑAS ELECTORALES\n`;
  t += `OFICIO / REQUERIMIENTO\n`;
  t += `${'─'.repeat(70)}\n\n`;
  t += `Ciudad y fecha: ${dia || '[día]'} de ${mes || '[mes]'} de ${anio}\n\n`;
  t += `Señores\n${partido}\nRepresentante Legal\nCiudad.\n\n`;
  t += `ASUNTO: ${asunto}\n\n`;
  t += `Respetados señores:\n\n`;
  t += `En relación con el informe de ingresos y gastos de campaña presentado ante el Fondo Nacional de Financiación de Partidos y Campañas Electorales para la Elección al Congreso de la República 2026, correspondiente al(a la) candidato(a) ${cand.nombre}, cédula ${cand.cedula || '—'}, inscrito(a) para ${cand.corp || ''}, nos permitimos informarles lo siguiente:\n\n`;
  t += `${obs}\n\n`;
  t += `Lo anterior con el fin de dar cumplimiento a lo establecido en la normativa vigente. Le recordamos que cuenta con un plazo de ${plazo} a partir del recibo de la presente comunicación para dar respuesta.\n\n`;
  t += `Cordialmente,\n\n\n`;
  t += `${jefe}\nJefe de Oficina\nFondo Nacional de Financiación de Partidos y Campañas Electorales\n`;

  const el = document.getElementById(`oficio_texto_${cand.cand_id}`);
  if (el) el.innerText = t;
}

function _cngRecalcLiq(cand, det) {
  const id    = cand.cand_id;
  const get   = sfx => parseFloat((document.getElementById(`liq_${id}_${sfx}`) || {}).value) || 0;
  const set   = (sfx, v) => { const el = document.getElementById(`liq_${id}_${sfx}`); if (el) el.textContent = _fmtCOP(v); };

  const gastos    = get('gastos');
  const votos     = get('votos');
  const valorVoto = get('valorvoto');
  const anticipos = get('anticipos');

  const repVotos = votos * valorVoto;
  const repGastos = gastos;
  const valorBruto = Math.min(repVotos, repGastos);
  const descAud = Math.round(repVotos * 0.01);
  const neto = valorBruto - descAud - anticipos;

  set('rep_votos',  repVotos);
  set('rep_gastos', repGastos);
  set('val_bruto',  valorBruto);
  set('desc_aud',   descAud);
  set('total_neto', Math.max(0, neto));
}

// Genera DOCX mínimo con el texto del editor (preserva ediciones del usuario)
async function _textoEditorADocx(textoId, nombreArchivo) {
  const el = document.getElementById(textoId);
  if (!el) return;
  const texto = (el.innerText || el.textContent || '').trim();
  const lineas = texto.split('\n');

  // Construir párrafos XML para cada línea
  function _escapar(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  const parrafos = lineas.map(l => {
    const es = _escapar(l);
    const bold = (l === l.toUpperCase() && l.length > 3 && /[A-ZÁÉÍÓÚ]/.test(l));
    const run = bold
      ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${es}</w:t></w:r>`
      : `<w:r><w:t xml:space="preserve">${es}</w:t></w:r>`;
    return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${l ? run : ''}</w:p>`;
  }).join('');

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:sectPr>
  <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701"/>
</w:sectPr>
${parrafos}
</w:body>
</w:document>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', relsXml);
  zip.file('word/document.xml', docXml);

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Word Congreso 2026: limpia el template (quita rojo/sombreado, filtra coalición) ──
async function _cngGenerarCertDocxFmt(id, esCoal) {
  const cand = _cngGetCand(id);
  const cont = cand.contador || {};
  const g    = sfx => (document.getElementById(`cert_${id}_${sfx}`) || {}).value || '';

  const partido      = g('partido')            || cand.org || '';
  const coalNombre   = esCoal ? (g('coalicion_nombre')   || '[NOMBRE COALICIÓN]')    : '';
  const coalPartidos = esCoal ? (g('coalicion_partidos') || '[PARTIDOS INTEGRANTES]') : '';
  const radicado     = g('radicado')   || '';
  const fechaPres    = g('fechapres')  || '29 de diciembre de 2023';
  const audNom       = g('audnom')     || cont.nombre   || 'NOMBRE Y APELLIDOS COMPLETOS';
  const audTP        = g('audtp')      || cont.tarjeta  || 'XXXXXX-T';
  const acta         = g('acta')       || 'XX';
  const dia          = g('dia')        || 'día';
  const mes          = g('mes')        || 'mes';
  const anio         = g('anio')       || String(new Date().getFullYear());
  const jefe         = g('jefe')       || 'ANDREA DEL PILAR LOPERA PRADA';
  const corp         = cand.corp       || '';
  const circ         = cand._circ_nom  || '';
  const sufijo       = esCoal ? '_Coalicion' : '_Partido';

  const esSenado  = corp.includes('SENADO');
  const corpShort = esSenado ? 'Senado de la República' : 'Cámara de Representantes';
  const circTxt   = esSenado ? 'Circunscripción Nacional' : (circ || '[CIRCUNSCRIPCIÓN]');

  // Texto de partido para apertura (diferente si es coalición)
  const partidoDocx = esCoal && coalNombre
    ? `${partido}, como responsable de la Coalición denominada "${coalNombre}"${coalPartidos ? `, conformada por el ${coalPartidos}` : ''}`
    : partido;

  try {
    const tr  = await fetch('/modules/revision/plantillas/cert_congreso2026.docx');
    if (!tr.ok) throw new Error('No se pudo cargar la plantilla');
    const zip = await JSZip.loadAsync(await tr.arrayBuffer());
    let xml   = await zip.file('word/document.xml').async('string');

    // ── Extraer texto plano de un fragmento XML ──
    function xt(frag) {
      return (frag.match(/<w:t[^>]*>([^<]*)<\/w:t>/g)||[]).map(t=>t.replace(/<[^>]+>/g,'')).join('');
    }

    // ── 1. Eliminar párrafos de etiquetas (texto rojo "APLICA PARA...") ──
    const LABELS = [
      'APLICA PARA','ESTE PÁRRAFO','PARA EL CASO',
      'LIQUIDACIÓN SIN ANTICIPO','LIQUIDACIÓN CON ANTICIPO',
      'CIFRAS A PAGAR','CANDIDATOS QUE NO PRESENTARON',
      'CANDIDATOS QUE NO','PRESUNTA VULNERACIÓN','CANDIDATOS REVOCADOS',
      'CUANDO EXISTEN','CUANDO EXISTA','RESUNTA VULNERACIÓN',
    ];
    xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, p => {
      const t = xt(p).trim();
      return LABELS.some(l => t.startsWith(l)) ? '' : p;
    });

    // ── 2. Eliminar runs sombreados/resaltados (texto de instrucciones en color) ──
    xml = xml.replace(/<w:r[ >][\s\S]*?<\/w:r>/g, r => {
      if (/<w:highlight/i.test(r)) return '';
      if (/<w:shd[^>]+w:fill="(?!auto|FFFFFF|ffffff)[0-9A-Fa-f]{6}/.test(r)) return '';
      return r;
    });

    // ── 3. Eliminar párrafos exclusivos de coalición si no es coalición ──
    if (!esCoal) {
      const COAL_KEYS = [
        'artículo 13 de la Ley 130','artículo 29 de la Ley 1475',
        'Acuerdo de Coalición','CLÁUSULA:',
        'en virtud de lo anterior, la citada campaña de coalición',
        'Coalición Programática','conformada por el',
        'NO solicitaron NI se les reconoció Anticipo',
        'quienes conformaron la',
      ];
      xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, p =>
        COAL_KEYS.some(k => xt(p).includes(k)) ? '' : p
      );
    }

    // ── 4. Párrafos opcionales según checkboxes ──
    const chk = sfx => (document.getElementById(`cert_${id}_chk_${sfx}`) || {}).checked || false;

    // Procesar tablas PRIMERO (antes de que el filtro de párrafos vacíe su contenido)
    const tblFilter = (keys) =>
      (t) => keys.some(k => xt(t).includes(k)) ? '' : t;

    if (!chk('nopres')) {
      xml = xml.replace(/<w:tbl[ >][\s\S]*?<\/w:tbl>/g,
        tblFilter(['TOTAL  VOTOS  A DESCONTAR']));
    }
    if (!chk('nocorr')) {
      xml = xml.replace(/<w:tbl[ >][\s\S]*?<\/w:tbl>/g,
        tblFilter(['TOTAL  VOTOS  Y GASTOS A DESCONTAR']));
    }

    // Párrafos opcionales
    const OPT_RULES = [
      // Error radicación inicial
      { id: 'radicacion', keys: ['Es importante aclarar, que la organización política generó'] },
      // Renuentes no presentaron
      { id: 'nopres', keys: [
          'NO PRESENTARON EL INFORME DE INGRESOS Y GASTOS',
          'NO PRESENTARON EL INFORME A TRAVÉS DEL',
          'concepto No. 5194',
      ]},
      // Renuentes no debida forma
      { id: 'nocorr', keys: [
          'NO PRESENTARON EN DEBIDA FORMA LOS INFORMES',
          'no presentaron en debida forma su Informe de Campaña',
          'concepto 123 de fecha 12 de febrero',
      ]},
      // Art. 25
      { id: 'art25', keys: [
          'artículo 25 de la Ley 1475 de 2011',
          'no obstante lo anterior, los votos y gastos',
          'CNE-I-202X-XXXX-FNFPCE-900',
      ]},
    ];

    for (const rule of OPT_RULES) {
      if (!chk(rule.id)) {
        xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, p =>
          rule.keys.some(k => xt(p).includes(k)) ? '' : p
        );
      }
    }

    // "Dictamen con abstención" (solo cuando haya renuentes)
    if (!chk('nopres') && !chk('nocorr')) {
      xml = xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, p => {
        const t = xt(p);
        if (t.includes('adjuntó al informe consolidado de Ingresos y Gastos, dictamen de') &&
            t.includes('abstención')) return '';
        if (t.includes('en relación con los candidatos que no presentaron en debida forma')) return '';
        return p;
      });
    }

    // ── 5. Reemplazos de texto (adaptación para Senado/Cámara y datos del candidato) ──
    const reps = [
      ['PARTIDO, MOVIMIENTO O GRUPO SIGNIFICATIVO DE CIUDADANOS', partidoDocx],
      ['ALCALDÍA – CONCEJO',  corp],
      ['la/el',               esSenado ? 'el' : 'la'],
      ['Concejo Municipal',   corpShort],
      ['municipio de SOACHA, departamento de CUNDINAMARCA', `circunscripción ${circTxt}`],
      ['del municipio de SOACHA', `de la ${circTxt}`],
      ['SOACHA',              circTxt],
      ['CUNDINAMARCA',        circTxt],
      ['Elecciones Territoriales celebradas el 29 de octubre de 2023',
       'Elecciones al Congreso de la República del 8 de marzo de 2026'],
      ['29 de octubre de 2023', '8 de marzo de 2026'],
      ['colocar el número de radicación del formulario 9B inicial', radicado || '[RADICADO]'],
      ['29 de diciembre de 2023', fechaPres],
      ['NOMBRE Y APELLIDOS COMPLETOS', audNom],
      ['XXXXXX-T',            audTP],
      ['XX del día de mes de año', `${acta} del ${dia} de ${mes} de ${anio}`],
      ['ANDREA DEL PILAR LOPERA PRADA', jefe],
      ['DOS MIL SETECIENTOS SESENTA Y SEIS PESOS MONEDA CORRIENTE ($2.766)',
       `OCHO MIL OCHOCIENTOS SESENTA Y TRES PESOS ($${CONGRESO2026.VALOR_VOTO.toLocaleString('es-CO')})`],
      ['$2.766',              `$${CONGRESO2026.VALOR_VOTO.toLocaleString('es-CO')}`],
      ['2.766',               String(CONGRESO2026.VALOR_VOTO)],
      ['Resolución No. 0669 del 31 de enero de 2023', CONGRESO2026.textoResolucionTopes()],
      ['Resolución No. 0670 del 31 de enero de 2023', CONGRESO2026.textoResolucionTopes()],
      ['Resolución No. 0672', CONGRESO2026.textoResolucionVoto()],
      ['ÚNICA/PRIMERA',       'PRIMERA'],
    ];
    // Más largo primero para evitar coincidencias parciales
    reps.sort((a,b) => b[0].length - a[0].length);
    for (const [from, to] of reps) xml = xml.split(from).join(to || '');

    // ── 5. Descargar DOCX con el estilo original intacto ──
    zip.file('word/document.xml', xml);
    const blob = await zip.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Certificacion_${(cand.nombre||'').replace(/\s+/g,'_').substring(0,25)}${sufijo}_Congreso2026.docx`;
    a.click();
    URL.revokeObjectURL(a.href);

  } catch(e) {
    alert('Error generando Word: ' + e.message);
  }
}

async function _cngDescargarCertDocx(id) {
  const esCoal = (document.getElementById(`cert_${id}_es_coalicion`) || {}).value === '1';
  await _cngGenerarCertDocxFmt(id, esCoal);
}

// Función legacy - conservada para referencia interna
async function _cngDescargarCertDocxLegacy(id) {
  const cand = _cngGetCand(id);
  const cont = cand.contador || {};
  const g = sfx => (document.getElementById(`cert_${id}_${sfx}`) || {}).value || '';

  const partido      = g('partido')  || cand.org || '';
  const radicado     = g('radicado') || '';
  const fechaPres    = g('fechapres')          || '29 de diciembre de 2023';
  const audNom       = g('audnom')             || cont.nombre   || 'NOMBRE Y APELLIDOS COMPLETOS';
  const audTP        = g('audtp')              || cont.tarjeta  || 'XXXXXX-T';
  const acta         = g('acta')               || 'XX';
  const dia          = g('dia')                || 'día';
  const mes          = g('mes')                || 'mes';
  const anio         = g('anio')               || String(new Date().getFullYear());
  const jefe         = g('jefe')               || 'ANDREA DEL PILAR LOPERA PRADA';
  const corp         = cand.corp               || 'ALCALDÍA – CONCEJO';
  const circ         = cand._circ_nom          || 'COLOMBIA';

  const reemplazos = [
    ['PARTIDO, MOVIMIENTO O GRUPO SIGNIFICATIVO DE CIUDADANOS', partido],
    ['ALCALDÍA – CONCEJO', corp],
    ['municipio de SOACHA, departamento de CUNDINAMARCA', `circunscripción ${circ}`],
    ['SOACHA', circ],
    ['CUNDINAMARCA', circ],
    ['Elecciones Territoriales celebradas el 29 de octubre de 2023', 'Elecciones al Congreso de la República 2026'],
    ['colocar el número de radicación del formulario 9B inicial', radicado || '[RADICADO]'],
    ['29 de diciembre de 2023', fechaPres],
    ['NOMBRE Y APELLIDOS COMPLETOS', audNom],
    ['XXXXXX-T', audTP],
    ['ANDREA DEL PILAR LOPERA PRADA', jefe],
    ['XX del día de mes de año', `${acta} del ${dia} de ${mes} de ${anio}`],
  ];
  const fname = `Certificacion_${(cand.nombre||'').replace(/\s+/g,'_').substring(0,25)}_Congreso2026.docx`;
  await _genDescargarDocx('cert_congreso2026.docx', reemplazos, fname);
}

async function _cngDescargarOficioDocx(id) {
  const cand = _cngGetCand(id);
  const g = sfx => (document.getElementById(`oficio_${id}_${sfx}`) || {}).value || '';
  const partido = g('partido') || cand.org        || 'PARTIDO COLOMBIA RENACIENTE';
  const corp    = cand.corp    || 'CONCEJO';
  const circ    = cand._circ_nom || 'VILLAVICENCIO - META';
  const jefe    = g('jefe')    || 'ANDREA DEL PILAR LOPERA PRADA';

  const reemplazos = [
    ['ELECCIONES TERRITORIALES 2023', 'CONGRESO DE LA REPÚBLICA 2026'],
    ['CONCEJO', corp],
    ['PARTIDO COLOMBIA RENACIENTE', partido],
    ['VILLAVICENCIO - META', circ],
    ['GONZALO RODRIGUEZ', cand.nombre || ''],
    ['ANDREA DEL PILAR LOPERA PRADA', jefe],
  ];
  const fname = `Oficio_${(cand.nombre||'').replace(/\s+/g,'_').substring(0,25)}_Congreso2026.docx`;
  await _genDescargarDocx('oficio_congreso2026.docx', reemplazos, fname);
}

function _cngRenderGeneradores(cand, det) {
  const id = cand.cand_id;
  const cont = cand.contador || {};
  const ing  = det.total_ingresos || cand.total_ingresos || 0;
  const gas  = det.total_gastos   || cand.total_gastos   || 0;

  const certId   = `cert_body_${id}`;
  const oficioId = `oficio_body_${id}`;
  const liqId    = `liq_body_${id}`;

  const certFields = `
    <div class="cng-gen-fields">
      <div class="cng-gen-field">
        <label>¿Es coalición?</label>
        <select id="cert_${id}_es_coalicion" onchange="_onCoalicionChange(${id});_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))">
          <option value="0">No — Partido / Movimiento</option>
          <option value="1">Sí — Coalición</option>
        </select>
      </div>
      <div class="cng-gen-field">
        <label id="cert_${id}_partido_lbl">Partido / Movimiento</label>
        <input id="cert_${id}_partido" value="${(cand.org||'').replace(/"/g,'')}" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))">
      </div>
      <div class="cng-gen-field" id="cert_${id}_coal_wrap1" style="display:none">
        <label>Nombre de la Coalición</label>
        <input id="cert_${id}_coalicion_nombre" placeholder="Ej: PACTO HISTÓRICO" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))">
      </div>
      <div class="cng-gen-field" id="cert_${id}_coal_wrap2" style="display:none">
        <label>Partidos integrantes</label>
        <input id="cert_${id}_coalicion_partidos" placeholder="Partido A, Partido B, Partido C…" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))">
      </div>
      <div class="cng-gen-field"><label>N° Radicado 9B</label><input id="cert_${id}_radicado" placeholder="XXXX" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field"><label>Fecha presentación 9B</label><input id="cert_${id}_fechapres" placeholder="dd/mm/aaaa" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field"><label>Contador(a) — Nombre</label><input id="cert_${id}_audnom" value="${(cont.nombre||'').replace(/"/g,'')}" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field"><label>Tarjeta Profesional</label><input id="cert_${id}_audtp" value="${cont.tarjeta||''}" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field"><label>C.C. Contador(a)</label><input id="cert_${id}_audcc" value="${cont.documento||''}" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field"><label>Acta N° reparto</label><input id="cert_${id}_acta" placeholder="XX" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field"><label>Día</label><input id="cert_${id}_dia" placeholder="dd" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field"><label>Mes</label><input id="cert_${id}_mes" placeholder="enero" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field"><label>Año</label><input id="cert_${id}_anio" value="${new Date().getFullYear()}" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field"><label>Jefe de Oficina</label><input id="cert_${id}_jefe" placeholder="Nombre del jefe" oninput="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))"></div>
      <div class="cng-gen-field" style="grid-column:1/-1;border-top:1px solid rgba(0,212,255,.15);padding-top:8px;margin-top:4px">
        <label style="font-size:.72rem;color:rgba(0,212,255,.65);text-transform:uppercase;letter-spacing:.05em">Párrafos opcionales — marcar los que aplican</label>
      </div>
      <div class="cng-gen-field"><label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="cert_${id}_chk_radicacion"> Error radicación inicial (9B definitivo)</label></div>
      <div class="cng-gen-field"><label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="cert_${id}_chk_nopres"> Renuentes — No presentaron informe</label></div>
      <div class="cng-gen-field"><label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="cert_${id}_chk_nocorr"> Renuentes — No presentaron en debida forma</label></div>
      <div class="cng-gen-field"><label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="cert_${id}_chk_art25"> Presunta vulneración Art. 25</label></div>
    </div>`;

  const oficioFields = `
    <div class="cng-gen-fields">
      <div class="cng-gen-field"><label>Partido / Destinatario</label><input id="oficio_${id}_partido" value="${(cand.org||'').replace(/"/g,'')}"></div>
      <div class="cng-gen-field"><label>Asunto</label><input id="oficio_${id}_asunto" value="REQUERIMIENTO DE INFORMACIÓN"></div>
      <div class="cng-gen-field"><label>Día</label><input id="oficio_${id}_dia" placeholder="dd"></div>
      <div class="cng-gen-field"><label>Mes</label><input id="oficio_${id}_mes" placeholder="enero"></div>
      <div class="cng-gen-field"><label>Año</label><input id="oficio_${id}_anio" value="${new Date().getFullYear()}"></div>
      <div class="cng-gen-field"><label>Plazo de respuesta</label><input id="oficio_${id}_plazo" value="5 días hábiles"></div>
      <div class="cng-gen-field"><label>Jefe de Oficina</label><input id="oficio_${id}_jefe" placeholder="Nombre del jefe"></div>
    </div>
    <div class="cng-gen-field" style="margin-bottom:8px"><label>Observaciones / Solicitud</label>
      <textarea id="oficio_${id}_obs" rows="3" style="width:100%;background:rgba(4,20,40,.9);border:1px solid rgba(0,212,255,.25);color:var(--text);border-radius:4px;padding:6px;font-size:.75rem;resize:vertical" placeholder="Describa las observaciones…"></textarea>
    </div>`;

  const tope = CONGRESO2026.getTope(cand.corp, cand._circ_nom || cand.circ_id, 0);

  const liqTable = `
    <div style="font-size:.68rem;color:rgba(0,212,255,.55);margin-bottom:8px">
      Res. ${CONGRESO2026.RES_VALOR_VOTO} · Valor voto: <strong style="color:var(--accent)">$${CONGRESO2026.VALOR_VOTO.toLocaleString('es-CO')}</strong>
      &nbsp;|&nbsp; Res. ${CONGRESO2026.RES_TOPES} · Tope lista: <strong style="color:var(--accent)">${tope ? '$'+tope.toLocaleString('es-CO') : 'ver resolución'}</strong>
    </div>
    <table class="cng-liq-tabla">
      <tr><td>Total gastos consolidados</td><td><input class="cng-liq-input" id="liq_${id}_gastos" value="${gas.toFixed(0)}" oninput="_cngRecalcLiq(_cngGetCand(${id}),_cngGetDet(${id}))"></td></tr>
      <tr><td>Total votos válidos</td><td><input class="cng-liq-input" id="liq_${id}_votos" value="0" oninput="_cngRecalcLiq(_cngGetCand(${id}),_cngGetDet(${id}))"></td></tr>
      <tr><td>Valor del voto (${CONGRESO2026.textoResolucionVoto()})</td><td><input class="cng-liq-input" id="liq_${id}_valorvoto" value="${CONGRESO2026.VALOR_VOTO}" oninput="_cngRecalcLiq(_cngGetCand(${id}),_cngGetDet(${id}))"></td></tr>
      <tr><td>Reposición por votos</td><td><span id="liq_${id}_rep_votos">$0</span></td></tr>
      <tr><td>Reposición por gastos netos</td><td><span id="liq_${id}_rep_gastos">$0</span></td></tr>
      <tr class="cng-liq-result"><td><strong>VALOR BRUTO A RECONOCER</strong></td><td><span id="liq_${id}_val_bruto">$0</span></td></tr>
      <tr><td>(-) Descuento auditoría 1%</td><td><span id="liq_${id}_desc_aud">$0</span></td></tr>
      <tr><td>(-) Anticipos</td><td><input class="cng-liq-input" id="liq_${id}_anticipos" value="0" oninput="_cngRecalcLiq(_cngGetCand(${id}),_cngGetDet(${id}))"></td></tr>
      <tr class="cng-liq-result"><td><strong>TOTAL NETO A REPONER</strong></td><td><span id="liq_${id}_total_neto">$0</span></td></tr>
    </table>`;

  return `
    <!-- CERTIFICACIÓN -->
    <div class="cng-gen-doc">
      <div class="cng-gen-header" onclick="_genToggle('${certId}')">
        <span class="cng-gen-icon">🏅</span>
        <span class="cng-gen-title">Certificación</span>
        <button class="cng-gen-toggle">▼ Abrir</button>
      </div>
      <div class="cng-gen-body" id="${certId}" data-cand-id="${id}">
        ${certFields}
        <button class="cng-doc-btn-sm" style="margin-bottom:8px" onclick="_cngGenerarCert(_cngGetCand(${id}),_cngGetDet(${id}))">↻ Regenerar</button>
        <div class="cng-gen-texto" id="cert_texto_${id}" contenteditable="true"></div>
        <div class="cng-gen-acciones">
          <button class="cng-doc-btn-sm" onclick="_genCopiar('cert_texto_${id}',this)">📋 Copiar</button>
          <button class="cng-doc-btn-sm" style="color:#4caf50;border-color:#4caf50" onclick="_cngDescargarCertDocx(${id})">📄 Descargar Word</button>
        </div>
      </div>
    </div>

    <!-- OFICIO / REQUERIMIENTO -->
    <div class="cng-gen-doc">
      <div class="cng-gen-header" onclick="_genToggle('${oficioId}')">
        <span class="cng-gen-icon">📨</span>
        <span class="cng-gen-title">Oficio / Requerimiento</span>
        <button class="cng-gen-toggle">▼ Abrir</button>
      </div>
      <div class="cng-gen-body" id="${oficioId}" data-cand-id="${id}">
        ${oficioFields}
        <button class="cng-doc-btn-sm" style="margin-bottom:8px" onclick="_cngGenerarOficio(_cngGetCand(${id}),_cngGetDet(${id}))">↻ Regenerar</button>
        <div class="cng-gen-texto" id="oficio_texto_${id}" contenteditable="true"></div>
        <div class="cng-gen-acciones">
          <button class="cng-doc-btn-sm" onclick="_genCopiar('oficio_texto_${id}',this)">📋 Copiar</button>
          <button class="cng-doc-btn-sm" style="color:#4caf50;border-color:#4caf50" onclick="_cngDescargarOficioDocx(${id})">📄 Descargar Word</button>
        </div>
      </div>
    </div>

    <!-- LIQUIDACIÓN -->
    <div class="cng-gen-doc">
      <div class="cng-gen-header" onclick="_genToggle('${liqId}')">
        <span class="cng-gen-icon">🧾</span>
        <span class="cng-gen-title">Liquidación de Reposición</span>
        <button class="cng-gen-toggle">▼ Abrir</button>
      </div>
      <div class="cng-gen-body" id="${liqId}" data-cand-id="${id}">
        ${liqTable}
        <div class="cng-gen-acciones">
          <button class="cng-doc-btn-sm" style="color:#4caf50;border-color:#4caf50" onclick="_genDescargarLiqXlsx(${id})">📊 Descargar Excel</button>
        </div>
      </div>
    </div>`;
}

// Cache de cand y det para callbacks de generadores
const _cngDetCache  = {};
const _cngCandCache = {};
function _cngGetCand(id) { return _cngCandCache[id] || {}; }
function _cngGetDet(id)  { return _cngDetCache[id]  || {}; }

// ── Gestión tab ───────────────────────────────────────────────────────────────
function _cngRenderGestion(det, cand) {
  const contDoc = (cand.contador || {}).documento || '';
  const gerDoc  = (cand.gerente  || {}).documento || '';
  const todos   = [...(det.ingresos || []), ...(det.gastos || [])];

  const sopCont = todos.filter(r => r.archivo && r.nit_cedula === contDoc);
  const sopGer  = todos.filter(r => r.archivo && r.nit_cedula === gerDoc);

  function _sopRow(r) {
    const enc = encodeURIComponent(r.archivo);
    return `<div class="cng-sop-row">
      <span class="cng-sop-desc">${_trunc(r.nom_formato || r.nom_ingreso || 'Soporte', 38)}</span>
      <span class="${r.total >= 0 ? 'monto-pos' : 'monto-neg'}" style="font-size:.7rem;flex-shrink:0">${_fmtTot(r.total)}</span>
      <button class="cng-doc-btn-sm" onclick="cne2026AbrirArchivo('${enc}')">↗</button>
      <button class="cng-doc-btn-sm" onclick="cngMostrarEnVisor('${enc}')">👁</button>
    </div>`;
  }

  function _sinSop() {
    return '<p style="font-size:.71rem;color:rgba(224,244,255,.28);margin:5px 0 0">Sin soportes en las transacciones cargadas</p>';
  }

  document.getElementById('cngGestionContent').innerHTML = `
    <div class="cng-gest-section">◈ Contador Electoral</div>
    <div class="cng-gest-card">
      <div class="cng-gest-nom">${(cand.contador || {}).nombre || '—'}</div>
      <div class="cng-gest-meta">Doc: ${contDoc || '—'} &nbsp;·&nbsp; Tarjeta: ${(cand.contador || {}).tarjeta || '—'}</div>
      ${sopCont.length ? `<div class="cng-sop-list">${sopCont.map(_sopRow).join('')}</div>` : _sinSop()}
    </div>

    <div class="cng-gest-section">◈ Gerente de Campaña</div>
    <div class="cng-gest-card">
      <div class="cng-gest-nom">${(cand.gerente || {}).nombre || '—'}</div>
      <div class="cng-gest-meta">Doc: ${gerDoc || '—'} &nbsp;·&nbsp; Banco: ${(cand.gerente || {}).banco || '—'}</div>
      ${sopGer.length ? `<div class="cng-sop-list">${sopGer.map(_sopRow).join('')}</div>` : _sinSop()}
    </div>

    <div class="cng-gest-section">◈ Dictamen de Auditoría</div>
    <div id="cngGestionDictamen">
      <button class="cng-doc-btn-sm" style="margin:4px 0" onclick="_cngCargarDictamen(${cand.cand_id})">Cargar desde CNE</button>
    </div>`;
}

async function _cngCargarDictamen(candId) {
  if (!_cne2026Logueado) { cne2026AbrirLogin(); return; }
  const el = document.getElementById('cngGestionDictamen');
  el.innerHTML = '<p class="cng-tab-msg" style="font-size:.74rem">Consultando CNE…</p>';
  try {
    const r = await fetch(`${_PROXY2026}/api/cne/dictament-de-auditoria?idcandidato=${candId}&idproceso=1`);
    const d = await r.json();
    const items = Array.isArray(d) ? d : (d.data || d.dictamen || []);
    if (!items.length) {
      el.innerHTML = '<p style="font-size:.71rem;color:rgba(224,244,255,.28);margin:4px 0">Sin dictamen registrado para este candidato.</p>';
      return;
    }
    el.innerHTML = items.map(it => {
      const archivo = it.archivo || it.ruta_archivo || '';
      const enc = archivo ? encodeURIComponent(archivo) : '';
      return `<div class="cng-gest-card">
        <div class="cng-gest-nom">${it.nombreAuditor || it.auditor || it.nombre || '—'}</div>
        <div class="cng-gest-meta">${it.fecha || ''} ${it.estado || ''} ${it.resultado || ''}</div>
        ${enc ? `<div style="margin-top:6px;display:flex;gap:5px">
          <button class="cng-doc-btn-sm" onclick="cne2026AbrirArchivo('${enc}')">↗ Abrir PDF</button>
          <button class="cng-doc-btn-sm" onclick="cngMostrarEnVisor('${enc}')">👁 Visor</button>
        </div>` : ''}
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = `<p style="font-size:.72rem;color:#ef9a50;margin:4px 0">Error: ${e.message || String(e)}</p>`;
  }
}

// ── Detalle ───────────────────────────────────────────────────────────────────
async function cngAbrirDetalle(candId) {
  const c = _cngLista.find(x => x.cand_id === candId) || _cngAllCands[candId];
  if (!c) return;

  document.getElementById('cngModalTitulo').textContent = c.nombre;
  document.getElementById('cngMOrg').textContent   = c.org;
  document.getElementById('cngMCorp').textContent  = c.corp;
  document.getElementById('cngMCirc').textContent  = c._circ_nom;
  document.getElementById('cngMTotIng').textContent = _fmt(c.total_ingresos);
  document.getElementById('cngMNumIng').textContent = (c.num_ingresos||0) + ' registros';
  document.getElementById('cngMTotGas').textContent = _fmt(c.total_gastos);
  document.getElementById('cngMNumGas').textContent = (c.num_gastos||0) + ' registros';

  // ── Censo y tope (solo Cámara Territorial) ──
  const esCamaraT = (c.corp||'').includes('CAMARA') && c._circ_nom &&
    !['INTERN','AFRO','INDIGEN','SAN AND'].some(k => (c._circ_nom||'').toUpperCase().includes(k));
  const censoCaja = document.getElementById('cngMCensoCaja');
  if (censoCaja) {
    if (esCamaraT) {
      const censo = CONGRESO2026.getCensoDpto(c._circ_nom);
      const tope  = CONGRESO2026.getTope(c.corp, c._circ_nom, censo);
      const camp  = Math.round(tope * CONGRESO2026.PCT_CAMP_INSTITUCIONAL);
      document.getElementById('cngMCenso').textContent    = censo ? censo.toLocaleString('es-CO') + ' electores' : '—';
      document.getElementById('cngMTope').textContent     = tope  ? '$' + tope.toLocaleString('es-CO') : '—';
      document.getElementById('cngMTopeCamp').textContent = camp  ? '$' + camp.toLocaleString('es-CO') : '—';
      censoCaja.style.display = '';
    } else {
      censoCaja.style.display = 'none';
    }
  }

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

  document.getElementById('cngTabBtnIngresos').textContent = `↓ Ingresos (${c.num_ingresos||0})`;
  document.getElementById('cng-tabBtnGastos').textContent  = `↑ Gastos (${c.num_gastos||0})`;

  _cngCurrentCandId = candId;
  _cngCandCache[candId] = c;
  cngActivarTab('consolidado');
  document.getElementById('cngIngContent').innerHTML     = '<p class="cng-tab-msg">Cargando…</p>';
  document.getElementById('cngGasContent').innerHTML     = '<p class="cng-tab-msg">Cargando…</p>';
  document.getElementById('cngAniContent').innerHTML     = '<p class="cng-tab-msg">Cargando…</p>';
  document.getElementById('cngDocsContent').innerHTML    = '<p class="cng-tab-msg">Cargando…</p>';
  document.getElementById('cngGestionContent').innerHTML = '<p class="cng-tab-msg">Cargando…</p>';
  document.getElementById('cngVisorEmpty').style.display  = 'block';
  document.getElementById('cngVisorWrap').style.display   = 'none';
  document.getElementById('cngVisorFrame').src            = '';
  const _rnecReset = document.getElementById('cngRnecContent');
  if (_rnecReset) _rnecReset.innerHTML = '';
  document.getElementById('cngModalOverlay').classList.add('open');
  _cne2026CheckLogin();
  // Cargar E6/E7/E8 en el Visor (no depende del servidor Render)
  _loadRnecForCand(c, 'cngRnecContent').catch(() => {});

  // Si el servidor nunca se ha despertado en esta sesión, hacer ping primero
  if (!_cngServidorDespierto) {
    const msgEsp = '<p class="cng-tab-msg" style="color:rgba(252,209,22,.6)">⏳ Conectando con servidor de datos… (puede tardar hasta 60 s la primera vez)</p>';
    document.getElementById('cngIngContent').innerHTML     = msgEsp;
    document.getElementById('cngGasContent').innerHTML     = msgEsp;
    document.getElementById('cngGestionContent').innerHTML = msgEsp;
    await _cne2026Ping();
    _cngServidorDespierto = true;
  }

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 65000);
    const r    = await fetch(`${_CAND_BASE}/${candId}.json`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const det = await r.json();
    _cngDetCache[candId] = det;
    _cngRenderIngresos(det.ingresos || []);
    _cngRenderGastos(det.gastos    || []);
    _cngRenderANI(det.ani || c.ani || {}, det.cedula || (c.ani && c.ani.cedula) || '');
    _cngRenderDocs(c, det);
    _cngRenderGestion(det, c);
  } catch(e) {
    const msg = e && e.name === 'AbortError'
      ? '<p class="cng-tab-msg" style="color:#ef9a50">El servidor tardó demasiado. Cierra y vuelve a abrir el candidato.</p>'
      : '<p class="cng-tab-msg" style="color:#ef9a50">Portal de datos no disponible en este momento</p>';
    document.getElementById('cngIngContent').innerHTML     = msg;
    document.getElementById('cngGasContent').innerHTML     = msg;
    document.getElementById('cngGestionContent').innerHTML = msg;
    _cngRenderANI(c.ani || {}, '');
    _cngRenderDocs(c, {});
  }
}

let _cngServidorDespierto = false;

let _cngCurrentCandId = null;

function _cngTxRows(rows, esGasto) {
  return rows.map(r => {
    const archivo = r.archivo;
    const pdfBtn = archivo
      ? `<button class="cng-tx-pdf" onclick="cne2026AbrirArchivo('${encodeURIComponent(archivo)}')" title="Ver soporte · ${r.nombre_persona || 'candidato'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></button>`
      : '';
    return `
    <div class="cng-tx-row">
      <span class="cng-tx-code">${r.codigo||'—'}</span>
      <div class="cng-tx-desc">
        ${r.nom_formato || r.nom_ingreso || '—'}
        <small>${r.nombre_persona ? r.nombre_persona + (r.nit_cedula ? ' · ' + r.nit_cedula : '') : ''}${r.fecha_registro_movimiento ? ' · ' + _fmtDate(r.fecha_registro_movimiento) : ''}</small>
      </div>
      <span class="cng-tx-monto ${esGasto ? 'monto-neg' : 'monto-pos'}">${_fmtTot(r.total)}</span>
      ${pdfBtn}
    </div>`;
  }).join('');
}

function _cngRenderIngresos(rows) {
  document.getElementById('cngIngContent').innerHTML = rows.length
    ? `<div class="cng-tx-list">${_cngTxRows(rows, false)}</div>`
    : '<p class="cng-tab-msg">Sin registros de ingresos</p>';
}

function _cngRenderGastos(rows) {
  document.getElementById('cngGasContent').innerHTML = rows.length
    ? `<div class="cng-tx-list">${_cngTxRows(rows, true)}</div>`
    : '<p class="cng-tab-msg">Sin registros de gastos</p>';
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
