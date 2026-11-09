@echo off
setlocal
cd /d "%~dp0"
set "SMARTSPACE_PYTHON="
for /f "delims=" %%I in ('where python.exe 2^>nul') do set "SMARTSPACE_PYTHON=%%I"
for %%P in ("%USERPROFILE%\anaconda3\envs\hci_project\python.exe" "%USERPROFILE%\miniconda3\envs\hci_project\python.exe" "%LOCALAPPDATA%\anaconda3\envs\hci_project\python.exe" "C:\ProgramData\anaconda3\envs\hci_project\python.exe") do if exist "%%~P" (
  set "SMARTSPACE_PYTHON=%%~P"
  goto run
)
echo Could not find the hci_project Python environment.
echo Expected: %USERPROFILE%\anaconda3\envs\hci_project\python.exe
pause
exit /b 1

:run
rem Include the environment's native DLL directories without requiring conda on PATH.
for %%P in ("%SMARTSPACE_PYTHON%") do set "SMARTSPACE_ENV=%%~dpP"
set "PATH=%SMARTSPACE_ENV%;%SMARTSPACE_ENV%Library\bin;%SMARTSPACE_ENV%Scripts;%PATH%"
echo Using: %SMARTSPACE_PYTHON%
"%SMARTSPACE_PYTHON%" -c "import aiohttp, dollarpy"
if errorlevel 1 (
  echo Required packages are missing. Run:
  echo "%SMARTSPACE_PYTHON%" -m pip install -r requirements.txt
  pause
  exit /b 1
)
if /i "%~1"=="--check" (
  echo SmartSpace startup check passed.
  exit /b 0
)
echo Opening SmartSpace at http://127.0.0.1:8770
echo Keep this window open while using the application.
"%SMARTSPACE_PYTHON%" server.py --port 8770
if errorlevel 1 echo The server stopped with an error. See the message above.
pause
