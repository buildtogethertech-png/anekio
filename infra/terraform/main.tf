data "aws_caller_identity" "current" {
  lifecycle {
    postcondition {
      condition     = self.account_id == var.expected_aws_account_id
      error_message = "Refusing to manage Anekio infrastructure in AWS account ${self.account_id}; expected ${var.expected_aws_account_id}."
    }
  }
}

locals {
  generated_bucket_suffix = "${data.aws_caller_identity.current.account_id}-${var.aws_region}"
  bucket_names = {
    "staging-private" = coalesce(var.staging_private_bucket_name, "${var.bucket_prefix}-private-staging-${local.generated_bucket_suffix}")
    "staging-public"  = coalesce(var.staging_public_bucket_name, "${var.bucket_prefix}-public-staging-${local.generated_bucket_suffix}")
    "production-private" = coalesce(
      var.production_private_bucket_name,
      "${var.bucket_prefix}-private-prod-${local.generated_bucket_suffix}"
    )
    "production-public" = coalesce(
      var.production_public_bucket_name,
      "${var.bucket_prefix}-public-prod-${local.generated_bucket_suffix}"
    )
  }
  bucket_environment = {
    for key, name in local.bucket_names : key => startswith(key, "staging-") ? "staging" : "production"
  }
  cors_origins = {
    staging    = var.staging_cors_origins
    production = var.production_cors_origins
  }
  vercel_oidc_url      = "https://oidc.vercel.com/${var.vercel_team_slug}"
  vercel_oidc_host     = "oidc.vercel.com/${var.vercel_team_slug}"
  vercel_oidc_audience = "https://vercel.com/${var.vercel_team_slug}"
}

resource "aws_s3_bucket" "uploads" {
  for_each = local.bucket_names
  bucket   = each.value

  tags = {
    Environment = local.bucket_environment[each.key]
    Visibility  = endswith(each.key, "-public") ? "public-assets" : "private-files"
  }
}

import {
  for_each = var.import_existing_private_buckets ? {
    "staging-private"    = local.bucket_names["staging-private"]
    "production-private" = local.bucket_names["production-private"]
  } : {}
  to = aws_s3_bucket.uploads[each.key]
  id = each.value
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  for_each = aws_s3_bucket.uploads
  bucket   = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  for_each = aws_s3_bucket.uploads
  bucket   = each.value.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  for_each = aws_s3_bucket.uploads
  bucket   = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "uploads" {
  for_each = aws_s3_bucket.uploads
  bucket   = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  for_each = aws_s3_bucket.uploads
  bucket   = each.value.id

  depends_on = [aws_s3_bucket_versioning.uploads]

  rule {
    id     = "upload-hygiene"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = startswith(each.key, "staging-") ? 30 : 90
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  for_each = aws_s3_bucket.uploads
  bucket   = each.value.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD", "PUT"]
    allowed_origins = local.cors_origins[local.bucket_environment[each.key]]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

data "aws_iam_policy_document" "bucket_tls" {
  for_each = aws_s3_bucket.uploads

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    actions = [
      "s3:*",
    ]
    resources = [
      each.value.arn,
      "${each.value.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "uploads" {
  for_each = aws_s3_bucket.uploads
  bucket   = each.value.id
  policy   = data.aws_iam_policy_document.bucket_tls[each.key].json
}

data "tls_certificate" "vercel" {
  url = local.vercel_oidc_url
}

resource "aws_iam_openid_connect_provider" "vercel" {
  url             = local.vercel_oidc_url
  client_id_list  = [local.vercel_oidc_audience]
  thumbprint_list = [data.tls_certificate.vercel.certificates[0].sha1_fingerprint]
}

locals {
  role_projects = {
    staging = {
      project     = var.vercel_staging_project_name
      environment = var.vercel_staging_environment
      bucket_keys = ["staging-private", "staging-public"]
    }
    production = {
      project     = var.vercel_production_project_name
      environment = var.vercel_production_environment
      bucket_keys = ["production-private", "production-public"]
    }
  }
}

data "aws_iam_policy_document" "vercel_assume_role" {
  for_each = local.role_projects

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.vercel.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.vercel_oidc_host}:aud"
      values   = [local.vercel_oidc_audience]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.vercel_oidc_host}:sub"
      values   = ["owner:${var.vercel_team_slug}:project:${each.value.project}:environment:${each.value.environment}"]
    }
  }
}

resource "aws_iam_role" "vercel_uploads" {
  for_each             = local.role_projects
  name                 = "anekio-vercel-${each.key}-s3"
  assume_role_policy   = data.aws_iam_policy_document.vercel_assume_role[each.key].json
  max_session_duration = 3600

  tags = {
    Environment = each.key
  }
}

data "aws_iam_policy_document" "uploads" {
  for_each = local.role_projects

  statement {
    sid = "BucketMetadata"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
    ]
    resources = [for key in each.value.bucket_keys : aws_s3_bucket.uploads[key].arn]
  }

  statement {
    sid = "UploadObjects"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ]
    resources = [for key in each.value.bucket_keys : "${aws_s3_bucket.uploads[key].arn}/*"]
  }
}

resource "aws_iam_role_policy" "uploads" {
  for_each = local.role_projects
  name     = "anekio-${each.key}-uploads"
  role     = aws_iam_role.vercel_uploads[each.key].id
  policy   = data.aws_iam_policy_document.uploads[each.key].json
}
