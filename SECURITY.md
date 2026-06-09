# Security Policy

## Private Data

The `data/` directory is local runtime data and must not be committed. It may contain API keys, ChatGPT Web cookies or tokens, CPA credentials, SMTP/SMS secrets, proxy URLs, user records, password hashes, prompts, chats, generated images, uploaded assets, and encryption keys.

If you accidentally publish secrets, rotate or revoke those credentials immediately. Removing the files from a later commit is not enough if they were already pushed.

## Reporting Vulnerabilities

Please avoid posting public issues that include working credentials, cookies, tokens, exploit steps, private prompts, or generated user data.

Open a minimal issue that says a security report is available, or contact the maintainer privately through the channel listed on the repository profile.

## Supported Versions

This project is currently in early open-source preparation. Security fixes should target the default branch first.
