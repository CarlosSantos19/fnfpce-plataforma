"""
config_render.py
================
Versión de config.py compatible con Linux/Render.
Usa Chrome en lugar de Edge, y rutas de Linux.
Los scrapers importan 'config' — este archivo sobreescribe config.py
cuando se corre en Linux.
"""
import sys, os, platform, time, glob, shutil, hashlib, logging
from datetime import datetime

# ── Directorio de descargas ───────────────────────────────────────────────────
# En Linux (Render) usamos /tmp; en Windows la ruta original
if platform.system() == 'Linux':
    DOWNLOAD_DIR = '/tmp/cne_descargas'
else:
    DOWNLOAD_DIR = os.environ.get('CNE_DOWNLOAD_DIR', r'C:\CNE_Descargas')

HEADLESS_MODE = True   # En producción siempre headless

CNE_LOGIN_URL = "https://app.cne.gov.co/usuarios/public/"


def configurar_logging(carpeta_logs=None):
    if carpeta_logs is None:
        carpeta_logs = DOWNLOAD_DIR
    os.makedirs(carpeta_logs, exist_ok=True)
    log_file = os.path.join(carpeta_logs,
                            f"log_cne_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[logging.FileHandler(log_file, encoding='utf-8'),
                  logging.StreamHandler()]
    )
    return log_file


def _hash_archivo(ruta, blocksize=65536):
    h = hashlib.md5()
    try:
        with open(ruta, 'rb') as f:
            buf = f.read(blocksize)
            while buf:
                h.update(buf)
                buf = f.read(blocksize)
        return h.hexdigest()
    except Exception:
        return None


def mover_sin_duplicar(origen, destino):
    if not os.path.exists(destino):
        shutil.move(origen, destino)
        return destino
    if _hash_archivo(origen) == _hash_archivo(destino):
        try: os.remove(origen)
        except: pass
        return None
    nombre_base, extension = os.path.splitext(os.path.basename(destino))
    carpeta = os.path.dirname(destino)
    contador = 1
    nueva_destino = destino
    while os.path.exists(nueva_destino):
        nueva_destino = os.path.join(carpeta, f"{nombre_base}_{contador}{extension}")
        contador += 1
    shutil.move(origen, nueva_destino)
    return nueva_destino


def deduplicar_carpeta(carpeta, extension="*.pdf"):
    archivos = glob.glob(os.path.join(carpeta, extension))
    if not archivos:
        return 0
    hashes = {}
    eliminados = 0
    archivos.sort(key=os.path.getmtime)
    for ruta in archivos:
        h = _hash_archivo(ruta)
        if h is None: continue
        if h in hashes:
            try: os.remove(ruta); eliminados += 1
            except: pass
        else:
            hashes[h] = ruta
    return eliminados


def _habilitar_descargas_headless(driver, download_path):
    try:
        driver.execute_cdp_cmd(
            "Browser.setDownloadBehavior",
            {"behavior": "allow", "downloadPath": download_path}
        )
    except Exception as e:
        logging.warning(f"[DRIVER] No se pudo configurar descargas headless: {e}")


