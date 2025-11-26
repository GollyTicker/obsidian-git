#!/bin/bash
set -e

# This script is run within the docker container

npm install --ignore-scripts

npm audit || true

if [[ "$1" == "prod" ]]; then
  npm run build
else
  npm run dev
fi
