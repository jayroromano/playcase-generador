@echo off
title Playcase - Generador de disenos
cd /d "%~dp0"
echo Iniciando Playcase...
start "" http://localhost:4173/
node servidor.js
pause
