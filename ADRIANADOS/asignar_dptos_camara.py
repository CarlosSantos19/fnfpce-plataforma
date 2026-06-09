"""
asignar_dptos_camara.py
=======================
Asigna departamento a candidatos CÁMARA en cc_index_1.json
consultando getCandidatos con id_departamento=X para X en 1-37.

Uso:
  py asignar_dptos_camara.py --usuario 80115895 --password TuPassword
"""

import sys, io, os, re, json, argparse, getpass, warnings
import requests
from urllib.parse import unquote

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
warnings.filterwarnings("ignore")

CNE_API        = "https://app_cng_2026.cne.gov.co/fondo_cng_2026/public"
CNE_LOGIN_HOME = "https://app_cng_2026.cne.gov.co/usuarios_cng_2026/public/"
CNE_LOGIN_URL  = "https://app_cng_2026.cne.gov.co/usuarios_cng_2026/public/login"
PROCESO_ID     = 1

BASE     = os.path.dirname(os.path.abspath(__file__))
IDX_PATH = os.path.join(BASE, "data", "cc_index_1.json")
IDX_OUT  = os.path.join(BASE, "data", "cc_index_1.json")
# También actualizar el que usa el portal
PORTAL_PATH = os.path.join(BASE, "..", "modules", "revision", "data", "cc_index_1.json")

def _login(usuario, password):
    sess = requests.Session()
    sess.verify = False
    sess.headers.update({"User-Agent": "Mozilla/5.0", "Accept-Language": "es-CO,es;q=0.9"})
    r1 = sess.get(CNE_LOGIN_HOME, timeout=15)
    m = re.search(r'name=["\']_token["\'].*?value=["\']([^"\']+)["\']', r1.text)
    if not m:
        print("  [ERR] No se encontró CSRF"); return None
    csrf = m.group(1)
    r2 = sess.post(CNE_LOGIN_URL,
                   data={"_token": csrf, "usuario": usuario, "password": password},
                   allow_redirects=True, timeout=20)
    if r2.status_code >= 400 or ("login" in r2.url.lower() and "redirect" not in r2.url.lower()):
        print("  [ERR] Login fallido"); return None
    xsrf = unquote(sess.cookies.get("XSRF-TOKEN", ""))
    sess.headers.update({"X-XSRF-TOKEN": xsrf, "X-Requested-With": "XMLHttpRequest"})
    print(f"  [OK]  Login exitoso — {r2.url}")
    return sess

def _get_cands_dpto(sess, id_dpto):
    """Obtiene todos los candidatos CÁMARA de un departamento específico."""
    todos = []
    for id_org in range(1, 32):
        for id_tipo in (1, 2, 3):
            try:
                r = sess.get(f"{CNE_API}/getCandidatos", params={
                    "id_tipo": id_tipo, "id_organizacion": id_org,
                    "id_corporacion": 1, "id_circunscripcion": 3,
                    "id_departamento": id_dpto, "id_proceso": PROCESO_ID,
                }, headers={"Accept": "application/json"}, timeout=15)
                if r.ok:
                    d = r.json()
                    cands = d.get("candidatos", []) if isinstance(d, dict) else d
                    todos.extend(cands)
            except Exception:
                pass
    return todos

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--usuario", default="")
    parser.add_argument("--password", default="")
    args = parser.parse_args()

    usuario  = args.usuario  or input("  Usuario (cédula): ").strip()
    password = args.password or getpass.getpass("  Contraseña: ")

    print("\n=== Asignando departamentos a candidatos CÁMARA ===\n")
    print("Iniciando sesión…")
    sess = _login(usuario, password)
    if not sess:
        sys.exit(1)

    print("Cargando índice…")
    with open(IDX_PATH, encoding="utf-8") as f:
        idx = json.load(f)

    # Construir mapa cand_id → dpto_nom
    dpto_map = {}  # cand_id (int) → nombre departamento

    print("Consultando departamentos CÁMARA (1-37)…")
    for id_dpto in range(1, 38):
        cands = _get_cands_dpto(sess, id_dpto)
        nuevos = [c for c in cands if c.get("id_candi") and c["id_candi"] not in dpto_map]
        if nuevos:
            # Obtener nombre del departamento haciendo una consulta con nombre
            dpto_nom = f"DPTO_{id_dpto}"
            # Intentar descubrir nombre desde la respuesta del API
            r = sess.get(f"{CNE_API}/departamento", params={"id_proceso": PROCESO_ID},
                         headers={"Accept": "application/json"}, timeout=15)
            if r.ok:
                dptos = r.json()
                if isinstance(dptos, list):
                    for d in dptos:
                        did = d.get("id") or d.get("id_departamento")
                        if str(did) == str(id_dpto):
                            dpto_nom = (d.get("nombre") or d.get("nom_departamento") or dpto_nom).upper()
                            break
            for c in nuevos:
                dpto_map[c["id_candi"]] = dpto_nom
            print(f"  dpto_id={id_dpto:2d} ({dpto_nom}): {len(nuevos)} candidatos nuevos")

    print(f"\nTotal candidatos con departamento: {len(dpto_map)}")

    # Actualizar candidatos en el índice
    actualizados = 0
    for sec_data in idx.values():
        for mun_data in sec_data.get("municipios", {}).values():
            for c in mun_data.get("candidatos", []):
                cid = c.get("cand_id")
                if cid in dpto_map:
                    c["dpto"] = dpto_map[cid]
                    actualizados += 1

    print(f"Candidatos actualizados en índice: {actualizados}")

    # Guardar
    with open(IDX_OUT, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  [OK]  Guardado: {IDX_OUT}")

    # Copiar al portal si existe la ruta
    portal = os.path.normpath(PORTAL_PATH)
    if os.path.exists(os.path.dirname(portal)):
        with open(portal, "w", encoding="utf-8") as f:
            json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  [OK]  Copiado al portal: {portal}")

    print("\n=== Listo. Ejecuta: firebase deploy --only hosting ===\n")

if __name__ == "__main__":
    main()
