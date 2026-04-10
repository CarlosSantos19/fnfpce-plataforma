"""
servidor_descarga.py
====================
Servidor Flask que expone los scrapers de cuentas claras como API REST.
El módulo web descarga-pdf llama a este servidor para ejecutar las descargas.

INICIAR:
  cd "C:\Users\carlos.santos\Desktop\APLICATIVO\cuentas claras"
  pip install flask flask-cors firebase-admin
  python servidor_descarga.py

El servidor queda en http://localhost:5050
"""

import sys, os, threading, uuid, glob, time, traceback, json, re, shutil
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS

# ── Agregar la carpeta de scrapers al path ─────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import config as cfg

# ── Importar módulos FNFP (requieren login CNE) ───────────────────────────────
from descargar_ingresos_fnfp         import descargar_organizacion_completa as dl_ingresos
from descargar_gastos_fnfp           import descargar_organizacion_completa as dl_gastos
from descargar_consolidados_fnfp     import descargar_consolidados_organizacion as dl_consolidados
from descargar_dictamen_fnfp         import descargar_dictamen_organizacion as dl_dictamen
from descargar_reporte_partido_fnfp  import descargar_reporte_partido_organizacion as dl_reporte_partido
from descargar_libro_contable_fnfp   import descargar_libro_contable_organizacion as dl_libro_contable

# ── Importar módulos públicos (sin login) ─────────────────────────────────────
from candidato_scraper     import descargar_todo_candidato as dl_candidato_publico
from descargar_resoluciones import descargar_resoluciones as dl_resoluciones

# ── Firebase Admin (subir a Storage) ──────────────────────────────────────────
try:
    import firebase_admin
    from firebase_admin import credentials, storage as fb_storage

    KEY_FILE = r"C:\Users\carlos.santos\Downloads\fnfpce-plataforma-firebase-adminsdk-fbsvc-7e13bfdd8d.json"
    BUCKET   = "fnfpce-plataforma.firebasestorage.app"

    if not firebase_admin._apps:
        cred = credentials.Certificate(KEY_FILE)
        firebase_admin.initialize_app(cred, {'storageBucket': BUCKET})
    bucket = fb_storage.bucket()
    FIREBASE_OK = True
    print("[FIREBASE] Conectado OK")
except Exception as e:
    FIREBASE_OK = False
    bucket = None
    print(f"[FIREBASE] No disponible: {e}")

# ── App Flask ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, origins="*")

# ── Estado de trabajos ─────────────────────────────────────────────────────────
# job_id → { 'status': 'running'|'done'|'error', 'logs': [], 'pdfs': [] }
jobs = {}
jobs_lock = threading.Lock()

# ── Helpers ────────────────────────────────────────────────────────────────────
def limpiar_key(texto):
    s = re.sub(r'[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]', '', str(texto or ''))
    return re.sub(r'\s+', '_', s)[:120]

def construir_storage_key(corp, depto, muni, agrup):
    return limpiar_key(f"{corp}_{depto}_{muni}_{agrup}")

def subir_carpeta(carpeta_local, storage_key, log_fn):
    """Sube todos los PDFs/Excel de una carpeta a Firebase Storage."""
    if not FIREBASE_OK or not bucket:
        log_fn("[FIREBASE] No disponible — archivos quedan en disco local")
        return []
    urls = []
    archivos = glob.glob(os.path.join(carpeta_local, "**", "*"), recursive=True)
    archivos = [f for f in archivos if os.path.isfile(f) and
                f.lower().endswith(('.pdf', '.xlsx', '.xls'))]
    if not archivos:
        log_fn("[STORAGE] No se encontraron archivos PDF/Excel para subir")
        return []
    log_fn(f"[STORAGE] {len(archivos)} archivo(s) encontrados para subir...")
    for path in archivos:
        nombre = os.path.relpath(path, carpeta_local).replace("\\", "/")
        destino = f"pdfs/{storage_key}/{nombre}"
        try:
            blob = bucket.blob(destino)
            content_type = 'application/pdf' if path.lower().endswith('.pdf') else \
                           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            blob.upload_from_filename(path, content_type=content_type)
            blob.make_public()
            urls.append({'nombre': nombre, 'url': blob.public_url})
            log_fn(f"  [STORAGE] subido: {nombre}")
        except Exception as e:
            log_fn(f"  [ERROR STORAGE] {nombre}: {e}")
    return urls

# ── Interceptor de print ───────────────────────────────────────────────────────
class LogCapture:
    def __init__(self, log_fn):
        self.log_fn = log_fn
        self.buf = ""

    def write(self, txt):
        self.buf += txt
        while "\n" in self.buf:
            linea, self.buf = self.buf.split("\n", 1)
            linea = linea.strip()
            if linea:
                self.log_fn(linea)

    def flush(self):
        pass

