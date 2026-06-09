"""
Servidor HTTP multi-hilo para el portal CNE.
Soporta 200+ conexiones simultáneas.
Usa subst P: para evitar límite de 260 chars en paths largos de Windows.

Uso:
    python servidor.py              # Puerto 8081
    python servidor.py 9000         # Puerto personalizado
"""

import sys
import os
import re
import json
import threading
import atexit
import subprocess
import unicodedata
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs, unquote
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

# ── Constantes ────────────────────────────────────────────────────────────────
# Sistema Territoriales 2023
CNE_API        = "https://app.cne.gov.co/fondo/public"
CNE_LOGIN_URL  = "https://app.cne.gov.co/usuarios/public/login"
CNE_LOGIN_HOME = "https://app.cne.gov.co/usuarios/public/"
CNE_AUTOLOGIN  = "https://app.cne.gov.co/usuarios/public/autoLoginRedirect/1"

# Sistema Congreso 2026 (portal separado del CNE)
CNE_API_2026        = "https://app_cng_2026.cne.gov.co/fondo_cng_2026/public"
CNE_LOGIN_URL_2026  = "https://app_cng_2026.cne.gov.co/usuarios_cng_2026/public/login"
CNE_LOGIN_HOME_2026 = "https://app_cng_2026.cne.gov.co/usuarios_cng_2026/public/"
CNE_AUTOLOGIN_2026  = "https://app_cng_2026.cne.gov.co/usuarios_cng_2026/public/autoLoginRedirect/1"

# URL activa — se actualiza al hacer login exitoso
_cne_api_activo = CNE_API
DRIVE     = "P:"
_cne_session: requests.Session | None = None
_cne_session_ts: float = 0.0
_cne_usuario: str = ""
_gestion_cache: dict = {}
_cache_lock = threading.Lock()

# Estado del indexador en segundo plano
_indice_estado: dict = {"fase": "idle", "pct": 0, "msg": "", "error": ""}
_indice_lock = threading.Lock()

# Estado del indexador financiero CC
_fin_estado: dict = {"fase": "idle", "pct": 0, "msg": "", "error": ""}
_fin_lock_est = threading.Lock()

# Estado del indexador Congreso 2026
_idx26_estado: dict = {"fase": "idle", "pct": 0, "msg": "", "error": ""}
_idx26_lock = threading.Lock()


# ── Utilidades ────────────────────────────────────────────────────────────────

def _parse_multipart(rfile, content_type: str, content_length: int) -> tuple[dict, dict]:
    """Parse multipart/form-data sin modulo cgi (removido en Python 3.13+)."""
    body = rfile.read(content_length)
    m = re.search(r"boundary=([^\s;]+)", content_type)
    if not m:
        return {}, {}
    boundary = m.group(1).encode()
    parts = body.split(b"--" + boundary)
    fields: dict = {}
    files: dict  = {}
    for part in parts[1:]:
        if part in (b"--", b"--\r\n"):
            break
        header_block, _, data = part.lstrip(b"\r\n").partition(b"\r\n\r\n")
        headers = header_block.decode("utf-8", errors="replace")
        name_m = re.search(r'name="([^"]*)"', headers)
        if not name_m:
            continue
        name = name_m.group(1)
        fname_m = re.search(r'filename="([^"]*)"', headers)
        if fname_m:
            files[name] = {"filename": fname_m.group(1), "data": data.rstrip(b"\r\n")}
        else:
            fields[name] = data.rstrip(b"\r\n").decode("utf-8", errors="replace")
    return fields, files


def _norm_folder(s: str) -> str:
    """Normaliza string a formato carpeta: MAYUS, sin tildes, espacios → guión bajo."""
    nfkd = unicodedata.normalize("NFD", s)
    limpio = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    limpio = re.sub(r"[^A-Za-z0-9\-_ ]", "", limpio)
    return limpio.strip().upper().replace(" ", "_")


def _subst_mount(portal_dir: str) -> str:
    """Mapea portal_dir a P: para paths cortos. Limpia al salir."""
    try:
        subprocess.run(
            ["subst", DRIVE, portal_dir],
            capture_output=True,
            check=True,
        )
        atexit.register(lambda: subprocess.run(["subst", f"{DRIVE}", "/D"], capture_output=True))
        os.chdir(DRIVE + "\\")
        print(f"Mapeado {portal_dir} -> {DRIVE}")
        return DRIVE + "\\"
    except Exception as e:
        print(f"subst falló ({e}), usando ruta original")
        return portal_dir


# ── Indexador en segundo plano ────────────────────────────────────────────────

def _norm_idx(s: str) -> str:
    import unicodedata as _ud
    s = _ud.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if _ud.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper().strip())

CORP_ID_MAP = {2:"GOBERNACION",3:"ALCALDIA",5:"ASAMBLEA",6:"CONCEJO",7:"JAL",8:"PERSONERIA"}

def _indice_set(fase: str, pct: int, msg: str, error: str = "") -> None:
    with _indice_lock:
        _indice_estado.update({"fase": fase, "pct": pct, "msg": msg, "error": error})
    print(f"[Indice] {msg}")

def _get_xsrf(sess):
    """Obtiene el último XSRF-TOKEN de la sesión, eliminando duplicados."""
    vals = [requests.utils.unquote(c.value) for c in sess.cookies if c.name == "XSRF-TOKEN"]
    if len(vals) > 1:
        last = vals[-1]
        keys_to_remove = [c for c in sess.cookies if c.name == "XSRF-TOKEN"]
        for c in keys_to_remove:
            sess.cookies.clear(c.domain, c.path, c.name)
        sess.cookies.set("XSRF-TOKEN", requests.utils.quote(last, safe=""))
        return last
    return vals[0] if vals else ""


