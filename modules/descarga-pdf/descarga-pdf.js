/**
 * modules/descarga-pdf/descarga-pdf.js
 * Documentos PDF por organización + Descarga automática desde CNE
 */

import { db, storage } from '/firebase-config.js';
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject, listAll
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
Auth.requireRole(['administrador', 'contador', 'administrativo', 'coordinador']);
renderSidebar('descarga-pdf');

const ROL    = Auth.getRole()     || 'contador';
const NOMBRE = Auth.getContador() || '';
const ES_CONTADOR = ROL === 'contador';

// ── Config servidor ───────────────────────────────────────────────────────────
// URL del servidor de descarga. Puede ser:
//   - Render:    'https://cne-servidor-descarga.onrender.com'
//   - Local:     'http://localhost:5050'
const SERVIDOR_DEFAULT = 'https://fnfpce-plataforma.onrender.com';
let SERVIDOR   = localStorage.getItem('cne_servidor_url') || SERVIDOR_DEFAULT;
let servidorOK = false;
let jobActivo  = null;   // job_id del proceso en curso

// ── Partículas ────────────────────────────────────────────────────────────────
(function () {
  const c = document.getElementById('particles');
  if (!c) return;
  for (let i = 0; i < 18; i++) {
    const part = document.createElement('div');
    part.className = 'particle';
    part.style.left              = Math.random() * 100 + 'vw';
    part.style.animationDuration = (8 + Math.random() * 14) + 's';
    part.style.animationDelay    = (Math.random() * 12) + 's';
    part.style.width = part.style.height = (Math.random() > 0.5 ? '2px' : '1px');
    part.style.opacity = String(Math.random() * 0.35);
    c.appendChild(part);
  }
})();

// ── Estado ────────────────────────────────────────────────────────────────────
let grupos       = [];
let grupoActivo  = null;
let pdfCounts    = {};

// ── Tabs principales ──────────────────────────────────────────────────────────
window.switchTab = function(tab) {
  document.getElementById('panel-docs').style.display = tab === 'docs' ? '' : 'none';
  document.getElementById('panel-cne').style.display  = tab === 'cne'  ? '' : 'none';
  document.getElementById('tab-docs').classList.toggle('active', tab === 'docs');
  document.getElementById('tab-cne').classList.toggle('active',  tab === 'cne');
  if (tab === 'cne') verificarServidor();
};

// ── Tabs secundarios (panel CNE) ──────────────────────────────────────────────
window.switchSubtab = function(sub) {
  ['fnfp','pub','res'].forEach(s => {
    document.getElementById(`subpanel-${s}`).style.display = s === sub ? '' : 'none';
    document.getElementById(`subtab-${s}`).classList.toggle('active', s === sub);
  });
};