# ── Ejecutor de módulos FNFP en hilo ──────────────────────────────────────────
MODULOS_FNFP = {
    'ingresos':        dl_ingresos,
    'gastos':          dl_gastos,
    'consolidados':    dl_consolidados,
    'dictamen':        dl_dictamen,
    'reporte_partido': dl_reporte_partido,
    'libro_contable':  dl_libro_contable,
}

# Módulos públicos (no requieren credenciales CNE)
MODULOS_PUBLICOS = {
    'candidato_publico': None,   # especial: necesita id_candidato
    'resoluciones':      None,   # especial: necesita url
}

def ejecutar_trabajo(job_id, modulos_sel, org_params, headless, storage_key, carpeta_base):
    def log(msg):
        with jobs_lock:
            jobs[job_id]['logs'].append(msg)

    stdout_orig = sys.stdout
    sys.stdout = LogCapture(log)

    try:
        cfg.HEADLESS_MODE = headless

        log("=" * 55)
        log(f"INICIO: {', '.join(modulos_sel).upper()}")
        log(f"Org: {org_params['organizacion']}")
        log(f"Corp: {org_params['corporacion']} | Dpto: {org_params['departamento']} | Mun: {org_params['municipio']}")
        log("=" * 55)

        for mod in modulos_sel:
            fn = MODULOS_FNFP.get(mod)
            if not fn:
                log(f"[SKIP] módulo desconocido: {mod}")
                continue

            log(f"\n>> Ejecutando: {mod.upper()} ...")
            try:
                fn(**org_params)
                log(f"   [OK] {mod} completado")
            except Exception as ex:
                log(f"   [ERROR] {mod}: {str(ex)[:200]}")
                log(traceback.format_exc()[-400:])

        # Subir a Firebase Storage
        log("\n>> Subiendo archivos a Firebase Storage...")
        urls = subir_carpeta(carpeta_base, storage_key, log)
        with jobs_lock:
            jobs[job_id]['pdfs'] = urls

        log("=" * 55)
        log("PROCESO COMPLETADO")
        log("=" * 55)

        with jobs_lock:
            jobs[job_id]['status'] = 'done'

    except Exception as ex:
        log(f"[ERROR FATAL] {ex}")
        with jobs_lock:
            jobs[job_id]['status'] = 'error'
    finally:
        sys.stdout = stdout_orig


def ejecutar_trabajo_publico(job_id, tipo, params, headless, storage_key, carpeta_base):
    """Ejecutor para módulos públicos (sin login CNE)."""
    def log(msg):
        with jobs_lock:
            jobs[job_id]['logs'].append(msg)

    stdout_orig = sys.stdout
    sys.stdout = LogCapture(log)

    try:
        cfg.HEADLESS_MODE = headless
        cfg.DOWNLOAD_DIR  = carpeta_base

        log("=" * 55)
        log(f"INICIO: {tipo.upper()}")
        log("=" * 55)

        if tipo == 'candidato_publico':
            ids = params.get('ids_candidato', [])
            if not ids:
                log("[ERROR] No se proporcionaron IDs de candidato")
            else:
                for cid in ids:
                    log(f"\n>> Descargando candidato ID: {cid}")
                    try:
                        dl_candidato_publico(int(cid))
                        log(f"   [OK] candidato {cid} completado")
                    except Exception as ex:
                        log(f"   [ERROR] candidato {cid}: {str(ex)[:200]}")

        elif tipo == 'resoluciones':
            url = params.get('url_resoluciones', 'https://app.cne.gov.co/usuarios/public/notificaciones')
            log(f">> Descargando resoluciones desde: {url}")
            try:
                dl_resoluciones(url)
                log(f"   [OK] resoluciones completadas")
            except Exception as ex:
                log(f"   [ERROR] resoluciones: {str(ex)[:200]}")

        # Subir a Firebase Storage
        log("\n>> Subiendo archivos a Firebase Storage...")
        urls = subir_carpeta(carpeta_base, storage_key, log)
        with jobs_lock:
            jobs[job_id]['pdfs'] = urls

        log("=" * 55)
        log("PROCESO COMPLETADO")
        log("=" * 55)

        with jobs_lock:
            jobs[job_id]['status'] = 'done'

    except Exception as ex:
        log(f"[ERROR FATAL] {ex}")
        with jobs_lock:
            jobs[job_id]['status'] = 'error'
    finally:
        sys.stdout = stdout_orig
        cfg.DOWNLOAD_DIR = r"C:\CNE_Descargas"


