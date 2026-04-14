from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from time import sleep
from config import crear_driver, esperar_descarga_completa, esperar_archivo_especifico, mover_sin_duplicar, deduplicar_carpeta
import config
import os
import shutil
import glob
import time

def limpiar_nombre_candidato(nombre):
    """Limpia el nombre del candidato para usarlo como nombre de carpeta"""
    if not nombre:
        return "SIN_NOMBRE"

    # Reemplazar caracteres inválidos para nombres de carpeta
    nombre_limpio = str(nombre).strip()
    caracteres_invalidos = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']
    for char in caracteres_invalidos:
        nombre_limpio = nombre_limpio.replace(char, '_')
    return nombre_limpio

def hacer_login(driver, usuario, password):
    """
    Realiza el login en el sistema CNE.

    Parámetros:
    - driver: Instancia del WebDriver
    - usuario: Usuario de acceso
    - password: Contraseña
    """
    print("Iniciando sesión en el sistema CNE...")

    # Navegar a la página de login
    login_url = config.CNE_LOGIN_URL
    driver.get(login_url)

    # Esperar hasta 25s a que aparezca el formulario de login
    # Si el token de seguridad persiste, retornar False para que el loop
    # externo cree un driver nuevo y reintente despues de 15 segundos
    try:
        WebDriverWait(driver, 25).until(
            EC.presence_of_element_located((By.XPATH, "//input[@type='password']"))
        )
        token_errors = driver.find_elements(By.XPATH,
            "//*[contains(text(), 'Token de seguridad') or contains(text(), 'token de seguridad')]")
        if token_errors:
            print("Token de seguridad detectado. Reintentando con driver nuevo en 15s...")
            return False
        print("Formulario de login listo")
    except Exception:
        token_errors = driver.find_elements(By.XPATH,
            "//*[contains(text(), 'Token de seguridad') or contains(text(), 'token de seguridad')]")
        if token_errors:
            print("Token de seguridad detectado. Reintentando con driver nuevo en 15s...")
        else:
            print("Formulario de login no encontrado en 25 segundos")
        return False

    wait = WebDriverWait(driver, 30)

    try:
        # Buscar campos de usuario y contraseña
        # Intentar varios selectores comunes
        usuario_input = None
        password_input = None

        # Intentar por name
        try:
            usuario_input = driver.find_element(By.NAME, "username")
        except:
            pass

        if not usuario_input:
            try:
                usuario_input = driver.find_element(By.NAME, "email")
            except:
                pass

        if not usuario_input:
            try:
                usuario_input = driver.find_element(By.ID, "username")
            except:
                pass

        if not usuario_input:
            try:
                usuario_input = driver.find_element(By.XPATH, "//input[@type='text' or @type='email']")
            except:
                pass

        # Buscar campo de contraseña
        try:
            password_input = driver.find_element(By.NAME, "password")
        except:
            pass

        if not password_input:
            try:
                password_input = driver.find_element(By.XPATH, "//input[@type='password']")
            except:
                pass

        if not usuario_input or not password_input:
            print("No se encontraron los campos de login")
            driver.save_screenshot("error_login_campos.png")
            return False

        # Llenar los campos
        usuario_input.clear()
        usuario_input.send_keys(usuario)
        sleep(0.3)

        password_input.clear()
        password_input.send_keys(password)
        sleep(0.3)

        # Buscar botón de login
        login_btn = None
        try:
            login_btn = driver.find_element(By.XPATH, "//button[@type='submit']")
        except:
            pass

        if not login_btn:
            try:
                login_btn = driver.find_element(By.XPATH, "//input[@type='submit']")
            except:
                pass

        if not login_btn:
            try:
                login_btn = driver.find_element(By.XPATH, "//button[contains(text(), 'Ingresar') or contains(text(), 'Login') or contains(text(), 'Entrar')]")
            except:
                pass

        if not login_btn:
            print("No se encontró el botón de login")
            driver.save_screenshot("error_login_boton.png")
            return False

        # Hacer clic en login
        login_btn.click()
        sleep(2)

        # Verificar que el login fue exitoso
        # Buscar elementos que indiquen login exitoso
        try:
            # Buscar botón "Cerrar Sesión" o "FNFP" o cambio en la URL
            if (driver.find_elements(By.XPATH, "//button[contains(text(), 'Cerrar Sesión') or contains(text(), 'Cerrar')]") or
                "FNFP" in driver.page_source or
                "main" in driver.current_url or
                "usuarios/public" not in driver.current_url):
                print("Login exitoso")
                return True
            else:
                print("Error en login - verificar credenciales")
                driver.save_screenshot("error_login_credenciales.png")
                return False
        except:
            # Si hay algún error, asumir que el login fue exitoso si cambió la URL
            if "usuarios/public" not in driver.current_url or "login" not in driver.current_url.lower():
                print("Login exitoso (verificación alternativa)")
                return True
            else:
                print("Error en login")
                driver.save_screenshot("error_login_credenciales.png")
                return False

    except Exception as e:
        print(f"Error durante el login: {e}")
        driver.save_screenshot("error_login_general.png")
        return False