// ── Verificar servidor ────────────────────────────────────────────────────────
window.verificarServidor = async function() {
  const dot  = document.getElementById('server-dot');
  const txt  = document.getElementById('server-txt');
  const note = document.getElementById('server-note');
  dot.className  = 'dp-server-dot dp-server-dot--wait';
  txt.textContent = 'Verificando…';
  try {
    const res = await fetch(`${SERVIDOR}/api/ping`, { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    servidorOK = true;
    dot.className   = 'dp-server-dot dp-server-dot--ok';
    txt.textContent  = `Conectado — Firebase: ${data.firebase ? 'OK' : 'No disponible'}`;
    note.style.display = 'none';
  } catch {
    servidorOK = false;
    dot.className   = 'dp-server-dot dp-server-dot--err';
    txt.textContent  = 'Sin conexión';
    note.style.display = '';
    note.innerHTML = `
      El servidor local no está activo. Para iniciarlo:<br>
      <code>cd "C:\\Users\\carlos.santos\\Desktop\\APLICATIVO\\cuentas claras"</code><br>
      <code>python servidor_descarga.py</code>
    `;
  }
};

// ── Toggle contraseña ─────────────────────────────────────────────────────────
window.togglePw = function(id, btn) {
  const inp = document.getElementById(id);
  if (inp.type === 'password') { inp.type = 'text';     btn.textContent = '🙈'; }
  else                         { inp.type = 'password'; btn.textContent = '👁'; }
};

// ── Consola helpers ───────────────────────────────────────────────────────────
function mostrarConsola() {
  document.getElementById('card-consola').style.display = '';
}

function consolaLog(msg) {
  const el = document.getElementById('dp-consola');
  const linea = document.createElement('div');
  linea.className = 'dp-consola-linea';
  // Colorear líneas según contenido
  if (msg.includes('[ERROR]') || msg.includes('[FATAL]'))  linea.classList.add('err');
  else if (msg.includes('[OK]') || msg.includes('COMPLETADO')) linea.classList.add('ok');
  else if (msg.includes('[STORAGE]') || msg.includes('[FIREBASE]')) linea.classList.add('info');
  else if (msg.includes('==='))                            linea.classList.add('sep');
  linea.textContent = msg;
  el.appendChild(linea);
  el.scrollTop = el.scrollHeight;
}

window.limpiarConsola = function() {
  document.getElementById('dp-consola').innerHTML = '';
  document.getElementById('card-consola').style.display = 'none';
  document.getElementById('card-resultados').style.display = 'none';
};

function setConsolaStatus(txt, tipo) {
  const el = document.getElementById('consola-status');
  el.textContent = txt;
  el.className = 'dp-consola-status dp-consola-status--' + tipo;
}

function mostrarProgreso(activo) {
  document.getElementById('dp-progreso-bar').style.display = activo ? '' : 'none';
}

function setJobId(panelId, jobId) {
  const el = document.getElementById(`job-id-${panelId}`);
  if (el) el.textContent = jobId ? `Job: ${jobId}` : '';
}

// ── Escuchar logs via SSE ─────────────────────────────────────────────────────
function escucharLogs(jobId, onFin) {
  const src = new EventSource(`${SERVIDOR}/api/logs/${jobId}`);
  src.onmessage = e => {
    if (e.data === '__FIN__') {
      src.close();
      mostrarProgreso(false);
      onFin && onFin();
      return;
    }
    consolaLog(e.data);
  };
  src.onerror = () => {
    src.close();
    setConsolaStatus('Conexión SSE perdida', 'err');
    mostrarProgreso(false);
    onFin && onFin();
  };
}

// ── Mostrar resultados ────────────────────────────────────────────────────────
async function mostrarResultados(jobId) {
  try {
    const res = await fetch(`${SERVIDOR}/api/estado/${jobId}`);
    const data = await res.json();

    const pdfs = data.pdfs || [];
    const cardRes = document.getElementById('card-resultados');
    const divRes  = document.getElementById('dp-resultados');

    if (!pdfs.length) {
      divRes.innerHTML = '<p class="dp-help-text">No se subieron archivos a Firebase Storage (verifique la carpeta de descargas).</p>';
    } else {
      divRes.innerHTML = `
        <p class="dp-help-text" style="color:#00ff88;">${pdfs.length} archivo(s) subidos correctamente.</p>
        <div class="dp-resultados-lista">
          ${pdfs.map(f => `
            <div class="dp-resultado-item">
              <span class="dp-pdf-icon">📄</span>
              <span class="dp-pdf-name">${esc(f.nombre)}</span>
              <a href="${f.url}" target="_blank" class="dp-pdf-btn-dl">↗ Abrir</a>
            </div>
          `).join('')}
        </div>`;
    }
    cardRes.style.display = '';
  } catch (e) {
    consolaLog(`[ERROR] No se pudo obtener resultados: ${e.message}`);
  }
}

// ── Botones de acción (enable/disable) ───────────────────────────────────────
function setBotonesDescarga(panel, activo) {
  const btnMap = { fnfp: 'btn-descargar-fnfp', pub: 'btn-descargar-pub', res: 'btn-descargar-res' };
  const btnDet = document.getElementById('btn-detener-fnfp');
  Object.values(btnMap).forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = activo;
  });
  if (btnDet) btnDet.style.display = (activo && panel === 'fnfp') ? '' : 'none';
}

