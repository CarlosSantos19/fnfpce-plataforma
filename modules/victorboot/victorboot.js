/**
 * modules/victorboot/victorboot.js
 * Chatbot de consulta electoral — datos desde Firestore reparto
 */

import { db } from '/firebase-config.js';
import { collection, getDocs } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
Auth.requireRole(['administrador', 'abogado', 'administrativo']);
renderSidebar('victorboot');

// ── Partículas ────────────────────────────────────────────────────────────────
(function () {
  const c = document.getElementById('particles');
  if (!c) return;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left              = Math.random() * 100 + 'vw';
    p.style.animationDuration = (8 + Math.random() * 14) + 's';
    p.style.animationDelay    = (Math.random() * 12) + 's';
    p.style.width = p.style.height = (Math.random() > 0.5 ? '2px' : '1px');
    p.style.opacity = String(Math.random() * 0.35);
    c.appendChild(p);
  }
})();

// ── DOM ───────────────────────────────────────────────────────────────────────
const dataStatus  = document.getElementById('dataStatus');
const vbForm      = document.getElementById('vbForm');
const vbWelcome   = document.getElementById('vbWelcome');
const vbChat      = document.getElementById('vbChat');
const vbMessages  = document.getElementById('vbMessages');
const vbOptions   = document.getElementById('vbOptionsArea');
const vbUserInfo  = document.getElementById('vbUserInfo');
const vbRecordCount = document.getElementById('vbRecordCount');
document.getElementById('vbResetBtn').addEventListener('click', reiniciar);

// ── Pasos del bot ─────────────────────────────────────────────────────────────
// Mapeo: campo del bot → campo en Firestore reparto
const PASOS = [
  { label: 'Corporación',    campo: 'corporacion'   },
  { label: 'Circunscripción', campo: 'circunscripcion' },
  { label: 'Departamento',   campo: 'departamento'  },
  { label: 'Municipio',      campo: 'municipio'     },
  { label: 'Agrupación',     campo: 'agrupacion'    },
];

// ── Estado ────────────────────────────────────────────────────────────────────
let todosLosDatos = [];   // todos los docs de reparto
let filtros       = {};   // filtros acumulados
let paso          = 0;    // paso actual
let userName      = '';

// ── Carga inicial de datos ────────────────────────────────────────────────────
(async function cargarReparto() {
  try {
    const snap = await getDocs(collection(db, 'reparto'));
    todosLosDatos = snap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .filter(d => d.repartoId && d.consecutivo);

    if (todosLosDatos.length === 0) {
      dataStatus.className = 'vb-data-status err';
      dataStatus.innerHTML = '✗ No hay datos en el módulo de Reparto.';
      return;
    }

    dataStatus.className = 'vb-data-status ok';
    dataStatus.innerHTML = `✔ ${todosLosDatos.length.toLocaleString('es-CO')} expedientes cargados`;
    vbRecordCount.textContent = `${todosLosDatos.length.toLocaleString('es-CO')} expedientes`;

    // Mostrar formulario
    vbForm.style.display = 'block';
  } catch (err) {
    dataStatus.className = 'vb-data-status err';
    dataStatus.innerHTML = `✗ Error al cargar datos: ${err.message}`;
  }
})();

// ── Iniciar consulta ──────────────────────────────────────────────────────────
vbForm.addEventListener('submit', e => {
  e.preventDefault();
  userName = document.getElementById('vbUserName').value.trim();
  if (!userName) return;

  vbWelcome.style.display = 'none';
  vbChat.style.display    = 'flex';
  vbUserInfo.textContent  = '// ' + userName;

  agregarMsg(`¡Hola ${userName}! Soy VictorBoot, tu asistente de consulta electoral ET2023.`, 'bot');
  agregarMsg('Voy a guiarte paso a paso para encontrar el expediente que necesitas.', 'bot');

  siguiente();
});

