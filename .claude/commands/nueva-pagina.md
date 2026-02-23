# Nueva Página del Sistema FNFPCE

Crea una nueva página HTML para el sistema FNFPCE siguiendo exactamente el mismo estilo tecnológico/cyberpunk del proyecto.

## Instrucciones

El usuario invocará este skill con: `/nueva-pagina <nombre>`

Por ejemplo: `/nueva-pagina dashboard` o `/nueva-pagina reportes`

### Pasos a seguir:

1. **Determinar el nombre** de la página a partir del argumento dado (si no se provee, preguntar al usuario).

2. **Crear tres archivos** en `c:/Users/carlos.santos/Desktop/APLICATIVO/`:
   - `<nombre>.html`
   - `<nombre>.css`
   - `<nombre>.js`

3. **El HTML** debe seguir esta estructura base:
   - `<!DOCTYPE html>` con `lang="es"`
   - `<link rel="stylesheet" href="<nombre>.css">`
   - Esquinas decorativas: `corner-tl`, `corner-tr`, `corner-bl`, `corner-br`
   - Barra de estado superior con punto verde parpadeante
   - Contenedor principal con clase `page-wrapper`
   - `<script src="<nombre>.js">` al final del body

4. **El CSS** debe:
   - Importar las fuentes: `Orbitron` y `Rajdhani` desde Google Fonts
   - Usar las mismas variables CSS del proyecto:
     ```css
     --cyan: #00d4ff
     --blue: #0057ff
     --dark: #020b18
     --panel: rgba(4, 20, 40, 0.85)
     --border: rgba(0, 212, 255, 0.25)
     ```
   - Fondo oscuro con cuadrícula animada (igual que login.css)
   - Esquinas decorativas cian
   - Barra de estado superior

5. **El JS** debe:
   - Verificar al inicio que existe sesión: `sessionStorage.getItem("contador")`
   - Si no hay sesión, redirigir a `login.html`
   - Mostrar el nombre del contador en la interfaz

6. **Mostrar al usuario** los archivos creados y una descripción de su estructura.

## Estilo visual de referencia

- Fondo: `#020b18` con grid de líneas cian al 4% de opacidad
- Textos principales: fuente `Orbitron`, color `#00d4ff`
- Textos secundarios: fuente `Rajdhani`, color `#e0f4ff`
- Paneles: `rgba(4, 20, 40, 0.85)` con borde `rgba(0, 212, 255, 0.25)`
- Efectos: `backdrop-filter: blur(20px)`, sombras oscuras
- Animación de línea de escaneo en la parte superior de cada panel
