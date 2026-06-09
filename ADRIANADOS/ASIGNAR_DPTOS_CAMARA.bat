@echo off
title Asignar Departamentos CAMARA 2026
cd /d "%~dp0"
echo.
echo ================================================================
echo   ASIGNAR DEPARTAMENTOS - CAMARA DE REPRESENTANTES 2026
echo   Consulta el CNE por departamento y actualiza el indice
echo ================================================================
echo.
py -X utf8 asignar_dptos_camara.py --usuario 80115895
echo.
if %errorlevel%==0 (
    echo   COMPLETADO - ahora ejecuta: firebase deploy --only hosting
) else (
    echo   ERROR - revisa los mensajes arriba
)
echo.
pause