def _construir_indice_bg() -> None:
    """Descarga todos los candidatos y construye busqueda.json + candidatos_mun/."""
    import time as _t, os as _os, json as _j
    global _cne_session

    data_dir  = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "data")
    cand_dir  = _os.path.join(data_dir, "candidatos_mun")
    proceso   = 7

    def _cne(endpoint, params=None):
        """GET al API de fondo con los headers requeridos."""
        if _cne_session is None:
            return None
        url  = CNE_API + "/" + endpoint.lstrip("/")
        xsrf = _get_xsrf(_cne_session)
        hdrs = {"Accept":"application/json","X-Requested-With":"XMLHttpRequest",
                "X-XSRF-TOKEN": xsrf, "Referer": CNE_API + "/"}
        try:
            r = _cne_session.get(url, params=params, headers=hdrs, timeout=30)
            return r.json() if r.ok else None
        except Exception:
            return None

    def _paginar(endpoint, extra=None, workers=20):
        """Descarga todas las páginas de un endpoint en paralelo."""
        p0 = dict(extra or {}); p0["page"] = 1
        d0 = _cne(endpoint, p0)
        if not d0:
            return []
        # detectar clave de datos y total de páginas
        data_key = next((k for k in d0 if isinstance(d0[k], dict) and "data" in d0[k]), None)
        if data_key:
            items   = list(d0[data_key].get("data", []))
            last_p  = d0[data_key].get("last_page", 1)
        elif isinstance(d0, list):
            return d0
        else:
            items  = d0.get("data", list(d0.values()) if not any(isinstance(v,dict) for v in d0.values()) else [])
            last_p = d0.get("last_page", 1)

        if last_p <= 1:
            return items

        lock2 = threading.Lock()
        def _fetch(pg):
            pp = dict(extra or {}); pp["page"] = pg
            d  = _cne(endpoint, pp)
            if not d: return []
            if data_key: return d[data_key].get("data", [])
            if isinstance(d, list): return d
            return d.get("data", [])

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(_fetch, pg): pg for pg in range(2, last_p+1)}
            for fut in as_completed(futs):
                rows = fut.result()
                with lock2:
                    items.extend(rows)
        return items

    try:
        _indice_set("trabajando", 2, "Descargando departamentos…")
        dptos_raw = _paginar("departamento")
        dptos_map = {str(d["id"]): _norm_idx(d.get("nombre","")) for d in dptos_raw if d.get("id")}

        _indice_set("trabajando", 6, f"Descargando municipios ({len(dptos_map)} dptos)…")
        muns_map: dict = {}
        mlock = threading.Lock()
        def _fetch_muns(did):
            muns = _paginar("municipio", {"id_departamento": did})
            with mlock:
                for m in muns:
                    mid = str(m.get("id",""))
                    nom = _norm_idx(m.get("nombre") or m.get("munipioNombre") or m.get("municipioNombre") or "")
                    if mid and nom:
                        muns_map[mid] = nom
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(_fetch_muns, list(dptos_map.keys())))

        _indice_set("trabajando", 10, "Consultando total de candidatos…")
        first = _cne("candidatos", {"idproceso": proceso, "page": 1})
        if not first:
            return _indice_set("error", 0, "No se pudo obtener candidatos", "Sin respuesta del API")
        total_p = first.get("pagination", {}).get("last_page", 1)
        total_c = first.get("pagination", {}).get("total", 0)
        _indice_set("trabajando", 12, f"Descargando {total_c:,} candidatos ({total_p:,} páginas)…")

        # Primera página ya descargada
        all_cands: list = []
        primera_data = first.get("candidatos", {})
        if isinstance(primera_data, dict): primera_data = primera_data.get("data", [])
        all_cands.extend(primera_data or [])

        done = [0]
        alock = threading.Lock()
        def _fetch_cand(pg):
            d = _cne("candidatos", {"idproceso": proceso, "page": pg})
            if not d: return []
            rows = d.get("candidatos", {})
            if isinstance(rows, dict): rows = rows.get("data", [])
            return rows if isinstance(rows, list) else []

        with ThreadPoolExecutor(max_workers=30) as pool:
            futs = {pool.submit(_fetch_cand, pg): pg for pg in range(2, total_p+1)}
            for fut in as_completed(futs):
                rows = fut.result()
                with alock:
                    all_cands.extend(rows)
                    done[0] += 1
                    if done[0] % 300 == 0:
                        pct = 12 + int(done[0] * 78 / total_p)
                        _indice_set("trabajando", pct,
                                    f"Descargando… {done[0]:,}/{total_p:,} págs | {len(all_cands):,} cands")

        _indice_set("trabajando", 91, f"Construyendo índices ({len(all_cands):,} candidatos)…")

        busqueda: dict = {}
        by_corp_mun: dict = {}
        renuncias=[]; revocados=[]; no_presento=[]; extemp=[]
        art23=art27=art34=0

        for c in all_cands:
            # Campos reales de la API CNE
            corp_id = int(c.get("id_corporacion") or 0)
            corp    = CORP_ID_MAP.get(corp_id, "OTRO")
            # Dpto y municipio vienen como strings directamente
            dpto    = _norm_idx(c.get("depto") or c.get("departamento") or
                                 dptos_map.get(str(c.get("id_departamento","")), "") or "")
            mun     = _norm_idx(c.get("municipio") or
                                 muns_map.get(str(c.get("id_municipio","")), "") or "")
            # Partido: viene en relacion_agrupacion, relacion_grupo o relacion_coalicion
            rel_ag  = c.get("relacion_agrupacion") or []
            rel_gr  = c.get("relacion_grupo") or []
            rel_co  = c.get("relacion_coalicion") or []
            if rel_ag:
                partido_nom = rel_ag[0].get("nombre_agrupacion") or rel_ag[0].get("nombre") or ""
            elif rel_gr:
                partido_nom = rel_gr[0].get("nombre_grupo") or rel_gr[0].get("nombre") or ""
            elif rel_co:
                partido_nom = rel_co[0].get("nombre_coalicion") or rel_co[0].get("nombre") or ""
            else:
                partido_nom = ""
            partido = _norm_idx(partido_nom or "SIN PARTIDO")
            cedula  = str(c.get("cedula") or "")
            if not dpto: continue
            mun_key = mun if mun else dpto

            busqueda.setdefault(corp,{}).setdefault(dpto,{}).setdefault(mun_key,set()).add(partido)
            by_corp_mun.setdefault((corp, mun_key), []).append({
                "id":      c.get("id_candidato") or "",
                "nombre":  (str(c.get("nombre") or "")+" "+str(c.get("apellido") or "")).strip(),
                "cedula":  cedula,
                "partido": partido,
                "dpto":    dpto, "mun": mun_key, "corp": corp, "corp_id": corp_id,
                "org_id":  c.get("id_organizacion_politica") or "",
                "circ_id": c.get("id_circunscripcion") or "",
                "tipo_id": c.get("id_tipo_organizacion") or "",
                "estado":  str(c.get("estado") or ""),
            })

        # Convertir sets → listas
        for corp in busqueda:
            for dpto in busqueda[corp]:
                for mun in busqueda[corp][dpto]:
                    busqueda[corp][dpto][mun] = sorted(busqueda[corp][dpto][mun])

        _indice_set("trabajando", 95, "Guardando archivos…")

        def _guardar(path, data):
            _os.makedirs(_os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                _j.dump(data, fh, ensure_ascii=False, separators=(",",":"))

        _guardar(_os.path.join(data_dir, "busqueda.json"), busqueda)

        files = 0
        for (corp, mun_key), cands in by_corp_mun.items():
            _guardar(_os.path.join(cand_dir, corp, mun_key+".json"), cands)
            files += 1

        _guardar(_os.path.join(data_dir, "stats.json"), {
            "total_candidatos": len(all_cands), "total_art23": art23,
            "total_art27": art27, "total_art34": art34,
            "total_no_presentaron": len(no_presento),
            "total_extemporaneos": len(extemp), "total_revocados": len(revocados),
            "_generado": _t.strftime("%Y-%m-%d %H:%M"), "_fuente": "CNE Cuentas Claras",
        })
        _guardar(_os.path.join(data_dir, "estado_candidatos.json"), {
            "renuncias": renuncias, "revocados": revocados,
            "no_presento": no_presento, "extemporaneo": extemp,
        })

        corps_n = len(busqueda)
        dptos_n = sum(len(v) for v in busqueda.values())
        _indice_set("listo", 100,
                    f"Índice completo: {len(all_cands):,} candidatos | "
                    f"{corps_n} corps | {dptos_n} dptos | {files} archivos")

    except Exception as e:
        _indice_set("error", 0, "Error en indexación", str(e))


# ── Indexador financiero CC (ingresos + gastos ET2023) ────────────────────────

def _fin_set(fase: str, pct: int, msg: str, error: str = "") -> None:
    with _fin_lock_est:
        _fin_estado.update({"fase": fase, "pct": pct, "msg": msg, "error": error})
    print(f"[Financiero] {msg}")

def _indexar_financiero_bg() -> None:
    """Descarga reporteingresosAdmin + reportegastosAdmin y construye cc_financiero_v2.json."""
    import time as _t, os as _os, json as _j
    global _cne_session

    data_dir = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "data")
    proceso  = 7
    CORPS    = [3, 6, 2, 5]   # ALCALDIA, CONCEJO, GOBERNACION, ASAMBLEA

    def _cne_get(endpoint, params):
        if _cne_session is None:
            return None
        url  = CNE_API + "/" + endpoint.lstrip("/")
        xsrf = _get_xsrf(_cne_session)
        hdrs = {"Accept": "application/json", "X-Requested-With": "XMLHttpRequest",
                "X-XSRF-TOKEN": xsrf, "Referer": CNE_API + "/"}
        try:
            r = _cne_session.get(url, params=params, headers=hdrs, timeout=30)
            return r.json() if r.ok else None
        except Exception:
            return None

    def _fetch_all(endpoint_name, corp_id):
        """Descarga todas las páginas de ingresos o gastos para un corp."""
        params0 = {
            "page": 1, "per_page": 100, "buscar": "", "criterio": "nombre",
            "id_corporacion": corp_id, "id_proceso_electoral": proceso,
            "id_tipo_organizacion": "", "id_circunscripcion": "",
            "id_departamento": "", "id_municipio": "", "id_organizacion": ""
        }
        d0 = _cne_get(endpoint_name, params0)
        if not d0:
            return []
        pag    = d0.get("pagination", {})
        items  = list(d0.get("candidatos", []))
        last_p = pag.get("last_page", 1)
        if last_p <= 1:
            return items
        lk = threading.Lock()
        def _fetch_page(pg):
            p = dict(params0); p["page"] = pg
            d = _cne_get(endpoint_name, p)
            return d.get("candidatos", []) if d else []
        with ThreadPoolExecutor(max_workers=20) as pool:
            futs = {pool.submit(_fetch_page, pg): pg for pg in range(2, last_p + 1)}
            for fut in as_completed(futs):
                rows = fut.result()
                with lk:
                    items.extend(rows)
        return items

    def _sum_totals(movs):
        total = 0.0
        for m in (movs or []):
            try:
                total += float(str(m.get("subtotal") or m.get("total") or 0)
                               .replace(",", "").replace("$", "") or 0)
            except Exception:
                pass
        return total

    try:
        _fin_set("trabajando", 2, "Iniciando descarga de datos financieros CC…")
        fin_idx = {}   # id_candidato(str) → {nom, cedula, dpto, mun, corp, corp_id, total_ingreso, total_gasto}

        total_corps = len(CORPS)
        for ci, corp_id in enumerate(CORPS):
            corp_name = CORP_ID_MAP.get(corp_id, str(corp_id))

            pct_i = 5 + ci * 22
            _fin_set("trabajando", pct_i, f"[{ci+1}/{total_corps}] Descargando ingresos {corp_name}…")
            for row in _fetch_all("reporteingresosAdmin", corp_id):
                cid = str(row.get("id_candidato") or "")
                if not cid:
                    continue
                if cid not in fin_idx:
                    fin_idx[cid] = {
                        "nom":    str(row.get("nom_candidato") or ""),
                        "cedula": str(row.get("numero_documento") or ""),
                        "dpto":   _norm_idx(str(row.get("dpto_nombre") or "")),
                        "mun":    _norm_idx(str(row.get("municipio_nombre") or "")) or None,
                        "corp":   str(row.get("nombre_corpo") or ""),
                        "corp_id": corp_id,
                        "total_ingreso": 0.0,
                        "total_gasto":   0.0,
                    }
                fin_idx[cid]["total_ingreso"] += _sum_totals(row.get("ingresos"))

            pct_g = pct_i + 11
            _fin_set("trabajando", pct_g, f"[{ci+1}/{total_corps}] Descargando gastos {corp_name}…")
            for row in _fetch_all("reportegastosAdmin", corp_id):
                cid = str(row.get("id_candidato") or "")
                if not cid:
                    continue
                if cid not in fin_idx:
                    fin_idx[cid] = {
                        "nom":    str(row.get("nom_candidato") or ""),
                        "cedula": str(row.get("numero_documento") or ""),
                        "dpto":   _norm_idx(str(row.get("dpto_nombre") or "")),
                        "mun":    _norm_idx(str(row.get("municipio_nombre") or "")) or None,
                        "corp":   str(row.get("nombre_corpo") or ""),
                        "corp_id": corp_id,
                        "total_ingreso": 0.0,
                        "total_gasto":   0.0,
                    }
                fin_idx[cid]["total_gasto"] += _sum_totals(row.get("gastos"))

        _fin_set("trabajando", 96, f"Guardando {len(fin_idx):,} candidatos en cc_financiero_v2.json…")
        out_path = _os.path.join(data_dir, "cc_financiero_v2.json")
        _os.makedirs(data_dir, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            _j.dump(fin_idx, fh, ensure_ascii=False, separators=(",", ":"))

        # Actualizar cc_stats_analisis.json con nuevos totales
        total_ing  = sum(v["total_ingreso"] for v in fin_idx.values())
        total_gas  = sum(v["total_gasto"]   for v in fin_idx.values())
        reportaron = sum(1 for v in fin_idx.values() if v["total_ingreso"] > 0 or v["total_gasto"] > 0)

        stats_path = _os.path.join(data_dir, "cc_stats_analisis.json")
        stats = {}
        if _os.path.exists(stats_path):
            try:
                with open(stats_path, encoding="utf-8") as fh:
                    stats = _j.load(fh)
            except Exception:
                pass
        stats["total_ingresos"]  = round(total_ing, 2)
        stats["total_gastos"]    = round(total_gas, 2)
        stats["total_reportaron"] = reportaron
        stats["_fin_generado"]   = _t.strftime("%Y-%m-%d %H:%M")
        with open(stats_path, "w", encoding="utf-8") as fh:
            _j.dump(stats, fh, ensure_ascii=False, indent=2)

        _fin_set("listo", 100,
                 f"Completado: {len(fin_idx):,} candidatos | "
                 f"Ingresos: ${total_ing/1e6:.1f} MM | Gastos: ${total_gas/1e6:.1f} MM")

    except Exception as e:
        import traceback
        _fin_set("error", 0, "Error en indexación financiera", traceback.format_exc())


# ── Indexador Congreso 2026 ───────────────────────────────────────────────────

def _idx26_set(fase: str, pct: int, msg: str, error: str = "") -> None:
    with _idx26_lock:
        _idx26_estado.update({"fase": fase, "pct": pct, "msg": msg, "error": error})
    print(f"[Congreso2026] {msg}")

def _indexar_congreso_2026_bg(usuario: str, password: str) -> None:
    """Corre indexar_congreso_2026.py en segundo plano desde servidor.py."""
    import importlib.util, sys as _sys, os as _os, traceback
    _idx26_set("trabajando", 5, "Iniciando login en 2026.cne.gov.co…")
    try:
        script = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                               "indexar_congreso_2026.py")
        spec = importlib.util.spec_from_file_location("_idx26", script)
        mod  = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        _idx26_set("trabajando", 10, "Conectando…")
        sess = mod._login(usuario, password)
        if sess is None:
            _idx26_set("error", 0, "Login fallido. Verifica credenciales.", "login")
            return

        _idx26_set("trabajando", 20, "Detectando proceso Congreso 2026…")
        procesos, candidatos_26 = mod._detectar_proceso(sess)

        # Guardar cc_procesos.json
        import json as _j
        data_dir = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "data")
        _os.makedirs(data_dir, exist_ok=True)
        with open(_os.path.join(data_dir, "cc_procesos.json"), "w", encoding="utf-8") as fh:
            _j.dump([{"id": p["id"], "nombre": p["nombre"], "fecha": p["fecha"]}
                     for p in procesos], fh, ensure_ascii=False, indent=2)

        if not candidatos_26:
            _idx26_set("error", 0, "No se encontró proceso Congreso 2026 en el CNE.", "no_proceso")
            return

        proceso_id = candidatos_26[0]["id"]
        nombre_proc = candidatos_26[0]["nombre"]
        _idx26_set("trabajando", 30, f"Proceso detectado: [{proceso_id}] {nombre_proc}")

        # Monkey-patch para reportar progreso
        _orig_ok = mod._ok
        def _ok_prog(msg):
            _orig_ok(msg)
            if "candidatos" in msg.lower():
                _idx26_set("trabajando", 60, msg)
            elif "archivos" in msg.lower():
                _idx26_set("trabajando", 85, msg)
            elif "ndice" in msg.lower():
                _idx26_set("trabajando", 90, msg)
        mod._ok = _ok_prog

        _idx26_set("trabajando", 35, f"Descargando candidatos del proceso {proceso_id}…")
        mod.indexar(sess, proceso_id)
        _idx26_set("listo", 100, f"Indexación completada. Proceso [{proceso_id}] listo.")
    except Exception:
        _idx26_set("error", 0, "Error en indexación", traceback.format_exc())