# ── ENDPOINTS ──────────────────────────────────────────────────────────────────

@app.route('/api/ping', methods=['GET'])
def ping():
    return jsonify({'ok': True, 'firebase': FIREBASE_OK, 'version': '2.0'})


@app.route('/api/modulos', methods=['GET'])
def listar_modulos():
    """Lista los módulos disponibles clasificados por tipo."""
    return jsonify({
        'fnfp': list(MODULOS_FNFP.keys()),
        'publicos': list(MODULOS_PUBLICOS.keys()),
    })


@app.route('/api/descargar', methods=['POST'])
def iniciar_descarga():
    """
    Descarga FNFP (requiere credenciales CNE).

    Body JSON:
    {
      "usuario_cne": "...",
      "password_cne": "...",
      "proceso_electoral": "ELECCIONES TERRITORIALES 2023",
      "corporacion": "Alc",           // Alc|Con|Asa|Gob
      "circunscripcion": "Municipal",
      "departamento": "Cundinamarca",
      "municipio": "Bogota",
      "tipo_organizacion": "Or",      // Or|Co|Gr
      "organizacion": "PARTIDO LIBERAL",
      "modulos": ["ingresos","gastos"],
      "headless": false
    }
    """
    data = request.get_json(force=True)

    required = ['usuario_cne','password_cne','corporacion','departamento','organizacion']
    faltantes = [f for f in required if not data.get(f,'').strip()]
    if faltantes:
        return jsonify({'error': f'Faltan campos: {", ".join(faltantes)}'}), 400

    modulos_sel = data.get('modulos') or list(MODULOS_FNFP.keys())
    modulos_sel = [m for m in modulos_sel if m in MODULOS_FNFP]
    if not modulos_sel:
        return jsonify({'error': 'Sin módulos FNFP válidos seleccionados'}), 400

    corp  = data.get('corporacion', '').strip().upper()
    depto = data.get('departamento', '').strip().upper()
    muni  = data.get('municipio', '').strip().upper()
    agrup = data.get('organizacion', '').strip().upper()
    storage_key = construir_storage_key(corp, depto, muni, agrup)

    carpeta_base = os.path.join(cfg.DOWNLOAD_DIR, storage_key)
    os.makedirs(carpeta_base, exist_ok=True)

    org_params = {
        'usuario_cne':       data['usuario_cne'].strip(),
        'password_cne':      data['password_cne'].strip(),
        'proceso_electoral': data.get('proceso_electoral', 'ELECCIONES TERRITORIALES 2023').strip(),
        'corporacion':       data['corporacion'].strip(),
        'circunscripcion':   data.get('circunscripcion', 'Municipal').strip(),
        'departamento':      data['departamento'].strip(),
        'municipio':         data.get('municipio', '').strip(),
        'tipo_organizacion': data.get('tipo_organizacion', 'Or').strip(),
        'organizacion':      data['organizacion'].strip(),
        'carpeta_base':      carpeta_base,
    }

    job_id = str(uuid.uuid4())[:8]
    with jobs_lock:
        jobs[job_id] = {'status': 'running', 'logs': [], 'pdfs': []}

    t = threading.Thread(
        target=ejecutar_trabajo,
        args=(job_id, modulos_sel, org_params, data.get('headless', False),
              storage_key, carpeta_base),
        daemon=True
    )
    t.start()

    return jsonify({'job_id': job_id, 'storage_key': storage_key})


@app.route('/api/descargar_publico', methods=['POST'])
def iniciar_descarga_publica():
    """
    Descarga pública (sin credenciales CNE).

    Body JSON para candidato_publico:
    {
      "tipo": "candidato_publico",
      "ids_candidato": [93337081, 12345678],
      "corporacion": "CONCEJO",
      "departamento": "Cundinamarca",
      "municipio": "Bogota",
      "organizacion": "PARTIDO LIBERAL",
      "headless": false
    }

    Body JSON para resoluciones:
    {
      "tipo": "resoluciones",
      "url_resoluciones": "https://app.cne.gov.co/usuarios/public/notificaciones",
      "organizacion": "RESOLUCIONES_CNE",
      "headless": false
    }
    """
    data = request.get_json(force=True)
    tipo = data.get('tipo', '').strip()

    if tipo not in MODULOS_PUBLICOS:
        return jsonify({'error': f'Tipo inválido: {tipo}. Válidos: {list(MODULOS_PUBLICOS.keys())}'}), 400

    corp  = data.get('corporacion', 'PUBLICO').strip().upper()
    depto = data.get('departamento', '').strip().upper()
    muni  = data.get('municipio', '').strip().upper()
    agrup = data.get('organizacion', tipo).strip().upper()
    storage_key = construir_storage_key(corp, depto, muni, agrup)

    carpeta_base = os.path.join(cfg.DOWNLOAD_DIR, storage_key)
    os.makedirs(carpeta_base, exist_ok=True)

    params = {
        'ids_candidato':    data.get('ids_candidato', []),
        'url_resoluciones': data.get('url_resoluciones',
                                     'https://app.cne.gov.co/usuarios/public/notificaciones'),
    }

    job_id = str(uuid.uuid4())[:8]
    with jobs_lock:
        jobs[job_id] = {'status': 'running', 'logs': [], 'pdfs': []}

    t = threading.Thread(
        target=ejecutar_trabajo_publico,
        args=(job_id, tipo, params, data.get('headless', False),
              storage_key, carpeta_base),
        daemon=True
    )
    t.start()

    return jsonify({'job_id': job_id, 'storage_key': storage_key})


