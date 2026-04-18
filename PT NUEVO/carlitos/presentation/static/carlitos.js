// ============================================================
// CARLITOS - Logica del Asistente Robotico CNE
// ============================================================

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/chat`;

// ─── Estado global ───────────────────────────────────────────
const estado = {
  ws: null,
  grabando: false,
  recognition: null,
  ttsActivo: true,
  esperandoRespuesta: false,
  carpetaActiva: null,
  mensajeActual: null,   // elemento DOM del mensaje asistente en curso
  textoActual: "",       // texto acumulado del chunk actual
};

// ─── Elementos DOM ───────────────────────────────────────────
const elems = {
  rostro:        document.getElementById("robot-face"),
  estadoLabel:   document.getElementById("estado-label"),
  mensajes:      document.getElementById("chat-mensajes"),
  typing:        document.getElementById("typing-indicator"),
  inputTexto:    document.getElementById("input-texto"),
  btnEnviar:     document.getElementById("btn-enviar"),
  btnVoz:        document.getElementById("btn-voz"),
  btnTts:        document.getElementById("btn-tts"),
  btnLimpiar:    document.getElementById("btn-limpiar"),
  listaCarpetas: document.getElementById("lista-carpetas"),
  carpetaTag:    document.getElementById("carpeta-activa-tag"),
  voiceWaves:    document.getElementById("voice-waves"),
  carpetasCount: document.getElementById("carpetas-count"),
  reloj:         document.getElementById("reloj"),
};

// ─── Reloj HUD ───────────────────────────────────────────────
function actualizarReloj() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  if (elems.reloj) elems.reloj.textContent = `${h}:${m}:${s}`;
}
setInterval(actualizarReloj, 1000);
actualizarReloj();

// ─── Fondo animado (grid + particulas) ───────────────────────
(function initCanvas() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  const GRID = 50;
  let t = 0;

  // Particulas
  const particles = Array.from({ length: 40 }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 1.5 + 0.5,
    a: Math.random(),
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = `rgba(0,180,255,0.06)`;
    ctx.lineWidth = 0.5;
    for (let x = 0; x < canvas.width; x += GRID) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += GRID) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Puntos en intersecciones
    ctx.fillStyle = `rgba(0,245,255,0.15)`;
    for (let x = 0; x < canvas.width; x += GRID) {
      for (let y = 0; y < canvas.height; y += GRID) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Particulas flotantes
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
      p.a = 0.3 + 0.3 * Math.sin(t * 0.02 + p.x);

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,245,255,${p.a})`;
      ctx.fill();
    });

    t++;
    requestAnimationFrame(draw);
  }
  draw();
})();

// ─── WebSocket ───────────────────────────────────────────────
function conectarWS() {
  estado.ws = new WebSocket(WS_URL);

  estado.ws.onopen = () => console.log("WS conectado");

  estado.ws.onmessage = (ev) => {
    try { manejarMensajeWS(JSON.parse(ev.data)); }
    catch (e) { console.error("Error parseando WS:", e); }
  };

  estado.ws.onclose = () => {
    console.log("WS cerrado. Reconectando en 3s...");
    setTimeout(conectarWS, 3000);
  };

  estado.ws.onerror = (e) => console.error("WS error:", e);
}

function manejarMensajeWS(msg) {
  switch (msg.tipo) {
    case "chunk":
      manejarChunk(msg);
      break;
    case "fin":
      manejarFin(msg);
      break;
    case "pensando":
      setEstadoRostro("pensando");
      mostrarTyping(true);
      break;
    case "error":
      mostrarError(msg.mensaje);
      manejarFin({ estado: "idle" });
      break;
    case "carpetas":
      renderCarpetas(msg.lista);
      break;
    case "limpiar_ok":
      elems.mensajes.innerHTML = "";
      estado.carpetaActiva = null;
      actualizarTagCarpeta();
      break;
  }
}

function manejarChunk(msg) {
  mostrarTyping(false);
  setEstadoRostro(msg.estado || "hablando");

  if (!estado.mensajeActual) {
    estado.mensajeActual = crearBurbujaMensaje("asistente");
    estado.textoActual = "";
  }

  estado.textoActual += msg.texto;
  estado.mensajeActual.querySelector(".contenido").innerHTML =
    renderMarkdown(estado.textoActual);

  scrollMensajes();
}

