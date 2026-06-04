"""
generar_candidatos_cong2026.py
===============================
Pre-genera archivos slim por candidato del Congreso 2026.
Salida: modules/congreso/data/candidatos/{cand_id}.json

Cada archivo contiene:
  - info básica (nombre, org, corp, circ)
  - consolidado (total_ingresos, total_gastos, num_ingresos, num_gastos)
  - ingresos: primeros 50 registros slim
  - gastos:   primeros 50 registros slim
  - contador, gerente (desde cc_index_1.json)
  - ani: desde ani_index_congreso_2026.json (si existe)

Uso:
  py -3 generar_candidatos_cong2026.py
"""

import sys, io, os, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE   = os.path.dirname(os.path.abspath(__file__))
DATA   = os.path.join(BASE, "data")
OUT    = os.path.join(BASE, "data", "candidatos_cong")

os.makedirs(OUT, exist_ok=True)

print("Cargando datos...")

with open(os.path.join(DATA, "cc_index_1.json"), encoding="utf-8") as f:
    cc_index = json.load(f)

with open(os.path.join(DATA, "congreso_2026_completo.json"), encoding="utf-8") as f:
    completo = json.load(f)

with open(os.path.join(DATA, "gastos_congreso_2026.json"), encoding="utf-8") as f:
    gastos_raw = json.load(f)

ani_raw = {}
ani_path = os.path.join(DATA, "ani_index_congreso_2026.json")
if os.path.exists(ani_path):
    with open(ani_path, encoding="utf-8") as f:
        ani_raw = json.load(f)

# Mapa cand_id -> info completa desde cc_index_1
cand_map = {}
for sec_data in cc_index.values():
    for mun_data in sec_data.get("municipios", {}).values():
        for c in mun_data.get("candidatos", []):
            cid = str(c.get("cand_id", ""))
            if cid:
                cand_map[cid] = c

print(f"  Candidatos en índice: {len(cand_map)}")

ingresos_raw = completo.get("ingresos", {})
candidatos   = completo.get("candidatos", [])

print(f"  Con ingresos: {len(ingresos_raw)}")
print(f"  Con gastos:   {len(gastos_raw)}")

CAMPOS_ING = ["id_ingreso", "nom_ingreso", "des_ingreso", "nom_formato", "codigo",
              "total", "nombre_persona", "nit_cedula", "tipo_contribucion",
              "especie", "donacion", "credito", "aporte",
              "fecha_registro_movimiento", "no_comprobante_interno",
              "partido_movimiento", "acta_no", "archivo"]

CAMPOS_GAS = ["id_gasto", "nom_ingreso", "des_ingreso", "nom_formato", "codigo",
              "total", "nombre_persona", "nit_cedula",
              "fecha_registro_movimiento", "no_comprobante_interno",
              "acta_no", "clasificacion", "lugar_evento", "archivo"]

def slim(record, campos):
    return {k: record.get(k) for k in campos if record.get(k) is not None}

generados = 0
t0 = time.time()

for c_obj in candidatos:
    cid = str(c_obj.get("id_candi", ""))
    if not cid:
        continue

    # Info base desde cc_index (tiene contador, gerente, totales)
    info = cand_map.get(cid, {})

    # ANI del candidato (cedula viene del gerente/contador)
    cedula_cand = ""
    if info.get("gerente"):
        cedula_cand = info["gerente"].get("documento", "")
    elif info.get("contador"):
        cedula_cand = info["contador"].get("documento", "")
    ani = {}
    if cedula_cand and cedula_cand in ani_raw:
        ani = ani_raw[cedula_cand]

    # Ingresos slim
    ing_data = ingresos_raw.get(cid, {})
    ingresos_slim = [slim(r, CAMPOS_ING) for r in ing_data.get("data", [])[:50]]

    # Gastos slim
    gas_data = gastos_raw.get(cid, {})
    gastos_slim = [slim(r, CAMPOS_GAS) for r in gas_data.get("data", [])[:50]]

    # Calcular totales desde registros (más preciso)
    def _sum(records):
        t = 0
        for r in records:
            try: t += float(str(r.get("total") or 0).replace(",","") or 0)
            except: pass
        return t

    out_obj = {
        "cand_id":        cid,
        "nombre":         c_obj.get("nombre", info.get("nombre", "")),
        "org":            info.get("org", c_obj.get("org", "")),
        "corp":           info.get("corp", ""),
        "corp_id":        info.get("corp_id", c_obj.get("corp")),
        "circ_id":        info.get("circ_id", str(c_obj.get("circ", ""))),
        "org_id":         info.get("org_id", str(c_obj.get("org", ""))),
        # Financiero
        "total_ingresos": info.get("total_ingresos", _sum(ing_data.get("data", []))),
        "total_gastos":   info.get("total_gastos",   _sum(gas_data.get("data", []))),
        "num_ingresos":   info.get("num_ingresos",   ing_data.get("total_registros", 0)),
        "num_gastos":     info.get("num_gastos",     gas_data.get("total_registros", 0)),
        # Detalle
        "ingresos":       ingresos_slim,
        "gastos":         gastos_slim,
        # Personal
        "contador":       info.get("contador"),
        "gerente":        info.get("gerente"),
        "ani":            ani,
        "cedula":         cedula_cand,
    }

    out_path = os.path.join(OUT, f"{cid}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, separators=(",", ":"))

    generados += 1
    if generados % 200 == 0:
        print(f"  {generados}/{len(candidatos)} archivos...")

elapsed = time.time() - t0
print(f"\nGenerados: {generados} archivos en {elapsed:.1f}s")
print(f"Carpeta:   {OUT}")

# Tamaño total
total_kb = sum(
    os.path.getsize(os.path.join(OUT, f)) // 1024
    for f in os.listdir(OUT) if f.endswith(".json")
)
print(f"Tamaño total: {total_kb:,} KB ({total_kb//1024} MB)")
