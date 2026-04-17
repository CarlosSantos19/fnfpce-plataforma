/**
 * modules/actas/actas.js
 * Visualización e impresión de Actas de Entrega ET2023.
 *
 * Agrupación: cada acta = único (numeroActaEntrega) si existe,
 * o (nombreContador + cajaDigital + numeroActaReparto + fechaActaReparto).
 */

import { db } from '/firebase-config.js';
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

Auth.requireRole(['administrador', 'contador']);
renderSidebar('actas');

const rol           = Auth.getRole() || 'contador';
const nombreUsuario = Auth.getContador() || '';
const esContador    = rol === 'contador';

let todosExpedientes = [];
let _actaGrupos      = [];
let actaActual       = null;

// ── Partículas ────────────────────────────────────────────────────────────────
(function initParticulas() {
  const container = document.getElementById('particles');
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left              = Math.random() * 100 + 'vw';
    p.style.animationDuration = (10 + Math.random() * 14) + 's';
    p.style.animationDelay    = (Math.random() * 10) + 's';
    p.style.width = p.style.height = (Math.random() > 0.5 ? '2px' : '1px');
    container.appendChild(p);
  }
})();

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const snap = await getDocs(collection(db, 'reparto'));
    todosExpedientes = snap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .filter(e => e.nombreContador); // debe tener contador asignado

    if (esContador) {
      todosExpedientes = todosExpedientes.filter(e =>
        (e.nombreContador || '').trim().toLowerCase() === nombreUsuario.trim().toLowerCase()
      );
    } else {
      poblarFiltroContador();
      document.getElementById('filtro-admin').style.display = '';
    }

    renderListaActas(todosExpedientes);

  } catch (err) {
    document.getElementById('lista-actas').innerHTML =
      `<div class="loading-txt">Error al cargar datos: ${err.message}</div>`;
  }
}

// ── Filtro de contador (admin) ────────────────────────────────────────────────
function poblarFiltroContador() {
  const contadores = [...new Set(
    todosExpedientes.map(e => e.nombreContador).filter(Boolean)
  )].sort();

  const sel = document.getElementById('sel-contador');
  contadores.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

window.filtrarPorContador = function() {
  const filtro = document.getElementById('sel-contador').value;
  const filtrado = filtro
    ? todosExpedientes.filter(e => e.nombreContador === filtro)
    : todosExpedientes;
  renderListaActas(filtrado);
};

// ── Agrupación de expedientes por acta ───────────────────────────────────────
// Clave: numeroActaEntrega (si existe) o combinación de campos
function claveActa(e) {
  const codigo = (e.numeroActaEntrega || '').trim();
  if (codigo) return `cod:${codigo}`;
  const fecha  = (e.fechaActaReparto  || '').trim();
  const numA   = (e.numeroActaReparto || '').toString().trim();
  const caja   = (e.cajaDigital       || '').toString().trim();
  const cont   = (e.nombreContador    || '').trim();
  return `manual:${cont}||${caja}||${numA}||${fecha}`;
}

function renderListaActas(expedientes) {
  const grupos = {};

  expedientes.forEach(e => {
    const key = claveActa(e);
    if (!grupos[key]) {
      grupos[key] = {
        key,
        nombreContador:    e.nombreContador    || '',
        cajaDigital:       e.cajaDigital       || '',
        fechaActaReparto:  e.fechaActaReparto  || '',
        numeroActaReparto: e.numeroActaReparto  || '',
        numeroActaEntrega: (e.numeroActaEntrega || '').trim(),
        expedientes: []
      };
    }
    grupos[key].expedientes.push(e);
  });

  // Ordenar: contador → fecha acta → caja
  _actaGrupos = Object.values(grupos).sort((a, b) => {
    const nc = a.nombreContador.localeCompare(b.nombreContador);
    if (nc !== 0) return nc;
    const fd = (a.fechaActaReparto || '').localeCompare(b.fechaActaReparto || '');
    if (fd !== 0) return fd;
    return (a.cajaDigital || 0) - (b.cajaDigital || 0);
  });

  const el = document.getElementById('lista-actas');

  if (!_actaGrupos.length) {
    el.innerHTML = '<div class="loading-txt">No hay actas registradas.</div>';
    return;
  }

  el.innerHTML = _actaGrupos.map((g, idx) => {
    const counts = contarPorTipo(g.expedientes);
    const resumen = Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `<span class="acta-stat">${k}: ${v}</span>`)
      .join('');

    const etiquetaNumActa = g.numeroActaReparto
      ? `Acta No. ${g.numeroActaReparto}` : '';
    const etiquetaCodigo  = g.numeroActaEntrega
      ? `<span class="acta-codigo-tag">${g.numeroActaEntrega}</span>` : '';

    return `
      <div class="acta-item" onclick="abrirActa(${idx})">
        <div class="acta-item-header">
          <span class="acta-caja">◆ Caja Digital ${String(g.cajaDigital).padStart(2, '0')}</span>
          <span class="acta-num-tag">${etiquetaNumActa}</span>
        </div>
        ${etiquetaCodigo}
        <div class="acta-item-nombre">${g.nombreContador}</div>
        <div class="acta-item-fecha">${formatearFechaCorta(g.fechaActaReparto)}</div>
        <div class="acta-item-stats">
          ${resumen}
          <span class="acta-stat acta-stat--total">TOTAL: ${g.expedientes.length}</span>
        </div>
        <div class="acta-item-accion">Ver Acta →</div>
      </div>
    `;
  }).join('');
}

