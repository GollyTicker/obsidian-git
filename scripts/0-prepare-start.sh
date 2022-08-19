#!/bin/bash
set -e

./scripts/stop.sh

docker-compose -f docker/compose.yml build
