"""
asignar_dptos_camara.py
=======================
Asigna departamento a candidatos CÁMARA en cc_index_1.json
cruzando por nombre con contador_gerente_congreso_2026.json.

No requiere conexión al CNE — usa archivos locales.

Uso:
  py asignar_dptos_camara.py
"""

import sys, io, os, re, json, unicodedata

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE     = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")

IDX_PATH   = os.path.join(DATA_DIR, "cc_index_1.json")
CG_PATH    = os.path.join(DATA_DIR, "contador_gerente_congreso_2026.json")
GER_PATH   = os.path.join(DATA_DIR, "gerentes_congreso_2026.json")
PORTAL_IDX = os.path.normpath(os.path.join(BASE, "..", "modules", "revision", "data", "cc_index_1.json"))

# Mapa DANE id → nombre normalizado
DANE = {
    5:"ANTIOQUIA", 8:"ATLANTICO", 11:"BOGOTA D.C.", 13:"BOLIVAR",
    15:"BOYACA", 17:"CALDAS", 18:"CAQUETA", 19:"CAUCA", 20:"CESAR",
    23:"CORDOBA", 25:"CUNDINAMARCA", 27:"CHOCO", 41:"HUILA",
    44:"LA GUAJIRA", 47:"MAGDALENA", 50:"META", 52:"NARINO",
    54:"NORTE DE SANTANDER", 63:"QUINDIO", 66:"RISARALDA",
    68:"SANTANDER", 70:"SUCRE", 73:"TOLIMA", 76:"VALLE DEL CAUCA",
    81:"ARAUCA", 85:"CASANARE", 86:"PUTUMAYO", 88:"SAN ANDRES",
    91:"AMAZONAS", 94:"GUAINIA", 95:"GUAVIARE", 97:"VAUPES", 99:"VICHADA",
}

def _norm(s):
    """Normaliza texto: mayúsculas, sin tildes, solo alfanumérico."""
    s = unicodedata.normalize("NFD", str(s or "").upper())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Z0-9 ]", " ", s).strip()

def _nombre_clave(nombre, apellidos=""):
    """Genera clave de búsqueda de nombre normalizado."""
    return _norm(f"{nombre} {apellidos}".strip())

def main():
    print("\n=== Asignando departamentos CÁMARA (modo local) ===\n")

    # ── Cargar índice ──────────────────────────────────────────────────────────
    print("Cargando cc_index_1.json…")
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            with open(IDX_PATH, encoding=enc) as f:
                idx = json.load(f)
            break
        except Exception:
            continue
    else:
        print("  [ERR] No se pudo leer cc_index_1.json"); sys.exit(1)

    # ── Construir mapa nombre → (dpto_id, dpto_nom) desde archivo local ────────
    nombre_dpto = {}   # nombre_normalizado → dpto_nombre
    cedula_dpto = {}   # cedula_str         → dpto_nombre

    def _agregar(nombre_p, apellidos_p, cedula_p, id_dpto, nom_dpto):
        if not nom_dpto and id_dpto:
            nom_dpto = DANE.get(int(id_dpto), f"DPTO_{id_dpto}")
        dpto_str = _norm(nom_dpto) if nom_dpto else ""
        if not dpto_str:
            return
        clave = _nombre_clave(nombre_p, apellidos_p)
        if clave:
            nombre_dpto[clave] = dpto_str
        ced = str(cedula_p or "").strip()
        if ced:
            cedula_dpto[ced] = dpto_str

    # Cargar contador_gerente_congreso_2026.json
    if os.path.exists(CG_PATH):
        print("Leyendo contador_gerente_congreso_2026.json…")
        for enc in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                with open(CG_PATH, encoding=enc) as f:
                    cg_data = json.load(f)
                break
            except Exception:
                continue
        else:
            cg_data = []

        for registro in (cg_data if isinstance(cg_data, list) else []):
            # Estructura: { "contadores": [...] }  o lista plana de contadores
            contadores = registro.get("contadores", []) if isinstance(registro, dict) else [registro]
            for c in contadores:
                proc = str(c.get("proceso") or "")
                if "CONGRESO" not in proc.upper():
                    continue
                _agregar(
                    c.get("nombreP", ""), c.get("apellidosP", ""),
                    c.get("documentoP", ""),
                    c.get("id_departamento"), c.get("nom_departamento", "")
                )
        print(f"  Candidatos con dpto desde contador_gerente: {len(nombre_dpto):,}")

    # Cargar gerentes_congreso_2026.json como fuente adicional
    if os.path.exists(GER_PATH):
        print("Leyendo gerentes_congreso_2026.json…")
        for enc in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                with open(GER_PATH, encoding=enc) as f:
                    ger_data = json.load(f)
                break
            except Exception:
                continue
        else:
            ger_data = []

        prev = len(nombre_dpto)
        for g in (ger_data if isinstance(ger_data, list) else []):
            proc = str(g.get("proceso") or "")
            if "CONGRESO" not in proc.upper():
                continue
            _agregar(
                g.get("nombreP", ""), g.get("apellidosP", ""),
                g.get("documentoP", ""),
                g.get("id_departamento"), g.get("nom_departamento", "")
            )
        print(f"  Candidatos adicionales desde gerentes: {len(nombre_dpto) - prev:,}")

    print(f"Total candidatos en mapa nombre→dpto: {len(nombre_dpto):,}")

    # ── Asignar departamentos a candidatos CÁMARA ──────────────────────────────
    actualizados = sin_match = 0

    for sec_data in idx.values():
        for mun_data in sec_data.get("municipios", {}).values():
            for c in mun_data.get("candidatos", []):
                if c.get("corp_id") != 1:   # Solo CÁMARA
                    continue
                if c.get("dpto"):           # Ya tiene dpto
                    actualizados += 1
                    continue

                nombre_norm = _norm(c.get("nombre", ""))

                # Intentar match exacto por nombre
                dpto = nombre_dpto.get(nombre_norm)

                # Intentar match parcial (primeras 3 palabras del nombre)
                if not dpto:
                    partes = nombre_norm.split()
                    for n in range(min(len(partes), 4), 2, -1):
                        clave_parcial = " ".join(partes[:n])
                        for k, v in nombre_dpto.items():
                            if k.startswith(clave_parcial):
                                dpto = v
                                break
                        if dpto:
                            break

                if dpto:
                    c["dpto"] = dpto
                    actualizados += 1
                else:
                    sin_match += 1

    print(f"\nCandidatos CÁMARA actualizados: {actualizados}")
    print(f"Sin match (quedarán sin departamento): {sin_match}")

    # Mostrar distribución por departamento
    todos_dptos = {}
    for sec_data in idx.values():
        for mun_data in sec_data.get("municipios", {}).values():
            for c in mun_data.get("candidatos", []):
                if c.get("corp_id") == 1 and c.get("dpto"):
                    d = c["dpto"]
                    todos_dptos[d] = todos_dptos.get(d, 0) + 1
    if todos_dptos:
        print("\nDistribución por departamento:")
        for d, n in sorted(todos_dptos.items()):
            print(f"  {d}: {n}")

    # ── Guardar ────────────────────────────────────────────────────────────────
    with open(IDX_PATH, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n  [OK]  Guardado: {IDX_PATH}")

    if os.path.exists(os.path.dirname(PORTAL_IDX)):
        with open(PORTAL_IDX, "w", encoding="utf-8") as f:
            json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  [OK]  Copiado al portal: {PORTAL_IDX}")

    print("\n=== Listo. Ejecuta: firebase deploy --only hosting ===\n")

if __name__ == "__main__":
    main()
