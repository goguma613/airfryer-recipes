@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo    에어프라이기 레시피 보관함  -  자동 배포
echo ============================================
echo.

REM --- git 설치 확인 ---
where git >nul 2>&1
if errorlevel 1 (
  echo [오류] git이 설치되어 있지 않습니다.
  echo        https://git-scm.com 에서 설치한 뒤 다시 실행하세요.
  goto :end
)

REM --- git 저장소 확인 ---
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [오류] 이 폴더는 git 저장소가 아닙니다.
  goto :end
)

REM --- 변경사항 모두 스테이징 ---
git add -A

REM --- 올릴 변경이 있는지 확인 ---
git diff --cached --quiet
if not errorlevel 1 (
  echo 변경된 내용이 없습니다. 배포할 것이 없어요.
  goto :end
)

echo 올릴 파일 목록:
git -c core.quotepath=false diff --cached --name-only
echo.

REM --- 커밋 메시지: 실행 시 인자로 주면 그걸, 없으면 날짜·시각 자동 ---
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set "STAMP=%%i"
set "MSG=%~1"
if "%MSG%"=="" set "MSG=deploy %STAMP%"

echo 커밋: %MSG%
git commit -m "%MSG%"
if errorlevel 1 (
  echo [오류] 커밋에 실패했습니다.
  goto :end
)

echo.
echo GitHub에 올리는 중... 처음 한 번은 로그인 창이 뜰 수 있어요.
git push
if errorlevel 1 (
  echo.
  echo [오류] 깃허브 업로드에 실패했습니다.
  echo        인터넷 연결 또는 git 로그인 상태를 확인한 뒤 다시 실행하세요.
  goto :end
)

echo.
echo ============================================
echo   배포 완료!  1~2분 뒤 사이트에 반영됩니다.
echo   https://goguma613.github.io/airfryer-recipes/
echo ============================================

:end
echo.
pause
endlocal
