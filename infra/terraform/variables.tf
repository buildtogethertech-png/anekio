variable "aws_region" {
  description = "AWS region containing the Anekio S3 buckets."
  type        = string
  default     = "ap-south-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile Terraform should use for Anekio infrastructure."
  type        = string
  default     = "anekio"
}

variable "expected_aws_account_id" {
  description = "AWS account that owns the Anekio infrastructure. Planning fails for any other account."
  type        = string
  default     = "440427555457"
}

variable "bucket_prefix" {
  description = "Prefix used when a bucket name is not supplied explicitly."
  type        = string
  default     = "anekio-school"
}

variable "staging_private_bucket_name" {
  description = "Existing or new private staging bucket name."
  type        = string
  default     = ""
}

variable "staging_public_bucket_name" {
  description = "Existing or new public-assets staging bucket name."
  type        = string
  default     = ""
}

variable "production_private_bucket_name" {
  description = "Existing or new private production bucket name."
  type        = string
  default     = ""
}

variable "production_public_bucket_name" {
  description = "Existing or new public-assets production bucket name."
  type        = string
  default     = ""
}

variable "import_existing_private_buckets" {
  description = "Import the named staging and production private buckets on the first apply."
  type        = bool
  default     = false
}

variable "vercel_team_slug" {
  description = "Vercel team slug used by the team-scoped OIDC issuer."
  type        = string
}

variable "vercel_staging_project_name" {
  description = "Vercel project allowed to assume the staging role."
  type        = string
  default     = "anekio-staging"
}

variable "vercel_production_project_name" {
  description = "Vercel project allowed to assume the production role."
  type        = string
  default     = "cultivate-school"
}

variable "vercel_staging_environment" {
  description = "Vercel environment used by the staging project. Deploy scripts currently use production on that isolated project."
  type        = string
  default     = "production"
}

variable "vercel_production_environment" {
  description = "Vercel environment allowed to assume the production role."
  type        = string
  default     = "production"
}

variable "staging_cors_origins" {
  description = "Browser origins allowed to use staging presigned S3 requests."
  type        = list(string)
  default = [
    "http://localhost:8081",
    "http://app.localhost:8081",
    "https://staging.anekio.com",
    "https://app.staging.anekio.com",
    "https://*.staging.anekio.com",
  ]
}

variable "production_cors_origins" {
  description = "Browser origins allowed to use production presigned S3 requests."
  type        = list(string)
  default = [
    "https://anekio.com",
    "https://*.anekio.com",
  ]
}
