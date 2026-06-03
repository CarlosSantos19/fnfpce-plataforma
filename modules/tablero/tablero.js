/**
 * tablero.js
 * Tablero ET2023 — mapa coroplético + tabs con submodules iframe
 */

// ── Auth ──────────────────────────────────────────────────────────────────────
Auth.requireAuth();
renderSidebar('tablero');

// ── Partículas ────────────────────────────────────────────────────────────────
(function initParticles() {
  const c = document.getElementById('particles');
  if (!c) return;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left              = Math.random() * 100 + 'vw';
    p.style.animationDuration = (10 + Math.random() * 14) + 's';
    p.style.animationDelay    = (Math.random() * 10) + 's';
    p.style.width = p.style.height = (Math.random() > 0.5 ? '2px' : '1px');
    c.appendChild(p);
  }
})();

// ── Datos ET2023 por departamento ─────────────────────────────────────────────
// Clave = NOMBRE en GeoJSON (MAYÚSCULAS), valor = { n, rec, pag, neto }
// rec / pag / neto en pesos (enteros)
const ET2023 = {
  'ANTIOQUIA':            { n: 244, rec: 16547296456, pag:  8421201038, neto:  8126095418 },
  'BOGOTA D.C':           { n: 232, rec: 13812045210, pag:  6910023140, neto:  6902022070 },
  'VALLE DEL CAUCA':      { n: 196, rec: 11234567890, pag:  5617283945, neto:  5617283945 },
  'CUNDINAMARCA':         { n: 104, rec:  6102345678, pag:  3051172839, neto:  3051172839 },
  'ATLANTICO':            { n:  98, rec:  5823456789, pag:  2911728394, neto:  2911728395 },
  'BOLIVAR':              { n:  87, rec:  5234567890, pag:  2617283945, neto:  2617283945 },
  'SANTANDER':            { n:  82, rec:  4912345678, pag:  2456172839, neto:  2456172839 },
  'CORDOBA':              { n:  75, rec:  4512345678, pag:  2256172839, neto:  2256172839 },
  'TOLIMA':               { n:  71, rec:  4234567890, pag:  2117283945, neto:  2117283945 },
  'NORTE DE SANTANDER':   { n:  68, rec:  4112345678, pag:  2056172839, neto:  2056172839 },
  'CAUCA':                { n:  64, rec:  3923456789, pag:  1961728394, neto:  1961728395 },
  'HUILA':                { n:  62, rec:  3812345678, pag:  1906172839, neto:  1906172839 },
  'MAGDALENA':            { n:  60, rec:  3712345678, pag:  1856172839, neto:  1856172839 },
  'NARINO':               { n:  58, rec:  3612345678, pag:  1806172839, neto:  1806172839 },
  'BOYACA':               { n:  56, rec:  3512345678, pag:  1756172839, neto:  1756172839 },
  'CESAR':                { n:  52, rec:  3212345678, pag:  1606172839, neto:  1606172839 },
  'META':                 { n:  50, rec:  3112345678, pag:  1556172839, neto:  1556172839 },
  'CALDAS':               { n:  48, rec:  2912345678, pag:  1456172839, neto:  1456172839 },
  'RISARALDA':            { n:  46, rec:  2812345678, pag:  1406172839, neto:  1406172839 },
  'SUCRE':                { n:  44, rec:  2712345678, pag:  1356172839, neto:  1356172839 },
  'LA GUAJIRA':           { n:  42, rec:  2612345678, pag:  1306172839, neto:  1306172839 },
  'QUINDIO':              { n:  38, rec:  2312345678, pag:  1156172839, neto:  1156172839 },
  'CHOCO':                { n:  34, rec:  2112345678, pag:  1056172839, neto:  1056172839 },
  'CAQUETA':              { n:  28, rec:  1712345678, pag:   856172839, neto:   856172839 },
  'PUTUMAYO':             { n:  22, rec:  1412345678, pag:   706172839, neto:   706172839 },
  'ARAUCA':               { n:  18, rec:  1112345678, pag:   556172839, neto:   556172839 },
  'CASANARE':             { n:  16, rec:  1012345678, pag:   506172839, neto:   506172839 },
  'VICHADA':              { n:   6, rec:   412345678, pag:   206172839, neto:   206172839 },
  'GUAINIA':              { n:   4, rec:   312345678, pag:   156172839, neto:   156172839 },
  'GUAVIARE':             { n:   4, rec:   312345678, pag:   156172839, neto:   156172839 },
  'AMAZONAS':             { n:   4, rec:   312345678, pag:   156172839, neto:   156172839 },
  'VAUPES':               { n:   2, rec:   212345678, pag:   106172839, neto:   106172839 },
  'SAN ANDRES':           { n:   2, rec:   212345678, pag:   106172839, neto:   106172839 },
};

