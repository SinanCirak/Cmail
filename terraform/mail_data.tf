# Raw mail archive: private S3 + DynamoDB index (IMAP migration / SES inbound later)

locals {
  mail_data_fqdn = "data.${var.subdomain_name}.${var.domain_name}"
}

resource "aws_s3_bucket" "mail_data" {
  bucket = local.mail_data_fqdn
}

resource "aws_s3_bucket_public_access_block" "mail_data" {
  bucket                  = aws_s3_bucket.mail_data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "mail_data" {
  bucket = aws_s3_bucket.mail_data.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "mail_data" {
  bucket = aws_s3_bucket.mail_data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "mail_data" {
  bucket = aws_s3_bucket.mail_data.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_dynamodb_table" "mail_metadata" {
  name         = "${var.project_name}-mail-metadata"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

data "aws_iam_policy_document" "mail_sync" {
  statement {
    sid    = "MailArchiveS3Write"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:PutObjectTagging",
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.mail_data.arn,
      "${aws_s3_bucket.mail_data.arn}/*",
    ]
  }

  statement {
    sid    = "MailMetaDynamoWrite"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:DescribeTable",
    ]
    resources = [aws_dynamodb_table.mail_metadata.arn]
  }
}

resource "aws_iam_policy" "mail_sync" {
  name_prefix = "${var.project_name}-mail-sync-"
  description = "Upload mail from IMAP sync script to S3 + DynamoDB metadata"
  policy      = data.aws_iam_policy_document.mail_sync.json
}

resource "aws_iam_user_policy_attachment" "mail_sync" {
  count      = var.mail_sync_iam_user_name != "" ? 1 : 0
  user       = var.mail_sync_iam_user_name
  policy_arn = aws_iam_policy.mail_sync.arn
}