function manejarFin(msg) {
  const estadoFinal = msg.estado || "idle";
  setEstadoRostro(estadoFinal);
  mostrarTyping(false);

  if (estado.mensajeActual && estado.ttsActivo && estado.textoActual.trim()) {
    hablarTexto(estado.textoActual);
  }

  estado.mensajeActual = null;
  estado.textoActual = "";
  estado.esperandoRespuesta = false;
  elems.btnEnviar.disabled = false;
}

// ─── Enviar mensaje ──────────────────────────────────────────
function enviarMensaje(texto, esVoz = false) {
  if (!texto.trim() || estado.esperandoRespuesta) return;
  if (!estado.ws || estado.ws.readyState !== WebSocket.OPEN) {
    mostrarError("Sin conexion al servidor.");
    return;
  }

  // Detener TTS previo
  speechSynthesis.cancel();

  // Mostrar mensaje del usuario
  const burbuja = crearBurbujaMensaje("usuario");
  burbuja.querySelector(".contenido").textContent = texto;
  scrollMensajes();

  estado.esperandoRespuesta = true;
  elems.btnEnviar.disabled = true;
  elems.inputTexto.value = "";
  elems.inputTexto.style.height = "42px";

  estado.ws.send(JSON.stringify({
    tipo: "mensaje",
    texto,
    carpeta: estado.carpetaActiva,
    es_voz: esVoz,
  }));
}

// ─── Burbujas de chat ────────────────────────────────────────
function crearBurbujaMensaje(rol) {
  const div = document.createElement("div");
  div.className = `mensaje ${rol}`;

  const rolDiv = document.createElement("div");
  rolDiv.className = "rol";
  rolDiv.innerHTML = rol === "asistente"
    ? "&#129302; Carlitos"
    : "&#128100; Tú";

  const cont = document.createElement("div");
  cont.className = "contenido";

  div.appendChild(rolDiv);
  div.appendChild(cont);
  elems.mensajes.appendChild(div);
  scrollMensajes();
  return div;
}

function mostrarError(texto) {
  const div = crearBurbujaMensaje("asistente");
  div.style.borderColor = "var(--rojo-error)";
  div.querySelector(".contenido").textContent = "⚠ " + texto;
}

function scrollMensajes() {
  elems.mensajes.scrollTop = elems.mensajes.scrollHeight;
}

// ─── Markdown basico ─────────────────────────────────────────
function renderMarkdown(texto) {
  return texto
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^#{1,3} (.+)$/gm, "<strong style='font-size:1.05em'>$1</strong>")
    .replace(/^[-*] (.+)$/gm, "&bull; $1")
    .replace(/\n/g, "<br>");
}

// ─── Estado del rostro ───────────────────────────────────────
const LABELS = {
  idle:        "EN ESPERA",
  hablando:    "HABLANDO",
  pensando:    "PENSANDO",
  escuchando:  "ESCUCHANDO",
  error:       "ERROR",
};

function setEstadoRostro(nuevoEstado) {
  elems.rostro.className = "robot-face " + nuevoEstado;
  elems.estadoLabel.className = "estado-label " + nuevoEstado;
  elems.estadoLabel.textContent = "■ " + (LABELS[nuevoEstado] || nuevoEstado.toUpperCase());
  // Ondas de voz activas solo cuando habla o escucha
  if (elems.voiceWaves) {
    elems.voiceWaves.classList.toggle("activo",
      nuevoEstado === "hablando" || nuevoEstado === "escuchando");
  }
}

function mostrarTyping(visible) {
  elems.typing.classList.toggle("visible", visible);
}

// ─── Voz - Reconocimiento (STT) ──────────────────────────────
function iniciarReconocimiento() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Tu navegador no soporta reconocimiento de voz. Usa Chrome.");
    return;
  }

  if (estado.grabando) {
    estado.recognition?.stop();
    return;
  }

  const rec = new SpeechRecognition();
  rec.lang = "es-CO";
  rec.continuous = false;
  rec.interimResults = false;

  rec.onstart = () => {
    estado.grabando = true;
    elems.btnVoz.classList.add("grabando");
    elems.btnVoz.title = "Escuchando... (click para detener)";
    setEstadoRostro("escuchando");
    speechSynthesis.cancel();
  };

  rec.onresult = (e) => {
    const texto = e.results[0][0].transcript;
    elems.inputTexto.value = texto;
    enviarMensaje(texto, true);
  };

  rec.onerror = (e) => {
    console.error("STT error:", e.error);
    if (e.error !== "aborted") mostrarError("Error de micrófono: " + e.error);
  };

  rec.onend = () => {
    estado.grabando = false;
    estado.recognition = null;
    elems.btnVoz.classList.remove("grabando");
    elems.btnVoz.title = "Hablar";
    if (!estado.esperandoRespuesta) setEstadoRostro("idle");
  };

  estado.recognition = rec;
  rec.start();
}

