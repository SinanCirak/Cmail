data "archive_file" "mail_api_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/mail_api.py"
  output_path = "${path.module}/mail-api.zip"
}

resource "aws_lambda_function" "mail_api" {
  function_name    = "${var.project_name}-mail-api"
  role             = aws_iam_role.lambda_exec.arn
  runtime          = "python3.12"
  handler          = "mail_api.lambda_handler"
  filename         = data.archive_file.mail_api_zip.output_path
  source_code_hash = data.archive_file.mail_api_zip.output_base64sha256
  timeout          = 29
  memory_size      = 256

  environment {
    variables = {
      METADATA_TABLE = aws_dynamodb_table.mail_metadata.name
      MAIL_BUCKET    = aws_s3_bucket.mail_data.bucket
    }
  }
}

resource "aws_iam_role_policy" "mail_lambda_data" {
  name = "${var.project_name}-mail-lambda-data"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "MailMetadataRead"
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:GetItem",
          "dynamodb:Scan",
        ]
        Resource = aws_dynamodb_table.mail_metadata.arn
      },
      {
        Sid    = "MailMetadataWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:UpdateItem",
        ]
        Resource = aws_dynamodb_table.mail_metadata.arn
      },
      {
        Sid      = "MailArchiveRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.mail_data.arn}/*"
      },
      {
        Sid    = "MailArchiveWrite"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.mail_data.arn}/*"
      },
      {
        Sid      = "SesOutboundSend"
        Effect   = "Allow"
        Action   = ["ses:SendRawEmail"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_apigatewayv2_integration" "mail_api" {
  api_id                 = aws_apigatewayv2_api.cmail.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.mail_api.invoke_arn
  payload_format_version = "2.0"
}

locals {
  mail_routes = toset([
    "GET /mail/folders",
    "GET /mail/messages",
    "GET /mail/content",
    "PATCH /mail/message",
    "DELETE /mail/message",
    "POST /mail/send",
  ])
}

resource "aws_apigatewayv2_route" "mail" {
  for_each = local.mail_routes

  api_id             = aws_apigatewayv2_api.cmail.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.mail_api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_lambda_permission" "mail_api_apigw" {
  statement_id  = "AllowAPIGatewayMailApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mail_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.cmail.execution_arn}/*/*"
}
