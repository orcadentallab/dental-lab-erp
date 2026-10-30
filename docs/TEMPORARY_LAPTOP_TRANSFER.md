# Temporary laptop backup and restore

Backup branch: codex/temporary-laptop-backup-20261030
Repository: https://github.com/orcadentallab/dental-lab-erp

This branch preserves the existing uncommitted ERP work as a checkpoint. It is
not a release or evidence that the saved changes passed tests.

## Continue work

Commit each completed change and push this branch to origin. Confirm the remote
commit matches the local HEAD before declaring it backed up. Keep SQL migrations
and relevant documentation with their code. Never commit .env files, database
dumps, credentials, browser profiles, or temporary deployment secrets.

## Restore on the repaired laptop

Keep any existing laptop changes safe before switching branches. For a fresh copy:

```powershell
git clone --branch codex/temporary-laptop-backup-20261030 https://github.com/orcadentallab/dental-lab-erp.git
cd dental-lab-erp
npm ci
npm run dev
```

Copy .env and .env.production separately through a trusted private channel.
The ignored .transfer-backup folder on the temporary laptop contains a private
workspace ZIP and an offline Git bundle. The ZIP contains secrets and must not
be uploaded to GitHub. Copy both to a trusted external drive for an independent
backup. The ZIP excludes dependencies, build output, browser caches, and Git
metadata. The bundle preserves Git branches and history.

Offline Git restore:

```powershell
git clone --branch codex/temporary-laptop-backup-20261030 erp-history.bundle dental-lab-erp
git -C dental-lab-erp remote set-url origin https://github.com/orcadentallab/dental-lab-erp.git
```

Supabase data is separate from source control. This checkpoint does not export
or validate a live database backup. Review the existing backup workflow and its
latest successful run separately before relying on database recovery.
