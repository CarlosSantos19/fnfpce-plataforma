"""
indexar_congreso_2026.py
========================
Descarga el índice del Congreso 2026 desde CNE - Cuentas Claras.

Endpoint descubierto: GET /getCandidatos
Parámetros: id_tipo, id_organizacion, id_corporacion, id_circunscripcion, id_proceso=1

Guarda:
  data/cc_index_1.json          → índice principal para el portal
  data/cc_procesos.json         → lista de procesos

Uso:
  python indexar_congreso_2026.py --usuario 12345678 --password mipass
"""

import sys, io, os, re, json, argparse, threading, getpass, unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ── Constantes ────────────────────────────────────────────────────────────────
CNE_API        = "https://app_cng_2026.cne.gov.co/fondo_cng_2026/public"
CNE_LOGIN_HOME = "https://app_cng_2026.cne.gov.co/usuarios_cng_2026/public/"
CNE_LOGIN_URL  = "https://app_cng_2026.cne.gov.co/usuarios_cng_2026/public/login"
CNE_AUTOLOGIN  = "https://app_cng_2026.cne.gov.co/usuarios_cng_2026/public/autoLoginRedirect/1"
DATA_DIR       = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PROCESO_ID     = 1   # proceso Congreso 2026 en este sistema

CORP_NOMBRES = {
    1: "CAMARA DE REPRESENTANTES",
    4: "SENADO DE LA REPUBLICA",
}

def _norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper().strip())

def _ok(msg):  print(f"  [OK]  {msg}")
def _err(msg): print(f"  [ERR] {msg}", file=sys.stderr)
def _inf(msg): print(f"  ...   {msg}")
def _sep():    print("-" * 65)

