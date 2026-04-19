output "app_url" {
  value = "https://${local.fqdn}"
}

output "cloudfront_distribution_domain" {
  value = aws_cloudfront_distribution.site.domain_name
}

output "site_bucket_name" {
  value = aws_s3_bucket.site.bucket
}

output "api_base_url" {
  value = aws_apigatewayv2_api.cmail.api_endpoint
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.cmail.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_domain" {
  value = "https://${aws_cognito_user_pool_domain.web.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "mail_data_bucket_name" {
  value       = aws_s3_bucket.mail_data.bucket
  description = "Private S3 bucket for raw .eml and attachments (data.cmail.cirak.ca)"
}

output "mail_metadata_table_name" {
  value       = aws_dynamodb_table.mail_metadata.name
  description = "DynamoDB table for mail index metadata (pk/sk + s3_key)"
}

output "mail_sync_policy_arn" {
  value       = aws_iam_policy.mail_sync.arn
  description = "Attach this policy to the IAM principal that runs scripts/imap_to_mail_archive.py"
}

output "ses_inbound_enabled" {
  value       = try(local.ses_inbound_ready, false)
  description = "True if SES → S3 → Lambda inbound pipeline is provisioned (see variables ses_inbound_*)."
}
