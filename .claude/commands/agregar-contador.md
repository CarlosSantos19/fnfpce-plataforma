# Agregar Contador al Login

Agrega uno o varios nombres nuevos al `<select>` de contadores en `login.html`, manteniéndolos en orden alfabético.

## Instrucciones

El usuario invocará este skill con: `/agregar-contador <Nombre>` o `/agregar-contador <Nombre1>, <Nombre2>, ...`

Por ejemplo: `/agregar-contador Pedro` o `/agregar-contador Pedro, Laura, Felipe`

### Pasos a seguir:

1. **Leer el archivo** `c:/Users/carlos.santos/Desktop/APLICATIVO/login.html`

2. **Identificar los nombres** a agregar del argumento del usuario. Si no se provee argumento, preguntar al usuario qué nombre(s) desea agregar.

3. **Para cada nombre nuevo**:
   - Usar solo el primer nombre (capitalizar correctamente)
   - Verificar que no exista ya en el `<select>`
   - Insertar la nueva `<option>` en el lugar correcto manteniendo orden alfabético

4. **Editar login.html** agregando la(s) nueva(s) opciones en el bloque del `<select id="usuario">`.

5. **Confirmar al usuario** qué nombres fueron agregados y cuáles ya existían (si aplica).

## Regla importante

Solo agregar el primer nombre. Si el usuario escribe "Carlos Andrés Pérez", registrar únicamente "Carlos".