def descargar_gastos_candidato(
    usuario_cne,
    password_cne,
    proceso_electoral="ELECCIONES TERRITORIALES 2023",
    corporacion="Alc",
    circunscripcion="Municipal",
    departamento="Tolima",
    municipio="Mariquita",
    tipo_organizacion="Or",
    organizacion="PARTIDO LIBERAL COLOMBIANO",
    candidato="",
    carpeta_destino=None
):
    """
    Descarga el PDF de gastos de un candidato desde el FNFP.

    Parámetros:
    - usuario_cne: Usuario de acceso al sistema CNE (REQUERIDO)
    - password_cne: Contraseña de acceso (REQUERIDO)
    - proceso_electoral: Nombre del proceso electoral
    - corporacion: Tipo de corporación (ej: "Alc", "Con", "Asa", "Gob")
    - circunscripcion: Circunscripción (ej: "Municipal", "Departamental")
    - departamento: Nombre del departamento
    - municipio: Nombre del municipio
    - tipo_organizacion: "Or" (Organización Política), "Co" (Coalición), "Gr" (Grupo Significativo)
    - organizacion: Nombre del partido/organización
    - candidato: Nombre completo del candidato (puede estar vacío)
    - carpeta_destino: Carpeta personalizada para guardar los PDFs
    """

    driver = crear_driver(carpeta_destino)

    try:
        # PASO 1: Hacer login
        if not hacer_login(driver, usuario_cne, password_cne):
            print("No se pudo iniciar sesión. Abortando...")
            return

        wait = WebDriverWait(driver, 20)

        # PASO 2: Hacer clic en el botón/card FNFP (después del login)
        print("Esperando botón FNFP...")
        sleep(1.5)

        try:
            # Buscar la card FNFP - puede ser la imagen, el texto o el contenedor
            fnfp_button = None

            # Intento 1: Buscar por el texto "FNFP" en cualquier elemento
            try:
                fnfp_button = driver.find_element(By.XPATH, "//*[text()='FNFP']/..")
            except:
                pass

            # Intento 2: Buscar la imagen con src que contenga el ícono de FNFP
            if not fnfp_button:
                try:
                    fnfp_button = driver.find_element(By.XPATH, "//img[contains(@src, '1617726291')]/..")
                except:
                    pass

            # Intento 3: Buscar cualquier card que contenga "FNFP"
            if not fnfp_button:
                try:
                    fnfp_button = driver.find_element(By.XPATH, "//div[contains(@class, 'card')]//div[contains(text(), 'FNFP')]/../..")
                except:
                    pass

            # Intento 4: Buscar por clase card-img-top
            if not fnfp_button:
                try:
                    fnfp_button = driver.find_element(By.XPATH, "//img[contains(@class, 'card-img-top')]/..")
                except:
                    pass

            if fnfp_button:
                print("Botón FNFP encontrado, haciendo clic...")
                fnfp_button.click()
                sleep(1.5)
                print("Módulo FNFP abierto")
            else:
                print("No se pudo encontrar el botón FNFP")
                driver.save_screenshot("error_boton_fnfp_no_encontrado.png")
                raise Exception("Botón FNFP no encontrado")

        except Exception as e:
            print(f"Error buscando botón FNFP: {e}")
            driver.save_screenshot("error_boton_fnfp.png")
            raise

        # PASO 4: Hacer clic en "Registro De Ingresos Y Gastos"
        print("Buscando menú 'Registro De Ingresos Y Gastos'...")
        try:
            registro_menu = wait.until(EC.element_to_be_clickable(
                (By.XPATH, "//a[contains(., 'Registro De Ingresos') or contains(., 'Registro de Ingresos')]")
            ))
            registro_menu.click()
            sleep(0.5)
            print("Menú 'Registro De Ingresos Y Gastos' expandido")
        except Exception as e:
            print(f"Error buscando menú Registro: {e}")

        # PASO 5: Hacer clic en "Gestionar Ingresos De Campaña"
        print("Buscando opción 'Gestionar Ingresos De Campaña'...")
        gestionar_ingresos = wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//a[contains(., 'Gestionar Ingresos De Campaña') or contains(., 'Gestionar Gastos de Campaña')]")
        ))
        gestionar_ingresos.click()
        sleep(1.5)
        print("Página 'Gestionar Ingresos De Campaña' cargada")

        print(f"Procesando: {candidato} - {organizacion}")

        # IMPORTANTE: Los selectores son Vue Select (vs__), NO <select> tradicionales
        # Necesitamos interactuar escribiendo en los campos vs__search

        print("Esperando que carguen los componentes Vue Select...")
        sleep(0.5)

        def seleccionar_vue_select(placeholder_texto, valor, esperar=0.5):
            """Helper para seleccionar en componentes Vue Select"""
            try:
                print(f"\n{'='*60}")
                print(f"Buscando campo: {placeholder_texto}")
                print(f"Valor a seleccionar: '{valor}'")
                # Buscar el input por placeholder
                input_field = driver.find_element(By.XPATH, f"//input[contains(@placeholder, '{placeholder_texto}')]")
                input_field.click()
                sleep(0.2)
                input_field.clear()
                input_field.send_keys(valor)
                sleep(0.5)

                # MOSTRAR todas las opciones disponibles
                try:
                    opciones_disponibles = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                    print(f"\nOpciones disponibles en el dropdown ({len(opciones_disponibles)}):")
                    for idx, opt in enumerate(opciones_disponibles[:10], 1):  # Mostrar máximo 10
                        texto = opt.text.strip()
                        print(f"  {idx}. '{texto}'")
                    if len(opciones_disponibles) > 10:
                        print(f"  ... y {len(opciones_disponibles) - 10} opciones más")
                except Exception as e:
                    print(f"No se pudieron listar las opciones: {e}")

                # Hacer clic en la opción del dropdown
                # Estrategia: Buscar la opción que sea EXACTAMENTE el valor buscado
                # Usar normalize-space() para eliminar espacios extras
                try:
                    # Primero intentar coincidencia EXACTA con normalize-space
                    print(f"\nIntentando selección EXACTA: '{valor}'")
                    opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                    opcion_correcta = None

                    for opt in opciones:
                        texto_opcion = opt.text.strip()
                        if texto_opcion == valor:
                            opcion_correcta = opt
                            print(f"¡Coincidencia exacta encontrada!: '{texto_opcion}'")
                            break

                    if opcion_correcta:
                        opcion_correcta.click()
                        print(f"[OK] Seleccionado (exacto): {valor}")
                        sleep(esperar)
                        return True
                    else:
                        # IMPORTANTE: SOLO coincidencia exacta, no usar contains
                        print(f"[ERROR] No se encontró coincidencia EXACTA para: '{valor}'")
                        print(f"Opciones disponibles:")
                        for opt in opciones:
                            print(f"  - '{opt.text.strip()}'")
                        raise Exception(f"No se encontró la opción exacta: '{valor}'")
                except Exception as e:
                    print(f"Error en selección: {e}")
                    # Como último recurso, presionar Enter
                    print("Usando ENTER como último recurso (después de error)")
                    from selenium.webdriver.common.keys import Keys
                    input_field.send_keys(Keys.ENTER)
                    print(f"[OK] Seleccionado (Enter): {valor}")
                    sleep(esperar)
                    return True
            except Exception as e:
                print(f"[ERROR] Error seleccionando {placeholder_texto}: {e}")
                return False

        # 1. Seleccionar Proceso Electoral
        print("\n1. Seleccionando Proceso Electoral...")
        seleccionar_vue_select("Seleccione Proceso Electoral", proceso_electoral, 0.5)

        # 2. Seleccionar Corporación
        print("\n" + "="*60)
        print("2. Seleccionando Corporación...")
        print(f"Valor a seleccionar: '{corporacion}'")
        # Buscar el segundo input con placeholder "Seleccione..."
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            print(f"Inputs 'Seleccione...' encontrados: {len(inputs)}")
            if len(inputs) > 0:
                inputs[0].click()
                sleep(0.2)
                inputs[0].clear()
                inputs[0].send_keys(corporacion)
                sleep(0.5)

                # MOSTRAR opciones disponibles
                try:
                    opciones_disponibles = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                    print(f"\nOpciones disponibles en el dropdown ({len(opciones_disponibles)}):")
                    for idx, opt in enumerate(opciones_disponibles[:10], 1):
                        texto = opt.text.strip()
                        print(f"  {idx}. '{texto}'")
                    if len(opciones_disponibles) > 10:
                        print(f"  ... y {len(opciones_disponibles) - 10} opciones más")
                except Exception as e:
                    print(f"No se pudieron listar las opciones: {e}")

                # Intentar selección exacta primero
                try:
                    print(f"\nIntentando selección EXACTA: '{corporacion}'")
                    opcion = wait.until(EC.element_to_be_clickable(
                        (By.XPATH, f"//li[text()='{corporacion}' or normalize-space(.)='{corporacion}']")
                    ))
                    print(f"Texto de la opción encontrada: '{opcion.text}'")
                    opcion.click()
                    print(f"[OK] Corporación seleccionada (exacto)")
                except:
                    # Si falla, intentar con contains
                    try:
                        print(f"Intentando selección con CONTAINS: '{corporacion}'")
                        opcion = wait.until(EC.element_to_be_clickable(
                            (By.XPATH, f"//li[contains(text(), '{corporacion}')]")
                        ))
                        print(f"Texto de la opción encontrada: '{opcion.text}'")
                        opcion.click()
                        print(f"[OK] Corporación seleccionada (contains)")
                    except:
                        print("Usando ENTER como último recurso")
                        from selenium.webdriver.common.keys import Keys
                        inputs[0].send_keys(Keys.ENTER)
                        print(f"[OK] Corporación seleccionada (Enter)")
                sleep(0.5)
        except Exception as e:
            print(f"[ERROR] Error seleccionando corporación: {e}")

        # 3. Seleccionar Circunscripción
        print(f"\n3. Seleccionando Circunscripción: {circunscripcion}...")
        print("Refrescando lista de inputs después de seleccionar Corporación...")
        sleep(0.5)  # Esperar a que se carguen nuevos campos
        try:
            # Buscar NUEVAMENTE los inputs después de seleccionar corporación
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            print(f"Inputs 'Seleccione...' encontrados: {len(inputs)}")

            # Verificar si ya está seleccionado
            try:
                selected_circunscripcion = driver.find_element(By.XPATH, "//div[@id='vs3__combobox']//span[@class='vs__selected']")
                if circunscripcion in selected_circunscripcion.text:
                    print(f"[OK] Circunscripción ya está seleccionada: {circunscripcion}")
                    sleep(0.5)
                else:
                    # Si no está seleccionado, seleccionar
                    if len(inputs) > 0:
                        # Buscar el input que pertenece a Circunscripción
                        circunscripcion_input = driver.find_element(By.XPATH, "//div[@id='vs3__combobox']//input[@class='vs__search']")
                        circunscripcion_input.click()
                        sleep(0.3)
                        circunscripcion_input.clear()
                        circunscripcion_input.send_keys(circunscripcion)
                        sleep(0.5)
                        try:
                            opcion = wait.until(EC.element_to_be_clickable(
                                (By.XPATH, f"//li[contains(text(), '{circunscripcion}')]")
                            ))
                            opcion.click()
                        except:
                            from selenium.webdriver.common.keys import Keys
                            circunscripcion_input.send_keys(Keys.ENTER)
                        print(f"[OK] Circunscripción seleccionada: {circunscripcion}")
                        sleep(0.5)
            except:
                # Si no hay selección previa, buscar por índice
                if len(inputs) >= 1:
                    # El primer input disponible ahora debería ser Circunscripción
                    inputs[0].click()
                    sleep(0.3)
                    inputs[0].clear()
                    inputs[0].send_keys(circunscripcion)
                    sleep(0.5)
                    try:
                        opcion = wait.until(EC.element_to_be_clickable(
                            (By.XPATH, f"//li[contains(text(), '{circunscripcion}')]")
                        ))
                        opcion.click()
                    except:
                        from selenium.webdriver.common.keys import Keys
                        inputs[0].send_keys(Keys.ENTER)
                    print(f"[OK] Circunscripción seleccionada: {circunscripcion}")
                    sleep(0.5)
        except Exception as e:
            print(f"[ERROR] Error seleccionando circunscripción: {e}")

        # 4. Seleccionar Departamento
        print("\n4. Seleccionando Departamento...")
        sleep(0.5)  # Esperar a que se carguen nuevos campos
        try:
            # Buscar inputs DESPUÉS de seleccionar circunscripción
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            print(f"Inputs 'Seleccione...' encontrados: {len(inputs)}")
            if len(inputs) > 0:
                dep_input = inputs[0]
                dep_input.click(); sleep(0.8)
                dep_lb_id = dep_input.get_attribute("aria-controls") or ""
                dep_opts = (driver.find_elements(By.XPATH, f"//ul[@id='{dep_lb_id}']//li")
                            if dep_lb_id else
                            driver.find_elements(By.XPATH, "//ul[@role='listbox']//li"))
                dep_target = None
                for opt in dep_opts:
                    if opt.text.strip().upper() == departamento.strip().upper():
                        dep_target = opt; break
                if dep_target is not None:
                    driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", dep_target)
                    sleep(0.2)
                    try: dep_target.click()
                    except: driver.execute_script("arguments[0].click();", dep_target)
                else:
                    from selenium.webdriver.common.keys import Keys
                    dep_input.send_keys(Keys.ESCAPE)
                    print(f"[AVISO] Departamento '{departamento}' no encontrado")
                print(f"[OK] Departamento seleccionado: {departamento}")
                sleep(0.5)
        except Exception as e:
            print(f"[ERROR] Error seleccionando departamento: {e}")

        # 5. Seleccionar Municipio
        print("\n5. Seleccionando Municipio...")
        sleep(0.5)  # Esperar a que se carguen nuevos campos
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            print(f"Inputs 'Seleccione...' encontrados: {len(inputs)}")
            if len(inputs) > 0:
                inputs[0].click()
                sleep(0.3)
                inputs[0].clear()
                inputs[0].send_keys(municipio)
                sleep(0.5)
                try:
                    # Coincidencia EXACTA para municipio
                    opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                    opcion_encontrada = None
                    for opt in opciones:
                        if opt.text.strip().upper() == municipio.strip().upper():
                            opcion_encontrada = opt
                            break
                    if opcion_encontrada:
                        opcion_encontrada.click()
                    else:
                        from selenium.webdriver.common.keys import Keys
                        inputs[0].send_keys(Keys.ENTER)
                except:
                    from selenium.webdriver.common.keys import Keys
                    inputs[0].send_keys(Keys.ENTER)
                print(f"[OK] Municipio seleccionado: {municipio}")
                sleep(0.5)
        except Exception as e:
            print(f"[ERROR] Error seleccionando municipio: {e}")

        # 6. Seleccionar Tipo de Organización
        print("\n6. Seleccionando Tipo de Organización...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            # Buscar el input que esté en un combobox que diga "Tipo de Organizacion"
            tipo_org_input = None
            for inp in inputs:
                parent_text = inp.find_element(By.XPATH, "../../../..").text
                if "Tipo" in parent_text or "Organizaci" in parent_text:
                    tipo_org_input = inp
                    break

            if tipo_org_input:
                tipo_org_input.click()
                sleep(0.3)
                tipo_org_input.clear()
                tipo_org_input.send_keys(tipo_organizacion)
                sleep(0.5)
                try:
                    opcion = wait.until(EC.element_to_be_clickable(
                        (By.XPATH, f"//li[contains(text(), '{tipo_organizacion}')]")
                    ))
                    opcion.click()
                except:
                    from selenium.webdriver.common.keys import Keys
                    tipo_org_input.send_keys(Keys.ENTER)
                print(f"[OK] Tipo de Organización seleccionado: {tipo_organizacion}")
                sleep(0.5)
        except Exception as e:
            print(f"[ERROR] Error seleccionando tipo de organización: {e}")

        # 7. Seleccionar Organización
        print("\n7. Seleccionando Organización...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            org_input = None
            for inp in inputs:
                parent_text = inp.find_element(By.XPATH, "../../../..").text
                if "Seleccione la Organizacion" in parent_text:
                    org_input = inp
                    break

            if org_input:
                org_upper = organizacion.upper()

                # ESTRATEGIA: Abrir dropdown y hacer CLIC DIRECTO en el elemento <li>
                # Esto evita depender del cursor (typeAheadPointer) de Vue Select
                org_input.click()
                sleep(0.8)

                org_listbox_id = org_input.get_attribute("aria-controls") or ""
                if org_listbox_id:
                    opciones = driver.find_elements(By.XPATH, f"//ul[@id='{org_listbox_id}']//li")
                else:
                    opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                print(f"[INFO] Opciones en dropdown: {len(opciones)}")

                target_opt = None
                for opt in opciones:
                    if "Sorry" in opt.text:
                        continue
                    opt_upper = opt.text.strip().upper()
                    if opt_upper == org_upper or org_upper in opt_upper or opt_upper in org_upper:
                        target_opt = opt
                        print(f"[OK] Encontrado '{opt.text.strip()}'")
                        break

                if target_opt is not None:
                    driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", target_opt)
                    sleep(0.3)
                    try:
                        target_opt.click()
                    except:
                        driver.execute_script("arguments[0].click();", target_opt)
                    sleep(1.0)
                    print(f"[OK] Organización seleccionada: {organizacion}")
                else:
                    print(f"[AVISO] No encontrado '{organizacion}'.")
                    from selenium.webdriver.common.keys import Keys
                    org_input.send_keys(Keys.ESCAPE)
                sleep(0.5)
        except Exception as e:
            print(f"[ERROR] Error seleccionando organización: {e}")

        # 8. Seleccionar Candidato (opcional)
        if candidato and candidato.strip():
            print(f"\n8. Seleccionando Candidato: {candidato}...")
            sleep(0.5)
            try:
                inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
                print(f"Total inputs vs__search encontrados: {len(inputs)}")
                cand_input = None

                # Estrategia 1: Buscar por texto "Candidato" en el padre
                for idx, inp in enumerate(inputs):
                    try:
                        parent_text = inp.find_element(By.XPATH, "../../../..").text
                        print(f"Input {idx}: texto del padre contiene: {parent_text[:50]}...")
                        if "Candidato" in parent_text:
                            cand_input = inp
                            print(f"[OK] Input de candidato encontrado en posicion {idx}")
                            break
                    except:
                        pass

                # Estrategia 2: Si no se encontro, usar el ULTIMO input (debe ser candidato)
                if not cand_input and len(inputs) > 0:
                    cand_input = inputs[-1]
                    print(f"[OK] Usando ultimo input (posicion {len(inputs)-1}) como candidato")

                if cand_input:
                    cand_input.click()
                    sleep(0.3)
                    cand_input.clear()
                    print(f"Escribiendo candidato: '{candidato}'")
                    cand_input.send_keys(candidato)
                    sleep(0.5)

                    # Mostrar opciones disponibles
                    try:
                        opciones_disponibles = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                        print(f"\nOpciones de candidato disponibles ({len(opciones_disponibles)}):")
                        for idx, opt in enumerate(opciones_disponibles[:5], 1):
                            print(f"  {idx}. '{opt.text.strip()}'")
                    except:
                        print("No se pudieron listar opciones de candidato")

                    try:
                        opcion = wait.until(EC.element_to_be_clickable(
                            (By.XPATH, f"//li[contains(text(), '{candidato}')]")
                        ))
                        opcion.click()
                        print(f"[OK] Candidato seleccionado haciendo clic en opcion")
                    except Exception as e:
                        print(f"No se pudo hacer clic en opcion, usando ENTER: {e}")
                        from selenium.webdriver.common.keys import Keys
                        cand_input.send_keys(Keys.ENTER)
                        print(f"[OK] Candidato seleccionado con ENTER")
                    sleep(0.5)
                else:
                    print("[ERROR] No se encontro el input de candidato")
            except Exception as e:
                print(f"[ERROR] Error seleccionando candidato: {e}")
        else:
            print("\n8. [SKIP] No se especificó candidato, buscando todos los candidatos de la organización")

        print(f"\n[OK] Todos los filtros configurados para: {organizacion}")

        # 8. Hacer clic en el botón de búsqueda (puede no existir, depende de la interfaz)
        try:
            print("Buscando botón 'Buscar'...")
            buscar_btn = driver.find_element(By.XPATH, "//button[contains(., 'Buscar')]")
            buscar_btn.click()
            sleep(1.5)
            print("Búsqueda ejecutada")
        except:
            print("No se encontró botón 'Buscar', la tabla puede cargarse automáticamente")
            sleep(1.5)

        # 9. Buscar y descargar todos los PDFs de soporte
        print("Esperando que cargue la tabla de resultados...")
        sleep(1)

        # Hacer scroll hacia abajo para ver la tabla
        try:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            sleep(1)
            print("Scroll realizado para visualizar tabla")
        except:
            pass

        # Buscar los iconos/botones de PDF en la columna "Soporte"
        print("Buscando documentos PDF en la columna Soporte...")

        # Intentar múltiples selectores
        pdf_buttons = []

        # Selector 1: Botón con icono fa-file-pdf-o (el correcto según el HTML proporcionado)
        try:
            pdf_buttons = driver.find_elements(By.XPATH, "//button[.//i[contains(@class, 'fa-file-pdf-o')]]")
            if len(pdf_buttons) > 0:
                print(f"[OK] Encontrados {len(pdf_buttons)} botones con fa-file-pdf-o")
        except:
            pass

        # Selector 2: Botón con clase btn y texto danger que contenga icono PDF
        if not pdf_buttons:
            try:
                pdf_buttons = driver.find_elements(By.XPATH, "//button[contains(@class, 'btn') and contains(@class, 'text-danger')]//i[contains(@class, 'fa-file-pdf')]/..")
            except:
                pass

        # Selector 3: Cualquier botón o enlace con icono fa-file-pdf
        if not pdf_buttons:
            try:
                pdf_buttons = driver.find_elements(By.XPATH, "//button[.//i[contains(@class, 'fa-file-pdf')]] | //a[.//i[contains(@class, 'fa-file-pdf')]]")
            except:
                pass

        print(f"Encontrados {len(pdf_buttons)} documentos PDF en la página actual")

        # Procesar todas las páginas
        pagina_actual = 1
        total_descargados = 0

        while True:
            print(f"\n{'='*60}")
            print(f"Procesando página {pagina_actual}...")
            print(f"{'='*60}")

            # Re-encontrar botones en la página actual
            pdf_buttons = driver.find_elements(By.XPATH, "//button[.//i[contains(@class, 'fa-file-pdf-o')]]")
            print(f"Encontrados {len(pdf_buttons)} documentos PDF en página {pagina_actual}")

            if len(pdf_buttons) > 0:
                # Descargar cada PDF de la página actual
                for idx in range(len(pdf_buttons)):
                    try:
                        # Re-encontrar los elementos para evitar StaleElementReferenceException
                        pdf_buttons_refresh = driver.find_elements(By.XPATH, "//button[.//i[contains(@class, 'fa-file-pdf-o')]]")

                        if idx < len(pdf_buttons_refresh):
                            total_descargados += 1
                            print(f"Descargando documento {idx + 1}/{len(pdf_buttons)} (Total: {total_descargados})...")
                            # Hacer scroll al botón para asegurar que sea visible
                            driver.execute_script("arguments[0].scrollIntoView(true);", pdf_buttons_refresh[idx])
                            sleep(0.3)

                            # Intentar clic normal primero, si falla usar JavaScript
                            try:
                                pdf_buttons_refresh[idx].click()
                            except Exception as click_error:
                                print(f"Clic normal fallo, usando JavaScript click...")
                                driver.execute_script("arguments[0].click();", pdf_buttons_refresh[idx])

                            sleep(0.6)
                            print(f"[OK] Documento {idx + 1} descargado")
                    except Exception as e:
                        print(f"[ERROR] Error descargando documento {idx + 1}: {e}")
                        continue
            else:
                print("No se encontraron documentos PDF para descargar en esta página")

            # Intentar ir a la siguiente página
            try:
                print(f"\nBuscando siguiente página...")
                sleep(1)

                # Buscar el botón de siguiente página (puede ser un número o flecha)
                # Intentar encontrar el botón con el número de la siguiente página
                siguiente_pagina = pagina_actual + 1

                # Estrategia 1: Buscar botón con el número de la siguiente página
                # Formato exacto del botón: <a href="#" class="page-link">2</a>
                boton_siguiente = None
                try:
                    boton_siguiente = driver.find_element(By.XPATH, f"//a[@class='page-link' and text()='{siguiente_pagina}']")
                    print(f"Encontrado botón de página {siguiente_pagina}")
                except:
                    pass

                # Estrategia 2: Buscar botón "Siguiente" o con flecha
                if not boton_siguiente:
                    try:
                        boton_siguiente = driver.find_element(By.XPATH, "//a[contains(@class, 'page-link') and (contains(., 'Siguiente') or contains(., '›') or contains(., '>'))]")
                        print(f"Encontrado botón 'Siguiente'")
                    except:
                        pass

                # Estrategia 3: Buscar cualquier botón de paginación que no sea "Ant" o "Anterior"
                if not boton_siguiente:
                    try:
                        # Buscar todos los botones de paginación
                        botones_paginacion = driver.find_elements(By.XPATH, "//a[contains(@class, 'page-link')]")
                        for boton in botones_paginacion:
                            texto = boton.text.strip()
                            if texto.isdigit() and int(texto) == siguiente_pagina:
                                boton_siguiente = boton
                                print(f"Encontrado botón de página {siguiente_pagina} (búsqueda alternativa)")
                                break
                    except:
                        pass

                if boton_siguiente:
                    print(f"Haciendo clic en página {siguiente_pagina}...")
                    driver.execute_script("arguments[0].scrollIntoView(true);", boton_siguiente)
                    sleep(0.5)
                    boton_siguiente.click()
                    sleep(2)  # Esperar a que cargue la nueva página
                    print(f"[OK] Navegado a página {siguiente_pagina}")
                    pagina_actual += 1

                    # Scroll hacia arriba para ver la tabla desde el inicio
                    driver.execute_script("window.scrollTo(0, 0);")
                    sleep(0.5)
                    driver.execute_script("window.scrollTo(0, document.body.scrollHeight/2);")
                    sleep(1)
                else:
                    print(f"No se encontró botón de siguiente página. Proceso completado.")
                    break

            except Exception as e:
                print(f"No hay más páginas o error navegando: {e}")
                break

        print(f"\n{'='*60}")
        print(f"Resumen: Total de {total_descargados} documentos PDF descargados de {pagina_actual} página(s)")
        print(f"{'='*60}")

        print(f"Proceso completado para {candidato}")

    except Exception as e:
        print(f"Error procesando {candidato}: {e}")
        # Tomar screenshot para debugging
        try:
            driver.save_screenshot(f"error_{candidato.replace(' ', '_')}.png")
            print(f"Screenshot guardado: error_{candidato.replace(' ', '_')}.png")
        except:
            pass

    finally:
        sleep(2)
        driver.quit()


def descargar_organizacion_completa(
    usuario_cne,
    password_cne,
    proceso_electoral="ELECCIONES TERRITORIALES 2023",
    corporacion="Alc",
    circunscripcion="Municipal",
    departamento="Tolima",
    municipio="Mariquita",
    tipo_organizacion="Or",
    organizacion="PARTIDO LIBERAL COLOMBIANO",
    carpeta_base=None
):
    """
    Descarga ingresos de TODOS los candidatos de una organización iterando por el dropdown.

    Esta función:
    1. Configura todos los filtros (corporación, departamento, municipio, organización)
    2. Abre el dropdown de candidatos
    3. Obtiene la lista de TODOS los candidatos disponibles
    4. Para CADA candidato:
       - Selecciona el candidato del dropdown (sin usar Clear para mantener filtros)
       - Descarga todos los PDFs de ese candidato
       - Repite con el siguiente candidato

    Parámetros:
    - carpeta_base: Carpeta base de la organización (ej: ALCALDIA_Boyacá_Turmequé_PARTIDO)
                    Se creará la estructura: carpeta_base/Ingresos/nombre_candidato/
    """
    import os

    # IMPORTANTE: Crear driver temporal solo para login y configuración inicial
    # Luego crearemos un driver específico para cada candidato con su carpeta de descarga
    driver = crear_driver(carpeta_base)

    try:
        # Retry: si la aplicacion falla al navegar, esperar 15s y reintentar login
        wait = None
        for _nav_intento in range(3):
            if _nav_intento > 0:
                print(f"Reintentando login en 15 segundos (intento {_nav_intento+1}/3)...")
                sleep(15)
                try:
                    driver.quit()
                except Exception:
                    pass
                driver = crear_driver(carpeta_base)

            # PASO 1: Login
            if not hacer_login(driver, usuario_cne, password_cne):
                print(f"No se pudo iniciar sesión (intento {_nav_intento+1}/3). Reintentando...")
                continue

            wait = WebDriverWait(driver, 20)

            # PASO 2: Navegar a FNFP
            print("Navegando al módulo FNFP...")
            sleep(1.5)

            try:
                fnfp_button = driver.find_element(By.XPATH, "//*[text()='FNFP']/..")
                fnfp_button.click()
                sleep(1.5)
                print("Módulo FNFP abierto")
            except:
                print("Error accediendo a FNFP")
                if _nav_intento < 2:
                    continue
                return

            # PASO 3: Navegar a Gestionar Ingresos
            print("Navegando a Gestionar Ingresos De Campaña...")
            try:
                registro_menu = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//a[contains(., 'Registro De Ingresos')]")
                ))
                registro_menu.click()
                sleep(0.5)

                gestionar_ingresos = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//a[contains(., 'Gestionar Ingresos De Campaña')]")
                ))
                gestionar_ingresos.click()
                sleep(1.5)
                print("Página cargada")
                break  # Navegacion exitosa
            except Exception as e:
                print(f"Error navegando: {e}")
                if _nav_intento < 2:
                    continue
                return

        if wait is None:
            print("[ERROR] No se pudo completar la navegación después de 3 intentos.")
            return

        # PASO 4: Configurar TODOS los filtros (excepto candidato)
        print(f"\n{'='*80}")
        print(f"CONFIGURANDO FILTROS PARA: {organizacion}")
        print(f"{'='*80}\n")

        # Helper para seleccionar en Vue Select con exactitud
        def seleccionar_exacto(placeholder_texto, valor, esperar=0.5):
            from selenium.webdriver.common.keys import Keys as _Keys
            for _int in range(3):
                try:
                    input_field = driver.find_element(By.XPATH, f"//input[contains(@placeholder, '{placeholder_texto}')]")
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", input_field)
                    sleep(0.2)
                    input_field.click()
                    sleep(0.2)
                    input_field.clear()
                    input_field.send_keys(valor)

                    # Esperar hasta 3s a que aparezcan opciones reales
                    opciones = []
                    for _ in range(6):
                        sleep(0.5)
                        todas = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                        opciones = [o for o in todas if o.text.strip() and "Sorry, no matching" not in o.text]
                        if opciones:
                            break

                    if not opciones:
                        input_field.send_keys(_Keys.ENTER)
                        sleep(esperar)
                        print(f"[OK] Sin opciones visibles, ENTER: {valor}")
                        return True

                    # Buscar coincidencia exacta, luego parcial
                    opcion_correcta = None
                    for opt in opciones:
                        if opt.text.strip() == valor:
                            opcion_correcta = opt
                            break
                    if not opcion_correcta:
                        for opt in opciones:
                            if valor.upper() in opt.text.strip().upper():
                                opcion_correcta = opt
                                break

                    if opcion_correcta:
                        driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", opcion_correcta)
                        sleep(0.1)
                        try:
                            opcion_correcta.click()
                        except Exception:
                            driver.execute_script("arguments[0].click();", opcion_correcta)
                    else:
                        input_field.send_keys(_Keys.ENTER)

                    sleep(esperar)
                    print(f"[OK] Seleccionado: {valor}")
                    return True

                except Exception as e:
                    if _int < 2:
                        print(f"[RETRY {_int+1}] Error en '{placeholder_texto}': {e}")
                        sleep(1)
                    else:
                        print(f"[ERROR] No se pudo seleccionar '{placeholder_texto}': {e}")
                        return False
            return False

        # 1. Proceso Electoral
        print("1. Seleccionando Proceso Electoral...")
        seleccionar_exacto("Seleccione Proceso Electoral", proceso_electoral, 0.5)

        # 2. Corporación
        print("2. Seleccionando Corporación...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            if len(inputs) > 0:
                inputs[0].click()
                sleep(0.2)
                inputs[0].clear()
                inputs[0].send_keys(corporacion)
                sleep(0.5)
                from selenium.webdriver.common.keys import Keys
                inputs[0].send_keys(Keys.ENTER)
                sleep(0.5)
                print("[OK]")
        except Exception as e:
            print(f"[ERROR]: {e}")

        # 3. Circunscripción
        print(f"3. Seleccionando Circunscripción: {circunscripcion}...")
        sleep(0.5)
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            if len(inputs) >= 1:
                inputs[0].click()
                sleep(0.3)
                inputs[0].clear()
                inputs[0].send_keys(circunscripcion)
                sleep(0.5)
                from selenium.webdriver.common.keys import Keys
                inputs[0].send_keys(Keys.ENTER)
                sleep(0.5)
                print("[OK]")
        except Exception as e:
            print(f"[ERROR]: {e}")

        # 4. Departamento
        print("4. Seleccionando Departamento...")
        sleep(0.5)
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            if len(inputs) > 0:
                dep_input = inputs[0]
                dep_input.click(); sleep(0.8)
                dep_lb_id = dep_input.get_attribute("aria-controls") or ""
                dep_opts = (driver.find_elements(By.XPATH, f"//ul[@id='{dep_lb_id}']//li")
                            if dep_lb_id else
                            driver.find_elements(By.XPATH, "//ul[@role='listbox']//li"))
                dep_target = None
                for opt in dep_opts:
                    if opt.text.strip().upper() == departamento.strip().upper():
                        dep_target = opt; break
                if dep_target is not None:
                    driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", dep_target)
                    sleep(0.2)
                    try: dep_target.click()
                    except: driver.execute_script("arguments[0].click();", dep_target)
                else:
                    from selenium.webdriver.common.keys import Keys
                    dep_input.send_keys(Keys.ESCAPE)
                    print(f"[AVISO] Departamento '{departamento}' no encontrado")
                print("[OK]")
                sleep(0.5)
        except Exception as e:
            print(f"[ERROR]: {e}")

        # 5. Municipio
        if municipio and municipio.strip():
            print("5. Seleccionando Municipio...")
            sleep(0.5)
            try:
                inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
                if len(inputs) > 0:
                    inputs[0].click()
                    sleep(0.3)
                    inputs[0].clear()
                    inputs[0].send_keys(municipio)
                    sleep(0.5)
                    from selenium.webdriver.common.keys import Keys
                    inputs[0].send_keys(Keys.ENTER)
                    sleep(0.5)
                    print("[OK]")
            except Exception as e:
                print(f"[ERROR]: {e}")

        # 6. Tipo de Organización
        print("6. Seleccionando Tipo de Organización...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            tipo_org_input = None
            for inp in inputs:
                parent_text = inp.find_element(By.XPATH, "../../../..").text
                if "Tipo" in parent_text or "Organizaci" in parent_text:
                    tipo_org_input = inp
                    break

            if tipo_org_input:
                tipo_org_input.click()
                sleep(0.3)
                tipo_org_input.clear()
                tipo_org_input.send_keys(tipo_organizacion)
                sleep(0.5)
                from selenium.webdriver.common.keys import Keys
                tipo_org_input.send_keys(Keys.ENTER)
                sleep(0.5)
                print("[OK]")
        except Exception as e:
            print(f"[ERROR]: {e}")

        # 7. Organización
        print("7. Seleccionando Organización...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            org_input = None
            for inp in inputs:
                parent_text = inp.find_element(By.XPATH, "../../../..").text
                if "Seleccione la Organizacion" in parent_text:
                    org_input = inp
                    break

            if org_input:
                org_upper = organizacion.upper()

                # ESTRATEGIA: Abrir dropdown y hacer CLIC DIRECTO en el elemento <li>
                # Esto evita depender del cursor (typeAheadPointer) de Vue Select
                org_input.click()
                sleep(0.8)

                org_listbox_id = org_input.get_attribute("aria-controls") or ""
                if org_listbox_id:
                    opciones = driver.find_elements(By.XPATH, f"//ul[@id='{org_listbox_id}']//li")
                else:
                    opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                print(f"[INFO] Opciones en dropdown: {len(opciones)}")

                target_opt = None
                for opt in opciones:
                    if "Sorry" in opt.text:
                        continue
                    opt_upper = opt.text.strip().upper()
                    if opt_upper == org_upper or org_upper in opt_upper or opt_upper in org_upper:
                        target_opt = opt
                        print(f"[OK] Encontrado '{opt.text.strip()}'")
                        break

                if target_opt is not None:
                    driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", target_opt)
                    sleep(0.3)
                    try:
                        target_opt.click()
                    except:
                        driver.execute_script("arguments[0].click();", target_opt)
                    sleep(1.0)
                    print("[OK]")
                else:
                    print(f"[AVISO] No encontrado '{organizacion}'.")
                    from selenium.webdriver.common.keys import Keys
                    org_input.send_keys(Keys.ESCAPE)
                sleep(0.5)
        except Exception as e:
            print(f"[ERROR]: {e}")

        # PASO 5: OBTENER LISTA DE TODOS LOS CANDIDATOS
        print(f"\n{'='*80}")
        print("OBTENIENDO LISTA DE CANDIDATOS DEL DROPDOWN")
        print(f"{'='*80}\n")

        sleep(0.5)

        candidatos_lista = []

        try:
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            cand_input = None

            # Buscar el input de candidato
            for idx, inp in enumerate(inputs):
                try:
                    parent_text = inp.find_element(By.XPATH, "../../../..").text
                    if "Candidato" in parent_text:
                        cand_input = inp
                        break
                except:
                    pass

            if not cand_input and len(inputs) > 0:
                cand_input = inputs[-1]

            if cand_input:
                # Hacer clic para abrir el dropdown
                cand_input.click()
                sleep(0.5)

                # Obtener TODAS las opciones del dropdown
                opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                print(f"{'='*80}")
                print(f"Candidatos disponibles en el dropdown:")
                print(f"{'='*80}")

                for idx, opt in enumerate(opciones, 1):
                    nombre_candidato = opt.text.strip()
                    if nombre_candidato and nombre_candidato != "Sorry, no matching options.":
                        candidatos_lista.append(nombre_candidato)
                        print(f"  {idx}. {nombre_candidato}")

                print(f"{'='*80}")
                print(f"Total: {len(candidatos_lista)} candidatos encontrados")
                print(f"{'='*80}\n")

                if not candidatos_lista:
                    print("[WARNING] No se encontraron candidatos para esta organización")
                    return
            else:
                print("[ERROR] No se encontró el input de candidato")
                return

        except Exception as e:
            print(f"[ERROR] Error obteniendo candidatos: {e}")
            import traceback
            traceback.print_exc()
            return

        # PASO 6: ITERAR POR CADA CANDIDATO Y DESCARGAR PDFs
        print(f"\n{'='*80}")
        print(f"INICIANDO DESCARGA PARA {len(candidatos_lista)} CANDIDATOS")
        print(f"{'='*80}\n")

        for cand_idx, nombre_candidato in enumerate(candidatos_lista, 1):
            print(f"\n{'#'*80}")
            print(f"CANDIDATO {cand_idx}/{len(candidatos_lista)}: {nombre_candidato}")
            print(f"{'#'*80}\n")

            try:
                # PASO 6.1: Seleccionar el candidato directamente (SIN hacer clic en Clear)
                # IMPORTANTE: No usamos el botón Clear porque borra todos los filtros anteriores
                print(f"Seleccionando candidato: {nombre_candidato}...")

                # Buscar el input de candidato
                inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
                cand_input = None

                for inp in inputs:
                    try:
                        parent_text = inp.find_element(By.XPATH, "../../../..").text
                        if "Candidato" in parent_text:
                            cand_input = inp
                            break
                    except:
                        pass

                if not cand_input and len(inputs) > 0:
                    cand_input = inputs[-1]

                if cand_input:
                    # IMPORTANTE: Múltiples estrategias para evitar "element click intercepted"

                    # Estrategia 1: Intentar cerrar el dropdown del perfil si está abierto
                    try:
                        profile_dropdown = driver.find_element(By.ID, "profileDropdown")
                        # Hacer clic fuera para cerrarlo (clic en el body)
                        driver.execute_script("document.body.click();")
                        sleep(0.3)
                    except:
                        pass

                    # Estrategia 2: Hacer scroll para asegurar que el elemento esté en el centro de la pantalla
                    try:
                        driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'});", cand_input)
                        sleep(0.5)
                    except:
                        pass

                    # Estrategia 3: Hacer scroll hacia arriba para alejar el elemento del área del header
                    try:
                        driver.execute_script("window.scrollBy(0, -200);")
                        sleep(0.3)
                    except:
                        pass

                    # Estrategia 4: Intentar click normal primero, si falla usar JavaScript
                    click_exitoso = False
                    try:
                        cand_input.click()
                        click_exitoso = True
                        print("[OK] Click normal exitoso en input de candidato")
                    except Exception as e:
                        print(f"[WARNING] Click normal falló: {e}")
                        print("[INFO] Intentando con JavaScript click...")
                        try:
                            driver.execute_script("arguments[0].click();", cand_input)
                            click_exitoso = True
                            print("[OK] JavaScript click exitoso en input de candidato")
                        except Exception as e2:
                            print(f"[ERROR] JavaScript click también falló: {e2}")

                    if not click_exitoso:
                        print(f"[ERROR] No se pudo hacer click en el input de candidato")
                        continue

                    sleep(0.5)

                    # ESTRATEGIA MEJORADA: NO escribir el nombre, sino abrir dropdown y hacer clic directo
                    # Esto evita problemas de filtrado de Vue.js que causan "Sorry, no matching options"
                    print(f"Abriendo dropdown de candidatos...")

                    # Abrir el dropdown sin escribir nada
                    # Solo hacer clic para que se despliegue la lista completa
                    try:
                        # El dropdown ya debería abrirse con el click anterior, pero esperamos un poco
                        sleep(0.5)

                        # Obtener todas las opciones disponibles del dropdown
                        opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                        print(f"Opciones en dropdown: {len(opciones)}")

                        # Buscar la opción que coincida EXACTAMENTE con el nombre del candidato
                        opcion_encontrada = False
                        for opt in opciones:
                            texto_opt = opt.text.strip()

                            # Ignorar mensajes de error
                            if "Sorry, no matching options" in texto_opt:
                                continue

                            # Buscar coincidencia exacta
                            if texto_opt == nombre_candidato:
                                print(f"[INFO] Coincidencia exacta encontrada: '{texto_opt}'")

                                # Hacer scroll a la opción para asegurar que sea visible
                                try:
                                    driver.execute_script("arguments[0].scrollIntoView({block: 'nearest', inline: 'nearest'});", opt)
                                    sleep(0.2)
                                except:
                                    pass

                                # Hacer clic en la opción
                                try:
                                    opt.click()
                                    print(f"[OK] Candidato seleccionado: {nombre_candidato}")
                                    opcion_encontrada = True
                                    break
                                except Exception as click_err:
                                    # Si el click normal falla, intentar con JavaScript
                                    print(f"[WARNING] Click normal falló, usando JavaScript: {click_err}")
                                    driver.execute_script("arguments[0].click();", opt)
                                    print(f"[OK] Candidato seleccionado con JavaScript: {nombre_candidato}")
                                    opcion_encontrada = True
                                    break

                        if not opcion_encontrada:
                            print(f"[ERROR] No se encontró el candidato '{nombre_candidato}' en las opciones del dropdown")
                            print(f"[INFO] Opciones disponibles fueron:")
                            for opt in opciones[:5]:  # Mostrar primeras 5 opciones
                                print(f"  - '{opt.text.strip()}'")
                            print(f"[SKIP] Saltando candidato: {nombre_candidato}")
                            continue

                    except Exception as e:
                        print(f"[ERROR] Error al seleccionar candidato del dropdown: {e}")
                        print(f"[SKIP] Saltando candidato: {nombre_candidato}")
                        import traceback
                        traceback.print_exc()
                        continue

                    # IMPORTANTE: Esperar a que se cargue la información del candidato
                    print("Esperando a que cargue el botón 'Buscar'...")
                    sleep(2)

                    # Hacer scroll hacia arriba para asegurar que el botón sea visible
                    driver.execute_script("window.scrollTo(0, 0);")
                    sleep(0.5)

                else:
                    print(f"[ERROR] No se pudo encontrar el input de candidato")
                    continue

                # PASO 6.3: BUSCAR EL BOTÓN AZUL "Buscar" Y HACER CLIC
                print(f"\nBuscando botón azul 'Buscar' para ejecutar la búsqueda...")

                # Hacer screenshot ANTES de buscar el botón para ver el estado de la página
                try:
                    screenshot_path = f"debug_antes_buscar_{cand_idx}.png"
                    driver.save_screenshot(screenshot_path)
                except:
                    pass

                boton_encontrado = False
                sleep(2)  # Esperar a que el botón aparezca

                try:
                    # El botón "Buscar" que veo en tu screenshot parece ser un botón con un icono de búsqueda
                    # Voy a buscar específicamente el botón azul con el icono de búsqueda

                    # Estrategia 1: Buscar botón con icono de búsqueda (fa-search) dentro de un botón
                    try:
                        print("Buscando botón con icono de búsqueda...")
                        buscar_btn = driver.find_element(By.XPATH, "//button[contains(@class, 'btn') and .//i[contains(@class, 'fa-search')]]")
                        driver.execute_script("arguments[0].scrollIntoView(true);", buscar_btn)
                        sleep(0.5)
                        driver.execute_script("arguments[0].click();", buscar_btn)
                        print("[OK] Botón 'Buscar' con icono encontrado y presionado")
                        boton_encontrado = True
                    except Exception as e:
                        print(f"No se encontró botón con icono de búsqueda: {e}")

                    # Estrategia 2: Buscar botón azul (btn-primary o btn-info) que contenga "Buscar"
                    if not boton_encontrado:
                        try:
                            print("Buscando botón azul con texto 'Buscar'...")
                            buscar_btn = driver.find_element(By.XPATH, "//button[contains(@class, 'btn-primary') or contains(@class, 'btn-info')][contains(., 'Buscar')]")
                            driver.execute_script("arguments[0].scrollIntoView(true);", buscar_btn)
                            sleep(0.5)
                            driver.execute_script("arguments[0].click();", buscar_btn)
                            print("[OK] Botón azul 'Buscar' encontrado y presionado")
                            boton_encontrado = True
                        except Exception as e:
                            print(f"No se encontró botón azul: {e}")

                    # Estrategia 3: Buscar cualquier botón visible que contenga "Buscar"
                    if not boton_encontrado:
                        try:
                            print("Buscando cualquier botón con texto 'Buscar'...")
                            buscar_btn = wait.until(EC.element_to_be_clickable(
                                (By.XPATH, "//button[contains(text(), 'Buscar')]")
                            ))
                            driver.execute_script("arguments[0].scrollIntoView(true);", buscar_btn)
                            sleep(0.5)
                            driver.execute_script("arguments[0].click();", buscar_btn)
                            print("[OK] Botón 'Buscar' encontrado y presionado")
                            boton_encontrado = True
                        except Exception as e:
                            print(f"No se encontró botón 'Buscar': {e}")

                    if not boton_encontrado:
                        print("[ERROR] No se pudo encontrar el botón 'Buscar' después de seleccionar el candidato")
                        print("Esto puede significar que el candidato no se seleccionó correctamente")
                        # Hacer otro screenshot para debugging
                        try:
                            screenshot_path = f"debug_sin_boton_{cand_idx}.png"
                            driver.save_screenshot(screenshot_path)
                        except:
                            pass
                        continue  # Saltar a siguiente candidato

                    # Esperar a que se ejecute la búsqueda y cargue la tabla
                    print("Esperando a que se ejecute la búsqueda y cargue la tabla...")
                    sleep(4)

                except Exception as e:
                    print(f"[ERROR] Error buscando botón 'Buscar': {e}")
                    import traceback
                    traceback.print_exc()
                    continue  # Saltar a siguiente candidato

                # Verificar que la tabla haya cargado
                print("Verificando que la tabla con datos haya cargado...")
                sleep(2)

                # Scroll hacia abajo para ver la tabla
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                sleep(1)

                # Procesar todas las páginas de este candidato
                pagina_actual = 1
                total_descargados_candidato = 0
                pdfs_info = []  # Lista para guardar info de código y formato de cada PDF

                while True:
                    print(f"\nProcesando página {pagina_actual}...")

                    # Buscar botones/enlaces PDF con múltiples selectores
                    XPATH_PDF = (
                        "//button[.//i[contains(@class, 'fa-file-pdf')]] | "
                        "//a[.//i[contains(@class, 'fa-file-pdf')]] | "
                        "//button[contains(@class, 'pdf')] | "
                        "//a[contains(@class, 'pdf')] | "
                        "//a[contains(@href, '.pdf')]"
                    )
                    pdf_buttons = driver.find_elements(By.XPATH, XPATH_PDF)
                    print(f"Encontrados {len(pdf_buttons)} PDFs en página {pagina_actual}")

                    if len(pdf_buttons) > 0:
                        for idx in range(len(pdf_buttons)):
                            try:
                                pdf_buttons_refresh = driver.find_elements(By.XPATH, XPATH_PDF)

                                if idx < len(pdf_buttons_refresh):
                                    # Extraer información de la fila ANTES de descargar
                                    codigo_ingreso = "SIN_CODIGO"
                                    formato_ingreso = ""

                                    try:
                                        # Obtener la fila (tr) que contiene este botón PDF
                                        boton_pdf = pdf_buttons_refresh[idx]
                                        fila_tr = boton_pdf.find_element(By.XPATH, "./ancestor::tr")

                                        # Obtener todas las columnas (td) de la fila
                                        columnas = fila_tr.find_elements(By.TAG_NAME, "td")

                                        # Estructura de la tabla de ingresos:
                                        # Columna 0: Opciones (botón editar)
                                        # Columna 1: No. Comprobante Interno
                                        # Columna 2: Valor Total
                                        # Columna 3: Código (ej: 102, 103)
                                        # Columna 4: Formato (ej: 6.2B, 6.3B)
                                        # Columna 5: Nombre del Formato
                                        # Columna 6: Soporte (botón PDF)
                                        # Columna 7: Estado

                                        if len(columnas) >= 5:
                                            # Extraer código (columna 3)
                                            codigo_ingreso = columnas[3].text.strip() if columnas[3].text.strip() else "SIN_CODIGO"

                                            # Extraer formato (columna 4)
                                            formato_ingreso = columnas[4].text.strip() if len(columnas) > 4 and columnas[4].text.strip() else ""

                                            print(f"  Código: {codigo_ingreso} | Formato: {formato_ingreso if formato_ingreso else '(vacío)'}")
                                    except Exception as e:
                                        print(f"  [WARNING] No se pudo extraer info de la fila: {e}")

                                    total_descargados_candidato += 1
                                    print(f"  Descargando PDF {idx + 1}/{len(pdf_buttons)}...")
                                    driver.execute_script("arguments[0].scrollIntoView(true);", pdf_buttons_refresh[idx])
                                    sleep(0.3)

                                    # Obtener timestamp ANTES de descargar para identificar el archivo
                                    pdfs_antes = set(glob.glob(os.path.join(carpeta_base, "*.pdf")))

                                    try:
                                        pdf_buttons_refresh[idx].click()
                                    except:
                                        driver.execute_script("arguments[0].click();", pdf_buttons_refresh[idx])

                                    # ESTRATEGIA MEJORADA: Mover el PDF INMEDIATAMENTE después de descargarlo
                                    # Esperar a que el archivo aparezca (máximo 15 segundos)
                                    archivo_descargado = None
                                    intentos = 0
                                    max_intentos = 30  # 30 intentos de 0.5s = 15 segundos máximo

                                    while intentos < max_intentos:
                                        sleep(0.5)
                                        pdfs_ahora = set(glob.glob(os.path.join(carpeta_base, "*.pdf")))
                                        pdfs_nuevos = pdfs_ahora - pdfs_antes

                                        if pdfs_nuevos:
                                            archivo_descargado = list(pdfs_nuevos)[0]
                                            print(f"  [OK] PDF descargado: {os.path.basename(archivo_descargado)}")
                                            break
                                        intentos += 1

                                    if not archivo_descargado:
                                        print(f"  [WARNING] No se detectó el archivo descargado después de 15s")
                                        continue

                                    # ESPERAR a que este archivo ESPECÍFICO termine (no esperar otros)
                                    print(f"  [INFO] Esperando a que complete la descarga...")
                                    if not esperar_archivo_especifico(archivo_descargado, timeout=30):
                                        print(f"  [WARNING] Timeout esperando archivo, intentando mover de todas formas...")

                                    # Verificar que el archivo aún existe y está accesible
                                    if not os.path.exists(archivo_descargado):
                                        print(f"  [WARNING] Archivo no encontrado: {archivo_descargado}")
                                        continue

                                    # MOVER INMEDIATAMENTE a su carpeta correspondiente
                                    try:
                                        # Crear estructura: carpeta_base/Ingresos/nombre_candidato/
                                        nombre_limpio = limpiar_nombre_candidato(nombre_candidato)
                                        carpeta_candidato = os.path.join(carpeta_base, "Ingresos", nombre_limpio)

                                        if not os.path.exists(carpeta_candidato):
                                            os.makedirs(carpeta_candidato)

                                        # Nombre del PDF: codigo-formato.pdf (ej: 103-6.3B.pdf)
                                        extension = os.path.splitext(archivo_descargado)[1]
                                        if formato_ingreso:
                                            formato_limpio = formato_ingreso.replace("/", "_").replace("\\", "_").replace(":", "_")
                                            nuevo_nombre = f"{codigo_ingreso}-{formato_limpio}{extension}"
                                        else:
                                            nuevo_nombre = f"{codigo_ingreso}{extension}"

                                        destino = os.path.join(carpeta_candidato, nuevo_nombre)

                                        resultado = mover_sin_duplicar(archivo_descargado, destino)
                                        if resultado:
                                            print(f"  [OK] Movido -> Ingresos/{nombre_limpio}/{os.path.basename(resultado)}")
                                        else:
                                            print(f"  [SKIP] Archivo identico ya existe en destino")

                                    except Exception as e:
                                        print(f"  [ERROR] Error moviendo PDF: {e}")

                                    # Guardar info para organización posterior (ya no se usa, pero mantenemos por compatibilidad)
                                    pdfs_info.append({
                                        'codigo': codigo_ingreso,
                                        'formato': formato_ingreso,
                                        'orden': total_descargados_candidato
                                    })
                            except Exception as e:
                                print(f"  [ERROR] Error descargando PDF {idx + 1}: {e}")
                                continue
                    else:
                        print("  No hay PDFs en esta página")

                    # Intentar ir a la siguiente página
                    try:
                        siguiente_pagina = pagina_actual + 1
                        boton_siguiente = None

                        # Estrategia 1: Buscar enlace con el número de página específico
                        try:
                            boton_siguiente = driver.find_element(By.XPATH, f"//a[@class='page-link' and text()='{siguiente_pagina}']")
                        except:
                            pass

                        # Estrategia 2: Buscar cualquier enlace de paginación con el número
                        if not boton_siguiente:
                            try:
                                boton_siguiente = driver.find_element(By.XPATH, f"//a[contains(@class, 'page') and text()='{siguiente_pagina}']")
                            except:
                                pass

                        # Estrategia 3: Buscar botón "Siguiente" o "Next"
                        if not boton_siguiente:
                            try:
                                boton_siguiente = driver.find_element(By.XPATH, "//a[contains(@class, 'page-link') and (contains(text(), 'Siguiente') or contains(text(), 'Next') or contains(@aria-label, 'Next'))]")
                            except:
                                pass

                        # Estrategia 4: Buscar botón con icono de flecha derecha
                        if not boton_siguiente:
                            try:
                                boton_siguiente = driver.find_element(By.XPATH, "//a[contains(@class, 'page-link') and .//i[contains(@class, 'fa-angle-right') or contains(@class, 'fa-chevron-right') or contains(@class, 'fa-arrow-right')]]")
                            except:
                                pass

                        if boton_siguiente:
                            print(f"  Navegando a página {siguiente_pagina}...")
                            driver.execute_script("arguments[0].scrollIntoView(true);", boton_siguiente)
                            sleep(0.5)

                            try:
                                boton_siguiente.click()
                            except:
                                driver.execute_script("arguments[0].click();", boton_siguiente)

                            sleep(3)  # Esperar más tiempo para que cargue la nueva página
                            pagina_actual += 1

                            # Scroll a la mitad de la página para ver los PDFs
                            driver.execute_script("window.scrollTo(0, document.body.scrollHeight/2);")
                            sleep(1)
                            print(f"  [OK] Página {pagina_actual} cargada")
                        else:
                            print(f"  No se encontró botón para página {siguiente_pagina}")
                            print(f"  Total de páginas procesadas: {pagina_actual}")
                            break
                    except Exception as e:
                        print(f"  Error en paginación: {e}")
                        break

                print(f"\n[OK] {nombre_candidato}: {total_descargados_candidato} PDFs descargados y organizados")

            except Exception as e:
                print(f"[ERROR] Error procesando candidato {nombre_candidato}: {e}")
                import traceback
                traceback.print_exc()
                continue

        print(f"\n{'='*80}")
        print(f"PROCESO COMPLETADO PARA TODA LA ORGANIZACIÓN: {organizacion}")
        print(f"{'='*80}\n")

        # LIMPIEZA FINAL: Eliminar PDFs que quedaron en la carpeta base
        print(f"\n{'='*80}")
        print("LIMPIEZA FINAL - Eliminando PDFs de la carpeta base...")
        print(f"{'='*80}\n")

        try:
            # Buscar TODOS los PDFs que están directamente en carpeta_base (no en subcarpetas)
            pdfs_en_base = glob.glob(os.path.join(carpeta_base, "*.pdf"))

            if pdfs_en_base:
                print(f"Encontrados {len(pdfs_en_base)} PDFs en la carpeta base que deben eliminarse:")
                for pdf in pdfs_en_base:
                    try:
                        print(f"  Eliminando: {os.path.basename(pdf)}")
                        os.remove(pdf)
                        print(f"  [OK] Eliminado")
                    except Exception as e:
                        print(f"  [ERROR] No se pudo eliminar: {e}")
                print(f"\n[OK] Limpieza completada: {len(pdfs_en_base)} archivos procesados")
            else:
                print("[OK] No hay PDFs para limpiar en la carpeta base")
        except Exception as e:
            print(f"[ERROR] Error durante limpieza: {e}")

    except Exception as e:
        print(f"Error general: {e}")
        import traceback
        traceback.print_exc()

    finally:
        sleep(2)
        driver.quit()


def descargar_gastos_batch(lista_candidatos):
    """
    Descarga ingresos de múltiples candidatos.

    lista_candidatos: Lista de diccionarios con los parámetros de cada candidato
    """
    for candidato_info in lista_candidatos:
        descargar_gastos_candidato(**candidato_info)
        sleep(2)  # Pausa entre candidatos


if __name__ == "__main__":
    # Ejemplo de uso con el candidato que mostraste
    candidato_ejemplo = {
        "proceso_electoral": "ELECCIONES TERRITORIALES 2023",
        "corporacion": "Alcaldía_fun",
        "departamento": "Tolima",
        "municipio": "Mariquita",
        "tipo_organizacion": "Organización Política",
        "organizacion": "PARTIDO LIBERAL COLOMBIANO",
        "candidato": "ALVARO BOHORQUEZ OSMA"
    }

    descargar_gastos_candidato(**candidato_ejemplo)

    # Para procesar múltiples candidatos, usar:
    # lista_candidatos = [
    #     {
    #         "proceso_electoral": "ELECCIONES TERRITORIALES 2023",
    #         "corporacion": "Alcaldía_fun",
    #         "departamento": "Tolima",
    #         "municipio": "Mariquita",
    #         "tipo_organizacion": "Organización Política",
    #         "organizacion": "PARTIDO LIBERAL COLOMBIANO",
    #         "candidato": "ALVARO BOHORQUEZ OSMA"
    #     },
    #     # Agregar más candidatos aquí...
    # ]
    # descargar_gastos_batch(lista_candidatos)
