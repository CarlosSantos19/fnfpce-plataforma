/**
 * modules/pagos/pagos.js
 * Registro de reconocimientos y pagos ET2023
 */

import { db } from '/firebase-config.js';
import {
  collection, getDocs, addDoc, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Auth ──────────────────────────────────────────────────────────────────────
Auth.requireRole(['administrador', 'pago', 'administrativo']);
renderSidebar('pagos');

// ── Estado del asistente ──────────────────────────────────────────────────────
let pasoActual      = 1;
let cuentaSeleccionada = null;   // doc del reparto seleccionado
let valorReconocido = 0;
let valorAuditoria  = 0;
let valorNeto       = 0;
let resReconocimiento = '';

// ── Datos ─────────────────────────────────────────────────────────────────────
let todosReparto = [];
let todosPagos   = [];
let pagosFiltrados = [];

// ── Formatear moneda ──────────────────────────────────────────────────────────
function fmt(n) {
  return '$' + Number(n).toLocaleString('es-CO', { minimumFractionDigits: 0 });
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Cargar reparto ────────────────────────────────────────────────────────────
async function cargarReparto() {
  try {
    const snap = await getDocs(collection(db, 'reparto'));
    todosReparto = snap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .filter(d => !!(d.consecutivo || '').trim());
    todosReparto.sort((a, b) => (a.agrupacion || '').localeCompare(b.agrupacion || ''));
    renderListaReparto(todosReparto);
  } catch (err) {
    document.getElementById('lista-reparto').innerHTML =
      `<p class="hint-text">Error al cargar reparto: ${err.message}</p>`;
  }
}

function renderListaReparto(lista) {
  const div = document.getElementById('lista-reparto');
  if (!lista.length) {
    div.innerHTML = '<p class="hint-text">Sin resultados.</p>';
    return;
  }
  div.innerHTML = lista.map(r => `
    <div class="reparto-item" onclick="seleccionarCuenta('${r._id}')">
      <div class="ri-consec">${esc(r.consecutivo)}</div>
      <div class="ri-corp">${esc(r.corporacion)} · ${esc(r.circunscripcion)}</div>
      <div class="ri-agrup">${esc(r.agrupacion)}</div>
      <div class="ri-lugar">${esc(r.departamento)} · ${esc(r.municipio)}</div>
    </div>
  `).join('');
}

window.filtrarReparto = function() {
  const t = document.getElementById('buscar-reparto').value.toLowerCase();
  if (!t) { renderListaReparto(todosReparto); return; }
  renderListaReparto(todosReparto.filter(r =>
    [r.consecutivo, r.agrupacion, r.municipio, r.departamento, r.corporacion]
      .join(' ').toLowerCase().includes(t)
  ));
};

window.seleccionarCuenta = function(id) {
  cuentaSeleccionada = todosReparto.find(r => r._id === id);
  if (!cuentaSeleccionada) return;

  document.getElementById('resumen-cuenta').innerHTML = `
    <strong>${esc(cuentaSeleccionada.consecutivo)}</strong> — ${esc(cuentaSeleccionada.agrupacion)}<br>
    ${esc(cuentaSeleccionada.corporacion)} · ${esc(cuentaSeleccionada.circunscripcion)}<br>
    ${esc(cuentaSeleccionada.departamento)} · ${esc(cuentaSeleccionada.municipio)}
  `;
  document.getElementById('input-valor').value = '';
  document.getElementById('calculo-auditoria').style.display = 'none';
  document.getElementById('btn-aceptar-valor').disabled = true;
  irPaso(2);
};

// ── Paso 2: Valor reconocido ──────────────────────────────────────────────────
window.calcularAuditoria = function() {
  const val = parseFloat(document.getElementById('input-valor').value) || 0;
  const btnAcept = document.getElementById('btn-aceptar-valor');

  if (val <= 0) {
    document.getElementById('calculo-auditoria').style.display = 'none';
    btnAcept.disabled = true;
    return;
  }

  valorReconocido = Math.round(val);
  valorAuditoria  = Math.round(valorReconocido * 0.01);
  valorNeto       = valorReconocido - valorAuditoria;

  document.getElementById('display-reconocido').textContent = fmt(valorReconocido);
  document.getElementById('display-auditoria').textContent  = fmt(valorAuditoria);
  document.getElementById('display-neto').textContent       = fmt(valorNeto);
  document.getElementById('calculo-auditoria').style.display = '';
  btnAcept.disabled = false;
};

window.aceptarValor = function() {
  if (valorReconocido <= 0) return;
  document.getElementById('input-res-reconocimiento').value = '';
  irPaso(3);
};

// ── Paso 3: Resolución de reconocimiento ──────────────────────────────────────
window.aceptarReconocimiento = function() {
  resReconocimiento = document.getElementById('input-res-reconocimiento').value.trim();
  if (!resReconocimiento) {
    alert('Ingrese el número de resolución de reconocimiento.');
    return;
  }
  // Mostrar resumen en paso 4
  document.getElementById('resumen-final').innerHTML = `
    <strong>Cuenta:</strong> ${esc(cuentaSeleccionada.consecutivo)} — ${esc(cuentaSeleccionada.agrupacion)}<br>
    <strong>Valor Reconocido:</strong> ${fmt(valorReconocido)}<br>
    <strong>Auditoría (1%):</strong> ${fmt(valorAuditoria)}<br>
    <strong>Valor Neto:</strong> ${fmt(valorNeto)}<br>
    <strong>Res. Reconocimiento:</strong> ${esc(resReconocimiento)}
  `;
  document.getElementById('input-res-pago').value = '';
  document.getElementById('msg-guardar').textContent = '';
  irPaso(4);
};

// ── Paso 4: Guardar ───────────────────────────────────────────────────────────
window.guardarPago = async function() {
  const resPago      = document.getElementById('input-res-pago').value.trim();
  const consecutivo  = cuentaSeleccionada.consecutivo || '';
  const msgEl        = document.getElementById('msg-guardar');

  if (!resPago) { msgEl.textContent = '⚠ Ingrese la resolución de pago.'; msgEl.className = 'form-msg err'; return; }

  msgEl.textContent = 'Guardando...';
  msgEl.className   = 'form-msg';

  const registro = {
    consecutivo,
    corporacion:            cuentaSeleccionada.corporacion      || '',
    circunscripcion:        cuentaSeleccionada.circunscripcion  || '',
    departamento:           cuentaSeleccionada.departamento     || '',
    municipio:              cuentaSeleccionada.municipio        || '',
    agrupacion:             cuentaSeleccionada.agrupacion       || '',
    valorReconocido,
    valorAuditoria,
    valorNeto,
    resolucionReconocimiento: resReconocimiento,
    resolucionPago:           resPago,
    fechaRegistro:            new Date().toISOString().slice(0, 10),
    repartoRef:               cuentaSeleccionada._id,
  };

  try {
    await addDoc(collection(db, 'pagos'), registro);
    msgEl.textContent = '✔ Registro incluido en la base de pagos.';
    msgEl.className   = 'form-msg ok';
    await cargarPagos();
    // Reiniciar asistente después de 1.5s
    setTimeout(() => {
      reiniciarAsistente();
    }, 1500);
  } catch (err) {
    msgEl.textContent = '✘ Error: ' + err.message;
    msgEl.className   = 'form-msg err';
  }
};

function reiniciarAsistente() {
  cuentaSeleccionada = null;
  valorReconocido = valorAuditoria = valorNeto = 0;
  resReconocimiento = '';
  document.getElementById('buscar-reparto').value = '';
  filtrarReparto();
  irPaso(1);
}

// ── Navegación entre pasos ────────────────────────────────────────────────────
function irPaso(n) {
  pasoActual = n;
  [1,2,3,4].forEach(i => {
    document.getElementById(`paso-${i}`).style.display = i === n ? '' : 'none';
  });
}

window.volverPaso = function(n) { irPaso(n); };

// ── Cargar base de pagos ──────────────────────────────────────────────────────
async function cargarPagos() {
  try {
    const snap = await getDocs(collection(db, 'pagos'));
    todosPagos = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    todosPagos.sort((a, b) => (a.consecutivo || '').localeCompare(b.consecutivo || ''));
    pagosFiltrados = [...todosPagos];
    renderTablaPagos();
  } catch (err) {
    document.getElementById('tbody-pagos').innerHTML =
      `<tr><td colspan="12" class="table-loading">Error: ${err.message}</td></tr>`;
  }
}

window.filtrarPagos = function() {
  const t = document.getElementById('buscar-pagos').value.toLowerCase();
  pagosFiltrados = !t ? [...todosPagos] : todosPagos.filter(p =>
    [p.consecutivo, p.agrupacion, p.municipio, p.departamento, p.corporacion,
     p.resolucionReconocimiento, p.resolucionPago].join(' ').toLowerCase().includes(t)
  );
  renderTablaPagos();
};

function renderTablaPagos() {
  const tbody = document.getElementById('tbody-pagos');
  document.getElementById('stats-pagos').textContent =
    `${todosPagos.length} registro${todosPagos.length !== 1 ? 's' : ''}`;

  if (!pagosFiltrados.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="table-empty">Sin registros.</td></tr>';
    return;
  }

  tbody.innerHTML = pagosFiltrados.map(p => `
    <tr>
      <td><span class="consec-cell">${esc(p.consecutivo)}</span></td>
      <td>${esc(p.corporacion)}</td>
      <td>${esc(p.circunscripcion)}</td>
      <td>${esc(p.departamento)}</td>
      <td>${esc(p.municipio)}</td>
      <td>${esc(p.agrupacion)}</td>
      <td><span class="val-cell reconocido">${fmt(p.valorReconocido)}</span></td>
      <td><span class="val-cell auditoria">${fmt(p.valorAuditoria)}</span></td>
      <td><span class="val-cell neto">${fmt(p.valorNeto)}</span></td>
      <td>${esc(p.resolucionReconocimiento)}</td>
      <td>${esc(p.resolucionPago)}</td>
      <td>
        <button class="btn-eliminar-fila" data-id="${p._id}"
                onclick="confirmarEliminar('${p._id}','${esc(p.consecutivo)}')">✕</button>
      </td>
    </tr>
  `).join('');
}

// ── Eliminar ──────────────────────────────────────────────────────────────────
let _eliminarId = null;

window.confirmarEliminar = function(id, consec) {
  _eliminarId = id;
  document.getElementById('modal-title').textContent = '¿Eliminar registro?';
  document.getElementById('modal-body').textContent  = `Consecutivo: ${consec} — esta acción no se puede deshacer.`;
  document.getElementById('btn-modal-confirm').onclick = ejecutarEliminar;
  document.getElementById('modal-confirm').style.display = 'flex';
};

async function ejecutarEliminar() {
  if (!_eliminarId) return;
  try {
    await deleteDoc(doc(db, 'pagos', _eliminarId));
    todosPagos = todosPagos.filter(p => p._id !== _eliminarId);
    filtrarPagos();
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
  }
  cerrarModal();
};

window.cerrarModal = function() {
  document.getElementById('modal-confirm').style.display = 'none';
  _eliminarId = null;
};

// ── Init ──────────────────────────────────────────────────────────────────────
cargarReparto();
cargarPagos();
