output "staging_vercel_environment" {
  description = "Environment values for the isolated staging Vercel project."
  value = {
    UPLOADS_DRIVER        = "s3"
    AWS_REGION            = var.aws_region
    AWS_ROLE_ARN          = aws_iam_role.vercel_uploads["staging"].arn
    AWS_S3_PRIVATE_BUCKET = aws_s3_bucket.uploads["staging-private"].id
    AWS_S3_PUBLIC_BUCKET  = aws_s3_bucket.uploads["staging-public"].id
    ANEKIO_SCHOOL_KEY     = "primary"
  }
}

output "production_vercel_environment" {
  description = "Environment values for the production Vercel project."
  value = {
    UPLOADS_DRIVER        = "s3"
    AWS_REGION            = var.aws_region
    AWS_ROLE_ARN          = aws_iam_role.vercel_uploads["production"].arn
    AWS_S3_PRIVATE_BUCKET = aws_s3_bucket.uploads["production-private"].id
    AWS_S3_PUBLIC_BUCKET  = aws_s3_bucket.uploads["production-public"].id
    ANEKIO_SCHOOL_KEY     = "primary"
  }
}

output "bucket_names" {
  value = { for key, bucket in aws_s3_bucket.uploads : key => bucket.id }
}
