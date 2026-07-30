#!/bin/sh
# 더블클릭하면 개발 서버를 띄우고 브라우저를 연다.
# ES 모듈은 file:// 에서 막히므로 index.html 을 직접 열면 동작하지 않는다.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 가 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요."
  printf "\n엔터를 누르면 닫힙니다... "
  read -r _
  exit 1
fi

node tools/launch.mjs dev --port=5173
