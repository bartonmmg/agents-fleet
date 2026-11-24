@echo off
title Fleet Studio
cd /d "%~dp0"
where node >nul 2>nul || (echo No se encontro Node.js. Instalalo desde https://nodejs.org y volve a intentar. & pause & exit /b 1)
node bin\fleet.mjs studio
if errorlevel 1 pause