def _guardar(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    rel = os.path.relpath(path, DATA_DIR)
    _ok(f"Guardado {rel}  ({os.path.getsize(path) // 1024} KB)")

# ── Login ─────────────────────────────────────────────────────────────────────
def _set_xsrf(sess):
    """Extrae el XSRF-TOKEN de las cookies y lo pone en el header."""
    from urllib.parse import unquote
    xsrf = sess.cookies.get("XSRF-TOKEN")
    if xsrf:
        sess.headers.update({"X-XSRF-TOKEN": unquote(xsrf)})

def _login(usuario, password):
    import warnings; warnings.filterwarnings("ignore")
    sess = requests.Session()
    sess.verify = False
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "es-CO,es;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
    })
    try:
        _inf("Obteniendo token CSRF…")
        r1 = sess.get(CNE_LOGIN_HOME, timeout=15)
        m = re.search(r'name=["\']_token["\']\s*value=["\'](.*?)["\']', r1.text)
        if not m:
            _err("No se encontró token CSRF."); return None
        csrf = m.group(1)

        # Detectar campos reales del formulario de login
        campos = re.findall(r'<input[^>]+name=["\']([^"\']+)["\']', r1.text)
        _inf(f"  Campos del form: {campos}")

        _inf(f"Enviando credenciales para {usuario}…")
        r2 = sess.post(CNE_LOGIN_URL,
                       data={"_token": csrf, "usuario": usuario, "password": password},
                       allow_redirects=True, timeout=20)
        _inf(f"  Login POST → HTTP {r2.status_code} | URL final: {r2.url}")
        _inf(f"  Respuesta (100 chars): {r2.text[:100].strip()}")

        if r2.status_code >= 400:
            _err("Error HTTP en login."); return None
        if "login" in r2.url.lower() and "redirect" not in r2.url.lower():
            _err(f"Login rechazado — redirigió de vuelta al login."); return None
        if any(w in r2.text.lower() for w in ("incorrectos", "invalido", "invalid", "failed")):
            _err("Credenciales incorrectas."); return None

        # Extraer el enlace del botón FNFP del dashboard
        _inf("Buscando enlace FNFP en el dashboard…")
        links_fondo = re.findall(r'href=["\']([^"\']*fondo_cng_2026[^"\']*)["\']', r2.text)
        links_auto  = re.findall(r'href=["\']([^"\']*autoLogin[^"\']*)["\']', r2.text, re.I)
        links_todos = re.findall(r'href=["\']([^"\']{10,})["\']', r2.text)[:15]
        _inf(f"  Links fondo_cng_2026: {links_fondo}")
        _inf(f"  Links autoLogin:      {links_auto}")
        _inf(f"  Primeros 15 links:    {links_todos}")

        fnfp_url = None
        if links_fondo:
            fnfp_url = links_fondo[0]
        elif links_auto:
            fnfp_url = links_auto[0]

        if fnfp_url:
            if not fnfp_url.startswith("http"):
                fnfp_url = f"https://app_cng_2026.cne.gov.co{fnfp_url}"
            _inf(f"  Navegando a FNFP: {fnfp_url}")
            r_fnfp = sess.get(fnfp_url, allow_redirects=True, timeout=25)
            _inf(f"  FNFP → HTTP {r_fnfp.status_code} | URL: {r_fnfp.url}")
            _set_xsrf(sess)

        # Acceder al módulo fondo directamente (igual que el navegador al clicar FNFP)
        _inf("Accediendo al módulo FNFP…")
        r3 = sess.get(f"{CNE_API}/main", allow_redirects=True, timeout=20)
        _inf(f"  Fondo main: HTTP {r3.status_code} | URL: {r3.url}")

        # Actualizar XSRF con las cookies del fondo
        _set_xsrf(sess)
        _inf(f"  Cookies actuales: {[c.name for c in sess.cookies]}")

        # Verificar acceso con el endpoint real
        rv = sess.get(f"{CNE_API}/getCandidatos",
                      params={"id_tipo": 1, "id_organizacion": 1,
                              "id_corporacion": 4, "id_circunscripcion": 13,
                              "id_proceso": PROCESO_ID},
                      headers={"Accept": "application/json"}, timeout=15)
        _inf(f"  Verificación getCandidatos: HTTP {rv.status_code}, {len(rv.content)} bytes")
        if rv.status_code == 200:
            _ok("Sesión activa (verificado via /getCandidatos)")
            return sess

        # Intentar autoLoginRedirect como fallback
        _inf("  Intentando autoLoginRedirect…")
        for al in [CNE_AUTOLOGIN,
                   CNE_AUTOLOGIN.replace("/1", "/2"),
                   CNE_AUTOLOGIN.replace("/autoLoginRedirect/1", "/autoLoginRedirect")]:
            try:
                ra = sess.get(al, allow_redirects=False, timeout=10)
                loc = ra.headers.get("Location", "")
                _inf(f"  {al.split('/')[-1]}: {ra.status_code} | Location: {loc[:60] if loc else '-'}")
                if loc and "fondo_cng_2026" in loc:
                    import time as _t; _t.sleep(2)
                    sess.get(loc, allow_redirects=True, timeout=25)
                    _set_xsrf(sess)
                    rv2 = sess.get(f"{CNE_API}/getCandidatos",
                                   params={"id_tipo": 1, "id_organizacion": 1,
                                           "id_corporacion": 4, "id_circunscripcion": 13,
                                           "id_proceso": PROCESO_ID},
                                   headers={"Accept": "application/json"}, timeout=15)
                    if rv2.status_code == 200:
                        _ok("Sesión activa via autoLoginRedirect")
                        return sess
            except Exception:
                pass

        _err("No se pudo verificar acceso al fondo. Revise usuario/contraseña.")
        return None

    except requests.ConnectionError:
        _err("Sin conexión a internet."); return None
    except requests.Timeout:
        _err("Tiempo de espera agotado."); return None
    except Exception as e:
        _err(f"Error: {e}"); return None

# ── Descubrir catálogos ───────────────────────────────────────────────────────
def _get_json(sess, url, params=None):
    try:
        r = sess.get(url, params=params,
                     headers={"Accept": "application/json"}, timeout=15)
        if r.ok:
            return r.json()
    except Exception:
        pass
    return None

def _descubrir_catalogos(sess):
    """Busca los endpoints de organizaciones y circunscripciones."""
    _inf("Buscando catálogos de organizaciones…")
    orgs = []
    for ep in ["getOrganizaciones", "listarOrganizaciones", "organizacion",
               "organizaciones", "getOrganizacion"]:
        d = _get_json(sess, f"{CNE_API}/{ep}",
                      params={"id_proceso": PROCESO_ID})
        if d and isinstance(d, (list, dict)):
            items = d if isinstance(d, list) else d.get("data", list(d.values())[0] if d else [])
            if isinstance(items, list) and items:
                _ok(f"Organizaciones encontradas via /{ep}: {len(items)}")
                orgs = items
                break

    _inf("Buscando catálogos de circunscripciones…")
    circs = []
    for ep in ["getCircunscripciones", "circunscripcion", "circunscripciones",
               "listarCircunscripciones"]:
        d = _get_json(sess, f"{CNE_API}/{ep}",
                      params={"id_proceso": PROCESO_ID})
        if d and isinstance(d, (list, dict)):
            items = d if isinstance(d, list) else d.get("data", list(d.values())[0] if d else [])
            if isinstance(items, list) and items:
                _ok(f"Circunscripciones encontradas via /{ep}: {len(items)}")
                circs = items
                break

    return orgs, circs