// ── Iniciar descarga FNFP ─────────────────────────────────────────────────────
window.iniciarDescargaFNFP = async function() {
  if (!servidorOK) {
    alert('El servidor local no está activo. Inícialo primero con: python servidor_descarga.py');
    return;
  }

  const usuario = document.getElementById('f-usuario').value.trim();
  const pw      = document.getElementById('f-password').value.trim();
  const proceso = document.getElementById('f-proceso').value;
  const corp    = document.getElementById('f-corp').value;
  const circ    = document.getElementById('f-circ').value;
  const depto   = document.getElementById('f-depto').value.trim();
  const muni    = document.getElementById('f-muni').value.trim();
  const tipoOrg = document.getElementById('f-tipo-org').value;
  const org     = document.getElementById('f-org').value.trim();
  const headless = document.getElementById('f-headless').checked;

  if (!usuario || !pw)   { alert('Ingresa usuario y contraseña CNE.'); return; }
  if (!depto || !org)    { alert('Ingresa departamento y agrupación política.'); return; }

  const checks = document.querySelectorAll('#subpanel-fnfp .dp-modulos-grid input[type=checkbox]:checked');
  const modulos = [...checks].map(c => c.value);
  if (!modulos.length) { alert('Selecciona al menos un módulo.'); return; }

  limpiarConsola();
  mostrarConsola();
  mostrarProgreso(true);
  setConsolaStatus('Ejecutando…', 'run');
  setBotonesDescarga('fnfp', true);

  try {
    const res = await fetch(`${SERVIDOR}/api/descargar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_cne:       usuario,
        password_cne:      pw,
        proceso_electoral: proceso,
        corporacion:       corp,
        circunscripcion:   circ,
        departamento:      depto,
        municipio:         muni,
        tipo_organizacion: tipoOrg,
        organizacion:      org,
        modulos:           modulos,
        headless:          headless,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      consolaLog(`[ERROR] ${err.error}`);
      setConsolaStatus('Error', 'err');
      setBotonesDescarga('fnfp', false);
      return;
    }

    const data = await res.json();
    jobActivo = data.job_id;
    setJobId('fnfp', jobActivo);
    consolaLog(`[SISTEMA] Trabajo iniciado: ${jobActivo}`);
    consolaLog(`[SISTEMA] StorageKey: ${data.storage_key}`);

    escucharLogs(jobActivo, async () => {
      const estado = await fetch(`${SERVIDOR}/api/estado/${jobActivo}`).then(r => r.json());
      if (estado.status === 'done') {
        setConsolaStatus('Completado', 'ok');
        consolaLog('[SISTEMA] ✔ Proceso finalizado correctamente.');
        await mostrarResultados(jobActivo);
      } else {
        setConsolaStatus('Finalizado con errores', 'err');
      }
      setBotonesDescarga('fnfp', false);
      jobActivo = null;
    });

  } catch (e) {
    consolaLog(`[ERROR] ${e.message}`);
    setConsolaStatus('Error de conexión', 'err');
    setBotonesDescarga('fnfp', false);
  }
};

// ── Detener job ───────────────────────────────────────────────────────────────
window.detenerJob = function() {
  // No hay endpoint stop en el servidor (los scrapers Selenium corren en segundo plano)
  // Solo ocultamos el botón e informamos al usuario
  consolaLog('[SISTEMA] Nota: el proceso de scraping continuará en segundo plano.');
  consolaLog('[SISTEMA] Para detenerlo cierra el servidor_descarga.py en la terminal.');
  document.getElementById('btn-detener-fnfp').style.display = 'none';
};

// ── Iniciar descarga pública (ficha candidato) ────────────────────────────────
window.iniciarDescargaPublica = async function() {
  if (!servidorOK) {
    alert('El servidor local no está activo.');
    return;
  }

  const idsRaw = document.getElementById('pub-ids').value.trim();
  if (!idsRaw) { alert('Ingresa al menos un ID de candidato.'); return; }

  const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const corp  = document.getElementById('pub-corp').value.trim() || 'PUBLICO';
  const depto = document.getElementById('pub-depto').value.trim();
  const muni  = document.getElementById('pub-muni').value.trim();
  const org   = document.getElementById('pub-org').value.trim() || 'CANDIDATOS';
  const headless = document.getElementById('pub-headless').checked;

  limpiarConsola();
  mostrarConsola();
  mostrarProgreso(true);
  setConsolaStatus('Ejecutando…', 'run');
  setBotonesDescarga('pub', true);

  try {
    const res = await fetch(`${SERVIDOR}/api/descargar_publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo:          'candidato_publico',
        ids_candidato: ids,
        corporacion:   corp,
        departamento:  depto,
        municipio:     muni,
        organizacion:  org,
        headless,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      consolaLog(`[ERROR] ${err.error}`);
      setConsolaStatus('Error', 'err');
      setBotonesDescarga('pub', false);
      return;
    }

    const data = await res.json();
    jobActivo = data.job_id;
    setJobId('pub', jobActivo);
    consolaLog(`[SISTEMA] Trabajo iniciado: ${jobActivo}`);

    escucharLogs(jobActivo, async () => {
      const estado = await fetch(`${SERVIDOR}/api/estado/${jobActivo}`).then(r => r.json());
      setConsolaStatus(estado.status === 'done' ? 'Completado' : 'Con errores',
                       estado.status === 'done' ? 'ok' : 'err');
      await mostrarResultados(jobActivo);
      setBotonesDescarga('pub', false);
      jobActivo = null;
    });

  } catch (e) {
    consolaLog(`[ERROR] ${e.message}`);
    setConsolaStatus('Error de conexión', 'err');
    setBotonesDescarga('pub', false);
  }
};

