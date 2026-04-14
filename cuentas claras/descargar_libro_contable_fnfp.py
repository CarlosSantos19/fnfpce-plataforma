"""
DESCARGAR LIBRO CONTABLE (EXCEL) POR CANDIDATO - FNFP
Este script descarga el archivo Excel "Libro Contable" de cada candidato
desde la sección "Reporte De Ingresos Y Gastos De Campaña" del módulo FNFP.

Ruta de navegación:
FNFP > Registro De Ingresos Y Gastos > Reporte De Ingresos Y Gastos De Campaña

El Excel se descarga haciendo clic en el icono de Excel junto a "Libro Contable"
y se guarda en: carpeta_base/excel/nombre_candidato/
"""

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys
from time import sleep
from config import crear_driver, esperar_descarga_completa, esperar_archivo_especifico, mover_sin_duplicar, deduplicar_carpeta
import config
import os
import shutil
import glob
import time


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
    print("Iniciando sesión en el sistema CNE...")

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
        usuario_input = None
        password_input = None

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

        usuario_input.clear()
        usuario_input.send_keys(usuario)
        sleep(0.3)

        password_input.clear()
        password_input.send_keys(password)
        sleep(0.3)

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

        login_btn.click()
        sleep(3)

        try:
            if "login" not in driver.current_url.lower():
                print("Login exitoso")
                return True
            else:
                print("Login falló - aún en página de login")
                driver.save_screenshot("error_login_fallo.png")
                return False
        except:
            print("Login exitoso")
            return True

    except Exception as e:
        print(f"Error en login: {e}")
        driver.save_screenshot("error_login_excepcion.png")
        return False


def seleccionar_vue_select_mejorado(driver, placeholder_texto, valor, esperar=0.5):
    """
    Selecciona una opción en Vue Select con reintentos automáticos.
    """
    from selenium.webdriver.common.keys import Keys as _Keys
    for _int in range(3):
        try:
            input_field = driver.find_element(By.XPATH, f"//input[contains(@placeholder, '{placeholder_texto}')]")
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", input_field)
            sleep(0.2)
            input_field.click()
            sleep(0.8)

            lb_id = input_field.get_attribute("aria-controls") or ""
            if lb_id:
                opciones = driver.find_elements(By.XPATH, f"//ul[@id='{lb_id}']//li")
            else:
                opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

            # Si no hay opciones validas, esperar hasta 3s mas
            opciones_validas = [o for o in opciones if o.text.strip() and "Sorry, no matching" not in o.text]
            if not opciones_validas:
                for _ in range(6):
                    sleep(0.5)
                    todas = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                    opciones_validas = [o for o in todas if o.text.strip() and "Sorry, no matching" not in o.text]
                    if opciones_validas:
                        break

            if not opciones_validas:
                print(f"[RETRY {_int+1}] Sin opciones para '{valor}' en '{placeholder_texto}'")
                sleep(1)
                continue

            # Buscar coincidencia exacta primero, luego parcial
            opcion_correcta = None
            for opt in opciones_validas:
                if opt.text.strip().upper() == valor.upper():
                    opcion_correcta = opt
                    break
            if not opcion_correcta:
                for opt in opciones_validas:
                    if valor.upper() in opt.text.strip().upper() or opt.text.strip().upper() in valor.upper():
                        opcion_correcta = opt
                        break

            if opcion_correcta:
                driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", opcion_correcta)
                sleep(0.2)
                try:
                    opcion_correcta.click()
                except Exception:
                    driver.execute_script("arguments[0].click();", opcion_correcta)
                print(f"[OK] Seleccionado: {opcion_correcta.text.strip()}")
            else:
                input_field.send_keys(_Keys.ENTER)
                print(f"[OK] ENTER: {valor}")

            sleep(esperar)
            return True

        except Exception as e:
            if _int < 2:
                print(f"[RETRY {_int+1}] Error en '{placeholder_texto}': {e}")
                sleep(1)
            else:
                print(f"[ERROR] No se pudo seleccionar '{placeholder_texto}': {e}")
                return False
    return False



