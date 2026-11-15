@echo off
chcp 65001 >nul
rem Windows起動時に自動で動くデスクトップを開始（スタートアップにショートカットを作成）
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\MovingDesktop.lnk');$s.TargetPath='%~dp0start.bat';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"
echo スタートアップに登録しました。
pause
