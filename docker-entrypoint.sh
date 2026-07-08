#!/bin/sh
set -e

LRR_SERVER_PROTO=${LRR_SERVER_PROTO:-http}
LRR_SERVER_HOST=${LRR_SERVER_HOST:-host.docker.internal}
LRR_SERVER_PORT=${LRR_SERVER_PORT:-3000}
LRR_SERVER=${LRR_SERVER:-${LRR_SERVER_PROTO}://${LRR_SERVER_HOST}:${LRR_SERVER_PORT}}
export LRR_SERVER
NGINX_PORT=${NGINX_PORT:-80}
export NGINX_PORT

envsubst '${LRR_SERVER},${NGINX_PORT}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[docker-entrypoint] LRR_SERVER=$LRR_SERVER NGINX_PORT=$NGINX_PORT"
exec nginx -g 'daemon off;'
