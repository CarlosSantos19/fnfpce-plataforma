from selenium.webdriver.common.by import By
from time import sleep
from config import crear_driver

def descargar_resoluciones(url_busqueda):
    driver = crear_driver()
    driver.get(url_busqueda)
    sleep(2)

    # detectar tabla de resultados
    pdfs = driver.find_elements(By.XPATH, "//a[contains(@href,'pdf')]")

    for pdf in pdfs:
        try:
            pdf.click()
            sleep(1)
        except:
            pass

    driver.quit()


if __name__ == "__main__":
    descargar_resoluciones("https://app.cne.gov.co/usuarios/public/notificaciones")