// ── Flujo del bot ─────────────────────────────────────────────────────────────
function siguiente() {
  if (paso >= PASOS.length) {
    consultarFinal();
    return;
  }

  const p = PASOS[paso];
  const opciones = obtenerOpciones(p.campo);

  if (opciones.length === 0) {
    // Si no hay opciones para este paso pero sí hay registros, saltarlo
    const registros = aplicarFiltros(todosLosDatos, filtros);
    if (registros.length === 0) {
      agregarMsg('No se encontraron opciones con los filtros actuales.', 'bot');
      return;
    }
    paso++;
    siguiente();
    return;
  }

  agregarMsg(`¿Qué <strong>${p.label}</strong> te interesa?`, 'bot', true);
  mostrarOpciones(opciones, p.campo);
}

function obtenerOpciones(campo) {
  // Filtrar datos con los filtros ya aplicados y obtener valores únicos
  const datos = aplicarFiltros(todosLosDatos, filtros);
  const valores = [...new Set(datos.map(d => d[campo]).filter(Boolean))];
  return valores.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function aplicarFiltros(datos, filtros) {
  return datos.filter(d =>
    Object.entries(filtros).every(([k, v]) =>
      d[k] && d[k].toString().toLowerCase() === v.toLowerCase()
    )
  );
}

function seleccionar(valor, campo) {
  filtros[campo] = valor;
  paso++;
  agregarMsg(valor, 'user');
  limpiarOpciones();
  siguiente();
}

// ── Consulta final ────────────────────────────────────────────────────────────
function consultarFinal() {
  agregarMsg('Buscando expedientes… un momento.', 'bot');

  const resultados = aplicarFiltros(todosLosDatos, filtros);

  if (resultados.length === 0) {
    agregarMsg('No encontré expedientes con esos criterios. Puedes hacer una nueva consulta.', 'bot');
  } else {
    agregarMsg(
      resultados.length === 1
        ? 'Encontré <strong>1 expediente</strong>:'
        : `Encontré <strong>${resultados.length} expedientes</strong>:`,
      'bot', true
    );
    resultados.forEach((r, i) => mostrarResultado(r, i + 1, resultados.length));
    agregarMsg('¿Deseas hacer otra consulta? Usa el botón <strong>↺ Nueva consulta</strong>.', 'bot', true);
  }

  limpiarOpciones();
}

// ── Mostrar resultado ─────────────────────────────────────────────────────────
function mostrarResultado(r, num, total) {
  const estadoClass = obtenerClaseEstado(r.estado || '');
  const tituloNum   = total > 1 ? ` ${num} de ${total}` : '';

  let html = `<div class="vb-result-card">`;
  html += `<h4>⬟ EXPEDIENTE${tituloNum}</h4>`;

  // Identificación
  fila(r.corporacion,    'Corporación');
  fila(r.circunscripcion,'Circunscripción');
  fila(r.departamento,   'Departamento');
  fila(r.municipio,      'Municipio');
  fila(r.agrupacion,     'Agrupación');

  // Estado
  if (r.estado) {
    html += `<p><strong>Estado:</strong> <span class="vb-estado ${estadoClass}">${r.estado}</span></p>`;
  }

  fila(r.nombreContador, 'Contador asignado');
  fila(r.consecutivo,    'Consecutivo');

  // Oficios
  if (r.primerOficioNo) {
    html += `<div class="vb-oficio-block">`;
    html += `<p><strong>📄 Primer Oficio</strong></p>`;
    html += `<p>Número: ${r.primerOficioNo}</p>`;
    if (r.primerOficioFecha) html += `<p>Fecha: ${r.primerOficioFecha}</p>`;
    if (r.primerOficioRespuesta) html += `<p>Respuesta: ${r.primerOficioRespuesta}</p>`;
    if (r.primerOficioRadicado)  html += `<p>Radicado: ${r.primerOficioRadicado}</p>`;
    html += `</div>`;
  }

  if (r.segundoOficioNo) {
    html += `<div class="vb-oficio-block">`;
    html += `<p><strong>📄 Segundo Oficio</strong></p>`;
    html += `<p>Número: ${r.segundoOficioNo}</p>`;
    if (r.segundoOficioFecha) html += `<p>Fecha: ${r.segundoOficioFecha}</p>`;
    if (r.segundoOficioRespuesta) html += `<p>Respuesta: ${r.segundoOficioRespuesta}</p>`;
    if (r.segundoOficioRadicado)  html += `<p>Radicado: ${r.segundoOficioRadicado}</p>`;
    html += `</div>`;
  }

  if (r.observacion) {
    html += `<p style="margin-top:8px;color:rgba(224,244,255,.5);font-size:12px;">
               <strong>Obs:</strong> ${escHtml(r.observacion)}</p>`;
  }

  html += `</div>`;

  const div = document.createElement('div');
  div.className = 'vb-msg bot';
  div.innerHTML = `<div class="vb-bubble">${html}</div>`;
  vbMessages.appendChild(div);
  scrollAbajo();

  function fila(val, label) {
    if (val) html += `<p><strong>${label}:</strong> ${escHtml(String(val))}</p>`;
  }
}

function obtenerClaseEstado(estado) {
  const e = estado.toUpperCase();
  if (e.includes('CERTIF')) return 'estado-CERTIFICADO';
  if (e.includes('REOFIC'))  return 'estado-REOFICIADO';
  if (e.includes('OFFIC') || e.includes('OFIC')) return 'estado-OFFICIADO';
  if (e.includes('PEND'))    return 'estado-PENDIENTE';
  if (e.includes('VENC'))    return 'estado-VENCIDO';
  return 'estado-default';
}

// ── UI Helpers ────────────────────────────────────────────────────────────────
function agregarMsg(texto, tipo, esHtml = false) {
  const div = document.createElement('div');
  div.className = `vb-msg ${tipo}`;
  const bubble = document.createElement('div');
  bubble.className = 'vb-bubble';
  if (esHtml) bubble.innerHTML = texto;
  else        bubble.textContent = texto;
  div.appendChild(bubble);
  vbMessages.appendChild(div);
  scrollAbajo();
}

function mostrarOpciones(opciones, campo) {
  vbOptions.innerHTML = '';

  const search = document.createElement('input');
  search.type        = 'text';
  search.className   = 'vb-search';
  search.placeholder = '🔍 Buscar…';
  vbOptions.appendChild(search);

  const grid = document.createElement('div');
  grid.className = 'vb-options-grid';
  vbOptions.appendChild(grid);

  let seleccionado = null;

  function renderOpciones(lista) {
    grid.innerHTML = '';
    lista.forEach(op => {
      const item = document.createElement('div');
      item.className = 'vb-option-item' + (op === seleccionado ? ' selected' : '');

      const radio = document.createElement('input');
      radio.type  = 'radio';
      radio.name  = 'vb-opt';
      radio.value = op;
      radio.checked = op === seleccionado;

      radio.onchange = () => { seleccionado = op; confirmar.disabled = false; renderOpciones(lista); };
      item.onclick   = e => { if (e.target !== radio) { radio.checked = true; radio.onchange(); } };

      item.appendChild(radio);
      item.appendChild(document.createTextNode(op));
      grid.appendChild(item);
    });
  }

  renderOpciones(opciones);

  search.oninput = () => {
    const t = search.value.toLowerCase();
    renderOpciones(opciones.filter(o => o.toLowerCase().includes(t)));
  };

  const confirmar = document.createElement('button');
  confirmar.className   = 'vb-confirm-btn';
  confirmar.textContent = '✓ Confirmar selección';
  confirmar.disabled    = true;
  confirmar.onclick     = () => { if (seleccionado) seleccionar(seleccionado, campo); };
  vbOptions.appendChild(confirmar);
}

function limpiarOpciones() {
  vbOptions.innerHTML = '';
}

function scrollAbajo() {
  vbMessages.scrollTo({ top: vbMessages.scrollHeight, behavior: 'smooth' });
}

function reiniciar() {
  filtros = {};
  paso    = 0;
  vbMessages.innerHTML = '';
  limpiarOpciones();
  agregarMsg(`¡Hola de nuevo ${userName}! Comencemos una nueva consulta.`, 'bot');
  siguiente();
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