def descargar_libro_contable_organizacion(
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
    Descarga el Excel "Libro Contable" de TODOS los candidatos de una organización.

    Navega a:
    FNFP > Registro De Ingresos Y Gastos > Reporte De Ingresos Y Gastos De Campaña

    Para cada candidato:
    1. Selecciona el candidato del dropdown
    2. Hace clic en "Buscar"
    3. Busca el icono de Excel junto a "Libro Contable"
    4. Descarga el Excel
    5. Lo mueve a carpeta_base/excel/nombre_candidato/

    Parámetros:
    - carpeta_base: Carpeta base de la organización
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

            # PASO 3: Navegar a "Reporte De Ingresos Y Gastos De Campaña"
            print("Navegando a Reporte De Ingresos Y Gastos De Campaña...")
            try:
                registro_menu = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//a[contains(., 'Registro De Ingresos')]")
                ))
                registro_menu.click()
                sleep(0.5)

                reporte_link = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//a[contains(., 'Reporte De Ingresos Y Gastos De Campaña')]")
                ))
                reporte_link.click()
                sleep(2)
                print("Página de reportes cargada")
                break  # Navegacion exitosa
            except Exception as e:
                print(f"Error navegando a reportes: {e}")
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

        # 1. Proceso Electoral
        print("1. Seleccionando Proceso Electoral...")
        seleccionar_vue_select_mejorado(driver, "Seleccione Proceso Electoral", proceso_electoral, 0.5)

        # 2. Corporación
        print("2. Seleccionando Corporación...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            if len(inputs) > 0:
                inputs[0].click()
                sleep(0.3)
                inputs[0].clear()
                if len(corporacion) > 2:
                    inputs[0].send_keys(corporacion[:2])
                else:
                    inputs[0].send_keys(corporacion)
                sleep(0.8)

                opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                encontrado = False
                for opt in opciones:
                    if "Sorry, no matching options" in opt.text:
                        continue
                    texto_opt = opt.text.strip().upper()
                    corp_upper = corporacion.upper()
                    if texto_opt == corp_upper or corp_upper in texto_opt or texto_opt in corp_upper:
                        driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", opt)
                        sleep(0.2)
                        opt.click()
                        print(f"[OK] Seleccionado: {opt.text.strip()}")
                        encontrado = True
                        break

                if not encontrado:
                    inputs[0].send_keys(Keys.ENTER)
                    print(f"[OK] Seleccionado con ENTER")
                sleep(0.5)
        except Exception as e:
            print(f"[ERROR]: {e}")

        # 3. Circunscripción
        print(f"3. Seleccionando Circunscripción: {circunscripcion}...")
        sleep(0.5)
        seleccionar_vue_select_mejorado(driver, "Seleccione...", circunscripcion, 0.5)

        # 4. Departamento
        print("4. Seleccionando Departamento...")
        sleep(0.5)
        seleccionar_vue_select_mejorado(driver, "Seleccione...", departamento, 0.5)

        # 5. Municipio
        if municipio and municipio.strip():
            print("5. Seleccionando Municipio...")
            sleep(0.5)
            seleccionar_vue_select_mejorado(driver, "Seleccione...", municipio, 0.5)

        # 6. Tipo de Organización
        print("6. Seleccionando Tipo de Organización...")
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
                if len(tipo_organizacion) > 2:
                    tipo_org_input.send_keys(tipo_organizacion[:2])
                else:
                    tipo_org_input.send_keys(tipo_organizacion)
                sleep(0.8)

                opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                encontrado = False
                for opt in opciones:
                    if "Sorry, no matching options" in opt.text:
                        continue
                    if opt.text.strip().upper() == tipo_organizacion.upper():
                        opt.click()
                        print(f"[OK] Seleccionado: {tipo_organizacion}")
                        encontrado = True
                        break
                if not encontrado:
                    tipo_org_input.send_keys(Keys.ENTER)
                    print(f"[OK] Seleccionado con ENTER")
                sleep(0.5)
        except Exception as e:
            print(f"[ERROR]: {e}")

        # 7. Organización
        print("7. Seleccionando Organización...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            org_input = None
            for inp in inputs:
                try:
                    parent_text = inp.find_element(By.XPATH, "../../../..").text
                    if "Seleccione la Organizacion" in parent_text:
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

        # PASO 5: OBTENER LISTA DE TODOS LOS CANDIDATOS
        print(f"\n{'='*80}")
        print("OBTENIENDO LISTA DE CANDIDATOS DEL DROPDOWN")
        print(f"{'='*80}\n")

        sleep(0.5)

        candidatos_lista = []

        try:
            inputs = driver.find_elements(By.XPATH, "//input[@class='vs__search']")
            cand_input = None

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
                cand_input.click()
                sleep(0.5)

                opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                print(f"Candidatos disponibles en el dropdown:")
                for idx, opt in enumerate(opciones, 1):
                    nombre_candidato = opt.text.strip()
                    if nombre_candidato and nombre_candidato != "Sorry, no matching options.":
                        candidatos_lista.append(nombre_candidato)
                        print(f"  {idx}. {nombre_candidato}")

                print(f"Total: {len(candidatos_lista)} candidatos encontrados\n")

                if not candidatos_lista:
                    print("[WARNING] No se encontraron candidatos para esta organización")
                    return
            else:
                print("[ERROR] No se encontró el input de candidato")
                return

        except Exception as e:
            print(f"[ERROR] Error obteniendo candidatos: {e}")
            return

        # PASO 6: ITERAR POR CADA CANDIDATO Y DESCARGAR EXCEL
        print(f"\n{'='*80}")
        print(f"INICIANDO DESCARGA DE LIBRO CONTABLE PARA {len(candidatos_lista)} CANDIDATOS")
        print(f"{'='*80}\n")

        for cand_idx, nombre_candidato in enumerate(candidatos_lista, 1):
            print(f"\n{'#'*80}")
            print(f"CANDIDATO {cand_idx}/{len(candidatos_lista)}: {nombre_candidato}")
            print(f"{'#'*80}\n")

            try:
                # PASO 6.1: Seleccionar el candidato
                print(f"Seleccionando candidato: {nombre_candidato}...")

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
                    # Cerrar dropdown del perfil si está abierto
                    try:
                        driver.execute_script("document.body.click();")
                        sleep(0.3)
                    except:
                        pass

                    # Scroll al input
                    try:
                        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", cand_input)
                        sleep(0.5)
                        driver.execute_script("window.scrollBy(0, -200);")
                        sleep(0.3)
                    except:
                        pass

                    # Click en el input
                    click_exitoso = False
                    try:
                        cand_input.click()
                        click_exitoso = True
                    except:
                        try:
                            driver.execute_script("arguments[0].click();", cand_input)
                            click_exitoso = True
                        except:
                            pass

                    if not click_exitoso:
                        print(f"[ERROR] No se pudo hacer click en el input de candidato")
                        continue

                    sleep(0.5)

                    # Abrir dropdown y seleccionar candidato
                    try:
                        opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                        opcion_encontrada = False
                        for opt in opciones:
                            texto_opt = opt.text.strip()
                            if "Sorry, no matching options" in texto_opt:
                                continue
                            if texto_opt == nombre_candidato:
                                try:
                                    driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", opt)
                                    sleep(0.2)
                                    opt.click()
                                except:
                                    driver.execute_script("arguments[0].click();", opt)
                                print(f"[OK] Candidato seleccionado: {nombre_candidato}")
                                opcion_encontrada = True
                                break

                        if not opcion_encontrada:
                            print(f"[SKIP] No se encontró el candidato '{nombre_candidato}'")
                            continue

                    except Exception as e:
                        print(f"[SKIP] Error seleccionando candidato: {e}")
                        continue

                    sleep(2)
                    driver.execute_script("window.scrollTo(0, 0);")
                    sleep(0.5)

                else:
                    print(f"[ERROR] No se encontró el input de candidato")
                    continue

                # PASO 6.2: Esperar a que cargue el reporte
                # En la página "Reporte De Ingresos Y Gastos De Campaña" NO hay botón "Buscar".
                # Los datos se cargan automáticamente al seleccionar el candidato.
                # Si existe un botón "Buscar", lo presionamos; si no, continuamos.
                print("Esperando a que cargue el reporte del candidato...")
                sleep(3)

                try:
                    buscar_btn = None
                    for xpath_buscar in [
                        "//button[contains(@class, 'btn') and .//i[contains(@class, 'fa-search')]]",
                        "//button[contains(@class, 'btn-primary') or contains(@class, 'btn-info')][contains(., 'Buscar')]",
                        "//button[contains(text(), 'Buscar')]",
                    ]:
                        try:
                            buscar_btn = driver.find_element(By.XPATH, xpath_buscar)
                            break
                        except:
                            pass

                    if buscar_btn:
                        driver.execute_script("arguments[0].scrollIntoView(true);", buscar_btn)
                        sleep(0.5)
                        driver.execute_script("arguments[0].click();", buscar_btn)
                        print("[OK] Botón 'Buscar' presionado")
                        sleep(5)
                    else:
                        print("[INFO] No hay botón 'Buscar' - los datos cargan automáticamente al seleccionar candidato")
                        sleep(2)
                except:
                    print("[INFO] Continuando sin botón 'Buscar'")
                    sleep(2)

                # PASO 6.3: Buscar y hacer clic en el icono de Excel del "Libro Contable"
                print("Buscando icono de Excel de 'Libro Contable'...")

                # Scroll completo hacia abajo para ver toda la página
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                sleep(2)

                excel_descargado = False

                # Obtener lista de archivos ANTES de descargar
                archivos_antes = set()
                for ext in ['*.xlsx', '*.xls', '*.csv']:
                    archivos_antes.update(glob.glob(os.path.join(carpeta_base, ext)))

                try:
                    # Tomar screenshot para debugging
                    driver.save_screenshot(f"debug_antes_excel_{cand_idx}.png")

                    # El botón Excel es una imagen <img> con src que contiene "excel.png"
                    # El handler de clic puede estar en el <img> mismo o en un elemento padre
                    excel_btn = None

                    # Estrategia 1: Esperar hasta 15s a que aparezca la imagen de Excel
                    try:
                        excel_btn = WebDriverWait(driver, 15).until(
                            EC.presence_of_element_located((By.XPATH,
                                "//img[contains(@src, 'excel')]"))
                        )
                        print(f"[INFO] Imagen de Excel encontrada con WebDriverWait")
                    except:
                        print("[WARNING] WebDriverWait no encontró la imagen, intentando búsqueda directa...")

                    # Estrategia 2: Buscar directamente con múltiples XPaths
                    if not excel_btn:
                        for xpath in [
                            "//img[contains(@src, 'excel.png')]",
                            "//img[contains(@src, 'sprites/excel')]",
                            "//img[contains(@class, 'btn') and contains(@src, 'excel')]",
                            "//img[contains(@src, 'excel') or contains(@src, 'xls')]",
                        ]:
                            try:
                                excel_btn = driver.find_element(By.XPATH, xpath)
                                print(f"[INFO] Excel encontrado con: {xpath}")
                                break
                            except:
                                pass

                    # Estrategia 3: Buscar por el texto "Libro Contable" y el icono cercano
                    if not excel_btn:
                        try:
                            libro_section = driver.find_element(By.XPATH,
                                "//*[contains(text(), 'Libro Contable')]")
                            for level in range(1, 6):
                                ancestor_xpath = "/".join([".."] * level)
                                try:
                                    parent = libro_section.find_element(By.XPATH, ancestor_xpath)
                                    excel_btn = parent.find_element(By.XPATH,
                                        ".//img[contains(@src, 'excel')]")
                                    print(f"[INFO] Excel encontrado cerca de 'Libro Contable' (nivel {level})")
                                    break
                                except:
                                    pass
                        except:
                            pass

                    # Estrategia 4: Buscar todos los img de Excel
                    if not excel_btn:
                        try:
                            excels = driver.find_elements(By.XPATH,
                                "//img[contains(@src, 'excel') or contains(@src, 'xls')]")
                            if excels:
                                for exc in excels:
                                    try:
                                        parent_text = exc.find_element(By.XPATH, "./ancestor::div[1]").text
                                        if 'Libro' in parent_text or 'Contable' in parent_text:
                                            excel_btn = exc
                                            print("[INFO] Excel de Libro Contable encontrado por contexto")
                                            break
                                    except:
                                        pass
                                if not excel_btn and excels:
                                    excel_btn = excels[0]
                                    print(f"[INFO] Usando primer icono de Excel encontrado ({len(excels)} total)")
                        except:
                            pass

                    if excel_btn:
                        # Obtener info del elemento para debugging
                        try:
                            elem_html = driver.execute_script("return arguments[0].outerHTML;", excel_btn)
                            parent_html = driver.execute_script("return arguments[0].parentElement.outerHTML;", excel_btn)
                        except:
                            pass

                        # Scroll al botón para que sea visible
                        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", excel_btn)
                        sleep(1)

                        # Intento 1: Clic JavaScript en el <img>
                        try:
                            driver.execute_script("arguments[0].click();", excel_btn)
                            print("[OK] Clic en <img> Excel con JavaScript")
                        except Exception as e1:
                            print(f"[WARNING] Clic JS en img falló: {e1}")

                        sleep(2)

                        # Verificar si se inició descarga
                        archivos_check = set()
                        for ext in ['*.xlsx', '*.xls', '*.csv']:
                            archivos_check.update(glob.glob(os.path.join(carpeta_base, ext)))
                        descarga_iniciada = len(archivos_check - archivos_antes) > 0

                        # Si no descargó, intentar clic en el elemento padre
                        if not descarga_iniciada:
                            print("[INFO] No se detectó descarga, intentando clic en elemento padre...")
                            try:
                                parent_elem = driver.execute_script("return arguments[0].parentElement;", excel_btn)
                                if parent_elem:
                                    driver.execute_script("arguments[0].click();", parent_elem)
                                    print("[OK] Clic en elemento padre con JavaScript")
                                    sleep(2)
                            except Exception as e2:
                                print(f"[WARNING] Clic en padre falló: {e2}")

                        # Verificar de nuevo
                        archivos_check2 = set()
                        for ext in ['*.xlsx', '*.xls', '*.csv']:
                            archivos_check2.update(glob.glob(os.path.join(carpeta_base, ext)))
                        descarga_iniciada = len(archivos_check2 - archivos_antes) > 0

                        # Si aún no descargó, intentar disparar todos los eventos
                        if not descarga_iniciada:
                            print("[INFO] No se detectó descarga, intentando disparo de eventos...")
                            try:
                                # Disparar eventos mousedown, mouseup, click en secuencia
                                driver.execute_script("""
                                    var elem = arguments[0];
                                    var events = ['mousedown', 'mouseup', 'click'];
                                    events.forEach(function(eventType) {
                                        var event = new MouseEvent(eventType, {
                                            bubbles: true,
                                            cancelable: true,
                                            view: window
                                        });
                                        elem.dispatchEvent(event);
                                    });
                                """, excel_btn)
                                print("[OK] Eventos dispatched en <img>")
                                sleep(2)
                            except Exception as e3:
                                print(f"[WARNING] Dispatch eventos falló: {e3}")

                        # Verificar de nuevo
                        archivos_check3 = set()
                        for ext in ['*.xlsx', '*.xls', '*.csv']:
                            archivos_check3.update(glob.glob(os.path.join(carpeta_base, ext)))
                        descarga_iniciada = len(archivos_check3 - archivos_antes) > 0

                        # Intento 4: Buscar si hay un ng-click o @click en el elemento o ancestros
                        if not descarga_iniciada:
                            print("[INFO] Buscando handler Angular/Vue en ancestros...")
                            try:
                                # Subir por el DOM buscando elementos con ng-click o v-on:click
                                clickable = driver.execute_script("""
                                    var elem = arguments[0];
                                    for (var i = 0; i < 5; i++) {
                                        if (elem.getAttribute('ng-click') ||
                                            elem.getAttribute('v-on:click') ||
                                            elem.getAttribute('@click') ||
                                            elem.onclick) {
                                            return elem;
                                        }
                                        elem = elem.parentElement;
                                        if (!elem) break;
                                    }
                                    return null;
                                """, excel_btn)
                                if clickable:
                                    driver.execute_script("arguments[0].click();", clickable)
                                    print("[OK] Clic en ancestro con handler de click")
                                    sleep(2)
                                else:
                                    print("[INFO] No se encontró handler en ancestros")
                            except Exception as e4:
                                print(f"[WARNING] Búsqueda de handler falló: {e4}")

                        # Intento 5: Usar ActionChains para simular clic real del mouse
                        archivos_check4 = set()
                        for ext in ['*.xlsx', '*.xls', '*.csv']:
                            archivos_check4.update(glob.glob(os.path.join(carpeta_base, ext)))
                        descarga_iniciada = len(archivos_check4 - archivos_antes) > 0

                        if not descarga_iniciada:
                            print("[INFO] Intentando ActionChains (clic real de mouse)...")
                            try:
                                from selenium.webdriver.common.action_chains import ActionChains
                                actions = ActionChains(driver)
                                actions.move_to_element(excel_btn).click().perform()
                                print("[OK] Clic con ActionChains")
                                sleep(2)
                            except Exception as e5:
                                print(f"[WARNING] ActionChains falló: {e5}")

                        # Esperar descarga final
                        print("Esperando descarga del Excel...")
                        sleep(3)

                        # Verificar que se descargó un archivo nuevo
                        archivos_despues = set()
                        for ext in ['*.xlsx', '*.xls', '*.csv']:
                            archivos_despues.update(glob.glob(os.path.join(carpeta_base, ext)))

                        archivos_nuevos = archivos_despues - archivos_antes

                        # Si no encontró inmediatamente, esperar un poco más
                        intentos = 0
                        while not archivos_nuevos and intentos < 20:
                            sleep(1)
                            archivos_despues = set()
                            for ext in ['*.xlsx', '*.xls', '*.csv']:
                                archivos_despues.update(glob.glob(os.path.join(carpeta_base, ext)))
                            archivos_nuevos = archivos_despues - archivos_antes
                            intentos += 1

                        if archivos_nuevos:
                            archivo_descargado = list(archivos_nuevos)[0]
                            print(f"[OK] Excel descargado: {os.path.basename(archivo_descargado)}")

                            # Esperar descarga completa del archivo específico
                            esperar_archivo_especifico(archivo_descargado, timeout=30)

                            # Mover a carpeta excel/nombre_candidato/
                            try:
                                nombre_limpio = limpiar_nombre_archivo(nombre_candidato)
                                carpeta_candidato = os.path.join(carpeta_base, "excel", nombre_limpio)

                                if not os.path.exists(carpeta_candidato):
                                    os.makedirs(carpeta_candidato)

                                # Nombre: Libro_Contable_Candidato.xlsx
                                extension = os.path.splitext(archivo_descargado)[1]
                                nuevo_nombre = f"Libro_Contable_{nombre_limpio}{extension}"
                                destino = os.path.join(carpeta_candidato, nuevo_nombre)

                                resultado = mover_sin_duplicar(archivo_descargado, destino)
                                if resultado:
                                    print(f"[OK] Movido -> excel/{nombre_limpio}/{os.path.basename(resultado)}")
                                else:
                                    print(f"[SKIP] Libro contable identico ya existe en destino")
                                excel_descargado = True
                            except Exception as e:
                                print(f"[ERROR] Error moviendo Excel: {e}")
                        else:
                            print("[WARNING] No se detectó archivo Excel descargado después de todos los intentos")
                            driver.save_screenshot(f"debug_no_descarga_excel_{cand_idx}.png")
                    else:
                        print("[WARNING] No se encontró el icono de Excel en la página")
                        # Imprimir todos los <img> de la página para debugging
                        try:
                            all_imgs = driver.find_elements(By.TAG_NAME, "img")
                            for img in all_imgs:
                                src = img.get_attribute("src") or ""
                                if src:
                                    print(f"  - {src[:100]}")
                        except:
                            pass
                        driver.save_screenshot(f"debug_no_excel_{cand_idx}.png")

                except Exception as e:
                    print(f"[ERROR] Error descargando Excel: {e}")
                    import traceback
                    traceback.print_exc()

                if excel_descargado:
                    print(f"\n[OK] Libro Contable descargado para: {nombre_candidato}")
                else:
                    print(f"\n[WARNING] No se pudo descargar Libro Contable para: {nombre_candidato}")

            except Exception as e:
                print(f"[ERROR] Error procesando candidato {nombre_candidato}: {e}")
                import traceback
                traceback.print_exc()
                continue

        print(f"\n{'='*80}")
        print(f"PROCESO COMPLETADO PARA: {organizacion}")
        print(f"{'='*80}\n")

    except Exception as e:
        print(f"Error general: {e}")
        import traceback
        traceback.print_exc()

    finally:
        sleep(2)
        driver.quit()


if __name__ == "__main__":
    from credenciales import USUARIO_CNE, PASSWORD_CNE

    descargar_libro_contable_organizacion(
        usuario_cne=USUARIO_CNE,
        password_cne=PASSWORD_CNE,
        proceso_electoral="ELECCIONES TERRITORIALES 2023",
        corporacion="Alcaldia_fun",
        circunscripcion="Municipal",
        departamento="Caldas",
        municipio="Manizales",
        tipo_organizacion="Or",
        organizacion="PARTIDO COLOMBIA RENACIENTE",
        carpeta_base=r"C:\CNE_Descargas\ALCALDIA_Caldas_Manizales_PARTIDO_COLOMBIA_RENACIENTE"
    )
