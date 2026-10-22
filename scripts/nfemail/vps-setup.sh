#!/usr/bin/env bash
# Instala e agenda a importação automática de NFs na VPS (Ubuntu/Debian). Rode como root ou com sudo, dentro desta pasta:
#   sudo bash vps-setup.sh
# O login do NFeMail usa reCAPTCHA e precisa de um Chrome "de verdade": roda com tela virtual (xvfb), sem interface.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
apt-get update -y
apt-get install -y curl unzip xvfb ca-certificates fonts-liberation wget
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs; }
if ! command -v google-chrome >/dev/null; then
  wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/chrome.deb
fi
cd "$DIR"
npm install --omit=dev --no-audit --no-fund
[ -f .env.local ] || { cp env.example .env.local; chmod 600 .env.local; echo ">> Preencha $DIR/.env.local e rode de novo."; exit 0; }
# 08:00 e 14:00 (horário de Brasília): ajuste o fuso da VPS com 'timedatectl set-timezone America/Sao_Paulo'
CRON="0 8,14 * * * cd $DIR && xvfb-run -a node sincronizar.mjs >> $DIR/logs/cron.log 2>&1"
mkdir -p "$DIR/logs"
( crontab -l 2>/dev/null | grep -v "nfemail\|sincronizar.mjs" ; echo "$CRON" ) | crontab -
echo "Agendado: $CRON"
echo "Teste agora (simulação, não grava no ERP):  cd $DIR && xvfb-run -a node sincronizar.mjs --simular"
