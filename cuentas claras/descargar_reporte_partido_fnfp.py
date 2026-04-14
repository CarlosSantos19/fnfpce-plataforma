"""
DESCARGAR REPORTE DE INGRESOS Y GASTOS DEL PARTIDO - FNFP
Este script descarga todos los tipos de informe disponibles en la sección
"Reporte De Ingresos Y Gastos Del Partido" del módulo FNFP.

Ruta de navegación:
FNFP > Registro De Ingresos Y Gastos > Reporte De Ingresos Y Gastos Del Partido
"""

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys
from time import sleep
from config import crear_driver, esperar_descarga_completa, mover_sin_duplicar, deduplicar_carpeta
import config
import os
import shutil
import glob


def limpiar_nombre_archivo(nombre):
    """Limpia el nombre para usarlo como nombre de archivo o carpeta"""
    if not nombre:
        return "SIN_NOMBRE"

    nombre_limpio = str(nombre).strip()
    caracteres_invalidos = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']
    for char in caracteres_invalidos:
        nombre_limpio = nombre_limpio.replace(char, '_')
    return nombre_limpio


def hacer_login(driver, usuario, password):
    """Realiza el login en el sistema CNE"""
    print("Iniciando sesion en el sistema CNE...")

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
            print("No se encontro el boton de login")
            driver.save_screenshot("error_login_boton.png")
            return False

        # Hacer clic en login
        login_btn.click()
        sleep(3)

        # Verificar si el login fue exitoso
        if "login" not in driver.current_url.lower():
            print("Login exitoso")
            return True
        else:
            print("Login fallo - aun en pagina de login")
            driver.save_screenshot("error_login_fallo.png")
            return False

    except Exception as e:
        print(f"Error en login: {e}")
        import traceback
        traceback.print_exc()
        driver.save_screenshot("error_login_excepcion.png")
        return False


