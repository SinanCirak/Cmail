# Cmail (Vite + React)

Mail UI prototype (list + reading pane, compose, settings).

## Run locally

```bash
npm install
npm run dev
```

App runs at `http://localhost:5173/`.

## Build

```bash
npm run build
```

Static output is in `dist/`.

## Deploy (static hosting)

This app is a **static site**. You can deploy the `dist/` folder to any static host.

### Option A — Netlify

- Build command: `npm run build`
- Publish directory: `dist`

### Option B — Vercel

- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`

### Option C — AWS S3 + CloudFront

- Upload `dist/` to an S3 bucket configured for static hosting
- Set CloudFront origin to the bucket
- For SPA routing (if you add it later), set CloudFront error response to serve `/index.html`

## AWS production architecture (`cmail.cirak.ca`)

This repository now includes Terraform under `terraform/` for:

- Route53 alias record: `cmail.cirak.ca`
- ACM certificate (us-east-1) for CloudFront
- CloudFront + private S3 website bucket
- Cognito User Pool (app sign-in uses SRP on your domain; legacy OAuth2+PKCE still works for `?code=` callbacks)
- API Gateway HTTP API with JWT authorizer (Cognito)
- Lambda sample protected endpoint (`GET /me`)

### 1) Provision infrastructure

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

After apply, note these outputs:

- `app_url`
- `api_base_url`
- `cognito_domain`
- `cognito_client_id`
- `cognito_user_pool_id`

### 2) Configure frontend auth environment

Create `.env.local` in project root:

```bash
VITE_COGNITO_REGION=ca-central-1
VITE_COGNITO_USER_POOL_ID=<terraform output -raw cognito_user_pool_id>
VITE_COGNITO_DOMAIN=<terraform output cognito_domain>
VITE_COGNITO_CLIENT_ID=<terraform output cognito_client_id>
VITE_COGNITO_REDIRECT_URI=https://cmail.cirak.ca/
VITE_COGNITO_LOGOUT_URI=https://cmail.cirak.ca/
```

### 3) Build and upload UI

```bash
npm run build
aws s3 sync dist/ s3://<terraform output site_bucket_name> --delete
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/*"
```

### 4) Create first user in Cognito

- AWS Console -> Cognito -> User Pools -> `cmail-users`
- Create user with email
- Mark email verified / set temporary password flow as needed
- Login from `https://cmail.cirak.ca/` and complete password change

### Mail archive (`data.cmail.cirak.ca`)

Terraform provisions a **private** S3 bucket named like `data.cmail.cirak.ca` (not a public website) and a **DynamoDB** table for metadata pointers (`s3_key`, subject, folder, etc.). Raw MIME is stored under `raw/<mailbox>/…/*.eml`.

After `terraform apply`, note:

- `mail_data_bucket_name`
- `mail_metadata_table_name`
- `mail_sync_policy_arn` (attach to the IAM user that runs the sync script)

Optional: set `mail_sync_iam_user_name` in `terraform.tfvars` to auto-attach the policy to an existing IAM user.

#### IMAP import (e.g. WorkMail) — run from your PC or a jump host

Windows (recommended): run from the repository root — the script prompts for IMAP user (if `IMAP_USER` is unset) and password securely:

```powershell
cd E:\WORK\Cmail
.\scripts\run_imap_sync.ps1
```

Manual environment setup:

```bash
python -m venv .venv-imap
source .venv-imap/bin/activate   # Windows: .venv-imap\Scripts\activate
pip install -r scripts/requirements-imap-sync.txt

export AWS_REGION=ca-central-1
export MAIL_ARCHIVE_BUCKET=$(cd terraform && terraform output -raw mail_data_bucket_name)
export MAIL_METADATA_TABLE=$(cd terraform && terraform output -raw mail_metadata_table_name)
export IMAP_HOST=imap.mail.us-east-1.awsapps.com   # Use the IMAP host for your WorkMail region
export IMAP_USER=you@cirak.ca
export IMAP_PASSWORD=*** 

python scripts/imap_to_mail_archive.py
```

On the first run **LIST is disabled** (many WorkMail servers hang on LIST); common folder names (`INBOX`, `Sent Items`, …) are tried instead. To pass your own folder list:

`export IMAP_FOLDERS='INBOX,Sent Items,Custom Folder'`  

To discover folders from the server, set `IMAP_USE_LIST=1` (turn it off if sync is slow or stalls).

First run downloads all messages per folder; later runs only fetch new UIDs (state in `.imap_mail_state.json`). Set `SKIP_DYNAMODB=1` to upload S3 only.

## Notes

The rest of this README is the original Vite template notes.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
