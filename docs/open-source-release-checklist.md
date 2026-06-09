# Open Source Release Checklist

Use this checklist before pushing a public GitHub repository or creating a release.

## Repository Contents

- `data/` is not tracked and is not copied into release archives.
- `output/`, `runtime/`, `.trae/`, `scripts/__pycache__/`, `dist/`, logs, backups, and database files are not tracked.
- `LICENSE`, `README.md`, `SECURITY.md`, and `CONTRIBUTING.md` are present.
- `package.json` declares the repository license.

## Secrets

Verify that no public commit contains:

- API keys or OpenAI-compatible provider keys.
- ChatGPT Web access tokens, cookies, account IDs, or auth JSON.
- CPA username/password/token values.
- SMTP or SMS credentials.
- Proxy URLs that include credentials.
- SQLite database files, backups, generated images, uploaded assets, masks, or debug responses.

Suggested local checks:

```powershell
git grep -n -i -E "api_key|access_token|refresh_token|web_cookies|cookie|authorization|bearer|password_secret|token_secret|private_key|secret_key"
git ls-files | Select-String -Pattern "^(data|output|runtime|\\.trae|scripts/__pycache__)/"
git count-objects -vH
```

## GitHub Migration

- Keep GitHub as the public main repository.
- Keep Gitee as a private development remote or a clean mirror of GitHub.
- Do not mirror the current repository history to GitHub if it contains large local binaries or generated assets.

## Packaging

- Start with source-code releases.
- Put generated executables or installers in GitHub Releases, not in Git.
- Build Windows, macOS, and Linux packages on their matching platforms when adding desktop installers.