// ── Conteo por tipo de corporación ───────────────────────────────────────────
function contarPorTipo(expedientes) {
  const c = { AL: 0, CO: 0, AS: 0, GO: 0, JAL: 0 };
  expedientes.forEach(e => {
    const corp = (e.corporacion || '').toUpperCase().trim();
    if      (corp.startsWith('ALCALD'))   c.AL++;
    else if (corp.startsWith('CONCEJO'))  c.CO++;
    else if (corp.startsWith('ASAMBLEA')) c.AS++;
    else if (corp.startsWith('GOBERN'))   c.GO++;
    else if (corp.startsWith('JUNTA'))    c.JAL++;
  });
  return c;
}

// ── Abrir acta ────────────────────────────────────────────────────────────────
window.abrirActa = function(idx) {
  actaActual = _actaGrupos[idx];

  document.getElementById('inp-num-acta').value   = actaActual.numeroActaReparto || '';
  document.getElementById('inp-codigo-doc').value = actaActual.numeroActaEntrega || '';

  document.getElementById('panel-selector').style.display = 'none';
  document.getElementById('panel-acta').style.display     = '';

  renderActa();
};

window.volverSelector = function() {
  document.getElementById('panel-selector').style.display = '';
  document.getElementById('panel-acta').style.display     = 'none';
  actaActual = null;
};

window.actualizarActa = function() { renderActa(); };