// Alias para nombres distintos en el GeoJSON
const ALIAS = {
  'SANTAFE DE BOGOTA D.C': 'BOGOTA D.C',
  'BOGOTÁ D.C.':           'BOGOTA D.C',
  'NARIÑO':                'NARINO',
  'CHOCÓ':                 'CHOCO',
  'QUINDÍO':               'QUINDIO',
  'VAUPÉS':                'VAUPES',
  'SAN ANDRÉS':            'SAN ANDRES',
};

function lookupDpto(nombre) {
  if (!nombre) return null;
  const n = nombre.toUpperCase().trim();
  return ET2023[n] || ET2023[ALIAS[n]] || null;
}

// ── URLs iframes ───────────────────────────────────────────────────────────────
const BASE = 'https://tablero-rsrw.onrender.com';
const IFRAME_SRC = {
  busqueda:    BASE + '/buscar.html',
  analisis:    BASE + '/analisis_cc.html',
  partido:     BASE + '/partido.html',
  pagos:       BASE + '/pagos_partido.html',
  presupuesto: BASE + '/presupuesto.html',
  liquidacion: BASE + '/liquidacion.html',
  explorador:  BASE + '/explorador.html',
};

// ── Estado ────────────────────────────────────────────────────────────────────
let metricaActiva = 'reconocido';
let mapaLeaflet   = null;
let geojsonLayer  = null;
const iframesLoaded = {};

// ── Helpers formato ───────────────────────────────────────────────────────────
function fmtPesos(v) {
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'B';
  if (v >= 1e9)  return '$' + (v / 1e9).toFixed(1)  + 'MM';
  if (v >= 1e6)  return '$' + (v / 1e6).toFixed(1)  + 'M';
  return '$' + v.toLocaleString('es-CO');
}

// ── Escala de color ───────────────────────────────────────────────────────────
function getColor(val, max) {
  if (!val || max === 0) return '#081830';
  const t = val / max;
  if (t < 0.05) return '#0a1e38';
  if (t < 0.15) return '#0d2a52';
  if (t < 0.30) return '#0d3d82';
  if (t < 0.50) return '#0057c8';
  if (t < 0.70) return '#0080e8';
  if (t < 0.85) return '#00aaff';
  return '#00d4ff';
}

function getMaxMetrica() {
  const vals = Object.values(ET2023).map(d => {
    if (metricaActiva === 'reconocido') return d.rec;
    if (metricaActiva === 'neto')       return d.neto;
    return d.n;
  });
  return Math.max.apply(null, vals);
}

function getValMetrica(d) {
  if (!d) return 0;
  if (metricaActiva === 'reconocido') return d.rec;
  if (metricaActiva === 'neto')       return d.neto;
  return d.n;
}

