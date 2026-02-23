import json

with open('contadores.json', encoding='utf-8') as f:
    data = json.load(f)

# Eliminar nombres con caracteres de reemplazo (\ufffd) o errores conocidos
eliminar = {
    'Taliliam Andrea Barajas Martinez',
    'Carlos Moreno',
    'Dionisio Rondon Sanchez',
    'Gloria Estela Oviedo Torres',
    'Henry Osvaldo Amaya Paez',
    'Henry Oswaldo Amaya Perez',
    'Miryam Johana Cabezas Gutierrez',
    'Nohora Grande Ballesteros',
    'Fabian Caicedo',
}

nuevos = []
for c in data['contadores']:
    nombre = c['nombre']
    # Eliminar si tiene caracteres de reemplazo Unicode
    if '\ufffd' in nombre:
        continue
    if nombre in eliminar:
        continue
    nuevos.append(c)

nuevos.sort(key=lambda x: x['nombre'].lower())

with open('contadores.json', 'w', encoding='utf-8') as f:
    json.dump({'contadores': nuevos}, f, ensure_ascii=False, indent=2)

print(f'Total final: {len(nuevos)}')
for c in nuevos:
    print(c['nombre'])
