#!/usr/bin/env bash
set -euo pipefail

# Finn Database Logical Backup Script
# Usage: ./scripts/backup-db.sh [project-ref]

PROJECT_REF="${1:-${SUPABASE_PROJECT_REF:-}}"

if [ -z "$PROJECT_REF" ]; then
  echo "Error: SUPABASE_PROJECT_REF is not set. Usage: ./scripts/backup-db.sh <project-ref>"
  exit 1
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

DUMP_FILE="$BACKUP_DIR/finn_backup_${TIMESTAMP}.sql"

echo "[1/3] Starting database logical dump for project: $PROJECT_REF..."
npx supabase db dump --project-ref "$PROJECT_REF" -f "$DUMP_FILE"

echo "[2/3] Validating backup integrity..."
if [ ! -s "$DUMP_FILE" ]; then
  echo "Error: Backup file is empty or missing."
  exit 1
fi

FILE_SIZE=$(wc -c < "$DUMP_FILE")
echo "Backup created successfully ($FILE_SIZE bytes): $DUMP_FILE"

echo "[3/3] Reminder: Encrypt backup file before storing offsite:"
echo "  gpg --symmetric --cipher-algo AES256 $DUMP_FILE"
echo "  rm $DUMP_FILE"
