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

## AWS production architecture

This repository includes Terraform under `terraform/` for:

- Route53 alias record for your app hostname
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
VITE_COGNITO_REGION=<your-aws-region>
VITE_COGNITO_USER_POOL_ID=<terraform output -raw cognito_user_pool_id>
VITE_COGNITO_DOMAIN=<terraform output cognito_domain>
VITE_COGNITO_CLIENT_ID=<terraform output cognito_client_id>
VITE_COGNITO_REDIRECT_URI=<terraform output app_url or your SPA URL>
VITE_COGNITO_LOGOUT_URI=<same as redirect base URL>
```

### 3) Build and upload UI

```bash
npm run build
aws s3 sync dist/ s3://<terraform output site_bucket_name> --delete
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/*"
```

### 4) Create first user in Cognito

- AWS Console → Cognito → User Pools → select the pool created by Terraform
- Create user with email
- Mark email verified / set temporary password flow as needed
- Open your deployed app URL from `terraform output app_url` and complete password change

### Mail archive

Terraform provisions a **private** mail-data bucket (not a public website) and a **DynamoDB** table for metadata (`s3_key`, subject, folder, etc.). Raw MIME lives under `raw/<mailbox>/…/*.eml`.

Use **`terraform output`** for resource names (for example `mail_data_bucket_name`, `mail_metadata_table_name`, `mail_sync_policy_arn`). Attach `mail_sync_policy_arn` only to the IAM principal that performs archive sync.

Optional: set `mail_sync_iam_user_name` in `terraform.tfvars` to attach that policy automatically.

Keep any **IMAP → S3 import scripts, hosts, and passwords outside this repo**—wire them locally with outputs from Terraform and AWS credentials from your environment (never commit secrets).

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
