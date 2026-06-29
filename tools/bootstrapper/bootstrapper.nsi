; ============================================================
; Recepcion-de-Pedidos-Web-Installer.nsi
; Bootstrapper liviano: descarga latest.json desde Firebase
; Storage, verifica SHA256 y ejecuta el instalador completo.
; Compilar con: makensis.exe bootstrapper.nsi
; ============================================================

!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "Recepci${U+00F3}n de Pedidos"
OutFile "Recepcion-de-Pedidos-Web-Installer.exe"
RequestExecutionLevel user
ShowInstDetails show
SetCompressor /SOLID lzma

; ---- URL de latest.json (Firebase Storage, lectura pública) ---
!define LATEST_URL "https://firebasestorage.googleapis.com/v0/b/achava3703.firebasestorage.app/o/instalaciones%2Fsoftware%2Flatest.json?alt=media"

; ---- Páginas ------------------------------------------------
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

; ---- Sección principal --------------------------------------
Section "Descargar e instalar"
  SetDetailsPrint both
  DetailPrint "Iniciando descarga de Recepci${U+00F3}n de Pedidos..."

  ; Escribir el script PowerShell en disco usando $TEMP (NSIS variable, double-quoted)
  FileOpen $R0 "$TEMP\rdp-bootstrap.ps1" w
  FileWrite $R0 '[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12$\r$\n'
  FileWrite $R0 '$ErrorActionPreference = "Stop"$\r$\n'
  FileWrite $R0 '$ProgressPreference = "SilentlyContinue"$\r$\n'
  FileWrite $R0 'try {$\r$\n'
  FileWrite $R0 '    $info = Invoke-RestMethod -Uri "${LATEST_URL}" -UseBasicParsing$\r$\n'
  FileWrite $R0 '    if (-not $info.installerUrl) { throw "latest.json no contiene installerUrl" }$\r$\n'
  FileWrite $R0 '    Write-Host ("Descargando version " + $info.latest + " (~114 MB), por favor espera...")$\r$\n'
  FileWrite $R0 '    $dest = Join-Path $env:TEMP "rdp-setup.exe"$\r$\n'
  FileWrite $R0 '    Invoke-WebRequest -Uri $info.installerUrl -OutFile $dest -UseBasicParsing$\r$\n'
  FileWrite $R0 '    if ($info.sha256) {$\r$\n'
  FileWrite $R0 '        $hash = (Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToUpper()$\r$\n'
  FileWrite $R0 '        $expected = $info.sha256.ToUpper()$\r$\n'
  FileWrite $R0 '        if ($hash -ne $expected) {$\r$\n'
  FileWrite $R0 '            Remove-Item -Path $dest -Force -ErrorAction SilentlyContinue$\r$\n'
  FileWrite $R0 '            throw "Error de integridad: SHA256 no coincide."$\r$\n'
  FileWrite $R0 '        }$\r$\n'
  FileWrite $R0 '        Write-Host "SHA256 verificado OK."$\r$\n'
  FileWrite $R0 '    }$\r$\n'
  FileWrite $R0 '    Start-Process -FilePath $dest$\r$\n'
  FileWrite $R0 '    exit 0$\r$\n'
  FileWrite $R0 '} catch {$\r$\n'
  FileWrite $R0 '    Write-Error $_.Exception.Message$\r$\n'
  FileWrite $R0 '    exit 1$\r$\n'
  FileWrite $R0 '}$\r$\n'
  FileClose $R0

  DetailPrint "Conectando con el servidor..."

  ; Ejecutar el script PowerShell — double-quoted para que $TEMP sea resuelto por NSIS
  nsExec::ExecToStack "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $\"$TEMP\rdp-bootstrap.ps1$\""
  Pop $0   ; código de salida
  Pop $1   ; salida del proceso

  ; Limpiar script temporal siempre
  Delete "$TEMP\rdp-bootstrap.ps1"

  ${If} $0 != 0
    DetailPrint "Error: $1"
    MessageBox MB_OK|MB_ICONSTOP \
      "No se pudo completar la instalaci${U+00F3}n.$\n$\n\
Verific${U+00E1} tu conexi${U+00F3}n a internet e intent${U+00E1} de nuevo.$\n$\n\
Detalle: $1"
    Abort
  ${EndIf}

  DetailPrint "Instalaci${U+00F3}n iniciada correctamente. Pod${U+00E9}s cerrar esta ventana."
SectionEnd