@app.route('/api/estado/<job_id>', methods=['GET'])
def estado_trabajo(job_id):
    """Consulta el estado y logs de un trabajo."""
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Trabajo no encontrado'}), 404
    return jsonify({
        'status': job['status'],
        'logs':   job['logs'],
        'pdfs':   job['pdfs'],
    })


@app.route('/api/logs/<job_id>', methods=['GET'])
def stream_logs(job_id):
    """SSE: transmite los logs en tiempo real."""
    def generate():
        ultimo_idx = 0
        while True:
            with jobs_lock:
                job = jobs.get(job_id)
            if not job:
                yield f"data: [ERROR] Trabajo no encontrado\n\n"
                break
            logs = job['logs']
            nuevos = logs[ultimo_idx:]
            for linea in nuevos:
                yield f"data: {linea}\n\n"
            ultimo_idx = len(logs)
            if job['status'] in ('done', 'error'):
                yield f"data: __FIN__\n\n"
                break
            time.sleep(0.5)
    return Response(stream_with_context(generate()),
                    mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache',
                             'X-Accel-Buffering': 'no'})


@app.route('/api/jobs', methods=['GET'])
def listar_jobs():
    """Lista todos los trabajos activos/recientes."""
    with jobs_lock:
        resumen = {
            jid: {
                'status': j['status'],
                'log_count': len(j['logs']),
                'pdf_count': len(j['pdfs']),
            }
            for jid, j in jobs.items()
        }
    return jsonify(resumen)


@app.route('/api/archivos_locales', methods=['POST'])
def listar_archivos_locales():
    """Lista los PDFs/Excel descargados en disco para una org."""
    data = request.get_json(force=True)
    storage_key = data.get('storage_key', '')
    carpeta = os.path.join(cfg.DOWNLOAD_DIR, storage_key)
    if not os.path.isdir(carpeta):
        return jsonify({'archivos': []})
    archivos = glob.glob(os.path.join(carpeta, "**", "*"), recursive=True)
    archivos = [
        {
            'nombre': os.path.relpath(f, carpeta).replace("\\", "/"),
            'tamano': os.path.getsize(f),
            'ruta':   f,
        }
        for f in archivos if os.path.isfile(f) and
        f.lower().endswith(('.pdf', '.xlsx', '.xls'))
    ]
    return jsonify({'archivos': archivos, 'carpeta': carpeta})


@app.route('/api/subir_existentes', methods=['POST'])
def subir_existentes():
    """Sube a Firebase Storage los archivos ya descargados en disco."""
    data = request.get_json(force=True)
    storage_key = data.get('storage_key', '')
    carpeta = os.path.join(cfg.DOWNLOAD_DIR, storage_key)
    logs = []
    urls = subir_carpeta(carpeta, storage_key, lambda m: logs.append(m))
    return jsonify({'logs': logs, 'pdfs': urls})


if __name__ == '__main__':
    print("=" * 55)
    print("  SERVIDOR DE DESCARGA CNE — FNFPCE v2.0")
    print(f"  URL: http://localhost:5050")
    print(f"  Carpeta descargas: {cfg.DOWNLOAD_DIR}")
    print(f"  Firebase Storage: {'OK' if FIREBASE_OK else 'NO CONECTADO'}")
    print(f"  Módulos FNFP: {', '.join(MODULOS_FNFP.keys())}")
    print(f"  Módulos Públicos: {', '.join(MODULOS_PUBLICOS.keys())}")
    print("=" * 55)
    app.run(host='0.0.0.0', port=5050, debug=False, threaded=True)
