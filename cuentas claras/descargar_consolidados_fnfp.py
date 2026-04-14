from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from time import sleep
from config import crear_driver, esperar_descarga_completa, esperar_archivo_especifico, mover_sin_duplicar, deduplicar_carpeta
import config
import os
import shutil
import glob
import time
import re

def _normalizar(nombre):
    """Normaliza nombre para comparación: quita guiones, comas, paréntesis y espacios extra"""
    s = nombre.upper().strip()
    s = re.sub(r'[\-\.\,\(\)]', ' ', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()

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
        sleep(3)

        # Verificar si el login fue exitoso
        try:
            # Intentar verificar si llegamos al dashboard o página principal
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
        import traceback
        traceback.print_exc()
        driver.save_screenshot("error_login_excepcion.png")
        return False

def descargar_consolidados_organizacion(
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
    Descarga los reportes CONSOLIDADOS (Ingresos, Gastos y Obligaciones) de una organización.

    Esta función:
    1. Navega a "Reporte De Ingresos Y Gastos De Campaña"
    2. Configura todos los filtros de la organización
    3. Descarga los 3 tipos de consolidados:
       - CONSOLIDADOS (general)
       - INGRESOS
       - GASTOS (que incluye Obligaciones)
    4. Organiza los PDFs en:
       carpeta_base/Consolidados/Ingresos/
       carpeta_base/Consolidados/Gastos/
       carpeta_base/Consolidados/Consolidados/

    Parámetros:
    - carpeta_base: Carpeta base de la organización
    """
    import os

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
                # Primero hacer clic en el menú "Registro De Ingresos"
                registro_menu = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//a[contains(., 'Registro De Ingresos')]")
                ))
                registro_menu.click()
                sleep(0.5)

                # Luego hacer clic en "Reporte De Ingresos Y Gastos De Campaña"
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

        # PASO 4: Configurar TODOS los filtros
        print(f"\n{'='*80}")
        print(f"CONFIGURANDO FILTROS PARA: {organizacion}")
        print(f"{'='*80}\n")

        # Helper MEJORADO para seleccionar en Vue Select
        # ESTRATEGIA: NO escribir el valor completo (evita "Sorry, no matching options")
        def seleccionar_exacto(placeholder_texto, valor, esperar=0.5):
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

        # 1. Proceso Electoral
        print("1. Seleccionando Proceso Electoral...")
        seleccionar_exacto("Seleccione Proceso Electoral", proceso_electoral, 0.5)

        # 2. Corporación
        print("2. Seleccionando Corporación...")
        try:
            inputs = driver.find_elements(By.XPATH, "//input[@placeholder='Seleccione...']")
            if len(inputs) > 0:
                inputs[0].click()
                sleep(0.3)
                inputs[0].clear()

                # ESTRATEGIA MEJORADA: Escribir solo primeros 2 caracteres
                if len(corporacion) > 2:
                    inputs[0].send_keys(corporacion[:2])
                else:
                    inputs[0].send_keys(corporacion)

                sleep(0.8)

                # Buscar coincidencia exacta
                opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                # Verificar error
                if len(opciones) == 1 and "Sorry, no matching options" in opciones[0].text:
                    print(f"[ERROR] No se encontraron opciones para '{corporacion}'")
                else:
                    # Buscar coincidencia exacta
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
                        from selenium.webdriver.common.keys import Keys
                        inputs[0].send_keys(Keys.ENTER)
                        print(f"[OK] Seleccionado con ENTER")

                sleep(0.5)
        except Exception as e:
            print(f"[ERROR]: {e}")

        # 3. Circunscripción
        print(f"3. Seleccionando Circunscripción: {circunscripcion}...")
        sleep(0.5)
        seleccionar_exacto("Seleccione...", circunscripcion, 0.5)

        # 4. Departamento
        print("4. Seleccionando Departamento...")
        sleep(0.5)
        seleccionar_exacto("Seleccione...", departamento, 0.5)

        # 5. Municipio
        if municipio and municipio.strip():
            print("5. Seleccionando Municipio...")
            sleep(0.5)
            seleccionar_exacto("Seleccione...", municipio, 0.5)

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

                # ESTRATEGIA MEJORADA: Escribir solo primeros 2 caracteres
                if len(tipo_organizacion) > 2:
                    tipo_org_input.send_keys(tipo_organizacion[:2])
                else:
                    tipo_org_input.send_keys(tipo_organizacion)

                sleep(0.8)

                # Buscar opciones
                opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                # Verificar error
                if len(opciones) == 1 and "Sorry, no matching options" in opciones[0].text:
                    print(f"[ERROR] No se encontraron opciones para '{tipo_organizacion}'")
                else:
                    # Buscar coincidencia exacta
                    encontrado = False
                    for opt in opciones:
                        if "Sorry, no matching options" in opt.text:
                            continue
                        if opt.text.strip().upper() == tipo_organizacion.upper():
                            driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", opt)
                            sleep(0.2)
                            opt.click()
                            print(f"[OK] Seleccionado: {tipo_organizacion}")
                            encontrado = True
                            break

                    if not encontrado:
                        from selenium.webdriver.common.keys import Keys
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
                    # Buscar campo de Organización pero NO "Tipo de Organización"
                    if ("Seleccione la Organizacion" in parent_text or "Organización" in parent_text) and "Tipo" not in parent_text:
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
                org_norm = _normalizar(organizacion)
                for opt in opciones:
                    if "Sorry" in opt.text:
                        continue
                    opt_upper = opt.text.strip().upper()
                    opt_norm = _normalizar(opt.text)
                    if (opt_upper == org_upper or org_upper in opt_upper or opt_upper in org_upper
                            or opt_norm == org_norm or org_norm in opt_norm or opt_norm in org_norm):
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
                    from selenium.webdriver.common.keys import Keys
                    org_input.send_keys(Keys.ESCAPE)

                sleep(0.5)
        except Exception as e:
            print(f"[ERROR]: {e}")
            import traceback
            traceback.print_exc()

        # PASO 4.5: OBTENER LISTA DE CANDIDATOS
        print(f"\n{'='*80}")
        print("OBTENIENDO LISTA DE CANDIDATOS")
        print(f"{'='*80}\n")

        sleep(1)

        candidatos_lista = []

        try:
            # Buscar el dropdown de candidatos
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
                # Abrir dropdown
                cand_input.click()
                sleep(0.5)

                # Obtener todas las opciones usando aria-controls para apuntar al listbox correcto
                cand_listbox_id = cand_input.get_attribute("aria-controls") or ""
                if cand_listbox_id:
                    opciones = driver.find_elements(By.XPATH, f"//ul[@id='{cand_listbox_id}']//li")
                else:
                    opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                print(f"Candidatos disponibles:")
                for idx, opt in enumerate(opciones, 1):
                    nombre_candidato = opt.text.strip()
                    if nombre_candidato and nombre_candidato != "Sorry, no matching options.":
                        candidatos_lista.append(nombre_candidato)
                        print(f"  {idx}. {nombre_candidato}")

                print(f"\nTotal: {len(candidatos_lista)} candidatos encontrados\n")

                if not candidatos_lista:
                    print("[WARNING] No se encontraron candidatos para esta organización")
                    return
            else:
                print("[ERROR] No se encontró el dropdown de candidatos")
                return

        except Exception as e:
            print(f"[ERROR] Error obteniendo candidatos: {e}")
            import traceback
            traceback.print_exc()
            return

        # PASO 5: ITERAR POR CADA CANDIDATO Y DESCARGAR SUS CONSOLIDADOS
        print(f"\n{'='*80}")
        print(f"INICIANDO DESCARGA DE CONSOLIDADOS PARA {len(candidatos_lista)} CANDIDATOS")
        print(f"{'='*80}\n")

        for cand_idx, nombre_candidato in enumerate(candidatos_lista, 1):
            print(f"\n{'#'*80}")
            print(f"CANDIDATO {cand_idx}/{len(candidatos_lista)}: {nombre_candidato}")
            print(f"{'#'*80}\n")

            try:
                # PASO 5.1: Seleccionar el candidato
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
                    # Limpiar selección anterior del dropdown de candidatos (para 2do+ candidato)
                    # En Vue Select, si hay un valor seleccionado, el dropdown pre-filtra al abrirse
                    # El botón vs__clear (la X) resetea la selección y permite ver todos los candidatos
                    try:
                        cand_parent = cand_input.find_element(By.XPATH, "../../..")
                        clear_btn = cand_parent.find_element(By.XPATH, ".//button[@type='button']")
                        driver.execute_script("arguments[0].click();", clear_btn)
                        sleep(0.3)
                        print(f"[INFO] Selección anterior limpiada")
                    except Exception:
                        pass  # Sin botón X = nada seleccionado aún, continuar normal

                    # Estrategias anti "element click intercepted"
                    try:
                        driver.execute_script("document.body.click();")
                        sleep(0.3)
                    except:
                        pass

                    try:
                        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", cand_input)
                        sleep(0.5)
                    except:
                        pass

                    try:
                        driver.execute_script("window.scrollBy(0, -200);")
                        sleep(0.3)
                    except:
                        pass

                    # Intentar click
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

                    # ESTRATEGIA MEJORADA: NO escribir el nombre, sino abrir dropdown y hacer clic directo
                    # Esto evita el error "Sorry, no matching options" por filtrado de Vue.js
                    sleep(0.5)

                    # Obtener opciones del dropdown ya abierto usando aria-controls
                    try:
                        cand_listbox_id2 = cand_input.get_attribute("aria-controls") or ""
                        if cand_listbox_id2:
                            opciones = driver.find_elements(By.XPATH, f"//ul[@id='{cand_listbox_id2}']//li")
                        else:
                            opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                        print(f"Opciones en dropdown candidato: {len(opciones)}")

                        encontrado = False
                        for opt in opciones:
                            texto_opt = opt.text.strip()
                            if "Sorry, no matching options" in texto_opt:
                                continue
                            if texto_opt == nombre_candidato:
                                driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", opt)
                                sleep(0.2)
                                opt.click()
                                print(f"[OK] Candidato seleccionado: {nombre_candidato}")
                                encontrado = True
                                break

                        if not encontrado:
                            print(f"[WARNING] No se encontró el candidato exacto '{nombre_candidato}' en el dropdown")
                            continue

                    except Exception as e:
                        print(f"[ERROR] Error seleccionando candidato: {e}")
                        continue

                    sleep(2)
                    driver.execute_script("window.scrollTo(0, 0);")
                    sleep(0.5)

                else:
                    print(f"[ERROR] No se encontró el input de candidato")
                    continue

                # PASO 5.2: Esperar a que carguen los datos del candidato
                # En este módulo NO hay botón "Buscar", los datos aparecen automáticamente
                print(f"\nEsperando a que carguen los datos del candidato...")
                sleep(5)

                # PASO 5.3: DESCARGAR LOS 4 TIPOS DE CONSOLIDADOS
                print(f"\nDESCARGANDO CONSOLIDADOS PARA: {nombre_candidato}\n")

                # Limpiar nombre del candidato para usar en nombres de archivo
                nombre_cand_limpio = limpiar_nombre_archivo(nombre_candidato)

                # Esperar a que cargue la página con los botones
                sleep(3)

                # Hacer scroll para ver los botones de descarga
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                sleep(1)

                # DESCARGAR LOS 4 CONSOLIDADOS: CONSOLIDADOS, INGRESOS, GASTOS, OBLIGACIONES
                # Cada sección está en su propia pestaña (nav-link)

                pdfs_descargados_este_candidato = []

                def _activar_tab(nombre_tab):
                    """Hace clic en la pestaña por nombre (texto parcial, clase parcial).
                    Retorna True si se pudo activar."""
                    try:
                        # Selector robusto: class contiene nav-link, texto contiene nombre
                        tab = driver.find_element(By.XPATH,
                            f"//a[contains(@class,'nav-link') and contains(normalize-space(text()),'{nombre_tab}')]")
                        driver.execute_script("arguments[0].scrollIntoView(true);", tab)
                        sleep(0.3)
                        driver.execute_script("arguments[0].click();", tab)
                        sleep(2)
                        driver.execute_script("window.scrollTo(0, 0);")
                        sleep(0.5)
                        print(f"[OK] Tab '{nombre_tab}' activado")
                        return True
                    except Exception as ex:
                        print(f"[AVISO] No se encontró tab '{nombre_tab}': {ex}")
                        return False

                def _descargar_pdfs_pestana(nombre_tipo):
                    """Descarga todos los PDFs visibles en la pestaña activa.
                    Retorna cantidad de PDFs descargados."""
                    descargados = 0
                    try:
                        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                        sleep(1)

                        # Buscar botones PDF con múltiples selectores
                        pdf_buttons = []
                        pdf_buttons.extend(driver.find_elements(By.XPATH,
                            "//button[contains(@class,'btn') and contains(@class,'text-danger')][.//i[contains(@class,'fa-file-pdf')]]"))
                        pdf_buttons.extend(driver.find_elements(By.XPATH,
                            "//button[.//i[contains(@class,'pdf')]]"))
                        pdf_buttons.extend(driver.find_elements(By.XPATH,
                            "//a[@download and contains(@href,'.pdf')]"))
                        pdf_buttons.extend(driver.find_elements(By.XPATH,
                            "//button[contains(@title,'PDF') or contains(text(),'PDF')]"))
                        # Deduplicar
                        vistos = []
                        for b in pdf_buttons:
                            if b not in vistos:
                                vistos.append(b)
                        pdf_buttons = vistos

                        print(f"  Botones PDF encontrados en '{nombre_tipo}': {len(pdf_buttons)}")

                        for idx, pdf_button in enumerate(pdf_buttons, 1):
                            try:
                                if not pdf_button.is_displayed():
                                    continue
                                driver.execute_script("arguments[0].scrollIntoView(true);", pdf_button)
                                sleep(0.5)
                                ventanas_antes = driver.window_handles
                                try:
                                    pdf_button.click()
                                except Exception:
                                    driver.execute_script("arguments[0].click();", pdf_button)
                                sleep(2)
                                ventanas_despues = driver.window_handles
                                if len(ventanas_despues) > len(ventanas_antes):
                                    nueva = [v for v in ventanas_despues if v not in ventanas_antes][0]
                                    driver.switch_to.window(nueva)
                                    sleep(1)
                                    pdf_url = driver.current_url
                                    driver.close()
                                    driver.switch_to.window(ventanas_antes[0])
                                    nombre_archivo = f"{nombre_tipo.lower()}_{idx}.pdf"
                                    js_dl = f"""
                                    fetch('{pdf_url}')
                                    .then(r=>r.blob())
                                    .then(b=>{{
                                        const u=window.URL.createObjectURL(b);
                                        const a=document.createElement('a');
                                        a.style.display='none';a.href=u;a.download='{nombre_archivo}';
                                        document.body.appendChild(a);a.click();
                                        window.URL.revokeObjectURL(u);a.remove();
                                    }});
                                    """
                                    driver.execute_script(js_dl)
                                    esperar_descarga_completa(carpeta_base, timeout=60)
                                    sleep(1)
                                else:
                                    esperar_descarga_completa(carpeta_base, timeout=30)
                                    sleep(0.5)
                                descargados += 1
                                pdfs_descargados_este_candidato.append({'tipo': nombre_tipo, 'orden': idx})
                                print(f"  [OK] {nombre_tipo} PDF {idx} descargado")
                            except Exception as e:
                                print(f"  [ERROR] {nombre_tipo} PDF {idx}: {e}")
                    except Exception as e:
                        print(f"[ERROR] _descargar_pdfs_pestana '{nombre_tipo}': {e}")
                        import traceback; traceback.print_exc()
                    print(f"[OK] Total '{nombre_tipo}': {descargados} PDFs")
                    return descargados

                # 1. CONSOLIDADOS
                print("-" * 60)
                print("PROCESANDO: CONSOLIDADOS")
                print("-" * 60)
                _activar_tab("CONSOLIDADOS")
                _descargar_pdfs_pestana("Consolidados")

                # 2. INGRESOS
                print("-" * 60)
                print("PROCESANDO: INGRESOS")
                print("-" * 60)
                _activar_tab("INGRESOS")
                _descargar_pdfs_pestana("Ingresos")

                # 3. GASTOS
                print("-" * 60)
                print("PROCESANDO: GASTOS")
                print("-" * 60)
                _activar_tab("GASTOS")
                _descargar_pdfs_pestana("Gastos")

                # 4. OBLIGACIONES
                print("-" * 60)
                print("PROCESANDO: OBLIGACIONES")
                print("-" * 60)
                _activar_tab("OBLIGACIONES")
                _descargar_pdfs_pestana("Obligaciones")

                # PASO 5.4: ORGANIZAR LOS PDFs DE ESTE CANDIDATO POR CÓDIGO
                print(f"\nOrganizando PDFs de {nombre_candidato} por código...")

                sleep(5)  # Esperar a que todos los PDFs terminen de descargarse

                # Eliminar duplicados exactos en carpeta_base antes de mover
                dups = deduplicar_carpeta(carpeta_base)
                if dups:
                    print(f"[DEDUP] {dups} PDF(s) duplicado(s) eliminado(s) en carpeta base")

                # Buscar todos los PDFs en la carpeta base
                pdfs_en_base = glob.glob(os.path.join(carpeta_base, "*.pdf"))

                if not pdfs_en_base:
                    print(f"[WARNING] No se encontraron PDFs descargados para {nombre_candidato}")
                else:
                    print(f"[INFO] Se encontraron {len(pdfs_en_base)} PDFs descargados")

                    # Ordenar por fecha de modificación (más antiguos primero = orden de descarga)
                    pdfs_en_base.sort(key=os.path.getmtime)

                    # Crear estructura: carpeta_base/Consolidados/nombre_candidato/
                    carpeta_candidato = os.path.join(carpeta_base, "Consolidados", nombre_cand_limpio)
                    if not os.path.exists(carpeta_candidato):
                        os.makedirs(carpeta_candidato)

                    # Mover los PDFs usando el tipo de pestaña como nombre
                    for idx, pdf_path in enumerate(pdfs_en_base):
                        try:
                            nombre_archivo_original = os.path.basename(pdf_path)
                            extension = os.path.splitext(nombre_archivo_original)[1] or ".pdf"

                            # Obtener tipo desde el registro de descargas si está disponible
                            if idx < len(pdfs_descargados_este_candidato):
                                tipo_reporte = pdfs_descargados_este_candidato[idx]['tipo']
                                orden = pdfs_descargados_este_candidato[idx]['orden']
                                nuevo_nombre = f"{tipo_reporte}_{orden}{extension}"
                            else:
                                nuevo_nombre = f"Consolidado_{idx + 1}{extension}"

                            destino = os.path.join(carpeta_candidato, nuevo_nombre)
                            resultado = mover_sin_duplicar(pdf_path, destino)
                            if resultado:
                                print(f"  [OK] {nombre_archivo_original} -> Consolidados/{nombre_cand_limpio}/{os.path.basename(resultado)}")
                            else:
                                print(f"  [SKIP] {nombre_archivo_original} ya existe identico en destino")

                        except Exception as e:
                            print(f"  [ERROR] Error moviendo PDF: {e}")
                            import traceback
                            traceback.print_exc()

                    print(f"\n[OK] Consolidados de {nombre_candidato} organizados por código")

            except Exception as e:
                print(f"[ERROR] Error procesando candidato {nombre_candidato}: {e}")
                import traceback
                traceback.print_exc()
                continue

        print(f"\n{'='*80}")
        print(f"PROCESO COMPLETADO PARA: {organizacion}")
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


if __name__ == "__main__":
    # Ejemplo de uso
    from credenciales import USUARIO_CNE, PASSWORD_CNE

    descargar_consolidados_organizacion(
        usuario_cne=USUARIO_CNE,
        password_cne=PASSWORD_CNE,
        proceso_electoral="ELECCIONES TERRITORIALES 2023",
        corporacion="Alc",
        circunscripcion="Municipal",
        departamento="Boyacá",
        municipio="Turmequé",
        tipo_organizacion="Or",
        organizacion="PARTIDO NUEVO LIBERALISMO",
        carpeta_base=r"C:\CNE_Descargas\ALCALDIA_Boyacá_Turmequé_PARTIDO NUEVO LIBERALISMO"
    )
