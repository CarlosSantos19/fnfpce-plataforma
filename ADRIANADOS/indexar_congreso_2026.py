"""
indexar_congreso_2026.py
========================
Descarga el índice del Congreso 2026 desde CNE - Cuentas Claras.

Auto-detecta el proceso ID buscando "CONGRESO" + "2026" en /proceso.
Si hay varios, muestra la lista y pide confirmar.

Guarda (sin sobrescribir datos de Territoriales 2023):
  data/candidatos_mun_{pid}/{corp}/{mun}.json    → archivos slim por municipio/circunscripción
  data/cc_index_{pid}.json                       → índice principal para el portal
  data/cc_procesos.json                          → lista completa de procesos del CNE

Uso:
  python indexar_congreso_2026.py
  python indexar_congreso_2026.py --proceso 9
  python indexar_congreso_2026.py --usuario 12345678 --password mipass
"""

import sys
import io
import os
import re
import json
import time
import argparse
import threading
import getpass
import unicodedata
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

# Corp IDs del API CNE — incluye Senado (4) y Cámara (1) ausentes en Territoriales 2023
CORP_NOMBRES = {
    1: "CAMARA DE REPRESENTANTES",
    2: "GOBERNACION",
    3: "ALCALDIA",
    4: "SENADO DE LA REPUBLICA",
    5: "ASAMBLEA",
    6: "CONCEJO",
    7: "JAL",
    8: "PERSONERIA",
}

# ── Utilidades ────────────────────────────────────────────────────────────────
def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper().strip())

def _safe(s: str) -> str:
    """Nombre de carpeta/archivo seguro (igual que JS: corp.replace(/[^\\w]/g,'_'))."""
    return re.sub(r"[^\w]", "_", str(s or "").upper().strip())

def _ok(msg):  print(f"  [OK]  {msg}")
def _err(msg): print(f"  [ERR] {msg}", file=sys.stderr)
def _inf(msg): print(f"  ...   {msg}")
def _sep():    print("-" * 65)

def _guardar(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    rel = os.path.relpath(path, DATA_DIR)
    _ok(f"Guardado {rel}  ({os.path.getsize(path) // 1024} KB)")

# ── Login CNE ─────────────────────────────────────────────────────────────────
def _login(usuario: str, password: str) -> "requests.Session | None":
    import warnings; warnings.filterwarnings("ignore")
    sess = requests.Session()
    sess.verify = False
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "es-CO,es;q=0.9",
    })
    try:
        _inf("Obteniendo token CSRF…")
        r1 = sess.get(CNE_LOGIN_HOME, timeout=15)
        m = re.search(r'name=["\']_token["\']\s*value=["\'](.*?)["\']', r1.text)
        if not m:
            _err("No se encontró token CSRF."); return None
        csrf = m.group(1)

        _inf(f"Enviando credenciales para {usuario}…")
        r2 = sess.post(
            CNE_LOGIN_URL,
            data={"_token": csrf, "usuario": usuario, "password": password},
            allow_redirects=True, timeout=20,
        )
        if r2.status_code >= 400 or "incorrectos" in r2.text.lower():
            _err("Credenciales incorrectas."); return None

        _inf("AutoLogin → módulo FNFP…")
        r3 = sess.get(CNE_AUTOLOGIN, allow_redirects=False, timeout=15)
        jwt_url = r3.headers.get("Location", "")
        if jwt_url:
            sess.get(jwt_url, allow_redirects=True, timeout=25)

        # Verificar acceso
        for ep in ["/departamento", f"/candidatos?idproceso=7&page=1"]:
            try:
                rv = sess.get(CNE_API + ep, headers={"Accept": "application/json"}, timeout=15)
                if rv.status_code == 200:
                    _ok(f"Sesión activa (verificado via {ep})")
                    return sess
            except Exception:
                pass
        _err("Login OK pero API FNFP no responde."); return None

    except requests.ConnectionError:
        _err("Sin conexión a internet."); return None
    except requests.Timeout:
        _err("Tiempo de espera agotado."); return None
    except Exception as e:
        _err(f"Error inesperado: {e}"); return None