# ── Obtener candidatos por combinación ───────────────────────────────────────
def _get_candidatos(sess, id_tipo, id_org, id_corp, id_circ,
                    id_dpto="undefined", id_mun="undefined"):
    _set_xsrf(sess)
    params = {
        "id_tipo":          id_tipo,
        "id_organizacion":  id_org,
        "id_corporacion":   id_corp,
        "id_circunscripcion": id_circ,
        "id_departamento":  id_dpto,
        "id_municipio":     id_mun,
        "id_proceso":       PROCESO_ID,
    }
    try:
        r = sess.get(f"{CNE_API}/getCandidatos", params=params,
                     headers={"Accept": "application/json"}, timeout=20)
        if r.ok:
            d = r.json()
            if isinstance(d, dict):
                return d.get("candidatos", [])
            if isinstance(d, list):
                return d
    except Exception:
        pass
    return []

# ── Escaneo inteligente ───────────────────────────────────────────────────────
def _escanear_todos(sess, orgs, circs):
    """
    Escanea todas las combinaciones para obtener todos los candidatos.
    Si no hay catálogos, escanea rangos de IDs.
    """
    candidatos_total = {}   # id_candi -> cand_obj

    # Determinar rangos a escanear
    if orgs:
        org_ids = [(o.get("id") or o.get("id_organizacion"),
                    o.get("id_tipo") or o.get("tipo_id") or 1,
                    o.get("nombre") or o.get("name") or "")
                   for o in orgs if o.get("id") or o.get("id_organizacion")]
    else:
        # Sin catálogo: escanear rango razonable
        _inf("Sin catálogo de organizaciones — escaneando IDs 1-200…")
        org_ids = [(i, 1, f"org_{i}") for i in range(1, 201)]

    if circs:
        circ_ids = [(c.get("id") or c.get("id_circunscripcion"),
                     c.get("nombre") or "")
                    for c in circs if c.get("id") or c.get("id_circunscripcion")]
    else:
        # Senado: circunscripción nacional (probar 1-20)
        # Cámara: circunscripciones departamentales (probar 1-40)
        _inf("Sin catálogo de circunscripciones — usando rangos por corporación…")
        circ_ids = [(i, f"circ_{i}") for i in range(1, 41)]

    corps = [
        (4, "SENADO DE LA REPUBLICA",    [c for c in circ_ids if c[0] in range(1, 20)]),
        (1, "CAMARA DE REPRESENTANTES",  circ_ids),
    ]

    lock = threading.Lock()
    procesadas = [0]

    def _probar(corp_id, corp_nom, id_tipo, id_org, org_nom, id_circ, circ_nom):
        cands = _get_candidatos(sess, id_tipo, id_org, corp_id, id_circ)
        with lock:
            procesadas[0] += 1
            if cands:
                for c in cands:
                    cid = c.get("id_candi") or c.get("id")
                    if cid and cid not in candidatos_total:
                        candidatos_total[cid] = {
                            "id_candi":   cid,
                            "nombre":     c.get("nombre", ""),
                            "cedula":     str(c.get("cedula") or c.get("documento") or ""),
                            "org":        org_nom,
                            "org_id":     id_org,
                            "corp":       corp_nom,
                            "corp_id":    corp_id,
                            "circ_id":    id_circ,
                            "circ":       circ_nom,
                            "proceso_id": PROCESO_ID,
                        }
                _inf(f"  [{procesadas[0]:4d}] corp={corp_id} org={id_org} circ={id_circ}"
                     f" → {len(cands)} candidatos (total: {len(candidatos_total)})")
        return len(cands)

    tareas = []
    for corp_id, corp_nom, circ_list in corps:
        for id_org, id_tipo, org_nom in org_ids:
            for id_circ, circ_nom in circ_list:
                tareas.append((corp_id, corp_nom, id_tipo, id_org, org_nom, id_circ, circ_nom))

    _inf(f"Total combinaciones a probar: {len(tareas):,}")
    _inf("Ejecutando en paralelo (30 workers)…\n")

    with ThreadPoolExecutor(max_workers=30) as pool:
        futs = [pool.submit(_probar, *t) for t in tareas]
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception:
                pass

    return list(candidatos_total.values())