// ── Renderizar documento ──────────────────────────────────────────────────────
function renderActa() {
  if (!actaActual) return;

  const numActa   = document.getElementById('inp-num-acta').value.trim();
  const codigoDoc = document.getElementById('inp-codigo-doc').value.trim();

  const { nombreContador, cajaDigital, fechaActaReparto, expedientes } = actaActual;

  // Ordenar: corporacion → departamento → municipio → consecutivo
  const ordenados = [...expedientes].sort((a, b) => {
    const cc = (a.corporacion || '').localeCompare(b.corporacion || '');
    if (cc !== 0) return cc;
    const dd = (a.departamento || '').localeCompare(b.departamento || '');
    if (dd !== 0) return dd;
    const mm = (a.municipio || '').localeCompare(b.municipio || '');
    if (mm !== 0) return mm;
    return (a.consecutivo || '').localeCompare(b.consecutivo || '');
  });

  const counts = contarPorTipo(expedientes);
  const total  = expedientes.length;
  const fechaFormateada = formatearFechaLarga(fechaActaReparto);

  const filas = ordenados.map((e, i) => `
    <tr>
      <td class="acta-td-num">${i + 1}</td>
      <td>${e.corporacion || ''}</td>
      <td>${e.circunscripcion || ''}</td>
      <td>${e.departamento || ''}</td>
      <td>${e.municipio || ''}</td>
      <td>${e.agrupacion || ''}</td>
      <td class="acta-td-rad">${formatearConsecutivo(e.consecutivo)}</td>
      <td>${e.observacion || ''}</td>
    </tr>
  `).join('');

  const resumenLinea = [
    `AL ${counts.AL}`,
    `CO ${counts.CO}`,
    `AS ${counts.AS}`,
    `GO ${counts.GO}`,
    `JAL ${counts.JAL}`,
  ].join('&nbsp;&nbsp;&nbsp;');

  const introActa = numActa
    ? `Acta de Reparto No. <strong>${numActa}</strong> del día <strong>${fechaFormateada}</strong>`
    : `acta de reparto del día <strong>${fechaFormateada}</strong>`;

  document.getElementById('acta-documento').innerHTML = `
    <div class="acta-paper">

      <!-- Encabezado institucional -->
      <div class="acta-encabezado">
        <div class="acta-logo-block">
          <img src="/imagenes/logo.jpg" class="acta-logo-img" alt="CNE" />
          <div class="acta-inst-nombres">
            <div class="acta-inst-1">CONSEJO NACIONAL ELECTORAL</div>
            <div class="acta-inst-2">
              FONDO NACIONAL DE FINANCIAMIENTO PARA LA COMPETENCIA ELECTORAL
            </div>
          </div>
        </div>
        <div class="acta-header-right">
          <div class="acta-ciudad">Bogotá D.C., ${fechaFormateada}</div>
          ${codigoDoc ? `<div class="acta-codigo-doc">${codigoDoc}</div>` : ''}
        </div>
      </div>

      <!-- Título -->
      <div class="acta-titulo">ACTA DE ENTREGA</div>

      <!-- Párrafo introductorio -->
      <div class="acta-intro">
        <p>
          Por medio de la presente acta, se hace entrega de las cuentas de rendición del proceso
          de Extinción de Términos ET2023, correspondientes al ${introActa},
          descritas a continuación:
        </p>
      </div>

      <!-- Tabla de expedientes -->
      <div class="acta-tabla-wrap">
        <table class="acta-tabla">
          <thead>
            <tr>
              <th>No.</th>
              <th>CORPORACIÓN</th>
              <th>CIRCUNSCRIPCIÓN</th>
              <th>DEPARTAMENTO</th>
              <th>MUNICIPIO</th>
              <th>AGRUPACIÓN POLÍTICA</th>
              <th>NO. RAD</th>
              <th>NOTA</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>

      <!-- Línea resumen por tipo -->
      <div class="acta-resumen">
        <span class="acta-resumen-tipos">${resumenLinea}</span>
        <span class="acta-resumen-sep">|</span>
        <span class="acta-resumen-total"><strong>TOTAL ${total}</strong></span>
        <span class="acta-resumen-sep">|</span>
        <span class="acta-resumen-caja"><strong>CAJA DIGITAL ${cajaDigital}</strong></span>
      </div>

      <!-- Nota de abreviaturas -->
      <div class="acta-nota">
        <strong>NOTA:</strong>&nbsp; AL: Alcaldía Municipal / Alcaldía Local &mdash;
        CO: Concejo Municipal &mdash; AS: Asamblea Departamental &mdash;
        GO: Gobernación &mdash; JAL: Junta Administradora Local
      </div>

      <!-- Bloque de detalle -->
      <div class="acta-detalle">
        <div class="acta-detalle-row">
          <span class="acta-detalle-lbl">Caja Digital:</span>
          <span class="acta-detalle-val">
            ${cajaDigital}${numActa ? ` &mdash; Acta No. ${numActa} del día ${fechaFormateada}` : ''}
          </span>
        </div>
        <div class="acta-detalle-row">
          <span class="acta-detalle-lbl">Número de cuentas:</span>
          <span class="acta-detalle-val">${total}</span>
        </div>
        <div class="acta-detalle-row">
          <span class="acta-detalle-lbl">Nombre del contador(a) quien recibe:</span>
          <span class="acta-detalle-val">${nombreContador}</span>
        </div>
      </div>

      <!-- Firmas -->
      <div class="acta-firmas">
        <div class="acta-firma-bloque">
          <div class="acta-firma-linea"></div>
          <div class="acta-firma-nombre">${nombreContador}</div>
          <div class="acta-firma-cargo">CONTADOR(A) — QUIEN RECIBE</div>
        </div>
        <div class="acta-firma-bloque">
          <div class="acta-firma-linea"></div>
          <div class="acta-firma-nombre">ANDREA DEL PILAR LOPERA PRADA</div>
          <div class="acta-firma-cargo">JEFE DE OFICINA — QUIEN ENTREGA</div>
          <div class="acta-firma-cargo">FNFPCE — ET2023</div>
        </div>
      </div>

    </div>
  `;
}

// ── Helpers de fecha ──────────────────────────────────────────────────────────
function formatearFechaLarga(fechaStr) {
  const d = parsarFecha(fechaStr);
  if (!d) return (fechaStr || '');
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatearFechaCorta(fechaStr) {
  const d = parsarFecha(fechaStr);
  if (!d) return (fechaStr || 'Sin fecha');
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function parsarFecha(fechaStr) {
  if (!fechaStr) return null;
  // YYYY-MM-DD (del seed original)
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
    const [y, m, d] = fechaStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // dd/mm/yyyy (del sorteo)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(fechaStr)) {
    const [d, m, y] = fechaStr.split('/').map(Number);
    return new Date(y, m - 1, d);
  }
  return null;
}

function formatearConsecutivo(consec) {
  // "AL-0279" o "AL-279" → "AL04279" (sin guión, con padding a 5 dígitos)
  if (!consec) return '';
  const m = consec.match(/^([A-Za-z]+)-?0*(\d+)$/);
  if (m) return m[1] + String(m[2]).padStart(5, '0');
  return consec.replace(/-/g, '');
}

// ── Arrancar ──────────────────────────────────────────────────────────────────
init();