// ── Iniciar descarga resoluciones ─────────────────────────────────────────────
window.iniciarDescargaResoluciones = async function() {
  if (!servidorOK) {
    alert('El servidor local no está activo.');
    return;
  }

  const url    = document.getElementById('res-url').value.trim();
  const nombre = document.getElementById('res-nombre').value.trim() || 'RESOLUCIONES_CNE';
  const headless = document.getElementById('res-headless').checked;

  if (!url) { alert('Ingresa la URL de resoluciones.'); return; }

  limpiarConsola();
  mostrarConsola();
  mostrarProgreso(true);
  setConsolaStatus('Ejecutando…', 'run');
  setBotonesDescarga('res', true);

  try {
    const res = await fetch(`${SERVIDOR}/api/descargar_publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo:              'resoluciones',
        url_resoluciones:  url,
        organizacion:      nombre,
        headless,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      consolaLog(`[ERROR] ${err.error}`);
      setConsolaStatus('Error', 'err');
      setBotonesDescarga('res', false);
      return;
    }

    const data = await res.json();
    jobActivo = data.job_id;
    setJobId('res', jobActivo);
    consolaLog(`[SISTEMA] Trabajo iniciado: ${jobActivo}`);

    escucharLogs(jobActivo, async () => {
      const estado = await fetch(`${SERVIDOR}/api/estado/${jobActivo}`).then(r => r.json());
      setConsolaStatus(estado.status === 'done' ? 'Completado' : 'Con errores',
                       estado.status === 'done' ? 'ok' : 'err');
      await mostrarResultados(jobActivo);
      setBotonesDescarga('res', false);
      jobActivo = null;
    });

  } catch (e) {
    consolaLog(`[ERROR] ${e.message}`);
    setConsolaStatus('Error de conexión', 'err');
    setBotonesDescarga('res', false);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Documentos por organización
// ══════════════════════════════════════════════════════════════════════════════

async function cargar() {
  try {
    const snap = await getDocs(collection(db, 'reparto'));
    let docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    if (ES_CONTADOR) {
      docs = docs.filter(d =>
        (d.nombreContador || '').trim().toLowerCase() === NOMBRE.trim().toLowerCase()
      );
    }

    grupos = agrupar(docs);
    poblarFiltros();
    renderGrilla();
    document.getElementById('card-resumen').style.display = '';

    await preCargarConteos();
    renderGrilla();
    renderStats();

  } catch (err) {
    document.getElementById('dp-grid').innerHTML =
      `<div class="dp-loading">Error al cargar: ${err.message}</div>`;
  }
}

async function preCargarConteos() {
  const LOTE = 20;
  for (let i = 0; i < grupos.length; i += LOTE) {
    const lote = grupos.slice(i, i + LOTE);
    await Promise.all(lote.map(async g => {
      try {
        const carpeta = ref(storage, `pdfs/${g.storageKey}`);
        const lista   = await listAll(carpeta);
        pdfCounts[g.key] = lista.items.length;
      } catch {
        pdfCounts[g.key] = 0;
      }
    }));
  }
}

function agrupar(docs) {
  const mapa = {};
  docs.forEach(d => {
    const key = [
      (d.corporacion    || '').trim().toUpperCase(),
      (d.departamento   || '').trim().toUpperCase(),
      (d.municipio      || '').trim().toUpperCase(),
      (d.agrupacion     || '').trim().toUpperCase(),
    ].join('||');

    if (!mapa[key]) {
      const agrup = (d.agrupacion  || '').trim();
      const depto = (d.departamento || '').trim();
      const muni  = (d.municipio   || '').trim();
      const corp  = (d.corporacion || '').trim();

      const storageKey = `${corp}_${depto}_${muni}_${agrup}`
        .replace(/[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 120);

      mapa[key] = {
        key, storageKey,
        corporacion: corp, departamento: depto,
        municipio: muni, agrupacion: agrup,
        expedientes: [],
      };
    }
    mapa[key].expedientes.push(d);
  });

  return Object.values(mapa).sort((a, b) =>
    a.agrupacion.localeCompare(b.agrupacion, 'es')
  );
}

function poblarFiltros() {
  const sel = document.getElementById('filtro-corporacion');
  const corps = [...new Set(grupos.map(g => g.corporacion).filter(Boolean))].sort();
  corps.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
}

function filtrarGrupos() {
  const corp  = document.getElementById('filtro-corporacion').value;
  const texto = document.getElementById('buscar-org').value.trim().toLowerCase();
  return grupos.filter(g => {
    if (corp && g.corporacion !== corp) return false;
    if (texto && !g.agrupacion.toLowerCase().includes(texto) &&
                 !g.municipio.toLowerCase().includes(texto) &&
                 !g.departamento.toLowerCase().includes(texto)) return false;
    return true;
  });
}

document.getElementById('filtro-corporacion').addEventListener('change', renderGrilla);
document.getElementById('buscar-org').addEventListener('input', renderGrilla);

function renderGrilla() {
  const lista = filtrarGrupos();
  const grid  = document.getElementById('dp-grid');

  if (!lista.length) {
    grid.innerHTML = '<div class="dp-loading">No hay organizaciones que coincidan.</div>';
    return;
  }

  grid.innerHTML = lista.map(g => {
    const count    = pdfCounts[g.key] || 0;
    const tienePdf = count > 0;
    const keyEnc   = encodeURIComponent(g.key);

    const idCNE = g.expedientes.find(e => e.consecutivoAplicativo)?.consecutivoAplicativo || '';
    const urlCNE = idCNE
      ? `https://app.cne.gov.co/usuarios/public/candidato/${idCNE}`
      : `https://app.cnecuentasclaras.gov.co`;

    return `
      <div class="dp-card ${tienePdf ? 'tiene-pdfs' : ''}" id="dp-card-${keyEnc}">
        <div class="dp-card-header">
          <div class="dp-org-name">${esc(g.agrupacion) || '—'}</div>
          <span class="dp-pdf-badge ${tienePdf ? 'con-pdf' : 'vacio'}">
            ${tienePdf ? `✓ ${count} PDF${count !== 1 ? 's' : ''}` : 'Sin PDFs'}
          </span>
        </div>
        <div class="dp-datos">
          <div class="dp-dato-row">
            <span class="dp-dato-key">Corporación</span>
            <span class="dp-dato-val">${esc(g.corporacion) || '—'}</span>
          </div>
          <div class="dp-dato-row">
            <span class="dp-dato-key">Departamento</span>
            <span class="dp-dato-val">${esc(g.departamento) || '—'}</span>
          </div>
          <div class="dp-dato-row">
            <span class="dp-dato-key">Municipio</span>
            <span class="dp-dato-val">${esc(g.municipio) || '—'}</span>
          </div>
          <div class="dp-dato-row">
            <span class="dp-dato-key">Expedientes</span>
            <span class="dp-dato-val">${g.expedientes.length}</span>
          </div>
        </div>
        <div class="dp-card-acciones">
          <button class="dp-btn-abrir" onclick="abrirModal('${keyEnc}')">
            ${ES_CONTADOR ? '↓ Ver PDFs' : '◧ Ver / Subir PDFs'}
          </button>
          <a class="dp-btn-cne" href="${urlCNE}" target="_blank" title="Abrir en portal CNE">
            ⬡ CNE
          </a>
        </div>
      </div>
    `;
  }).join('');
}