# ── Paginación paralela ───────────────────────────────────────────────────────
def _paginar(sess: "requests.Session", endpoint: str,
             params: dict | None = None, workers: int = 20) -> list:
    url = f"{CNE_API}/{endpoint.lstrip('/')}"
    p0 = dict(params or {}); p0["page"] = 1
    try:
        r0 = sess.get(url, params=p0, headers={"Accept": "application/json"}, timeout=30)
        d0 = r0.json() if r0.ok else None
    except Exception:
        d0 = None
    if not d0:
        return []

    # Detectar estructura paginada
    data_key = next(
        (k for k in d0 if isinstance(d0.get(k), dict) and "data" in d0[k]),
        None
    )
    if data_key:
        items  = list(d0[data_key].get("data", []))
        last_p = d0[data_key].get("last_page", 1)
    elif isinstance(d0, list):
        return d0
    else:
        items  = d0.get("data", [])
        last_p = d0.get("last_page", 1)

    if last_p <= 1:
        return items

    _inf(f"  {endpoint}: {last_p} páginas → descargando en paralelo…")
    lock = threading.Lock()

    def _fetch(pg: int) -> list:
        pp = dict(params or {}); pp["page"] = pg
        try:
            rv = sess.get(url, params=pp, headers={"Accept": "application/json"}, timeout=30)
            d  = rv.json() if rv.ok else None
        except Exception:
            d = None
        if not d: return []
        if data_key: return d[data_key].get("data", [])
        if isinstance(d, list): return d
        return d.get("data", [])

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_fetch, pg): pg for pg in range(2, last_p + 1)}
        for fut in as_completed(futs):
            rows = fut.result()
            with lock:
                items.extend(rows)
    return items

# ── Detectar proceso Congreso 2026 ───────────────────────────────────────────
def _detectar_proceso(sess: "requests.Session") -> "tuple[list, list]":
    _inf("Consultando /proceso en CNE…")
    try:
        r = sess.get(f"{CNE_API}/proceso", headers={"Accept": "application/json"}, timeout=20)
        raw = r.json() if r.ok else []
    except Exception:
        raw = []
    if isinstance(raw, dict):
        raw = raw.get("data", list(raw.values()))

    procesos = []
    for p in (raw or []):
        if not p.get("id"):
            continue
        nombre = str(p.get("nombre") or p.get("descripcion") or "")
        procesos.append({
            "id":     p["id"],
            "nombre": nombre,
            "fecha":  str(p.get("fecha_eleccion") or p.get("fecha") or ""),
        })

    _ok(f"{len(procesos)} procesos encontrados en el CNE")

    # Buscar automáticamente Congreso 2026
    candidatos_26 = []
    for p in procesos:
        n = _norm(p["nombre"])
        if "2026" in n and any(k in n for k in ("CONGRESO", "SENADO", "CAMARA", "LEGISLAT", "PARLAMENTAR")):
            candidatos_26.append(p)

    return procesos, candidatos_26

