# Optional: SES receives mail → S3 ses-inbound/ → Lambda indexes raw/{mailbox}/INBOX/ + DynamoDB.
# Enable after verifying the domain for receiving in SES and (usually) publishing MX for your mail host.

data "aws_caller_identity" "current" {}

variable "ses_inbound_enabled" {
  type        = bool
  default     = false
  description = "Provision SES receipt rule → S3 → Lambda indexer. Requires verified domain + recipients in SES."
}

variable "ses_inbound_recipients" {
  type        = list(string)
  default     = []
  description = "Mailbox addresses SES should accept (e.g. [\"sinan@cirak.ca\"]). Domain must verify in SES."
}

variable "ses_create_domain_identity" {
  type        = bool
  default     = true
  description = "Create SES domain identity for var.domain_name (complete DNS TXT verification in SES console)."
}

variable "mail_accept_domains" {
  type        = string
  default     = "cirak.ca"
  description = "Inbound Lambda routes To/Cc addresses on these comma-separated domains into MAILBOX pk."
}

locals {
  ses_inbound_ready = var.ses_inbound_enabled && length(var.ses_inbound_recipients) > 0
}

resource "aws_ses_domain_identity" "receive" {
  count  = local.ses_inbound_ready && var.ses_create_domain_identity ? 1 : 0
  domain = var.domain_name
}

resource "aws_ses_receipt_rule_set" "inbound" {
  count         = local.ses_inbound_ready ? 1 : 0
  rule_set_name = "${var.project_name}-recv-${var.aws_region}"
}

resource "aws_ses_receipt_rule" "to_s3" {
  count = local.ses_inbound_ready ? 1 : 0

  name          = "${var.project_name}-ses-to-s3"
  rule_set_name = aws_ses_receipt_rule_set.inbound[0].rule_set_name
  recipients    = var.ses_inbound_recipients
  enabled       = true

  s3_action {
    bucket_name       = aws_s3_bucket.mail_data.id
    object_key_prefix = "ses-inbound/"
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.mail_data_ses]
}

resource "aws_ses_active_receipt_rule_set" "inbound" {
  count         = local.ses_inbound_ready ? 1 : 0
  rule_set_name = aws_ses_receipt_rule_set.inbound[0].rule_set_name
}

data "aws_iam_policy_document" "mail_data_ses_put" {
  count = local.ses_inbound_ready ? 1 : 0

  statement {
    sid    = "AllowSesInboundWrites"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.mail_data.arn}/ses-inbound/*"]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_s3_bucket_policy" "mail_data_ses" {
  count  = local.ses_inbound_ready ? 1 : 0
  bucket = aws_s3_bucket.mail_data.id
  policy = data.aws_iam_policy_document.mail_data_ses_put[0].json
}

data "archive_file" "mail_inbound_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/mail_inbound_s3.py"
  output_path = "${path.module}/mail-inbound.zip"
}

resource "aws_lambda_function" "mail_inbound" {
  count = local.ses_inbound_ready ? 1 : 0

  function_name    = "${var.project_name}-mail-inbound-s3"
  role             = aws_iam_role.lambda_exec.arn
  runtime          = "python3.12"
  handler          = "mail_inbound_s3.lambda_handler"
  filename         = data.archive_file.mail_inbound_zip.output_path
  source_code_hash = data.archive_file.mail_inbound_zip.output_base64sha256
  timeout          = 60
  memory_size      = 256

  environment {
    variables = {
      METADATA_TABLE      = aws_dynamodb_table.mail_metadata.name
      MAIL_BUCKET         = aws_s3_bucket.mail_data.bucket
      MAIL_ACCEPT_DOMAINS = var.mail_accept_domains
      SES_INBOUND_PREFIX  = "ses-inbound/"
    }
  }
}

resource "aws_iam_role_policy" "mail_inbound_worker" {
  count = local.ses_inbound_ready ? 1 : 0
  name  = "${var.project_name}-mail-inbound-worker"
  role  = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ProcessInboundMail"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.mail_data.arn}/*"
      },
      {
        Sid      = "InboundMetaWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.mail_metadata.arn
      },
    ]
  })
}

resource "aws_lambda_permission" "mail_inbound_s3" {
  count = local.ses_inbound_ready ? 1 : 0

  statement_id  = "AllowS3InvokeInboundMail"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mail_inbound[0].function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.mail_data.arn
}

resource "aws_s3_bucket_notification" "mail_inbound" {
  count = local.ses_inbound_ready ? 1 : 0

  bucket = aws_s3_bucket.mail_data.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.mail_inbound[0].arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "ses-inbound/"
  }

  depends_on = [aws_lambda_permission.mail_inbound_s3]
}