def crear_driver(carpeta_destino=None):
    """
    Crea un driver de Chrome (Linux/Render) o Edge (Windows).
    Selenium 4.6+ gestiona automáticamente el chromedriver/msedgedriver.
    """
    download_path = carpeta_destino if carpeta_destino else DOWNLOAD_DIR
    os.makedirs(download_path, exist_ok=True)

    prefs = {
        "download.default_directory":      download_path,
        "download.prompt_for_download":    False,
        "download.directory_upgrade":      True,
        "safebrowsing.enabled":            False,
        "plugins.always_open_pdf_externally": True,
        "profile.default_content_settings.popups": 0,
        "profile.default_content_setting_values.automatic_downloads": 1,
    }

    if platform.system() == 'Linux':
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service

        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-popup-blocking")
        options.add_argument("--ignore-certificate-errors")
        options.add_experimental_option("prefs", prefs)

        # Buscar Chrome/Chromium instalado
        for binary in ["/usr/bin/chromium", "/usr/bin/chromium-browser",
                        "/usr/bin/google-chrome", "/usr/local/bin/chromium"]:
            if os.path.exists(binary):
                options.binary_location = binary
                break

        # Usar chromedriver del sistema (instalado con chromium-driver)
        chromedriver_path = None
        for drv in ["/usr/bin/chromedriver", "/usr/lib/chromium/chromedriver"]:
            if os.path.exists(drv):
                chromedriver_path = drv
                break

        service = Service(executable_path=chromedriver_path) if chromedriver_path else Service()
        driver = webdriver.Chrome(service=service, options=options)
        _habilitar_descargas_headless(driver, download_path)
        return driver

    else:
        # Windows — Edge (comportamiento original de config.py)
        from selenium import webdriver
        from selenium.webdriver.edge.options import Options
        from selenium.webdriver.edge.service import Service

        options = Options()
        if HEADLESS_MODE:
            options.add_argument("--headless=new")
            options.add_argument("--window-size=1920,1080")
        options.add_experimental_option("prefs", prefs)
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-popup-blocking")
        options.add_argument("--ignore-certificate-errors")

        base_dir = os.path.dirname(os.path.abspath(__file__))
        ruta_driver_local = os.path.join(base_dir, "msedgedriver.exe")
        service = Service(executable_path=ruta_driver_local) if os.path.exists(ruta_driver_local) else Service()

        driver = webdriver.Edge(service=service, options=options)
        _habilitar_descargas_headless(driver, download_path)
        return driver


def esperar_descarga_completa(carpeta, timeout=60):
    tiempo_inicio = time.time()
    ultimo_tamano = -1
    verificaciones_estables = 0
    while (time.time() - tiempo_inicio) < timeout:
        archivos_descargando = (glob.glob(os.path.join(carpeta, "*.crdownload")) +
                                glob.glob(os.path.join(carpeta, "*.tmp")) +
                                glob.glob(os.path.join(carpeta, "*.partial")))
        if archivos_descargando:
            time.sleep(1)
            continue
        archivos_pdf = glob.glob(os.path.join(carpeta, "*.pdf"))
        if not archivos_pdf:
            time.sleep(0.5)
            continue
        archivo_reciente = max(archivos_pdf, key=os.path.getmtime)
        try:
            tamano_actual = os.path.getsize(archivo_reciente)
            if tamano_actual == ultimo_tamano and tamano_actual > 0:
                verificaciones_estables += 1
                if verificaciones_estables >= 3:
                    try:
                        with open(archivo_reciente, 'rb') as f: f.read(1024)
                        time.sleep(2)
                        return True
                    except: pass
            else:
                verificaciones_estables = 0
                ultimo_tamano = tamano_actual
        except: pass
        time.sleep(1)
    return False


def esperar_archivo_especifico(archivo_pdf, timeout=30):
    tiempo_inicio = time.time()
    ultimo_tamano = -1
    verificaciones_estables = 0
    archivo_crdownload = archivo_pdf + ".crdownload"
    while (time.time() - tiempo_inicio) < timeout:
        if os.path.exists(archivo_crdownload):
            time.sleep(0.5)
            continue
        if not os.path.exists(archivo_pdf):
            time.sleep(0.5)
            continue
        try:
            tamano_actual = os.path.getsize(archivo_pdf)
            if tamano_actual == ultimo_tamano and tamano_actual > 0:
                verificaciones_estables += 1
                if verificaciones_estables >= 2:
                    try:
                        with open(archivo_pdf, 'rb') as f: f.read(1024)
                        return True
                    except: pass
            else:
                verificaciones_estables = 0
                ultimo_tamano = tamano_actual
        except: pass
        time.sleep(0.5)
    return False


def limpiar_descargas_incompletas(carpeta):
    for ext in ["*.crdownload", "*.tmp", "*.partial"]:
        for archivo in glob.glob(os.path.join(carpeta, ext)):
            try: os.remove(archivo)
            except: pass


def obtener_version_edge():
    return None


def diagnostico_sistema():
    print(f"Plataforma: {platform.system()}")
    print(f"DOWNLOAD_DIR: {DOWNLOAD_DIR}")
