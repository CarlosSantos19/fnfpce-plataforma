"""
servidor_render.py
==================
Versión de servidor_descarga.py para desplegar en Render.
Diferencias con la versión local:
 - Usa config_render.py (Chrome en vez de Edge)
 - Firebase credentials via variable de entorno FIREBASE_KEY_JSON
 - Puerto desde variable de entorno PORT (Render lo asigna automáticamente)
 - DOWNLOAD_DIR en /tmp/cne_descargas

VARIABLES DE ENTORNO requeridas en Render:
  FIREBASE_KEY_JSON   → contenido del JSON del service account (pegar todo el JSON)
  BUCKET              → fnfpce-plataforma.firebasestorage.app  (opcional, tiene default)
"""

import sys, os, platform, threading, uuid, glob, time, traceback, json, re, zipfile, io

# ── En Linux sobreescribir 'config' con config_render antes de cualquier import ──
if platform.system() == 'Linux':
    import importlib.util, types
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("config",
               os.path.join(BASE_DIR, "config_render.py"))
    mod  = importlib.util.module_from_spec(spec)
    sys.modules['config'] = mod
    spec.loader.exec_module(mod)

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import config as cfg

# ── Importar scrapers FNFP ────────────────────────────────────────────────────
from descargar_ingresos_fnfp         import descargar_organizacion_completa as dl_ingresos
from descargar_gastos_fnfp           import descargar_organizacion_completa as dl_gastos
from descargar_consolidados_fnfp     import descargar_consolidados_organizacion as dl_consolidados
from descargar_dictamen_fnfp         import descargar_dictamen_organizacion as dl_dictamen
from descargar_reporte_partido_fnfp  import descargar_reporte_partido_organizacion as dl_reporte_partido
from descargar_libro_contable_fnfp   import descargar_libro_contable_organizacion as dl_libro_contable
from candidato_scraper               import descargar_todo_candidato as dl_candidato_publico
from descargar_resoluciones          import descargar_resoluciones as dl_resoluciones

# ── Firebase Admin ─────────────────────────────────────────────────────────────
try:
    import firebase_admin
    from firebase_admin import credentials, storage as fb_storage

    BUCKET = os.environ.get('BUCKET', 'fnfpce-plataforma.firebasestorage.app')

    if not firebase_admin._apps:
        key_json = os.environ.get('FIREBASE_KEY_JSON', '')
        if key_json:
            # Cargado desde variable de entorno (Render)
            key_dict = json.loads(key_json)
            cred = credentials.Certificate(key_dict)
        else:
            # Fallback: archivo local (desarrollo Windows)
            key_file = os.environ.get('FIREBASE_KEY_FILE',
                r'C:\Users\carlos.santos\Downloads\fnfpce-plataforma-firebase-adminsdk-fbsvc-7e13bfdd8d.json')
            cred = credentials.Certificate(key_file)
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

jobs = {}
jobs_lock = threading.Lock()

MODULOS_FNFP = {
    'ingresos':        dl_ingresos,
    'gastos':          dl_gastos,
    'consolidados':    dl_consolidados,
    'dictamen':        dl_dictamen,
    'reporte_partido': dl_reporte_partido,
    'libro_contable':  dl_libro_contable,
}

MODULOS_PUBLICOS = {
    'candidato_publico': None,
    'resoluciones':      None,
}

# ── Helpers ────────────────────────────────────────────────────────────────────
def limpiar_key(texto):
    s = re.sub(r'[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]', '', str(texto or ''))
    return re.sub(r'\s+', '_', s)[:120]

def construir_storage_key(corp, depto, muni, agrup):
    return limpiar_key(f"{corp}_{depto}_{muni}_{agrup}")

