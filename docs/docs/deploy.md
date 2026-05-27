---
sidebar_position: 6
---

# Deploy

## One-click

The README's Deploy badge points at:

````
https://deploy.workers.cloudflare.com/?url=https://github.com/aloewright/my-cf-template
````

Cloudflare clones the repo into your account, provisions the Worker and the D1
database (because `wrangler.toml` declares the binding but omits `database_id`),
and deploys.

## Post-deploy steps

Set Polar secrets, apply migrations, point Polar's webhook URL — see the
README "Post-deploy setup" section.

## Docs deploy

````bash
npm run docs:deploy
# Builds Docusaurus and runs:
# wrangler pages deploy docs/build --project-name template-docs
````

The first deploy will create the Pages project; subsequent deploys update it.

## Versions and rollback

````bash
npx wrangler versions list
npx wrangler rollback
````
