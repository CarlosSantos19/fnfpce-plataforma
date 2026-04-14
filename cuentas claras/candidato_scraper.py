from selenium.webdriver.common.by import By
from selenium.webdriver.support.wait import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from time import sleep
from config import crear_driver

def descargar_todo_candidato(id_candidato):
    """
    Descarga TODOS los PDFs disponibles en la ficha del candidato.
    """
    url = f"https://app.cne.gov.co/usuarios/public/candidato/{id_candidato}"

    driver = crear_driver()
    driver.get(url)

    wait = WebDriverWait(driver, 10)

    sleep(2)

    # Selectores que cubren TODOS los PDFs
    selectores = [
        "//a[contains(text(),'PDF')]",
        "//a[contains(text(),'Descargar')]",
        "//a[contains(text(),'Gastos')]",
        "//a[contains(text(),'Ingresos')]",
        "//a[contains(text(),'Dictamen')]",
        "//a[contains(text(),'9B')]",
        "//a[contains(text(),'8B')]",
        "//a[contains(@href,'.pdf')]"
    ]

    pdf_links = set()

    # Capturar todos los enlaces PDF visibles
    for selector in selectores:
        try:
            elementos = driver.find_elements(By.XPATH, selector)
            for el in elementos:
                href = el.get_attribute("href")
                if href and "pdf" in href.lower():
                    pdf_links.add(href)
        except:
            pass

    print(f"Encontrados {len(pdf_links)} documentos PDF… descargando.")

    # Descargar cada archivo
    for pdf_url in pdf_links:
        try:
            driver.get(pdf_url)
            sleep(1.3)
        except:
            pass

    print(f"Descargas completadas del candidato {id_candidato}.")
    driver.quit()
