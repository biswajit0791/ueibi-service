#!/usr/bin/env bash
# ==============================================================================
# Script: delete-shraddhaauromira-tenant.sh
# Target: shraddhaauromira.com
# Purpose: Completely delete the Shraddha Auromira tenant, registration, users,
#          and transactional records from the Karyam database while preserving
#          global application data, Platform Owner, and all other company tenants.
#
# Usage:
#   ./delete-shraddhaauromira-tenant.sh --dry-run
#   ./delete-shraddhaauromira-tenant.sh --execute
# ==============================================================================

set -euo pipefail

# ANSI Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

TARGET_DOMAIN="shraddhaauromira.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$SCRIPT_DIR"

# Print Header
echo -e "${CYAN}================================================================${NC}"
echo -e "${BOLD}🏛️  KARYAM SAAS — COMPLETE TENANT DELETION UTILITY${NC}"
echo -e "Target Domain : ${BOLD}${TARGET_DOMAIN}${NC}"
echo -e "${CYAN}================================================================${NC}"

# Parse Arguments
MODE=""
if [ $# -eq 0 ]; then
  echo -e "${RED}Error: Missing mode argument.${NC}\n"
  echo -e "Usage:"
  echo -e "  ${BOLD}./delete-shraddhaauromira-tenant.sh --dry-run${NC}   (Inspect records without modifying data)"
  echo -e "  ${BOLD}./delete-shraddhaauromira-tenant.sh --execute${NC}   (Backup database and execute complete deletion)"
  exit 1
fi

case "$1" in
  --dry-run)
    MODE="DRY_RUN"
    ;;
  --execute)
    MODE="EXECUTE"
    ;;
  *)
    echo -e "${RED}Error: Unknown option '$1'.${NC}\n"
    echo -e "Usage:"
    echo -e "  ${BOLD}./delete-shraddhaauromira-tenant.sh --dry-run${NC}"
    echo -e "  ${BOLD}./delete-shraddhaauromira-tenant.sh --execute${NC}"
    exit 1
    ;;
esac

# 1. Environment Verification
if [ ! -f ".env" ]; then
  echo -e "${RED}❌ Error: .env file not found in $SCRIPT_DIR${NC}"
  exit 1
fi

# 2. Check Node.js and dependencies
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}❌ Error: Node.js is required but not installed or not in PATH.${NC}"
  exit 1
fi

if [ ! -f "scripts/delete-tenant-core.js" ]; then
  echo -e "${RED}❌ Error: Core deletion engine scripts/delete-tenant-core.js not found.${NC}"
  exit 1
fi

# Ensure backups directory exists
mkdir -p "$SCRIPT_DIR/backups"

# ==============================================================================
# MODE: DRY RUN
# ==============================================================================
if [ "$MODE" = "DRY_RUN" ]; then
  echo -e "${YELLOW}🛡️  RUNNING DRY RUN AUDIT... (NO DATA WILL BE CHANGED)${NC}\n"
  node scripts/delete-tenant-core.js --dry-run
  exit 0
fi

# ==============================================================================
# MODE: EXECUTE
# ==============================================================================
echo -e "${YELLOW}⚠️  WARNING: You are about to permanently delete all data for:${NC}"
echo -e "${RED}${BOLD}    ${TARGET_DOMAIN}${NC}\n"

# Step 1: Run dry run inspection first so admin sees what will be purged
node scripts/delete-tenant-core.js --dry-run

echo -e "${RED}----------------------------------------------------------------${NC}"
echo -e "${RED}${BOLD}CRITICAL CONFIRMATION REQUIRED:${NC}"
echo -e "This action will permanently delete all users, goals, tasks, departments,"
echo -e "subscriptions, registration tokens, and files for ${TARGET_DOMAIN}."
echo -e "All email addresses under ${TARGET_DOMAIN} will become available for fresh registration."
echo -e "${RED}----------------------------------------------------------------${NC}"
echo -ne "Type '${BOLD}${TARGET_DOMAIN}${NC}' to confirm and proceed: "
read -r CONFIRMATION
CONFIRMATION=$(echo "$CONFIRMATION" | tr -d '\r' | xargs)

if [ "$CONFIRMATION" != "$TARGET_DOMAIN" ]; then
  echo -e "\n${YELLOW}⛔ Aborted by user. Input '${CONFIRMATION}' did not match '${TARGET_DOMAIN}'.${NC}"
  echo -e "No changes were made to the database."
  exit 0
fi

echo -e "\n${BLUE}🔄 Confirmation accepted.${NC}"

# Step 2: Database Backup
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$SCRIPT_DIR/backups/pg_dump_pre_deletion_${TARGET_DOMAIN}_${TIMESTAMP}.sql"

echo -e "${BLUE}📦 Attempting PostgreSQL database backup...${NC}"
if command -v pg_dump >/dev/null 2>&1; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'")
  if [ -n "$DATABASE_URL" ]; then
    echo -e "   Running pg_dump to: ${BACKUP_FILE}"
    if pg_dump "$DATABASE_URL" > "$BACKUP_FILE" 2>/dev/null; then
      echo -e "${GREEN}   ✔ Full PostgreSQL backup completed successfully: $(du -h "$BACKUP_FILE" 2>/dev/null | cut -f1)${NC}"
    else
      echo -e "${YELLOW}   ⚠️ pg_dump returned a non-zero exit code. An internal JSON snapshot will also be captured.${NC}"
    fi
  fi
else
  echo -e "${YELLOW}   ⚠️ pg_dump command not found in system PATH.${NC}"
  echo -e "   Proceeding with automated JSON safety snapshot in ./backups/."
fi

# Step 3: Run Live Deletion via Core Engine
echo -e "\n${RED}${BOLD}⚡ INITIATING DATABASE TRANSACTION...${NC}"
node scripts/delete-tenant-core.js --execute --confirmed

echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}${BOLD}✔ TENANT DELETION PROCESS FINISHED.${NC}"
echo -e "${GREEN}================================================================${NC}"