// ─── Voz - Sintesis (TTS) ────────────────────────────────────
function hablarTexto(texto) {
  if (!estado.ttsActivo) return;
  speechSynthesis.cancel();

  // Limpia markdown y texto entre corchetes
  const textoLimpio = texto
    .replace(/\[.*?\]/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[#>-] /gm, "")
    .replace(/&bull;/g, "")
    .trim();

  if (!textoLimpio) return;

  const utterance = new SpeechSynthesisUtterance(textoLimpio);
  utterance.lang = "es-CO";
  utterance.rate = 1.0;
  utterance.pitch = 0.9;

  // Seleccionar voz en español si disponible
  const voces = speechSynthesis.getVoices();
  const vozES = voces.find(v => v.lang.startsWith("es") && v.name.includes("Google"))
    || voces.find(v => v.lang.startsWith("es"));
  if (vozES) utterance.voice = vozES;

  utterance.onstart  = () => setEstadoRostro("hablando");
  utterance.onend    = () => { if (!estado.esperandoRespuesta) setEstadoRostro("idle"); };
  utterance.onerror  = () => {};

  speechSynthesis.speak(utterance);
}

// ─── Carpetas ────────────────────────────────────────────────
function renderCarpetas(lista) {
  elems.listaCarpetas.innerHTML = "";
  if (elems.carpetasCount) elems.carpetasCount.textContent = lista ? lista.length : 0;

  if (!lista || lista.length === 0) {
    elems.listaCarpetas.innerHTML =
      '<div class="carpetas-vacio">No hay carpetas en CNE_Descargas</div>';
    return;
  }

  lista.forEach(nombre => {
    const div = document.createElement("div");
    div.className = "carpeta-item";
    div.textContent = nombre;
    div.title = nombre;
    div.onclick = () => seleccionarCarpeta(nombre, div);
    elems.listaCarpetas.appendChild(div);
  });
}

function seleccionarCarpeta(nombre, elem) {
  // Deseleccionar anterior
  document.querySelectorAll(".carpeta-item.activa")
    .forEach(el => el.classList.remove("activa"));

  if (estado.carpetaActiva === nombre) {
    // Deseleccionar si ya estaba activa
    estado.carpetaActiva = null;
    actualizarTagCarpeta();
    return;
  }

  elem.classList.add("activa");
  estado.carpetaActiva = nombre;
  actualizarTagCarpeta();

  estado.ws?.send(JSON.stringify({
    tipo: "seleccionar_carpeta",
    carpeta: nombre,
  }));
}

function actualizarTagCarpeta() {
  if (estado.carpetaActiva) {
    elems.carpetaTag.textContent = "Carpeta: " + estado.carpetaActiva;
    elems.carpetaTag.style.display = "block";
  } else {
    elems.carpetaTag.style.display = "none";
  }
}

// ─── Eventos ─────────────────────────────────────────────────
elems.btnEnviar.addEventListener("click", () => {
  enviarMensaje(elems.inputTexto.value.trim());
});

elems.inputTexto.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviarMensaje(elems.inputTexto.value.trim());
  }
  // Auto-resize
  setTimeout(() => {
    elems.inputTexto.style.height = "42px";
    elems.inputTexto.style.height = Math.min(elems.inputTexto.scrollHeight, 120) + "px";
  }, 0);
});

elems.btnVoz.addEventListener("click", iniciarReconocimiento);

elems.btnTts.addEventListener("click", () => {
  estado.ttsActivo = !estado.ttsActivo;
  elems.btnTts.classList.toggle("activo", estado.ttsActivo);
  elems.btnTts.title = estado.ttsActivo ? "Voz activada" : "Voz desactivada";
  if (!estado.ttsActivo) speechSynthesis.cancel();
});

elems.btnLimpiar.addEventListener("click", () => {
  if (confirm("¿Limpiar la conversación?")) {
    speechSynthesis.cancel();
    estado.ws?.send(JSON.stringify({ tipo: "limpiar" }));
  }
});

// ─── Init ────────────────────────────────────────────────────
// Cargar voces (async en algunos navegadores)
speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
speechSynthesis.getVoices();

// Estado inicial del TTS
elems.btnTts.classList.add("activo");

// Conectar WebSocket
conectarWS();

// Ocultar tag carpeta al inicio
actualizarTagCarpeta();
