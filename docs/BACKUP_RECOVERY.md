# Finn — Database Backup & Disaster Recovery Guide

This document defines the backup and disaster recovery protocol for the Finn Personal Finance application running on Supabase / PostgreSQL.

---

## 1. Threat Model & Recovery Objectives

* **RPO (Recovery Point Objective)**: <= 7 days (Free tier logical backup) / <= 24 hours (Paid automated backup).
* **RTO (Recovery Time Objective)**: < 1 hour to provision and restore database.
* **Sensitive Data Risk**: Database dumps contain personal financial information (balances, transactions, account numbers).
  * **Rule 1**: Backups must NEVER be placed in public repositories or unencrypted cloud storage.
  * **Rule 2**: Backups must be stored with access controls and at-rest encryption (GPG / AWS S3 KMS / Local VeraCrypt).
  * **Rule 3**: Retention schedule: Retain weekly backups for 4 weeks; retain monthly backups for 12 months; securely delete expired dumps.

---

## 2. Weekly Logical Backup Routine (Supabase CLI)

For free-tier operation, perform weekly logical exports using the Supabase CLI:

```bash
# 1. Login to Supabase CLI (if not already logged in)
npx supabase login

# 2. Dump the remote database schema and data
npx supabase db dump --project-ref <your-project-ref> -f backup_$(date +%Y%m%d_%H%M%S).sql

# 3. Encrypt the backup dump file immediately
gpg --symmetric --cipher-algo AES256 backup_*.sql
rm backup_*.sql  # Remove unencrypted plaintext dump
```

Alternatively, using direct `pg_dump`:

```bash
pg_dump -h db.<project-ref>.supabase.co -U postgres -d postgres -F c -b -v -f backup_$(date +%Y%m%d).dump
```

---

## 3. Disaster Recovery / Restoration Procedure

1. **Verify Integrity**: Verify the encrypted backup file checksum.
2. **Decrypt**:
   ```bash
   gpg -d backup_20260914.sql.gpg > restore_target.sql
   ```
3. **Restore to Fresh Database**:
   ```bash
   psql -h db.<new-project-ref>.supabase.co -U postgres -d postgres -f restore_target.sql
   ```
4. **Verification Step**:
   * Verify all 6 core tables exist: `profiles`, `accounts`, `categories`, `people`, `merchants`, `transactions`.
   * Verify Row Level Security is enabled:
     ```sql
     SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
     ```
   * Run automated integration test suite against the restored instance.
5. **Secure Cleanup**: Securely shred `restore_target.sql`.

---

## 4. Automated Backup Script

See `scripts/backup-db.sh` for an automated backup script that checks environment variables, generates a timestamped logical dump, and validates output.