# ── Handler ───────────────────────────────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    # ── Helpers internos ──────────────────────────────────────────────────────

    def _send_json(self, data, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, msg: str, status: int = 500):
        self._send_json({"error": msg}, status)

    def _qs(self) -> dict:
        parsed = urlparse(self.path)
        return {k: v[0] for k, v in parse_qs(parsed.query).items()}

    def _cne_get(self, endpoint: str, params: dict | None = None) -> requests.Response:
        global _cne_session
        url = CNE_API + "/" + endpoint.lstrip("/")
        xsrf = _get_xsrf(_cne_session)
        headers = {
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "X-XSRF-TOKEN": xsrf,
            "Referer": CNE_API + "/",
        }
        resp = _cne_session.get(url, params=params, headers=headers, timeout=30)
        return resp

    # ── Routing ───────────────────────────────────────────────────────────────

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/cne_buscar_candidatos":
                self._handle_cne_buscar_candidatos()
            elif path == "/api/cne_gestion_filtrado":
                self._handle_cne_gestion_filtrado()
            elif path == "/api/cne_dictamen_filtrado":
                self._handle_cne_dictamen_filtrado()
            elif path == "/api/cne_status":
                self._handle_cne_status()
            elif path == "/api/indice_status":
                self._handle_indice_status()
            elif path == "/api/fin_status":
                self._handle_fin_status()
            elif path == "/api/idx26_status":
                with _idx26_lock:
                    self._send_json(dict(_idx26_estado))
            elif path.startswith("/api/cne/"):
                self._handle_cne_proxy()
            elif path == "/api/lista_respuestas":
                self._handle_lista_respuestas()
            elif path == "/api/cc_stats":
                self._handle_cc_stats()
            elif path == "/api/cc_candidatos":
                self._handle_cc_candidatos()
            else:
                self.directory = getattr(self.server, 'portal_dir', os.getcwd())
                super().do_GET()
        except Exception as e:
            self._send_error_json(str(e))

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path in ("/api/cne_login", "/api/cne_login_manual"):
                self._handle_cne_login()
            elif path == "/api/construir_indice":
                self._handle_construir_indice()
            elif path == "/api/indexar_financiero":
                self._handle_indexar_financiero()
            elif path == "/api/indexar_congreso_2026":
                self._handle_indexar_congreso_2026()
            elif path == "/api/cne_import_cookies":
                self._handle_cne_import_cookies()
            elif path == "/api/guardar_liquidacion":
                self._handle_guardar_liquidacion()
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:
            self._send_error_json(str(e))

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # ── /api/cne_status ───────────────────────────────────────────────────────

    def _handle_cne_status(self):
        import time
        if _cne_session is None:
            return self._send_json({"sesion_activa": False})
        edad_min = (time.time() - _cne_session_ts) / 60 if _cne_session_ts else 0
        self._send_json({"sesion_activa": True, "edad_min": round(edad_min, 1),
                         "usuario": _cne_usuario})

    # ── /api/indice_status  y  /api/construir_indice ─────────────────────────

    def _handle_indice_status(self):
        with _indice_lock:
            self._send_json(dict(_indice_estado))

    def _handle_construir_indice(self):
        if _cne_session is None:
            return self._send_error_json("Sin sesión CNE activa.", 401)
        with _indice_lock:
            if _indice_estado["fase"] == "trabajando":
                return self._send_json({"ok": False, "msg": "Ya hay una indexación en curso."})
        t = threading.Thread(target=_construir_indice_bg, daemon=True)
        t.start()
        self._send_json({"ok": True, "msg": "Indexación iniciada en segundo plano."})

    def _handle_fin_status(self):
        with _fin_lock_est:
            self._send_json(dict(_fin_estado))

    def _handle_indexar_financiero(self):
        if _cne_session is None:
            return self._send_error_json("Sin sesión CNE activa.", 401)
        with _fin_lock_est:
            if _fin_estado["fase"] == "trabajando":
                return self._send_json({"ok": False, "msg": "Ya hay una indexación financiera en curso."})
        t = threading.Thread(target=_indexar_financiero_bg, daemon=True)
        t.start()
        self._send_json({"ok": True, "msg": "Indexación financiera iniciada en segundo plano."})

    # ── /api/cne_login  y  /api/cne_login_manual ─────────────────────────────

    def _handle_cne_login(self):
        global _cne_session, _cne_session_ts, _cne_usuario
        import re as _re, time as _time

        length = int(self.headers.get("Content-Length", 0))
        ct = self.headers.get("Content-Type", "")
        raw = self.rfile.read(length).decode("utf-8", errors="replace")

        # Soportar JSON (auth.js), form-urlencoded y multipart
        if "application/json" in ct:
            try:
                fields = json.loads(raw)
            except Exception:
                fields = {}
        elif "multipart" in ct:
            fields, _ = _parse_multipart(
                __import__("io").BytesIO(raw.encode()), ct, length)
        else:
            fields = dict(pair.split("=", 1) for pair in raw.split("&") if "=" in pair)

        usuario  = (fields.get("usuario") or fields.get("username") or "").strip()
        password = (fields.get("password") or "").strip()
        if not usuario or not password:
            return self._send_error_json("Usuario y contraseña requeridos", 400)

        sess = requests.Session()
        sess.verify = False
        sess.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/122.0.0.0 Safari/537.36",
            "Accept-Language": "es-CO,es;q=0.9",
        })

        # Perfiles a intentar: 2026 primero, luego 2023 como fallback
        _perfiles = [
            {"nombre": "Congreso 2026",
             "home":      CNE_LOGIN_HOME_2026,
             "login_url": CNE_LOGIN_URL_2026,
             "autologin": CNE_AUTOLOGIN_2026,
             "api":       CNE_API_2026},
            {"nombre": "Territoriales 2023",
             "home":      CNE_LOGIN_HOME,
             "login_url": CNE_LOGIN_URL,
             "autologin": CNE_AUTOLOGIN,
             "api":       CNE_API},
        ]

        ultimo_error = "Error desconocido"
        for perfil in _perfiles:
          try:
            p_nombre   = perfil["nombre"]
            p_home     = perfil["home"]
            p_login    = perfil["login_url"]
            p_autologin= perfil["autologin"]
            p_api      = perfil["api"]

            print(f"[CNE Login] Intentando {p_nombre} → {p_home}")
            sess2 = requests.Session()
            sess2.verify = False
            sess2.headers.update(sess.headers)

            # Paso 1: CSRF
            r1 = sess2.get(p_home, timeout=15)
            csrf_m = _re.search(
                r"name=[\"']_token[\"'].*?value=[\"'](.*?)[\"']", r1.text)
            if not csrf_m:
                csrf_m = _re.search(
                    r"meta[^>]+name=[\"']csrf-token[\"'][^>]+content=[\"'](.*?)[\"']",
                    r1.text)
            if not csrf_m:
                print(f"[CNE Login] {p_nombre}: sin CSRF, probando siguiente...")
                ultimo_error = f"Sin CSRF en {p_home}"
                continue
            csrf = csrf_m.group(1)

            # Paso 2: credenciales
            r2 = sess2.post(
                p_login,
                data={"_token": csrf, "usuario": usuario, "password": password},
                allow_redirects=True, timeout=20,
            )
            txt2 = r2.text.lower()
            if any(k in txt2 for k in ("incorrectos", "inválid", "invalid",
                                        "aceptadas", "credentials")):
                # Credenciales definitivamente malas — no seguir con otro perfil
                return self._send_json({
                    "ok": False,
                    "mensaje": "Usuario o contraseña incorrectos. "
                               "Verifique sus credenciales del portal CNE-Cuentas Claras."})
            if r2.status_code >= 400:
                print(f"[CNE Login] {p_nombre}: HTTP {r2.status_code}, probando siguiente...")
                ultimo_error = f"HTTP {r2.status_code}"
                continue
            if "login" in r2.url.lower() and "centralizadoredirect" not in r2.url.lower():
                print(f"[CNE Login] {p_nombre}: redirect a login ({r2.url}), probando siguiente...")
                ultimo_error = f"Redirigido a login: {r2.url}"
                continue

            print(f"[CNE Login] {p_nombre}: credenciales aceptadas, URL={r2.url}")
            sess = sess2  # usar esta sesión desde aquí

            # Paso 3: autoLoginRedirect
            r4_url = ""
            for al_url in [p_autologin,
                           p_autologin.replace("/autoLoginRedirect/1", "/autoLoginRedirect/2"),
                           p_autologin.replace("/autoLoginRedirect/1", "/autoLoginRedirect")]:
                try:
                    r3 = sess.get(al_url, allow_redirects=False, timeout=15)
                    loc = r3.headers.get("Location", "")
                    print(f"[CNE Login] autoLogin {al_url} → {loc or '(sin redirect)'}")
                    if loc:
                        _time.sleep(12)
                        r4 = sess.get(loc, allow_redirects=True, timeout=25)
                        r4_url = r4.url
                    else:
                        r3f = sess.get(al_url, allow_redirects=True, timeout=25)
                        r4_url = r3f.url
                    print(f"[CNE Login] URL final: {r4_url}")
                    if "fondo" in r4_url:
                        break
                except Exception as _e:
                    print(f"[CNE Login] autoLogin {al_url} error: {_e}")

            # Paso 4: verificar API
            xsrf_val = _get_xsrf(sess)
            api_hdrs = {"Accept": "application/json", "X-Requested-With": "XMLHttpRequest",
                        "X-XSRF-TOKEN": xsrf_val, "Referer": p_api + "/"}
            r5_status = 0
            for vurl in [p_api + "/departamento", p_api + "/proceso",
                         p_api + "/candidatos?page=1"]:
                try:
                    r5 = sess.get(vurl, headers=api_hdrs, timeout=15)
                    r5_status = r5.status_code
                    print(f"[CNE Login] Verificación {vurl}: {r5_status}")
                    if r5_status == 200:
                        break
                except Exception:
                    continue

            # Éxito si API responde 200
            if r5_status == 200:
                print(f"[CNE Login] OK {p_nombre} — sesión verificada para {usuario}")
                _cne_session    = sess
                _cne_session_ts = _time.time()
                _cne_usuario    = usuario
                global _cne_api_activo
                _cne_api_activo = p_api
                return self._send_json({
                    "ok": True,
                    "mensaje": f"Sesión iniciada ({p_nombre}) para {usuario}"})

            # Éxito parcial: llegamos al fondo aunque API no responda 200
            if "fondo" in r4_url:
                print(f"[CNE Login] OK {p_nombre} — en fondo (API {r5_status})")
                _cne_session    = sess
                _cne_session_ts = _time.time()
                _cne_usuario    = usuario
                _cne_api_activo = p_api
                return self._send_json({
                    "ok": True,
                    "mensaje": f"Sesión iniciada ({p_nombre}) para {usuario}"})

            # Fallback: credenciales correctas → aceptar sesión igual
            print(f"[CNE Login] Fallback {p_nombre} — credenciales OK, API status={r5_status}")
            _cne_session    = sess
            _cne_session_ts = _time.time()
            _cne_usuario    = usuario
            _cne_api_activo = p_api
            return self._send_json({
                "ok": True,
                "mensaje": f"Sesión iniciada ({p_nombre}) para {usuario}"})

          except requests.Timeout:
            print(f"[CNE Login] Timeout en {perfil['nombre']}, probando siguiente...")
            ultimo_error = "Timeout"
            continue
          except requests.ConnectionError as _ce:
            print(f"[CNE Login] Sin conexión a {perfil['nombre']}: {_ce}")
            ultimo_error = f"Sin conexión: {_ce}"
            continue
          except Exception as _ex:
            print(f"[CNE Login] Error en {perfil['nombre']}: {_ex}")
            ultimo_error = str(_ex)
            continue

        # Si llegamos aquí, todos los perfiles fallaron
        return self._send_error_json(
            f"No se pudo conectar con ningún sistema CNE. Último error: {ultimo_error}", 503)

    # ── /api/cne_buscar_candidatos ────────────────────────────────────────────

    def _handle_cne_buscar_candidatos(self):
        """
        Busca candidatos en CC por corporación y departamento.
        GET /api/cne_buscar_candidatos?corp=GOBERNACION&dpto=Huila
        Explora la API de CC para encontrar organizaciones y candidatos departamentales.
        """
        if _cne_session is None:
            return self._send_error_json("Sin sesion CNE. Use /api/cne_login o ejecute indexar_cuentas_claras.py", 401)

        qs = self._qs()
        id_circunscripcion = qs.get("id_circunscripcion", "")
        id_departamento    = qs.get("id_departamento", "")
        tipo_id            = qs.get("tipo_id", "")
        id_organizacion    = qs.get("id_organizacion", "")
        id_municipio       = qs.get("id_municipio", "")
        cand_id            = qs.get("cand_id", "")
        cedula             = qs.get("cedula", "")
        documento          = qs.get("documento", "")
        org_id             = qs.get("org_id", "")
        corp_id            = qs.get("corp_id", "")
        circ_id            = qs.get("circ_id", "")
        partido_filter     = qs.get("partido", "").upper()
        dpto_name          = qs.get("dpto", "").upper()
        corp_name          = qs.get("corp", "").upper()

        try:
            # Listar organizaciones
            params_orgs: dict = {}
            if id_circunscripcion:
                params_orgs["id_circunscripcion"] = id_circunscripcion
            if tipo_id:
                params_orgs["tipo_id"] = tipo_id
            if id_departamento:
                params_orgs["id_departamento"] = id_departamento

            try:
                r_orgs = self._cne_get("/organizacionPolitica", params_orgs)
                orgs_data = r_orgs.json() if r_orgs.ok else []
            except Exception as e:
                print(f"[BuscarCandidatos] Error listando orgs tipo={tipo_id}: {e}")
                orgs_data = []

            orgs = orgs_data if isinstance(orgs_data, list) else orgs_data.get("data", [])
            print(f"[BuscarCandidatos] Encontradas {len(orgs)} organizaciones")

            # Mapear org_id → nombre
            corp_map: dict = {str(o.get("id", "")): o.get("nombre", "") for o in orgs}

            candidatos = []
            for org in orgs:
                org_name = org.get("nombre", "")
                if partido_filter and partido_filter not in org_name.upper():
                    continue
                o_id = str(org.get("id", org_id))
                params_cand: dict = {}
                if o_id:
                    params_cand["id_organizacion"] = o_id
                if id_municipio:
                    params_cand["id_municipio"] = id_municipio
                if corp_id:
                    params_cand["corp_id"] = corp_id
                if circ_id:
                    params_cand["id_circunscripcion"] = circ_id
                if cand_id:
                    params_cand["cand_id"] = cand_id
                if cedula or documento:
                    params_cand["documento"] = cedula or documento

                try:
                    r_cand = self._cne_get("/candidato", params_cand)
                    cands = r_cand.json() if r_cand.ok else []
                    if isinstance(cands, dict):
                        cands = cands.get("data", [])
                    for c in cands:
                        c["org_name"] = org_name
                        c["dpto_name"] = dpto_name
                    candidatos.extend(cands)
                except Exception as e:
                    print(f"[BuscarCandidatos] Error listando candidatos org={o_id}: {e}")

            print(f"[BuscarCandidatos] Total candidatos: {len(candidatos)}")
            self._send_json({"candidatos": candidatos, "orgs": orgs})

        except Exception as e:
            print(f"[BuscarCandidatos] Error: {e}")
            self._send_error_json(str(e))

    # ── /api/cne_gestion_filtrado ─────────────────────────────────────────────

    def _handle_cne_gestion_filtrado(self):
        """
        Endpoint que consulta módulos de gestión del CNE y filtra.
        GET /api/cne_gestion_filtrado?dpto=ATLANTICO&mun=BARANOA&corp=ALCALDIA&partido=LIBERAL
        Devuelve {dictamen:[], coalicion:[], contador:[], gerente:[], auditor:[]}
        DICTAMEN: usa endpoint departamentosFilter del CNE (filtra server-side por depto)
        GERENTE/AUDITOR: descarga todo con caché 30min (API no soporta filtros)
        """
        if _cne_session is None:
            return self._send_error_json("Sin sesion CNE. Use /api/cne_login o ejecute indexar_cuentas_claras.py", 401)

        import time
        t_start = time.time()

        qs       = self._qs()
        dpto_raw    = qs.get("dpto", "").strip()
        mun_raw     = qs.get("mun", "").strip()
        f_corp      = qs.get("corp", "").strip().upper()
        f_partido   = qs.get("partido", "").strip().upper()
        f_dpto      = _norm_folder(dpto_raw)
        f_mun       = _norm_folder(mun_raw)

        def _n(s: str) -> str:
            """Normaliza para comparación."""
            return _norm_folder(s)

        def _parse_page(resp_json) -> tuple[list, int]:
            """Extrae items y last_page de una respuesta paginada de CNE.
            Maneja la estructura: {"pagination":{}, "COLLECTION": {"data":[...],"last_page":N}}
            y también la estructura plana: {"data":[...],"last_page":N}.
            """
            if isinstance(resp_json, list):
                return resp_json, 1
            if not isinstance(resp_json, dict):
                return [], 1
            # Buscar la clave colección: valor dict con "data" (lista) y "last_page"
            for k, v in resp_json.items():
                if k == "pagination":
                    continue
                if isinstance(v, dict) and isinstance(v.get("data"), list):
                    return v["data"], v.get("last_page", 1)
            # Fallback: "data" en la raíz
            if isinstance(resp_json.get("data"), list):
                return resp_json["data"], resp_json.get("last_page", 1)
            return [], 1

        def _fetch_page(endpoint: str, page: int, extra_params: dict | None = None) -> list:
            """Descarga una página de un endpoint."""
            params = {"page": page}
            if extra_params:
                params.update(extra_params)
            try:
                r = self._cne_get(endpoint, params)
                if not r.ok:
                    return []
                items, _ = _parse_page(r.json())
                return items
            except Exception:
                return []

        def _consultar_dictamen(mun_id: str, dpto_id: str) -> list:
            """
            Consulta dictamen usando los endpoints de filtro del CNE.
            - Si hay mun_id: usa municipioFilter (resultado directo, ~10 items)
            - Si solo hay dpto_id: usa departamentosFilter (pagina ~160 págs del depto)
            - Sin filtros: pagina todo (24K, fallback)
            """
            import time
            t0 = time.time()

            if mun_id:
                try:
                    r = self._cne_get("/dictament-de-auditoria/municipioFilter",
                                      {"id_municipio": mun_id, "dictamen_auditor": "true"})
                    if r.ok:
                        items, _ = _parse_page(r.json())
                        elapsed = f"{time.time()-t0:.1f}"
                        print(f"[Gestion] dictamen municipioFilter dpto={dpto_id} mun={mun_id} "
                              f"{len(items)} items, {elapsed}s")
                        return items
                except Exception as e:
                    print(f"[Gestion] dictamen error: {e}")

            if dpto_id:
                try:
                    r1 = self._cne_get("/dictament-de-auditoria/departamentosFilter",
                                       {"id_departamento": dpto_id, "page": 1})
                    if r1.ok:
                        first_items, last_p = _parse_page(r1.json())
                        print(f"[Gestion] dictamen departamentosFilter dpto={dpto_id} "
                              f"{last_p} páginas detectadas, descargando en paralelo...")
                        all_items = list(first_items)
                        batch_size = 10
                        for batch_start in range(2, last_p + 1, batch_size):
                            batch_end = min(batch_start + batch_size, last_p + 1)
                            pages = range(batch_start, batch_end)
                            with ThreadPoolExecutor(max_workers=batch_size) as pool:
                                futs = {pool.submit(_fetch_page,
                                                    "/dictament-de-auditoria/departamentosFilter",
                                                    pg, {"id_departamento": dpto_id}): pg
                                        for pg in pages}
                                for f in as_completed(futs):
                                    all_items.extend(f.result())
                        elapsed = f"{time.time()-t0:.1f}"
                        print(f"[Gestion] dictamen departamentosFilter dpto={dpto_id} "
                              f"{len(all_items)} items, {elapsed}s")
                        return all_items
                except Exception as e:
                    print(f"[Gestion] dictamen error: {e}")

            # Fallback: paginar todo
            return _paginar_modulo("dictament-de-auditoria")

        def _paginar_modulo(modulo: str, extra_params: dict | None = None) -> list:
            """Descarga TODAS las páginas de un módulo y las guarda en caché (30 min)."""
            import time
            cache_key = modulo + str(extra_params)
            with _cache_lock:
                cache_entry = _gestion_cache.get(cache_key)
                if cache_entry and (time.time() - cache_entry["ts"]) < 1800:
                    items = cache_entry["items"]
                    print(f"[Gestion] {modulo}: usando caché ({len(items)} items)")
                    return items

            r1 = self._cne_get(f"/{modulo}", {**(extra_params or {}), "page": 1})
            if not r1.ok:
                return []
            first_items, last_p = _parse_page(r1.json())
            print(f"[Gestion] {modulo}: {last_p} páginas detectadas, descargando en paralelo...")
            all_items = list(first_items)
            batch_size = 20
            for batch_start in range(2, last_p + 1, batch_size):
                batch_end = min(batch_start + batch_size, last_p + 1)
                pages = range(batch_start, batch_end)
                with ThreadPoolExecutor(max_workers=batch_size) as batch_pool:
                    page_results = {batch_pool.submit(_fetch_page, f"/{modulo}", pg, extra_params): pg
                                    for pg in pages}
                    for f in as_completed(page_results):
                        pg_items = f.result()
                        all_items.extend(pg_items)

            with _cache_lock:
                _gestion_cache[cache_key] = {"ts": time.time(), "items": all_items}
            return all_items

        try:
            # Resolver IDs de depto/municipio
            dpto_id = mun_id = ""
            try:
                r_dptos = self._cne_get("/departamento")
                if r_dptos.ok:
                    dptos, _ = _parse_page(r_dptos.json())
                    for d in dptos:
                        if not isinstance(d, dict):
                            continue
                        nom = (d.get("nombre") or d.get("departamentoNombre") or
                               d.get("nom_departamento") or "")
                        if _n(nom) == f_dpto:
                            dpto_id = str(d.get("id", ""))
                            break
            except Exception:
                pass

            if dpto_id and f_mun:
                try:
                    r_muns = self._cne_get("/municipio", {"id_departamento": dpto_id})
                    if r_muns.ok:
                        muns, _ = _parse_page(r_muns.json())
                        for m in muns:
                            if not isinstance(m, dict):
                                continue
                            nom = (m.get("nombre") or m.get("munipioNombre") or
                                   m.get("municipioNombre") or m.get("nom_ciudad") or "")
                            if _n(nom) == f_mun:
                                mun_id = str(m.get("id", ""))
                                break
                except Exception:
                    pass

            print(f"[Gestion] IDs resueltos: dpto={dpto_id} ('{dpto_raw}') / "
                  f"mun={mun_id} ('{mun_raw}')")

            # Dictamen
            dict_items = _consultar_dictamen(mun_id, dpto_id)

            # Coalición
            try:
                r_coal = self._cne_get("/coalicionPolitica")
                if r_coal.ok:
                    coal_items, _ = _parse_page(r_coal.json())
                else:
                    coal_items = []
                print(f"[Gestion] coalicion: {len(coal_items)} items "
                      f"(búsqueda: {f_dpto}|{f_mun})")
            except Exception as e:
                print(f"[Gestion] Error coalicion: {e}")
                coal_items = []

            # Contador, Gerente, Auditor (con caché)
            all_items = {
                "contador": _paginar_modulo("contador"),
                "gerente":  _paginar_modulo("gerente"),
                "auditor":  _paginar_modulo("dictament-de-auditoria"),
            }

            # _es_dpto: filtrar por depto cuando no hay municipio
            _es_dpto = bool(dpto_id and not mun_id)

            def _filtrar(items: list, nom_fields: list) -> list:
                result = []
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    # Filtro corporación
                    corp_val = it.get("corporacionNombre", "")
                    if f_corp and f_corp not in _n(corp_val) and "ALCALDR" not in corp_val.upper():
                        if "GOBERN" not in corp_val.upper() or "GOBERN" not in f_corp:
                            pass
                    # Filtro partido
                    org_names = [it.get(fn, "") for fn in nom_fields]
                    partido_match = (not f_partido or
                                     any(f_partido in _n(n) for n in org_names if n))
                    # Filtro depto/mun
                    nom_d = it.get("departamentoNombre") or it.get("nom_departamento", "")
                    nom_m = it.get("municipioNombre") or it.get("nom_ciudad", "")
                    dpto_match = (not f_dpto or _n(nom_d) == f_dpto)
                    mun_match  = (not f_mun  or _n(nom_m) == f_mun)
                    if partido_match and dpto_match and mun_match:
                        result.append(it)
                return result

            nom_fields_dict = ["agrupacionPoliticaNombre", "grupoSignificativoNombre",
                               "coalicionPoliticaNombre", "organizacion"]
            nom_fields_org  = ["nombre_org1", "nombre_org2", "nombre_org3", "nombre_coalicion"]

            filtered = {
                "dictamen":  _filtrar(dict_items, nom_fields_dict),
                "coalicion": _filtrar(coal_items, ["agrupacionPoliticaNombre", "nombre_coalicion"]),
                "contador":  _filtrar(all_items["contador"], nom_fields_org),
                "gerente":   _filtrar(all_items["gerente"],  nom_fields_org),
                "auditor":   _filtrar(all_items["auditor"],  nom_fields_dict),
            }

            import time
            elapsed_total = f"{time.time()-t_start:.1f}"
            sizes = {k: len(v) for k, v in filtered.items()}
            print(f"[Gestion Filtrado] {dpto_raw}|{mun_raw}|{f_corp}|{f_partido} "
                  f"→ {sizes} total | {elapsed_total}s")

            self._send_json(filtered)

        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f"[Gestion ERROR] {tb}")
            self._send_error_json(str(e))

    # ── /api/cne_dictamen_filtrado ────────────────────────────────────────────

    def _handle_cne_dictamen_filtrado(self):
        """
        Endpoint dedicado para dictamen de auditoría.
        GET /api/cne_dictamen_filtrado?dpto=HUILA&mun=TESALIA
        Devuelve {dictamen:[...]}
        Usa municipioFilter/departamentosFilter del CNE.
        """
        if _cne_session is None:
            return self._send_error_json("Sin sesion CNE. Use /api/cne_login o ejecute indexar_cuentas_claras.py", 401)

        qs    = self._qs()
        dpto  = _norm_folder(qs.get("dpto", ""))
        mun   = _norm_folder(qs.get("mun", ""))

        def _n(s: str) -> str:
            return _norm_folder(s)

        def _parse_cne_page(resp_json) -> tuple[list, int]:
            if isinstance(resp_json, list):
                return resp_json, 1
            if not isinstance(resp_json, dict):
                return [], 1
            for k, v in resp_json.items():
                if k == "pagination":
                    continue
                if isinstance(v, dict) and isinstance(v.get("data"), list):
                    return v["data"], v.get("last_page", 1)
            if isinstance(resp_json.get("data"), list):
                return resp_json["data"], resp_json.get("last_page", 1)
            return [], 1

        try:
            # Resolver IDs
            dpto_id = mun_id = ""
            r_dptos = self._cne_get("/departamento")
            if r_dptos.ok:
                dptos, _ = _parse_cne_page(r_dptos.json())
                for d in dptos:
                    if not isinstance(d, dict):
                        continue
                    nom = d.get("nombre") or d.get("departamentoNombre") or d.get("nom_departamento") or ""
                    if _n(nom) == dpto:
                        dpto_id = str(d.get("id", ""))
                        break

            if dpto_id and mun:
                r_muns = self._cne_get("/municipio", {"id_departamento": dpto_id})
                if r_muns.ok:
                    muns, _ = _parse_cne_page(r_muns.json())
                    for m in muns:
                        if not isinstance(m, dict):
                            continue
                        nom = m.get("nombre") or m.get("munipioNombre") or m.get("municipioNombre") or m.get("nom_ciudad") or ""
                        if _n(nom) == mun:
                            mun_id = str(m.get("id", ""))
                            break

            # Intentar municipioFilter
            all_items = []
            if mun_id:
                try:
                    r = self._cne_get("/dictament-de-auditoria/municipioFilter",
                                      {"id_municipio": mun_id, "dictamen_auditor": "true"})
                    if r.ok:
                        all_items, _ = _parse_cne_page(r.json())
                        print(f"[Dictamen] municipioFilter dpto={dpto_id} mun={mun_id} "
                              f"{len(all_items)} items")
                except Exception as e:
                    print(f"[Dictamen] municipioFilter error: {e}")

            # Intentar departamentosFilter
            if not all_items and dpto_id:
                try:
                    r1 = self._cne_get("/dictament-de-auditoria/departamentosFilter",
                                       {"id_departamento": dpto_id, "page": 1})
                    if r1.ok:
                        items1, last_p = _parse_cne_page(r1.json())
                        all_items = list(items1)
                        print(f"[Dictamen] departamentosFilter dpto={dpto_id} {last_p} págs")
                        for pg in range(2, last_p + 1):
                            r_pg = self._cne_get("/dictament-de-auditoria/departamentosFilter",
                                                 {"id_departamento": dpto_id, "page": pg})
                            if r_pg.ok:
                                items_pg, _ = _parse_cne_page(r_pg.json())
                                all_items.extend(items_pg)
                except Exception as e:
                    print(f"[Dictamen] departamentosFilter error: {e}")

            # Filtrar por municipio si vino mun
            if mun and all_items:
                filtered = [it for it in all_items
                            if isinstance(it, dict) and
                            _n(it.get("municipioNombre") or it.get("nom_ciudad") or "") == mun]
            else:
                filtered = all_items

            total_orig = len(all_items)
            print(f"[Dictamen Filtrado] {len(filtered)} de {total_orig}")
            self._send_json({"dictamen": filtered})

        except Exception as e:
            self._send_error_json(str(e))

    # ── /api/cne/<endpoint> (proxy) ───────────────────────────────────────────

    def _handle_cne_proxy(self):
        """
        Proxy a Cuentas Claras del CNE.
        /api/cne/<endpoint>?params → CNE_API/<endpoint>?params
        Devuelve JSON o PDF segun lo que devuelva CNE.
        """
        if _cne_session is None:
            body = b"Sin sesion CNE. Use /api/cne_login o ejecute indexar_cuentas_claras.py"
            self.send_response(401)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        parsed   = urlparse(self.path)
        endpoint = parsed.path[len("/api/cne"):]
        cne_url  = CNE_API + endpoint + ("?" + parsed.query if parsed.query else "")

        try:
            xsrf = _get_xsrf(_cne_session)
            # Detectar si es descarga de archivo (PDF/Excel) o llamada JSON
            is_file = (
                "/storage/" in endpoint or
                "imprimir" in endpoint.lower() or
                "descargar" in endpoint.lower() or
                "download" in endpoint.lower() or
                "libroContable" in endpoint or
                "descargar-consolidado" in endpoint or
                endpoint.lower().endswith(".pdf") or
                endpoint.lower().endswith(".xlsx")
            )
            proxy_headers = {
                "Accept": "application/pdf,application/octet-stream,*/*" if is_file else "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "X-XSRF-TOKEN": xsrf,
                "Referer": CNE_API + "/",
                "Accept-Language": "es-CO,es;q=0.9",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
            resp = _cne_session.get(cne_url, headers=proxy_headers, timeout=60, stream=True)
            if resp.status_code == 401:
                # Re-login fallido
                body = b"Re-login fallido"
                self.send_response(401)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if not resp.ok:
                body = f"CNE respondio HTTP {resp.status_code}".encode()
                self.send_response(resp.status_code)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            content = resp.content
            ct = resp.headers.get("Content-Type", "application/json")
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(content)))
            if "application/pdf" in ct or "octet" in ct:
                self.send_header("Content-Disposition", "inline")
            self.end_headers()
            self.wfile.write(content)

        except Exception as e:
            print(f"Error proxy CNE: {e}")
            self._send_error_json(str(e))

    # ── /api/lista_respuestas ─────────────────────────────────────────────────

    def _handle_lista_respuestas(self):
        qs         = self._qs()
        cargo      = _norm_folder(qs.get("cargo", ""))
        dpto       = _norm_folder(qs.get("dpto", ""))
        mun        = _norm_folder(qs.get("mun", ""))
        partido    = _norm_folder(qs.get("partido", ""))
        base       = os.path.join("data", "respuestas", cargo, dpto, mun, partido)
        rel_prefix = os.path.join("data", "respuestas", cargo, dpto, mun, partido)
        try:
            files = sorted(
                f for f in os.listdir(base) if os.path.isfile(os.path.join(base, f))
            )
            self._send_json({"files": [os.path.join(rel_prefix, f) for f in files]})
        except FileNotFoundError:
            self._send_json({"files": []})
        except Exception as e:
            self._send_error_json(str(e))

    # ── /api/cc_stats  y  /api/cc_candidatos ─────────────────────────────────

    def _handle_cc_stats(self):
        """Sirve data/cc_stats_analisis.json enriquecido con totales de cc_financiero_v2.json."""
        portal_dir = self.server.portal_dir if hasattr(self.server, "portal_dir") else os.getcwd()
        stats_path = os.path.join(portal_dir, "data", "cc_stats_analisis.json")
        fin_path   = os.path.join(portal_dir, "data", "cc_financiero_v2.json")
        if not os.path.exists(stats_path):
            # Intentar devolver al menos los totales financieros si ya se indexó
            data = {}
        else:
            try:
                with open(stats_path, encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                return self._send_error_json(str(e))
        # Enriquecer con totales de cc_financiero_v2.json si existe y aún no están en stats
        if os.path.exists(fin_path) and not data.get("total_ingresos"):
            try:
                with open(fin_path, encoding="utf-8") as f:
                    fin = json.load(f)
                data["total_ingresos"]  = round(sum(v.get("total_ingreso", 0) for v in fin.values()), 2)
                data["total_gastos"]    = round(sum(v.get("total_gasto",   0) for v in fin.values()), 2)
                data["total_reportaron"] = sum(1 for v in fin.values()
                                               if v.get("total_ingreso", 0) > 0 or v.get("total_gasto", 0) > 0)
            except Exception:
                pass
        self._send_json(data)

    def _handle_cc_candidatos(self):
        """
        Busca candidatos indexados.
        QS: dpto=, mun=, partido=, corp_id=, sin_radicacion=1, page=, per_page=
        Retorna: {total, page, per_page, candidatos:[...]}
        """
        qs       = self._qs()
        f_dpto   = qs.get("dpto", "").upper().strip()
        f_mun    = qs.get("mun", "").upper().strip()
        f_partido= qs.get("partido", "").upper().strip()
        f_corp   = qs.get("corp_id", "")
        f_sinrad = qs.get("sin_radicacion", "") == "1"
        f_q      = qs.get("q", "").upper().strip()
        page     = max(1, int(qs.get("page", 1)))
        per_page = min(500, max(10, int(qs.get("per_page", 100))))

        cc_dir = os.path.join("data", "candidatos_cc")
        if not os.path.isdir(cc_dir):
            return self._send_json({"total": 0, "page": 1, "per_page": per_page, "candidatos": []})

        resultados = []
        try:
            dptos = sorted(os.listdir(cc_dir))
            for dpto_folder in dptos:
                if f_dpto and f_dpto not in dpto_folder.upper():
                    continue
                dpto_path = os.path.join(cc_dir, dpto_folder)
                if not os.path.isdir(dpto_path):
                    continue
                for mun_folder in sorted(os.listdir(dpto_path)):
                    if f_mun and f_mun not in mun_folder.upper():
                        continue
                    mun_path = os.path.join(dpto_path, mun_folder)
                    if not os.path.isdir(mun_path):
                        continue
                    for fname in sorted(os.listdir(mun_path)):
                        if not fname.endswith(".json"):
                            continue
                        try:
                            with open(os.path.join(mun_path, fname), encoding="utf-8") as fh:
                                c = json.load(fh)
                        except Exception:
                            continue
                        if f_partido and f_partido not in (c.get("org") or "").upper():
                            continue
                        if f_corp and str(c.get("corp_id", "")) != f_corp:
                            continue
                        if f_sinrad and len(c.get("envios") or []) > 0:
                            continue
                        if f_q:
                            blob = " ".join([
                                str(c.get("nombre", "")),
                                str(c.get("cedula", "")),
                                str(c.get("org", "")),
                            ]).upper()
                            if f_q not in blob:
                                continue
                        # Resumen liviano
                        cons = c.get("consolidado") or {}
                        def _v(d, *ks):
                            for k in ks:
                                v = d.get(k)
                                if v is not None:
                                    try: return float(str(v).replace(",","").replace("$","").strip() or 0)
                                    except: pass
                            return 0.0
                        resultados.append({
                            "cand_id":   c.get("cand_id"),
                            "nombre":    c.get("nombre"),
                            "cedula":    c.get("cedula"),
                            "org":       c.get("org"),
                            "corp":      c.get("corp"),
                            "corp_id":   c.get("corp_id"),
                            "dpto":      c.get("dpto"),
                            "mun":       c.get("mun"),
                            "radico":    len(c.get("envios") or []) > 0,
                            "ingresos":  _v(cons,"totalIngresos","total_ingresos","ingresos","valorIngresos"),
                            "gastos":    _v(cons,"totalGastos","total_gastos","gastos","valorGastos"),
                        })
        except Exception as e:
            return self._send_error_json(str(e))

        total = len(resultados)
        start = (page - 1) * per_page
        self._send_json({
            "total":      total,
            "page":       page,
            "per_page":   per_page,
            "candidatos": resultados[start: start + per_page],
        })

    # ── /api/guardar_liquidacion ──────────────────────────────────────────────

    def _handle_guardar_liquidacion(self):
        """Guarda JSON de liquidación en data/liquidacion/{cargo}/{dpto}/{mun}/{partido}.json"""
        length = int(self.headers.get("Content-Length", 0))
        ct = self.headers.get("Content-Type", "")
        if "multipart" in ct:
            fields, _ = _parse_multipart(self.rfile, ct, length)
            data_str  = fields.get("data", "{}")
        else:
            data_str = self.rfile.read(length).decode("utf-8", errors="replace")

        try:
            payload = json.loads(data_str)
        except json.JSONDecodeError:
            return self._send_error_json("Nombre de archivo inválido", 400)

        cargo   = _norm_folder(payload.get("cargo", ""))
        dpto    = _norm_folder(payload.get("dpto", ""))
        mun     = _norm_folder(payload.get("mun", ""))
        partido = _norm_folder(payload.get("partido", ""))
        tipo    = payload.get("tipo", "LIQUIDACIÓN ÚNICA")

        destino = os.path.join("data", "liquidacion", cargo, dpto, mun)
        os.makedirs(destino, exist_ok=True)
        fname = os.path.join(destino, f"{partido}.json")
        with open(fname, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)

        self._send_json({"ok": True, "file": fname, "tipo": tipo})

    # ── Silenciar log ─────────────────────────────────────────────────────────

    def log_message(self, fmt, *args):
        pass  # Comentar para ver log de accesos


# ── Servidor multi-hilo ───────────────────────────────────────────────────────

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


# ── Punto de entrada ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081

    # En Windows: montar unidad P: para paths cortos
    portal_dir = os.path.dirname(os.path.abspath(__file__))
    if sys.platform == "win32":
        portal_dir = _subst_mount(portal_dir)

    server = ThreadedHTTPServer(("0.0.0.0", port), Handler)
    print(f"Portal CNE corriendo en http://0.0.0.0:{port}")
    print(f"Acceso local: http://localhost:{port}")
    print(f"Acceso red:   http://<tu-ip>:{port}")
    print("Ctrl+C para detener")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
        server.shutdown()
