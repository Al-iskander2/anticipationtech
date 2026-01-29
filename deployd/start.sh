#!/usr/bin/env bash
set -e

# Aplicar migraciones automáticamente
python manage.py migrate --noinput

# Recolectar archivos estáticos
python manage.py collectstatic --noinput

# Iniciar Gunicorn con el puerto de Render
: "${PORT:=10000}"
: "${WEB_CONCURRENCY:=2}"

exec gunicorn budsi_django.wsgi:application \
  --bind 0.0.0.0:${PORT} \
  --workers ${WEB_CONCURRENCY} \
  --timeout 120