def descargar_reporte_partido_organizacion(
    usuario_cne,
    password_cne,
    proceso_electoral="ELECCIONES TERRITORIALES 2023",
    corporacion="Con",
    circunscripcion="Municipal",
    departamento="Antioquia",
    municipio="Alejandria",
    tipo_organizacion="Or",
    organizacion="PARTIDO CAMBIO RADICAL",
    carpeta_base=None
):
    """
    Descarga todos los tipos de informe del "Reporte De Ingresos Y Gastos Del Partido".

    Esta funcion:
    1. Navega a "Reporte De Ingresos Y Gastos Del Partido"
    2. Configura todos los filtros de la organizacion
    3. Itera por cada opcion en "Tipo de Informe"
    4. Descarga el PDF de cada tipo de informe
    5. Organiza los PDFs en carpetas por tipo de informe

    Parametros:
    - carpeta_base: Carpeta base de la organizacion
    """

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
                print(f"No se pudo iniciar sesion (intento {_nav_intento+1}/3). Reintentando...")
                continue

            wait = WebDriverWait(driver, 20)

            # PASO 2: Navegar a FNFP
            print("Navegando al modulo FNFP...")
            sleep(1.5)

            try:
                fnfp_button = driver.find_element(By.XPATH, "//*[text()='FNFP']/..")
                fnfp_button.click()
                sleep(1.5)
                print("Modulo FNFP abierto")
            except:
                print("Error accediendo a FNFP")
                if _nav_intento < 2:
                    continue
                return

            # PASO 3: Navegar a "Reporte De Ingresos Y Gastos Del Partido"
            print("Navegando a Reporte De Ingresos Y Gastos Del Partido...")
            try:
                # Primero hacer clic en el menu "Registro De Ingresos Y Gastos"
                registro_menu = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//a[contains(., 'Registro De Ingresos Y Gastos')]")
                ))
                registro_menu.click()
                sleep(0.5)

                # Luego hacer clic en "Reporte De Ingresos Y Gastos Del Partido"
                reporte_link = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//a[contains(., 'Reporte De Ingresos Y Gastos Del Partido')]")
                ))
                reporte_link.click()
                sleep(2)
                print("Pagina de reportes del partido cargada")
                break  # Navegacion exitosa
            except Exception as e:
                print(f"Error navegando a reportes: {e}")
                if _nav_intento < 2:
                    continue
                return

        if wait is None:
            print("[ERROR] No se pudo completar la navegación después de 3 intentos.")
            return

        # PASO 4: Configurar TODOS los filtros (igual que descargar_ingresos_fnfp.py)
        print(f"\n{'='*80}")
        print(f"CONFIGURANDO FILTROS PARA: {organizacion}")
        print(f"{'='*80}\n")

        # Helper para seleccionar en Vue Select con exactitud (copiado de descargar_ingresos_fnfp.py)
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
                        print(f"[OK] Sin opciones, ENTER: {valor}")
                        return True

                    opcion_correcta = None
                    for opt in opciones:
                        if opt.text.strip().upper() == valor.upper():
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

        # 1. Proceso Electoral - METODO ROBUSTO
        print("1. Seleccionando Proceso Electoral...")
        try:
            # Buscar todos los inputs de Vue Select
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            proceso_input = None

            # Buscar el input que tenga "Proceso Electoral" en su contenedor padre
            for inp in inputs:
                try:
                    parent_text = inp.find_element(By.XPATH, "../../../..").text
                    if "Proceso" in parent_text and "Electoral" in parent_text:
                        proceso_input = inp
                        break
                except:
                    pass

            # Si no se encontro, intentar con placeholder
            if not proceso_input:
                try:
                    proceso_input = driver.find_element(By.XPATH, "//input[contains(@placeholder, 'Proceso Electoral')]")
                except:
                    pass

            # Si aun no se encontro, usar el primer input disponible
            if not proceso_input and len(inputs) > 0:
                proceso_input = inputs[0]

            if proceso_input:
                proceso_input.click()
                sleep(0.3)
                proceso_input.clear()
                proceso_input.send_keys(proceso_electoral)
                sleep(0.5)

                # Buscar opcion exacta
                opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                encontrado = False
                for opt in opciones:
                    if opt.text.strip() == proceso_electoral:
                        opt.click()
                        encontrado = True
                        print(f"[OK] Seleccionado: {proceso_electoral}")
                        break

                if not encontrado:
                    proceso_input.send_keys(Keys.ENTER)
                    print(f"[OK] Seleccionado con ENTER: {proceso_electoral}")

                sleep(0.5)
            else:
                print("[ERROR] No se encontro el campo Proceso Electoral")
        except Exception as e:
            print(f"[ERROR] Error seleccionando Proceso Electoral: {e}")

        # 2. Corporacion
        print("2. Seleccionando Corporacion...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            if len(inputs) > 0:
                inputs[0].click()
                sleep(0.2)
                inputs[0].clear()
                inputs[0].send_keys(corporacion)
                sleep(0.5)
                inputs[0].send_keys(Keys.ENTER)
                sleep(0.5)
                print("[OK]")
        except Exception as e:
            print(f"[ERROR]: {e}")

        # 3. Circunscripcion
        print(f"3. Seleccionando Circunscripcion: {circunscripcion}...")
        sleep(0.5)
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            if len(inputs) >= 1:
                inputs[0].click()
                sleep(0.3)
                inputs[0].clear()
                inputs[0].send_keys(circunscripcion)
                sleep(0.5)
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
                    inputs[0].send_keys(Keys.ENTER)
                    sleep(0.5)
                    print("[OK]")
            except Exception as e:
                print(f"[ERROR]: {e}")

        # 6. Tipo de Organizacion
        print("6. Seleccionando Tipo de Organizacion...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            tipo_org_input = None
            for inp in inputs:
                try:
                    parent_text = inp.find_element(By.XPATH, "../../../..").text
                    if "Tipo" in parent_text and "Organizaci" in parent_text:
                        tipo_org_input = inp
                        break
                except:
                    pass

            if tipo_org_input:
                tipo_org_input.click()
                sleep(0.3)
                tipo_org_input.clear()
                tipo_org_input.send_keys(tipo_organizacion)
                sleep(0.5)
                tipo_org_input.send_keys(Keys.ENTER)
                sleep(0.5)
                print("[OK]")
        except Exception as e:
            print(f"[ERROR]: {e}")

        # 7. Organizacion
        print("7. Seleccionando Organizacion...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            org_input = None
            for inp in inputs:
                try:
                    parent_text = inp.find_element(By.XPATH, "../../../..").text
                    if ("Seleccione la Organizacion" in parent_text or "Organizacion" in parent_text or "Organización" in parent_text) and "Tipo" not in parent_text:
                        org_input = inp
                        break
                except:
                    pass

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
                print(f"[INFO] Opciones en dropdown organización: {len(opciones)}")
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
                    except Exception:
                        driver.execute_script("arguments[0].click();", target_opt)
                    sleep(1.0)
                    print(f"[OK] Organización seleccionada: {organizacion}")
                else:
                    print(f"[AVISO] No encontrado '{organizacion}'.")
                    org_input.send_keys(Keys.ESCAPE)

                sleep(0.5)
        except Exception as e:
            print(f"[ERROR]: {e}")

        # PASO 5: HACER CLIC EN PESTAÑA "CONSOLIDADO PARTIDO"
        print(f"\n{'='*80}")
        print("SELECCIONANDO PESTAÑA CONSOLIDADO PARTIDO")
        print(f"{'='*80}\n")

        sleep(2)

        try:
            # Buscar la pestaña "CONSOLIDADO PARTIDO"
            tab_consolidado = driver.find_element(By.XPATH, "//a[@role='tab' and contains(text(), 'CONSOLIDADO PARTIDO')]")
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", tab_consolidado)
            sleep(0.5)
            tab_consolidado.click()
            print("[OK] Pestaña CONSOLIDADO PARTIDO seleccionada")
            sleep(2)
        except Exception as e:
            print(f"[ERROR] No se pudo seleccionar la pestaña CONSOLIDADO PARTIDO: {e}")
            # Intentar con otro selector
            try:
                tabs = driver.find_elements(By.XPATH, "//a[@role='tab']")
                for tab in tabs:
                    print(f"  - {tab.text}")
                    if "CONSOLIDADO" in tab.text.upper() and "PARTIDO" in tab.text.upper():
                        tab.click()
                        print("[OK] Pestaña CONSOLIDADO PARTIDO seleccionada (metodo alternativo)")
                        sleep(2)
                        break
            except:
                pass

        # PASO 6: OBTENER LISTA DE TIPOS DE INFORME
        print(f"\n{'='*80}")
        print("OBTENIENDO LISTA DE TIPOS DE INFORME")
        print(f"{'='*80}\n")

        # Esperar a que cargue el contenido de la pestaña
        sleep(3)

        # Guardar screenshot para debug
        driver.save_screenshot("debug_antes_tipo_informe.png")

        tipos_informe_lista = []

        try:
            # Hacer scroll hacia abajo para ver el campo Tipo de Informe
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            sleep(1)

            # Buscar el dropdown de Tipo de Informe por el span vs__selected que contiene "INFORME"
            tipo_informe_container = None

            # Metodo 1: Buscar por el texto "Tipo de Informe" en labels y buscar v-select cercano
            try:
                labels = driver.find_elements(By.XPATH, "//*[contains(text(), 'Tipo de Informe') or contains(text(), 'Tipo Informe')]")
                for label in labels:
                    try:
                        # Buscar el contenedor padre y luego el v-select
                        parent = label.find_element(By.XPATH, "./..")
                        v_select = parent.find_element(By.XPATH, ".//div[contains(@class, 'v-select')]")
                        tipo_informe_container = v_select
                        break
                    except:
                        try:
                            # Intentar buscar el siguiente hermano
                            v_select = label.find_element(By.XPATH, "./following-sibling::div[contains(@class, 'v-select')]")
                            tipo_informe_container = v_select
                            break
                        except:
                            try:
                                # Buscar en el padre del padre
                                parent = label.find_element(By.XPATH, "./../..")
                                v_select = parent.find_element(By.XPATH, ".//div[contains(@class, 'v-select')]")
                                tipo_informe_container = v_select
                                break
                            except:
                                pass
            except:
                pass

            # Metodo 2: Buscar por span vs__selected que contenga "INFORME"
            if not tipo_informe_container:
                try:
                    spans_selected = driver.find_elements(By.XPATH, "//span[@class='vs__selected' and contains(text(), 'INFORME')]")
                    if spans_selected:
                        # Obtener el contenedor padre (v-select)
                        tipo_informe_container = spans_selected[0].find_element(By.XPATH, "./ancestor::div[contains(@class, 'v-select')]")
                except:
                    pass

            # Metodo 3: Buscar todos los v-select y encontrar el que tiene INFORME
            if not tipo_informe_container:
                try:
                    v_selects = driver.find_elements(By.XPATH, "//div[contains(@class, 'v-select')]")
                    for vs in v_selects:
                        try:
                            texto = vs.text
                            if "INFORME" in texto.upper():
                                tipo_informe_container = vs
                                break
                        except:
                            pass
                except:
                    pass

            if tipo_informe_container:
                # Hacer scroll al elemento
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", tipo_informe_container)
                sleep(0.5)

                # Buscar el input dentro del contenedor
                try:
                    tipo_informe_input = tipo_informe_container.find_element(By.XPATH, ".//input[@class='vs__search']")
                except:
                    tipo_informe_input = tipo_informe_container

                # Abrir dropdown haciendo clic
                try:
                    tipo_informe_input.click()
                except:
                    driver.execute_script("arguments[0].click();", tipo_informe_container)

                sleep(1)

                # Obtener todas las opciones
                opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                print(f"Tipos de Informe disponibles:")
                for idx, opt in enumerate(opciones, 1):
                    nombre_tipo = opt.text.strip()
                    if nombre_tipo and "Sorry" not in nombre_tipo and nombre_tipo != "":
                        tipos_informe_lista.append(nombre_tipo)
                        print(f"  {idx}. {nombre_tipo}")

                print(f"\nTotal: {len(tipos_informe_lista)} tipos de informe encontrados\n")

                # Cerrar dropdown
                driver.execute_script("document.body.click();")
                sleep(0.5)

                if not tipos_informe_lista:
                    print("[WARNING] No se encontraron tipos de informe")
                    driver.save_screenshot("debug_sin_tipos_informe.png")
                    return
            else:
                print("[ERROR] No se encontro el dropdown de Tipo de Informe")
                driver.save_screenshot("error_tipo_informe_no_encontrado.png")
                return

        except Exception as e:
            print(f"[ERROR] Error obteniendo tipos de informe: {e}")
            import traceback
            traceback.print_exc()
            driver.save_screenshot("error_tipos_informe_excepcion.png")
            return

        # CREAR CARPETA PARA REPORTES DEL PARTIDO
        carpeta_reportes = os.path.join(carpeta_base, "Reporte_Partido")
        if not os.path.exists(carpeta_reportes):
            os.makedirs(carpeta_reportes)
            print(f"[OK] Carpeta creada: {carpeta_reportes}")

        # PASO 6: ITERAR POR CADA TIPO DE INFORME Y DESCARGAR
        print(f"\n{'='*80}")
        print(f"INICIANDO DESCARGA DE {len(tipos_informe_lista)} TIPOS DE INFORME")
        print(f"{'='*80}\n")

        pdfs_descargados_total = 0

        for tipo_idx, nombre_tipo in enumerate(tipos_informe_lista, 1):
            print(f"\n{'#'*80}")
            print(f"TIPO DE INFORME {tipo_idx}/{len(tipos_informe_lista)}: {nombre_tipo}")
            print(f"{'#'*80}\n")

            try:
                # PASO 6.1: Seleccionar el tipo de informe
                print(f"Seleccionando tipo de informe: {nombre_tipo}...")

                # Buscar el input de tipo de informe
                inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
                tipo_informe_input = None

                for inp in inputs:
                    try:
                        parent_text = inp.find_element(By.XPATH, "../../../..").text
                        if "Tipo" in parent_text and "Informe" in parent_text:
                            tipo_informe_input = inp
                            break
                    except:
                        pass

                if not tipo_informe_input and len(inputs) > 0:
                    tipo_informe_input = inputs[-1]

                if tipo_informe_input:
                    # Limpiar seleccion anterior si existe (buscar boton X/clear)
                    try:
                        parent_div = tipo_informe_input.find_element(By.XPATH, "../../..")
                        clear_buttons = parent_div.find_elements(By.XPATH, ".//button[contains(@class, 'vs__clear')]")
                        if clear_buttons:
                            clear_buttons[0].click()
                            sleep(0.3)
                    except:
                        pass

                    # Hacer scroll y clic
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", tipo_informe_input)
                    sleep(0.3)

                    try:
                        tipo_informe_input.click()
                    except:
                        driver.execute_script("arguments[0].click();", tipo_informe_input)

                    sleep(0.3)
                    tipo_informe_input.clear()
                    tipo_informe_input.send_keys(nombre_tipo)
                    sleep(0.5)
                    tipo_informe_input.send_keys(Keys.ENTER)
                    sleep(2)
                    print(f"[OK] Tipo de informe seleccionado: {nombre_tipo}")

                else:
                    print(f"[ERROR] No se encontro el input de tipo de informe")
                    continue

                # PASO 6.2: Buscar boton PDF y forzar descarga
                print(f"\nBuscando boton de descarga PDF...")

                # Esperar a que cargue el contenido
                sleep(2)

                # Buscar el boton PDF especifico: <button class="btn text-danger bg-white border border-danger"><i class="fa fa-file-pdf-o"></i></button>
                pdf_buttons = driver.find_elements(By.XPATH, "//button[contains(@class, 'btn') and contains(@class, 'text-danger')][.//i[contains(@class, 'fa-file-pdf')]]")


                if pdf_buttons:
                    for idx, pdf_button in enumerate(pdf_buttons, 1):
                        try:
                            if not pdf_button.is_displayed():
                                continue

                            driver.execute_script("arguments[0].scrollIntoView(true);", pdf_button)
                            sleep(0.5)


                            # Guardar ventanas actuales
                            ventanas_antes = driver.window_handles

                            # Hacer clic en el boton
                            try:
                                pdf_button.click()
                            except:
                                driver.execute_script("arguments[0].click();", pdf_button)

                            sleep(2)

                            # Verificar si se abrio una nueva pestaña
                            ventanas_despues = driver.window_handles

                            if len(ventanas_despues) > len(ventanas_antes):
                                # Cambiar a la nueva pestaña
                                nueva_ventana = [v for v in ventanas_despues if v not in ventanas_antes][0]
                                driver.switch_to.window(nueva_ventana)
                                sleep(1)

                                # Obtener la URL del PDF
                                pdf_url = driver.current_url

                                # Cerrar la pestaña del PDF
                                driver.close()

                                # Volver a la ventana principal
                                driver.switch_to.window(ventanas_antes[0])

                                # Descargar usando fetch y blob
                                nombre_archivo = f"reporte_{limpiar_nombre_archivo(nombre_tipo)[:40]}.pdf"
                                js_download = f"""
                                fetch('{pdf_url}')
                                .then(resp => resp.blob())
                                .then(blob => {{
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.style.display = 'none';
                                    a.href = url;
                                    a.download = '{nombre_archivo}';
                                    document.body.appendChild(a);
                                    a.click();
                                    window.URL.revokeObjectURL(url);
                                    a.remove();
                                }});
                                """
                                driver.execute_script(js_download)

                                # Esperar descarga
                                print(f"  [INFO] Esperando descarga de {nombre_archivo}...")
                                esperar_descarga_completa(carpeta_base, timeout=60)
                                sleep(2)

                                # MOVER INMEDIATAMENTE el PDF descargado
                                pdfs_descargados = glob.glob(os.path.join(carpeta_base, "*.pdf"))
                                if pdfs_descargados:
                                    # Ordenar por fecha de modificación (más reciente primero)
                                    pdfs_descargados.sort(key=os.path.getmtime, reverse=True)
                                    pdf_mas_reciente = pdfs_descargados[0]

                                    # Crear nombre descriptivo
                                    nombre_final = f"reporte_{limpiar_nombre_archivo(nombre_tipo)[:40]}.pdf"
                                    destino = os.path.join(carpeta_reportes, nombre_final)

                                    resultado = mover_sin_duplicar(pdf_mas_reciente, destino)
                                    if resultado:
                                        print(f"  [OK] Movido a: Reporte_Partido/{os.path.basename(resultado)}")
                                    else:
                                        print(f"  [SKIP] Reporte identico ya existe en destino")

                                pdfs_descargados_total += 1
                                print(f"[OK] PDF descargado para tipo: {nombre_tipo}")
                            else:
                                # No se abrio nueva pestaña, esperar descarga normal
                                print(f"  [INFO] Esperando descarga...")
                                esperar_descarga_completa(carpeta_base, timeout=30)
                                sleep(1)

                                # MOVER INMEDIATAMENTE el PDF descargado
                                pdfs_descargados = glob.glob(os.path.join(carpeta_base, "*.pdf"))
                                if pdfs_descargados:
                                    # Ordenar por fecha de modificación (más reciente primero)
                                    pdfs_descargados.sort(key=os.path.getmtime, reverse=True)
                                    pdf_mas_reciente = pdfs_descargados[0]

                                    # Crear nombre descriptivo
                                    nombre_final = f"reporte_{limpiar_nombre_archivo(nombre_tipo)[:40]}.pdf"
                                    destino = os.path.join(carpeta_reportes, nombre_final)

                                    resultado = mover_sin_duplicar(pdf_mas_reciente, destino)
                                    if resultado:
                                        print(f"  [OK] Movido a: Reporte_Partido/{os.path.basename(resultado)}")
                                    else:
                                        print(f"  [SKIP] Reporte identico ya existe en destino")

                                pdfs_descargados_total += 1
                                print(f"[OK] PDF descargado para tipo: {nombre_tipo}")

                        except Exception as e:
                            print(f"[ERROR] Error descargando PDF: {e}")
                            import traceback
                            traceback.print_exc()
                else:
                    print(f"[WARNING] No se encontraron botones PDF para '{nombre_tipo}'")

            except Exception as e:
                print(f"[ERROR] Error procesando tipo de informe {nombre_tipo}: {e}")
                import traceback
                traceback.print_exc()
                continue

        # PASO 7: LIMPIEZA FINAL - Eliminar PDFs que quedaron en la carpeta base
        print(f"\n{'='*80}")
        print("LIMPIEZA FINAL - Eliminando PDFs de la carpeta base...")
        print(f"{'='*80}\n")

        sleep(2)

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

        print(f"\n{'='*80}")
        print(f"PROCESO COMPLETADO")
        print(f"Total PDFs descargados: {pdfs_descargados_total}")
        print(f"Carpeta: {carpeta_reportes}")
        print(f"{'='*80}\n")

    except Exception as e:
        print(f"Error general: {e}")
        import traceback
        traceback.print_exc()

    finally:
        sleep(2)
        driver.quit()


if __name__ == "__main__":
    # Ejemplo de uso - datos del Excel
    from credenciales import USUARIO_CNE, PASSWORD_CNE

    descargar_reporte_partido_organizacion(
        usuario_cne=USUARIO_CNE,
        password_cne=PASSWORD_CNE,
        proceso_electoral="ELECCIONES TERRITORIALES 2023",
        corporacion="Alc",
        circunscripcion="Municipal",
        departamento="Caldas",
        municipio="Manizales",
        tipo_organizacion="Or",
        organizacion="PARTIDO COLOMBIA RENACIENTE",
        carpeta_base=r"C:\CNE_Descargas\ALCALDIA_Caldas_Manizales_PARTIDO_COLOMBIA_RENACIENTE"
    )
