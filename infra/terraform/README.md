# Anekio upload infrastructure

This stack owns four encrypted, private S3 buckets: public assets and private
files for each of staging and production. "Public" describes application-level
access; S3 Block Public Access remains enabled on every bucket.

It also creates one team-scoped Vercel OIDC provider and separate exact-project
IAM roles for the isolated `anekio-staging` and `cultivate-school` projects. No
permanent AWS access keys are required by Vercel.

## First apply

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Authenticate Terraform to AWS using the `anekio` AWS CLI profile or another
   short-lived local credential source.
3. Run `aws sts get-caller-identity --profile anekio` and confirm the account is `440427555457`.
   Terraform also enforces this check and refuses to plan against another account.
4. Run `terraform init`, `terraform plan`, and `terraform apply` in this folder.
   The AWS provider defaults to `profile = "anekio"`, so the `AWS_PROFILE`
   prefix is not required for normal local runs.

The existing staging and production upload buckets are imported rather than
recreated. Terraform creates the two public-assets buckets.

## Vercel values

Run these after apply to print the environment maps:

```bash
terraform output -json staging_vercel_environment
terraform output -json production_vercel_environment
```

Add the staging map to the Production environment of the isolated
`anekio-staging` project. Add the production map to the Production environment
of the `cultivate-school` project. The app deploy scripts use Production
deployments for both isolated projects, so the OIDC subjects intentionally use
`environment:production` and distinguish access by exact project name.

Set `ANEKIO_SCHOOL_KEY` to a stable tenant/deployment ID when a project contains
more than one school. Object keys never use the school's display name.