function renderStats() {
  const total     = grupos.length;
  const conPdfs   = grupos.filter(g => (pdfCounts[g.key] || 0) > 0).length;
  const sinPdfs   = total - conPdfs;
  const totalPdfs = Object.values(pdfCounts).reduce((s, n) => s + n, 0);
  const pct       = total ? Math.round(conPdfs / total * 100) : 0;

  document.getElementById('dp-stats').innerHTML = `
    <div class="dp-stat">
      <span class="dp-stat-val">${total}</span>
      <span class="dp-stat-lbl">Organizaciones</span>
    </div>
    <div class="dp-stat">
      <span class="dp-stat-val ok">${conPdfs}</span>
      <span class="dp-stat-lbl">Con PDFs</span>
    </div>
    <div class="dp-stat">
      <span class="dp-stat-val warn">${sinPdfs}</span>
      <span class="dp-stat-lbl">Sin PDFs</span>
    </div>
    <div class="dp-stat">
      <span class="dp-stat-val">${totalPdfs}</span>
      <span class="dp-stat-lbl">Total PDFs</span>
    </div>
    <div class="dp-stat dp-progress-bar">
      <div class="dp-bar-track">
        <div class="dp-bar-fill" style="width:${pct}%"></div>
      </div>
      <span class="dp-bar-pct">${pct}%</span>
    </div>
  `;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
window.abrirModal = function(keyEnc) {
  const key = decodeURIComponent(keyEnc);
  grupoActivo = grupos.find(g => g.key === key);
  if (!grupoActivo) return;

  document.getElementById('modal-pdf-title').textContent = '// ' + grupoActivo.agrupacion;
  document.getElementById('modal-pdf-org').textContent =
    `${grupoActivo.corporacion} · ${grupoActivo.departamento} · ${grupoActivo.municipio}`;

  document.getElementById('upload-area').style.display = ES_CONTADOR ? 'none' : '';
  document.getElementById('modal-pdf').style.display = 'flex';
  cargarListaPDFs();
};

window.cerrarModal = function() {
  document.getElementById('modal-pdf').style.display = 'none';
  grupoActivo = null;
};

async function cargarListaPDFs() {
  const listEl  = document.getElementById('pdf-list');
  const countEl = document.getElementById('pdf-count');
  listEl.innerHTML = '<div class="dp-loading" style="font-size:12px;">Cargando archivos…</div>';

  try {
    const carpeta = ref(storage, `pdfs/${grupoActivo.storageKey}`);
    const lista   = await listAll(carpeta);

    countEl.textContent = lista.items.length
      ? `${lista.items.length} archivo${lista.items.length !== 1 ? 's' : ''}`
      : '';

    if (!lista.items.length) {
      listEl.innerHTML = '<div class="dp-pdf-empty">No hay PDFs subidos aún.</div>';
      return;
    }

    const archivos = await Promise.all(
      lista.items.map(async item => ({
        ref:  item,
        name: item.name,
        url:  await getDownloadURL(item),
      }))
    );
    archivos.sort((a, b) => a.name.localeCompare(b.name));

    listEl.innerHTML = archivos.map((f, i) => `
      <div class="dp-pdf-item" id="pdf-item-${i}">
        <span class="dp-pdf-icon">📄</span>
        <span class="dp-pdf-name" title="${esc(f.name)}">${esc(f.name)}</span>
        <a href="${f.url}" target="_blank" download="${esc(f.name)}" class="dp-pdf-btn-dl">
          ↓ Descargar
        </a>
        ${ROL === 'administrador' ? `
          <button class="dp-pdf-btn-del" onclick="eliminarPDF('${encodeURIComponent(f.name)}')"
                  title="Eliminar">✕</button>
        ` : ''}
      </div>
    `).join('');

  } catch (err) {
    listEl.innerHTML = `<div class="dp-pdf-empty">Error: ${esc(err.message)}</div>`;
  }
}

// ── Subir PDFs ────────────────────────────────────────────────────────────────
document.getElementById('file-input').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !grupoActivo) return;
  await subirArchivos(files);
});

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('click', () => document.getElementById('file-input').click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
  const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
  if (!files.length) return;
  await subirArchivos(files);
});