# ── Flujo principal ───────────────────────────────────────────────────────────
def indexar(sess: "requests.Session", proceso_id: int) -> None:
    _sep()
    print(f"Indexando proceso {proceso_id} — Congreso 2026")
    _sep()

    cand_dir_base = os.path.join(DATA_DIR, f"candidatos_mun_{proceso_id}")

    # 1. Catálogos: departamentos y municipios
    _inf("Descargando departamentos…")
    dptos_raw = _paginar(sess, "/departamento")
    dptos_map: dict = {}  # id_str -> nombre normalizado
    for d in dptos_raw:
        did = str(d.get("id", ""))
        nom = _norm(
            d.get("departamentoNombre") or d.get("nom_departamento") or d.get("nombre") or ""
        )
        if did and nom:
            dptos_map[did] = nom
    _ok(f"{len(dptos_map)} departamentos")

    _inf("Descargando municipios (por departamento)…")
    muns_map: dict = {}  # id_str -> nombre normalizado
    mlock = threading.Lock()

    def _fetch_muns(dpto_id: str) -> None:
        muns = _paginar(sess, "/municipio", {"id_departamento": dpto_id}, workers=4)
        with mlock:
            for m in muns:
                mid = str(m.get("id", ""))
                nom = _norm(
                    m.get("munipioNombre") or m.get("municipioNombre") or m.get("nombre") or ""
                )
                if mid and nom:
                    muns_map[mid] = nom

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(_fetch_muns, list(dptos_map.keys())))
    _ok(f"{len(muns_map)} municipios")

    # 2. Candidatos del proceso
    _inf(f"Descargando candidatos del proceso {proceso_id}…")
    candidatos = _paginar(sess, "/candidatos", {"idproceso": proceso_id}, workers=30)
    if not candidatos:
        # Endpoint alternativo
        candidatos = _paginar(sess, "/candidato", {"idproceso": proceso_id}, workers=30)
    _ok(f"{len(candidatos)} candidatos descargados")

    if not candidatos:
        _err("Sin candidatos. Verifique proceso_id y que su usuario tenga acceso.")
        return

    # 3. Construir estructuras de datos
    _inf("Construyendo índices…")
    by_corp_mun: dict = {}   # (corp_safe, mun_safe) -> [cand_obj, ...]
    cc_index: dict    = {}   # dpto_key -> {id, nombre, municipios: {...}}

    for c in candidatos:
        corp_id  = int(c.get("id_corporacion") or c.get("corp_id") or 0)
        corp     = CORP_NOMBRES.get(corp_id, f"CORP_{corp_id}")
        dpto_id  = str(c.get("id_departamento") or "")
        mun_id   = str(c.get("id_municipio") or "")
        dpto_nom = dptos_map.get(dpto_id, "") or _norm(
            c.get("depto") or c.get("departamento") or ""
        )
        mun_nom  = muns_map.get(mun_id, "") or _norm(c.get("municipio") or "")

        # SENADO: cargo nacional — sin dpto ni municipio
        if corp == "SENADO DE LA REPUBLICA" or not dpto_nom:
            dpto_nom = "NACIONAL"
            mun_nom  = "NACIONAL"
        # CAMARA: cargo departamental — municipio = departamento
        elif corp == "CAMARA DE REPRESENTANTES" and not mun_nom:
            mun_nom = dpto_nom

        if not dpto_nom:
            continue

        mun_key = mun_nom if mun_nom else dpto_nom

        # Partido/organización
        rel_ag = c.get("relacion_agrupacion") or []
        rel_gr = c.get("relacion_grupo") or []
        rel_co = c.get("relacion_coalicion") or []
        if rel_ag:
            partido = _norm(rel_ag[0].get("nombre_agrupacion") or rel_ag[0].get("nombre") or "")
        elif rel_gr:
            partido = _norm(rel_gr[0].get("nombre_grupo") or rel_gr[0].get("nombre") or "")
        elif rel_co:
            partido = _norm(rel_co[0].get("nombre_coalicion") or rel_co[0].get("nombre") or "")
        else:
            partido = _norm(c.get("organizacion") or c.get("org") or "")
        partido = partido or "SIN PARTIDO"

        cedula = str(c.get("cedula") or c.get("documento") or "")
        nombre = (
            (str(c.get("nombre") or "") + " " + str(c.get("apellido") or "")).strip()
            or str(c.get("nombres") or "")
        )

        cand_obj = {
            "id":         c.get("id_candidato") or c.get("id") or "",
            "nombre":     nombre,
            "cedula":     cedula,
            "partido":    partido,
            "dpto":       dpto_nom,
            "mun":        mun_key,
            "corp":       corp,
            "corp_id":    corp_id,
            "org_id":     c.get("id_organizacion_politica") or c.get("id_organizacion") or "",
            "circ_id":    c.get("id_circunscripcion") or "",
            "tipo_id":    c.get("id_tipo_organizacion") or c.get("tipo_id") or "",
            "estado":     str(c.get("estado") or ""),
            "proceso_id": proceso_id,   # requerido por _construirBusquedaDesdeCC en adriana.html
        }

        corp_safe = _safe(corp)
        mun_safe  = _safe(mun_key)
        by_corp_mun.setdefault((corp_safe, mun_safe), []).append(cand_obj)

        # cc_index: misma estructura que cuentas_claras_index.json
        dpto_key     = _norm(dpto_nom)
        mun_key_norm = _norm(mun_key)
        if dpto_key not in cc_index:
            cc_index[dpto_key] = {"id": dpto_id, "nombre": dpto_nom, "municipios": {}}
        muns_dict = cc_index[dpto_key]["municipios"]
        if mun_key_norm not in muns_dict:
            muns_dict[mun_key_norm] = {"id": mun_id, "nombre": mun_key, "candidatos": []}
        muns_dict[mun_key_norm]["candidatos"].append({
            "nombre":     nombre,
            "cedula":     cedula,
            "org":        partido,
            "corp":       corp,
            "corp_id":    corp_id,
            "cand_id":    cand_obj["id"],
            "org_id":     cand_obj["org_id"],
            "circ_id":    cand_obj["circ_id"],
            "tipo_id":    cand_obj["tipo_id"],
            "proceso_id": proceso_id,
        })

    dptos_n = len(cc_index)
    muns_n  = sum(len(v["municipios"]) for v in cc_index.values())
    _ok(f"Índice: {dptos_n} dptos / circunscripciones, {muns_n} municipios/entidades")

    # 4. Guardar archivos slim por corp/municipio
    _inf("Guardando archivos por corporación/municipio…")
    files = 0
    for (corp_safe, mun_safe), cands in by_corp_mun.items():
        path = os.path.join(cand_dir_base, corp_safe, mun_safe + ".json")
        _guardar(path, cands)
        files += 1
    _ok(f"{files} archivos en candidatos_mun_{proceso_id}/")

    # 5. Guardar índice principal para el portal
    _guardar(os.path.join(DATA_DIR, f"cc_index_{proceso_id}.json"), cc_index)

    _sep()
    _ok("Indexación completada.")
    print()
    print(f"  → Redeployar o reiniciar el servidor para que los cambios sean visibles.")
    print(f"  → En el portal, seleccionar el proceso '{proceso_id}' en el desplegable.")
    print()

