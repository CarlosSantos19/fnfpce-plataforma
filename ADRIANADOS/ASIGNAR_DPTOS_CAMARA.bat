@echo off
title Asignar Departamentos CAMARA 2026
cd /d "%~dp0"
echo.
echo ================================================================
echo   ASIGNAR DEPARTAMENTOS - CAMARA DE REPRESENTANTES 2026
echo   Cruza nombres con datos locales — no necesita conexion CNE
echo ================================================================
echo.
py -X utf8 asignar_dptos_camara.py
echo.
if %errorlevel%==0 (
    echo   COMPLETADO - ahora ejecuta: firebase deploy --only hosting
) else (
    echo   ERROR - revisa los mensajes arriba
)
echo.
pause
