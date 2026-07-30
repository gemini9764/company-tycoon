#!/bin/sh
# 더블클릭하면 src/ 를 묶어 dist/company-tycoon.html 을 만든다.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 가 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요."
  printf "\n엔터를 누르면 닫힙니다... "
  read -r _
  exit 1
fi

node tools/launch.mjs build