# ── Punto de entrada ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")

    parser = argparse.ArgumentParser(description="Indexar Congreso 2026 — CNE Cuentas Claras")
    parser.add_argument("--proceso", type=int, default=0,
                        help="ID del proceso (0 = auto-detectar desde /proceso)")
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
        _err("Debe ingresar usuario y contraseña.")
        sys.exit(1)

    _sep()
    print("Iniciando sesión en CNE…")
    sess = _login(usuario, password)
    if sess is None:
        _err("No se pudo iniciar sesión. Verifique credenciales.")
        sys.exit(1)

    proceso_id = args.proceso

    # Siempre actualizar cc_procesos.json con la lista completa
    procesos, candidatos_26 = _detectar_proceso(sess)
    _guardar(
        os.path.join(DATA_DIR, "cc_procesos.json"),
        [{"id": p["id"], "nombre": p["nombre"], "fecha": p["fecha"]} for p in procesos],
    )

    if not proceso_id:
        if not candidatos_26:
            print()
            print("  No se detectó automáticamente un proceso Congreso 2026.")
            print("  Procesos disponibles:")
            for p in procesos:
                print(f"    [{p['id']:4}] {p['nombre']}  ({p['fecha']})")
            print()
            try:
                proceso_id = int(input("  Ingrese el ID del proceso Congreso 2026: ").strip())
            except ValueError:
                _err("ID inválido."); sys.exit(1)
        elif len(candidatos_26) == 1:
            proceso_id = candidatos_26[0]["id"]
            _ok(f"Auto-detectado: [{proceso_id}] {candidatos_26[0]['nombre']}")
        else:
            print()
            print("  Varios procesos coinciden con 'Congreso 2026':")
            for i, p in enumerate(candidatos_26):
                print(f"    {i + 1}) [{p['id']}] {p['nombre']}  ({p['fecha']})")
            print()
            try:
                opcion = int(input("  Seleccione número: ").strip()) - 1
                proceso_id = candidatos_26[opcion]["id"]
            except (ValueError, IndexError):
                _err("Selección inválida."); sys.exit(1)

    indexar(sess, proceso_id)
