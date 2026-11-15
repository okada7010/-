@echo off
rem 停止フラグを作成 → 1秒以内に終了して元の壁紙に戻ります
type nul > "%~dp0stop.flag"
