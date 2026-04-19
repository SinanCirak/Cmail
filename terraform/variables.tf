variable "project_name" {
  type        = string
  default     = "cmail"
  description = "Project and resource prefix."
}

variable "aws_region" {
  type        = string
  default     = "ca-central-1"
  description = "Primary AWS region for API, Cognito, and app resources."
}

variable "domain_name" {
  type        = string
  default     = "cirak.ca"
  description = "Root domain hosted in Route53."
}

variable "subdomain_name" {
  type        = string
  default     = "cmail"
  description = "Subdomain for Cmail app."
}

variable "hosted_zone_id" {
  type        = string
  description = "Route53 hosted zone id for domain_name."
}

variable "cognito_domain_prefix" {
  type        = string
  default     = "cmail-cirak-auth"
  description = "Cognito hosted UI domain prefix (must be globally unique per region)."
}

variable "cors_allow_origin" {
  type        = string
  default     = ""
  description = "CORS allow origin for API. Leave empty to use app URL automatically."
}

variable "mail_sync_iam_user_name" {
  type        = string
  default     = ""
  description = "If set, attach the IMAP mail-sync IAM policy to this IAM user (e.g. sinan). Leave empty to attach manually."
}
