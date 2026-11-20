@echo off
chcp 65001 >nul
rem Windows起動時にAI使用量コレクターを自動起動（スタートアップにショートカットを作成）
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\AIUsageCollector.lnk');$s.TargetPath='%~dp0ai_usage_start.bat';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"
echo スタートアップに登録しました。
pause
