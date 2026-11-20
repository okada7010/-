@echo off
rem AI使用量コレクターを終了（1秒以内に止まります）
type nul > "%~dp0stop_collector.flag"