async function subirArchivos(files) {
  const progressEl = document.getElementById('upload-progress');
  progressEl.style.display = '';
  progressEl.innerHTML = '';

  const pdfs = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) {
    mostrarMsgModal('Solo se permiten archivos .pdf', 'err');
    progressEl.style.display = 'none';
    return;
  }

  await Promise.all(pdfs.map(file => new Promise((resolve) => {
    const itemId  = 'prog-' + Math.random().toString(36).slice(2, 8);
    const fileRef = ref(storage, `pdfs/${grupoActivo.storageKey}/${file.name}`);

    progressEl.innerHTML += `
      <div class="dp-upload-item" id="${itemId}">
        <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;">
          ${esc(file.name)}
        </span>
        <div class="dp-upload-bar">
          <div class="dp-upload-fill" id="${itemId}-fill" style="width:0%"></div>
        </div>
        <span class="dp-upload-pct" id="${itemId}-pct">0%</span>
      </div>`;

    const task = uploadBytesResumable(fileRef, file);
    task.on('state_changed',
      snap => {
        const pct = Math.round(snap.bytesTransferred / snap.totalBytes * 100);
        const fillEl = document.getElementById(`${itemId}-fill`);
        const pctEl  = document.getElementById(`${itemId}-pct`);
        if (fillEl) fillEl.style.width = pct + '%';
        if (pctEl)  pctEl.textContent  = pct + '%';
      },
      err => { mostrarMsgModal('Error al subir ' + file.name + ': ' + err.message, 'err'); resolve(); },
      () => resolve()
    );
  })));

  progressEl.style.display = 'none';
  mostrarMsgModal(`✔ ${pdfs.length} archivo${pdfs.length !== 1 ? 's' : ''} subido${pdfs.length !== 1 ? 's' : ''}.`, 'ok');

  pdfCounts[grupoActivo.key] = (pdfCounts[grupoActivo.key] || 0) + pdfs.length;
  renderGrilla();
  renderStats();
  await cargarListaPDFs();
}

// ── Eliminar PDF ──────────────────────────────────────────────────────────────
window.eliminarPDF = async function(nameEnc) {
  const nombre = decodeURIComponent(nameEnc);
  if (!confirm(`¿Eliminar "${nombre}"?`)) return;
  try {
    const fileRef = ref(storage, `pdfs/${grupoActivo.storageKey}/${nombre}`);
    await deleteObject(fileRef);
    if (pdfCounts[grupoActivo.key] > 0) pdfCounts[grupoActivo.key]--;
    renderGrilla();
    renderStats();
    await cargarListaPDFs();
  } catch (err) {
    mostrarMsgModal('Error al eliminar: ' + err.message, 'err');
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function mostrarMsgModal(texto, tipo) {
  // Usa el div dp-msg del panel docs (visible si el modal está cerrado)
  // Para el modal mostramos un alert simple
  if (document.getElementById('modal-pdf').style.display !== 'none') {
    // Reusar pdf-count como mini-mensaje
    const el = document.getElementById('pdf-count');
    const prev = el.textContent;
    el.textContent = texto;
    el.style.color = tipo === 'ok' ? '#00ff88' : '#ff6080';
    setTimeout(() => { el.textContent = prev; el.style.color = ''; }, 3500);
  }
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
cargar();