# ── Construir índice para el portal ──────────────────────────────────────────
def _construir_index(candidatos):
    cc_index = {}
    for c in candidatos:
        corp     = c.get("corp", "")
        corp_id  = c.get("corp_id", 0)
        circ     = c.get("circ", "") or corp
        circ_key = _norm(circ)

        # Para el portal: SENADO → dpto "NACIONAL", Cámara → dpto = circunscripción
        if corp_id == 4:
            dpto_key = "NACIONAL"
            mun_key  = "NACIONAL"
        else:
            dpto_key = circ_key or "SIN_CIRC"
            mun_key  = circ_key or "SIN_CIRC"

        if dpto_key not in cc_index:
            cc_index[dpto_key] = {"id": str(c.get("circ_id", "")),
                                   "nombre": circ, "municipios": {}}
        muns = cc_index[dpto_key]["municipios"]
        if mun_key not in muns:
            muns[mun_key] = {"id": str(c.get("circ_id", "")),
                              "nombre": circ, "candidatos": []}
        muns[mun_key]["candidatos"].append({
            "nombre":     c["nombre"],
            "cedula":     c.get("cedula", ""),
            "org":        c.get("org", ""),
            "corp":       corp,
            "corp_id":    corp_id,
            "cand_id":    c["id_candi"],
            "org_id":     c.get("org_id", ""),
            "circ_id":    c.get("circ_id", ""),
            "proceso_id": PROCESO_ID,
        })
    return cc_index

# ── Flujo principal ───────────────────────────────────────────────────────────
def indexar(sess):
    _sep()
    print(f"Indexando Congreso 2026 (proceso_id={PROCESO_ID})")
    _sep()

    # Guardar cc_procesos.json con proceso conocido
    _guardar(os.path.join(DATA_DIR, "cc_procesos.json"),
             [{"id": PROCESO_ID, "nombre": "Congreso 2026", "fecha": "2026-03-15"}])

    # Descubrir catálogos
    orgs, circs = _descubrir_catalogos(sess)

    # Obtener todos los candidatos
    candidatos = _escanear_todos(sess, orgs, circs)

    if not candidatos:
        _err("No se encontraron candidatos.")
        return

    _ok(f"Total candidatos únicos: {len(candidatos):,}")

    # Construir y guardar índice
    cc_index = _construir_index(candidatos)
    _guardar(os.path.join(DATA_DIR, f"cc_index_{PROCESO_ID}.json"), cc_index)

    # Guardar lista plana de candidatos
    _guardar(os.path.join(DATA_DIR, "candidatos_congreso_2026.json"), candidatos)

    _sep()
    _ok("Indexación completada.")
    dptos = len(cc_index)
    total_cands = sum(
        len(m["candidatos"])
        for d in cc_index.values()
        for m in d["municipios"].values()
    )
    print(f"  Circunscripciones: {dptos}")
    print(f"  Candidatos en índice: {total_cands:,}")
    print()

# ── Punto de entrada ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import warnings; warnings.filterwarnings("ignore")

    parser = argparse.ArgumentParser(description="Indexar Congreso 2026 — CNE")
    parser.add_argument("--usuario",  default="", help="Cédula del usuario CNE")
    parser.add_argument("--password", default="", help="Contraseña CNE")
    args = parser.parse_args()

    print()
    print("=" * 65)
    print("  INDEXADOR CONGRESO 2026 — CNE CUENTAS CLARAS")
    print("=" * 65)
    print()

    usuario  = args.usuario  or input("  Usuario (cédula): ").strip()
    password = args.password or getpass.getpass("  Contraseña: ")

    if not usuario or not password:
        _err("Debe ingresar usuario y contraseña."); sys.exit(1)

    _sep()
    print("Iniciando sesión en CNE…")
    sess = _login(usuario, password)
    if sess is None:
        _err("No se pudo iniciar sesión."); sys.exit(1)

    indexar(sess)