def subir_carpeta(carpeta_local, storage_key, log_fn):
    if not FIREBASE_OK or not bucket:
        log_fn("[FIREBASE] No disponible — archivos quedan en disco local")
        return []
    archivos = glob.glob(os.path.join(carpeta_local, "**", "*"), recursive=True)
    archivos = [f for f in archivos if os.path.isfile(f) and
                f.lower().endswith(('.pdf', '.xlsx', '.xls'))]
    if not archivos:
        log_fn("[STORAGE] No se encontraron archivos para subir")
        return []
    log_fn(f"[STORAGE] {len(archivos)} archivo(s) encontrados...")
    urls = []
    for path in archivos:
        nombre = os.path.relpath(path, carpeta_local).replace("\\", "/")
        destino = f"pdfs/{storage_key}/{nombre}"
        try:
            blob = bucket.blob(destino)
            content_type = ('application/pdf' if path.lower().endswith('.pdf')
                            else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            blob.upload_from_filename(path, content_type=content_type)
            blob.make_public()
            urls.append({'nombre': nombre, 'url': blob.public_url})
            log_fn(f"  [STORAGE] subido: {nombre}")
        except Exception as e:
            log_fn(f"  [ERROR STORAGE] {nombre}: {e}")
    return urls


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
        log(f"Corp: {org_params['corporacion']} | Dpto: {org_params['departamento']}")
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
        archivos = glob.glob(os.path.join(carpeta_base, "**", "*"), recursive=True)
        archivos = [f for f in archivos if os.path.isfile(f) and
                    f.lower().endswith(('.pdf', '.xlsx', '.xls'))]
        log(f"\n>> {len(archivos)} archivo(s) listos para descargar.")
        log("=" * 55)
        log("PROCESO COMPLETADO — usa el botón 'Descargar ZIP'")
        log("=" * 55)
        with jobs_lock:
            jobs[job_id]['status']      = 'done'
            jobs[job_id]['carpeta']     = carpeta_base
            jobs[job_id]['num_archivos'] = len(archivos)
    except Exception as ex:
        log(f"[ERROR FATAL] {ex}")
        with jobs_lock:
            jobs[job_id]['status'] = 'error'
    finally:
        sys.stdout = stdout_orig


def ejecutar_trabajo_publico(job_id, tipo, params, headless, storage_key, carpeta_base):
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
            for cid in ids:
                log(f"\n>> Descargando candidato ID: {cid}")
                try:
                    dl_candidato_publico(int(cid))
                    log(f"   [OK] candidato {cid} completado")
                except Exception as ex:
                    log(f"   [ERROR] candidato {cid}: {str(ex)[:200]}")
        elif tipo == 'resoluciones':
            url = params.get('url_resoluciones',
                             'https://app.cne.gov.co/usuarios/public/notificaciones')
            log(f">> Descargando resoluciones desde: {url}")
            try:
                dl_resoluciones(url)
                log(f"   [OK] resoluciones completadas")
            except Exception as ex:
                log(f"   [ERROR] resoluciones: {str(ex)[:200]}")
        archivos = glob.glob(os.path.join(carpeta_base, "**", "*"), recursive=True)
        archivos = [f for f in archivos if os.path.isfile(f) and
                    f.lower().endswith(('.pdf', '.xlsx', '.xls'))]
        log(f"\n>> {len(archivos)} archivo(s) listos para descargar.")
        log("=" * 55)
        log("PROCESO COMPLETADO — usa el botón 'Descargar ZIP'")
        log("=" * 55)
        with jobs_lock:
            jobs[job_id]['status']       = 'done'
            jobs[job_id]['carpeta']      = carpeta_base
            jobs[job_id]['num_archivos'] = len(archivos)
    except Exception as ex:
        log(f"[ERROR FATAL] {ex}")
        with jobs_lock:
            jobs[job_id]['status'] = 'error'
    finally:
        sys.stdout = stdout_orig


# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.route('/api/ping', methods=['GET'])
def ping():
    return jsonify({'ok': True, 'firebase': FIREBASE_OK,
                    'plataforma': platform.system(), 'version': '2.0'})

@app.route('/api/modulos', methods=['GET'])
def listar_modulos():
    return jsonify({'fnfp': list(MODULOS_FNFP.keys()),
                    'publicos': list(MODULOS_PUBLICOS.keys())})

@app.route('/api/descargar', methods=['POST'])
def iniciar_descarga():
    data = request.get_json(force=True)
    required = ['usuario_cne','password_cne','corporacion','departamento','organizacion']
    faltantes = [f for f in required if not data.get(f,'').strip()]
    if faltantes:
        return jsonify({'error': f'Faltan campos: {", ".join(faltantes)}'}), 400
    modulos_sel = data.get('modulos') or list(MODULOS_FNFP.keys())
    modulos_sel = [m for m in modulos_sel if m in MODULOS_FNFP]
    if not modulos_sel:
        return jsonify({'error': 'Sin módulos válidos'}), 400

    corp  = data.get('corporacion','').strip().upper()
    depto = data.get('departamento','').strip().upper()
    muni  = data.get('municipio','').strip().upper()
    agrup = data.get('organizacion','').strip().upper()
    storage_key  = construir_storage_key(corp, depto, muni, agrup)
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
    threading.Thread(target=ejecutar_trabajo,
        args=(job_id, modulos_sel, org_params,
              data.get('headless', True), storage_key, carpeta_base),
        daemon=True).start()
    return jsonify({'job_id': job_id, 'storage_key': storage_key})

@app.route('/api/descargar_publico', methods=['POST'])
def iniciar_descarga_publica():
    data = request.get_json(force=True)
    tipo = data.get('tipo', '').strip()
    if tipo not in MODULOS_PUBLICOS:
        return jsonify({'error': f'Tipo inválido: {tipo}'}), 400
    corp  = data.get('corporacion', 'PUBLICO').strip().upper()
    depto = data.get('departamento', '').strip().upper()
    muni  = data.get('municipio', '').strip().upper()
    agrup = data.get('organizacion', tipo).strip().upper()
    storage_key  = construir_storage_key(corp, depto, muni, agrup)
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
    threading.Thread(target=ejecutar_trabajo_publico,
        args=(job_id, tipo, params, data.get('headless', True),
              storage_key, carpeta_base),
        daemon=True).start()
    return jsonify({'job_id': job_id, 'storage_key': storage_key})

@app.route('/api/estado/<job_id>', methods=['GET'])
def estado_trabajo(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Trabajo no encontrado'}), 404
    return jsonify({
        'status':       job['status'],
        'logs':         job['logs'],
        'pdfs':         job.get('pdfs', []),
        'num_archivos': job.get('num_archivos', 0),
    })

@app.route('/api/descargar_zip/<job_id>', methods=['GET'])
def descargar_zip(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Trabajo no encontrado'}), 404
    if job['status'] != 'done':
        return jsonify({'error': 'Trabajo aún no completado'}), 400

    carpeta = job.get('carpeta', '')
    if not carpeta or not os.path.isdir(carpeta):
        return jsonify({'error': 'Carpeta de archivos no disponible'}), 404

    archivos = glob.glob(os.path.join(carpeta, "**", "*"), recursive=True)
    archivos = [f for f in archivos if os.path.isfile(f) and
                f.lower().endswith(('.pdf', '.xlsx', '.xls'))]

    if not archivos:
        return jsonify({'error': 'No hay archivos para descargar'}), 404

    # Crear ZIP en memoria
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for ruta in archivos:
            nombre_zip = os.path.relpath(ruta, carpeta).replace("\\", "/")
            zf.write(ruta, nombre_zip)
    buf.seek(0)

    nombre_zip = f"CNE_{job_id}.zip"
    return Response(
        buf.getvalue(),
        mimetype='application/zip',
        headers={
            'Content-Disposition': f'attachment; filename="{nombre_zip}"',
            'Content-Length': str(buf.getbuffer().nbytes),
            'Access-Control-Expose-Headers': 'Content-Disposition',
        }
    )

@app.route('/api/logs/<job_id>', methods=['GET'])
def stream_logs(job_id):
    def generate():
        ultimo_idx = 0
        while True:
            with jobs_lock:
                job = jobs.get(job_id)
            if not job:
                yield "data: [ERROR] Trabajo no encontrado\n\n"
                break
            logs = job['logs']
            for linea in logs[ultimo_idx:]:
                yield f"data: {linea}\n\n"
            ultimo_idx = len(logs)
            if job['status'] in ('done', 'error'):
                yield "data: __FIN__\n\n"
                break
            time.sleep(0.5)
    return Response(stream_with_context(generate()),
                    mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

@app.route('/api/subir_existentes', methods=['POST'])
def subir_existentes():
    data = request.get_json(force=True)
    storage_key = data.get('storage_key', '')
    carpeta = os.path.join(cfg.DOWNLOAD_DIR, storage_key)
    logs = []
    urls = subir_carpeta(carpeta, storage_key, lambda m: logs.append(m))
    return jsonify({'logs': logs, 'pdfs': urls})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    print("=" * 55)
    print(f"  SERVIDOR CNE — FNFPCE v2.0  ({platform.system()})")
    print(f"  Puerto: {port}")
    print(f"  Firebase: {'OK' if FIREBASE_OK else 'NO'}")
    print("=" * 55)
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