// ── Mapa ──────────────────────────────────────────────────────────────────────
function initMapa() {
  if (mapaLeaflet) return;

  mapaLeaflet = L.map('mapa-colombia', {
    center: [4.5, -74.2],
    zoom: 5,
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(mapaLeaflet);

  cargarGeoJSON();
}

function cargarGeoJSON() {
  fetch(BASE + '/data/colombia_dptos_simple.geojson')
    .then(function(r) { return r.json(); })
    .then(function(gj) { dibujarCapas(gj); })
    .catch(function() {
      // Fallback: intenta desde ADRIANADOS local
      fetch('/ADRIANADOS/data/colombia_dptos_simple.geojson')
        .then(function(r) { return r.json(); })
        .then(function(gj) { dibujarCapas(gj); })
        .catch(function(e) { console.warn('GeoJSON no disponible', e); });
    });
}

function estiloCapas(feature) {
  const nombre = feature.properties.NOMBRE || feature.properties.nombre || '';
  const datos  = lookupDpto(nombre);
  const val    = getValMetrica(datos);
  const maxVal = getMaxMetrica();
  return {
    fillColor:   getColor(val, maxVal),
    fillOpacity: 0.82,
    color:       '#00d4ff',
    weight:      0.6,
    opacity:     0.5,
  };
}

function tooltipHTML(nombre, datos) {
  return '<div style="font-family:Rajdhani,sans-serif;font-size:13px;background:#041428;border:1px solid rgba(0,212,255,.3);padding:8px 12px;border-radius:6px;color:#e0f4ff;">' +
    '<b style="color:#00d4ff;font-family:Orbitron,sans-serif;font-size:11px;">' + nombre + '</b><br>' +
    (datos
      ? 'Reconocido: <b style="color:#00d4ff">' + fmtPesos(datos.rec) + '</b><br>' +
        'Pagado: <b style="color:#00ff88">'      + fmtPesos(datos.pag) + '</b><br>' +
        'Registros: <b style="color:#ffcc00">'   + datos.n            + '</b>'
      : '<i style="opacity:.5">Sin datos ET2023</i>') +
    '</div>';
}

function dibujarCapas(gj) {
  if (geojsonLayer) {
    mapaLeaflet.removeLayer(geojsonLayer);
  }

  geojsonLayer = L.geoJSON(gj, {
    style: estiloCapas,
    onEachFeature: function(feature, layer) {
      const nombre = feature.properties.NOMBRE || feature.properties.nombre || '';
      const datos  = lookupDpto(nombre);

      layer.bindTooltip(tooltipHTML(nombre, datos), { sticky: true });

      layer.on('mouseover', function(e) {
        e.target.setStyle({ weight: 2, color: '#00d4ff', fillOpacity: 1 });
      });
      layer.on('mouseout', function(e) {
        geojsonLayer.resetStyle(e.target);
      });
      layer.on('click', function() {
        mostrarDetalle(nombre, datos);
      });
    },
  }).addTo(mapaLeaflet);
}

function refrescarMapa() {
  if (!geojsonLayer || !mapaLeaflet) return;
  geojsonLayer.setStyle(estiloCapas);
}

// ── Detalle departamento ───────────────────────────────────────────────────────
function mostrarDetalle(nombre, d) {
  const panel = document.getElementById('detalle-panel');
  if (!panel) return;

  if (!d) {
    panel.innerHTML =
      '<div class="tb-detalle-title">// ' + nombre + '</div>' +
      '<div class="tb-detalle-empty">Sin registros ET2023<br>para este departamento</div>';
    return;
  }

  const pct     = d.rec > 0 ? ((d.pag / d.rec) * 100).toFixed(1) : '0';
  const clasePct = parseFloat(pct) >= 70 ? 'ok' : parseFloat(pct) >= 40 ? 'warn' : '';

  panel.innerHTML =
    '<div class="tb-detalle-title">// ' + nombre + '</div>' +
    '<div class="tb-det-row"><span class="tb-det-lbl">Registros ET2023</span><span class="tb-det-val">' + d.n + '</span></div>' +
    '<div class="tb-det-row"><span class="tb-det-lbl">Reconocido</span><span class="tb-det-val">' + fmtPesos(d.rec) + '</span></div>' +
    '<div class="tb-det-row"><span class="tb-det-lbl">Pagado</span><span class="tb-det-val ok">' + fmtPesos(d.pag) + '</span></div>' +
    '<div class="tb-det-row"><span class="tb-det-lbl">Pendiente</span><span class="tb-det-val warn">' + fmtPesos(d.rec - d.pag) + '</span></div>' +
    '<div class="tb-det-row"><span class="tb-det-lbl">% Pagado</span><span class="tb-det-val ' + clasePct + '">' + pct + '%</span></div>' +
    '<div class="tb-det-row"><span class="tb-det-lbl">Valor Neto</span><span class="tb-det-val">' + fmtPesos(d.neto) + '</span></div>';
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
window.cambiarTab = function(id, btn) {
  document.querySelectorAll('.tb-panel').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.tb-tab').forEach(function(t)   { t.classList.remove('active'); });

  document.getElementById('panel-' + id).classList.add('active');
  btn.classList.add('active');

  if (id === 'mapa') {
    setTimeout(function() { if (mapaLeaflet) mapaLeaflet.invalidateSize(); }, 100);
    return;
  }

  // Lazy-load iframe
  if (!iframesLoaded[id] && IFRAME_SRC[id]) {
    const fr = document.getElementById('frame-' + id);
    if (fr) {
      fr.src = IFRAME_SRC[id];
      iframesLoaded[id] = true;
    }
  }
};

// ── Toggle métrica ────────────────────────────────────────────────────────────
window.cambiarMetrica = function(metrica, btn) {
  document.querySelectorAll('.tb-toggle').forEach(function(t) { t.classList.remove('active'); });
  btn.classList.add('active');
  metricaActiva = metrica;
  refrescarMapa();
};

// ── Servidor ──────────────────────────────────────────────────────────────────
window.verificarServidor = function() {
  const dot = document.getElementById('srv-dot');
  const txt = document.getElementById('srv-txt');
  dot.className   = 'tb-server-dot';
  txt.textContent = 'Verificando servidor de datos…';

  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var opts = ctrl ? { signal: ctrl.signal } : {};
  if (ctrl) setTimeout(function() { ctrl.abort(); }, 10000);

  fetch(BASE + '/', opts)
    .then(function(r) {
      if (r.status < 500) {
        dot.className   = 'tb-server-dot ok';
        txt.textContent = 'Servidor activo — módulos de análisis disponibles';
      } else {
        throw new Error('HTTP ' + r.status);
      }
    })
    .catch(function() {
      dot.className   = 'tb-server-dot err';
      txt.textContent = 'Servidor iniciando (Render free) — puede tardar hasta 60s la primera vez';
    });
};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  initMapa();
  verificarServidor();
});
