from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from time import sleep
from config import crear_driver, mover_sin_duplicar, deduplicar_carpeta
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

def descargar_dictamen_organizacion(
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
    Descarga el dictamen del auditor para una organización.

    Esta función:
    1. Navega a "Gestionar Dictamen Auditor"
    2. Configura todos los filtros de la organización
    3. Descarga el archivo del dictamen
    4. Lo organiza en: carpeta_base/Dictamen/

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

            # PASO 3: Navegar a "Gestionar Dictamen Auditor"
            print("Navegando a Gestionar Dictamen Auditor...")
            try:
                # Primero hacer clic en el menú "Gestionar Registro Electoral"
                registro_menu = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//a[contains(., 'Gestionar Registro Electoral')]")
                ))
                registro_menu.click()
                sleep(0.5)

                # Luego hacer clic en "Gestionar Dictamen Auditor"
                dictamen_link = wait.until(EC.element_to_be_clickable(
                    (By.XPATH, "//a[contains(., 'Gestionar Dictamen Auditor')]")
                ))
                dictamen_link.click()
                sleep(2)
                print("Página de Gestionar Dictamen Auditor cargada")
                break  # Navegacion exitosa
            except Exception as e:
                print(f"Error navegando a Gestionar Dictamen Auditor: {e}")
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

        # Mapeo de campos a IDs de Vue Select
        campo_a_id = {
            "Proceso Electoral": "vs6__combobox",
            "Corporación": "vs7__combobox",
            "Circunscripción": "vs8__combobox",
            "Departamento": "vs9__combobox",
            "Municipio": "vs10__combobox",
            "Tipo de organización política": "vs11__combobox",
            "Nombre organización": "vs12__combobox"
        }

        # Función helper MEJORADA para seleccionar en Vue Select
        def seleccionar_vueselect(label_texto, valor, esperar=0.5):
            """
            Helper para seleccionar en Vue Select con reintentos automáticos.
            """
            for _int in range(3):
                try:
                    print(f"Seleccionando '{label_texto}': '{valor}'")

                    vs_id = campo_a_id.get(label_texto)
                    if not vs_id:
                        print(f"[ERROR] Campo '{label_texto}' no está en el mapeo de IDs")
                        return False

                    vue_select = driver.find_element(By.ID, vs_id)
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", vue_select)
                    sleep(0.5)

                    try:
                        dropdown_toggle = vue_select.find_element(By.CLASS_NAME, "vs__dropdown-toggle")
                    except:
                        dropdown_toggle = vue_select

                    driver.execute_script("arguments[0].click();", dropdown_toggle)
                    sleep(0.8)

                    listbox_id = vs_id.replace("__combobox", "__listbox")
                    opciones = driver.find_elements(By.XPATH, f"//ul[@id='{listbox_id}']//li")
                    if not opciones:
                        opciones = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")

                    # Esperar hasta 3s si no hay opciones validas
                    opciones_validas = [o for o in opciones if o.text.strip() and "Sorry, no matching" not in o.text]
                    if not opciones_validas:
                        for _ in range(6):
                            sleep(0.5)
                            todas = driver.find_elements(By.XPATH, "//ul[@role='listbox']//li")
                            opciones_validas = [o for o in todas if o.text.strip() and "Sorry, no matching" not in o.text]
                            if opciones_validas:
                                break

                    if not opciones_validas:
                        print(f"[RETRY {_int+1}] Sin opciones para '{valor}'")
                        sleep(1)
                        continue

                    print(f"Opciones encontradas: {len(opciones_validas)}")

                    opcion_correcta = None
                    for opcion in opciones_validas:
                        if opcion.text.strip().upper() == valor.upper():
                            opcion_correcta = opcion
                            break
                    if not opcion_correcta:
                        for opcion in opciones_validas:
                            if valor.upper() in opcion.text.strip().upper() or opcion.text.strip().upper() in valor.upper():
                                opcion_correcta = opcion
                                break

                    if not opcion_correcta:
                        print(f"[RETRY {_int+1}] No se encontró opción para: '{valor}'")
                        sleep(1)
                        continue

                    driver.execute_script("arguments[0].scrollIntoView({block: 'nearest'});", opcion_correcta)
                    sleep(0.2)
                    try:
                        opcion_correcta.click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", opcion_correcta)
                    print(f"[OK] Seleccionado: {opcion_correcta.text.strip()}")
                    sleep(esperar)
                    return True

                except Exception as e:
                    if _int < 2:
                        print(f"[RETRY {_int+1}] Error en '{label_texto}': {e}")
                        sleep(1)
                    else:
                        print(f"[ERROR] No se pudo seleccionar '{label_texto}': {e}")
                        return False
            return False

        # 1. Proceso Electoral
        print("1. Seleccionando Proceso Electoral...")
        if not seleccionar_vueselect("Proceso Electoral", proceso_electoral, 0.5):
            print("[INFO] No se pudo seleccionar Proceso Electoral (puede estar ya seleccionado)")
        sleep(1)

        # 2. Corporación
        print("2. Seleccionando Corporación...")
        if not seleccionar_vueselect("Corporación", corporacion, 0.5):
            raise Exception("Error seleccionando corporación")

        # 3. Circunscripción
        print("3. Seleccionando Circunscripción...")
        if not seleccionar_vueselect("Circunscripción", circunscripcion, 0.5):
            raise Exception("Error seleccionando circunscripción")

        # 4. Departamento
        print("4. Seleccionando Departamento...")
        if not seleccionar_vueselect("Departamento", departamento, 0.5):
            raise Exception("Error seleccionando departamento")

        # 5. Municipio (si aplica)
        if municipio and municipio.strip():
            print("5. Seleccionando Municipio...")
            if not seleccionar_vueselect("Municipio", municipio, 0.5):
                raise Exception("Error seleccionando municipio")

        # 6. Tipo de Organización
        print("6. Seleccionando Tipo de Organización...")
        if not seleccionar_vueselect("Tipo de organización política", tipo_organizacion, 0.5):
            raise Exception("Error seleccionando tipo de organización")

        # 7. Organización
        print("7. Seleccionando Organización...")
        if not seleccionar_vueselect("Nombre organización", organizacion, 0.5):
            raise Exception("Error seleccionando organización")

        # PASO 5: Hacer clic en el botón "Buscar"
        print(f"\n{'='*80}")
        print("BUSCANDO DICTAMEN")
        print(f"{'='*80}\n")

        sleep(2)

        try:
            # Buscar botón "Buscar"
            buscar_btn = None

            # Estrategia 1: Botón con icono de búsqueda
            try:
                buscar_btn = driver.find_element(By.XPATH, "//button[contains(@class, 'btn') and .//i[contains(@class, 'fa-search')]]")
                driver.execute_script("arguments[0].scrollIntoView(true);", buscar_btn)
                sleep(0.5)
                driver.execute_script("arguments[0].click();", buscar_btn)
                print("[OK] Botón 'Buscar' presionado")
            except:
                pass

            # Estrategia 2: Botón azul con texto "Buscar"
            if not buscar_btn:
                try:
                    buscar_btn = driver.find_element(By.XPATH, "//button[contains(@class, 'btn-primary') or contains(@class, 'btn-info')][contains(., 'Buscar')]")
                    driver.execute_script("arguments[0].scrollIntoView(true);", buscar_btn)
                    sleep(0.5)
                    driver.execute_script("arguments[0].click();", buscar_btn)
                    print("[OK] Botón azul 'Buscar' presionado")
                except:
                    pass

            # Esperar a que se ejecute la búsqueda
            print("Esperando a que se ejecute la búsqueda...")
            sleep(4)

        except Exception as e:
            print(f"[ERROR] Error con botón 'Buscar': {e}")
            return

        # PASO 6: DESCARGAR EL DICTAMEN
        print(f"\n{'='*80}")
        print("DESCARGANDO DICTAMEN")
        print(f"{'='*80}\n")

        sleep(2)

        try:
            # Hacer scroll para ver los botones de descarga
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            sleep(1)

            # Buscar botón de descarga del dictamen
            # Puede ser un botón PDF o un botón de descarga específico
            driver.save_screenshot(os.path.join(carpeta_base, "debug_antes_dictamen.png"))

            # Intentar encontrar el botón de descarga
            download_btn = None

            # Estrategia 1: Botón PDF
            try:
                download_btn = driver.find_element(By.XPATH, "//button[.//i[contains(@class, 'fa-file-pdf-o')]]")
            except:
                pass

            # Estrategia 2: Botón con icono de descarga
            if not download_btn:
                try:
                    download_btn = driver.find_element(By.XPATH, "//button[.//i[contains(@class, 'fa-download')]]")
                except:
                    pass

            # Estrategia 3: Botón con texto "Descargar"
            if not download_btn:
                try:
                    download_btn = driver.find_element(By.XPATH, "//button[contains(text(), 'Descargar')]")
                except:
                    pass

            if download_btn:
                driver.execute_script("arguments[0].scrollIntoView(true);", download_btn)
                sleep(0.5)

                try:
                    download_btn.click()
                except Exception as e:
                    driver.execute_script("arguments[0].click();", download_btn)

                sleep(5)
                print(f"[OK] Dictamen descargado")

                # Verificar si el archivo se descargó
                archivos_nuevos = glob.glob(os.path.join(carpeta_base, "*"))
            else:
                print("[ERROR] No se encontró botón de descarga del dictamen")
                driver.save_screenshot(os.path.join(carpeta_base, "error_no_boton_dictamen.png"))
                return

        except Exception as e:
            print(f"[ERROR] Error descargando dictamen: {e}")
            import traceback
            traceback.print_exc()
            driver.save_screenshot(os.path.join(carpeta_base, "error_dictamen.png"))
            return

        # PASO 7: ORGANIZAR EL DICTAMEN
        print(f"\nOrganizando dictamen...")

        sleep(5)  # Esperar a que termine la descarga

        # Buscar archivos descargados (PDFs u otros formatos)
        archivos_en_base = []
        for ext in ["*.pdf", "*.zip", "*.rar", "*.xlsx", "*.xls", "*.doc", "*.docx"]:
            archivos_en_base.extend(glob.glob(os.path.join(carpeta_base, ext)))

        if not archivos_en_base:
            print(f"[WARNING] No se encontró archivo descargado")
        else:
            print(f"[INFO] Se encontró {len(archivos_en_base)} archivo(s) descargado(s)")

            # Ordenar por fecha de modificación (más recientes primero)
            archivos_en_base.sort(key=os.path.getmtime, reverse=True)

            # Crear carpeta Dictamen
            carpeta_dictamen = os.path.join(carpeta_base, "Dictamen")
            if not os.path.exists(carpeta_dictamen):
                os.makedirs(carpeta_dictamen)

            # Mover el archivo más reciente
            archivo_path = archivos_en_base[0]
            nombre_archivo_original = os.path.basename(archivo_path)
            extension = os.path.splitext(nombre_archivo_original)[1]

            # Crear nuevo nombre
            org_limpia = limpiar_nombre_archivo(organizacion)
            nuevo_nombre = f"Dictamen_{org_limpia}{extension}"

            destino = os.path.join(carpeta_dictamen, nuevo_nombre)

            resultado = mover_sin_duplicar(archivo_path, destino)
            if resultado:
                print(f"[OK] {nombre_archivo_original} -> Dictamen/{os.path.basename(resultado)}")
            else:
                print(f"[SKIP] Dictamen identico ya existe en destino")

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
    # Ejemplo de uso
    from credenciales import USUARIO_CNE, PASSWORD_CNE

    descargar_dictamen_organizacion(
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
