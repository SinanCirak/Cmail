import json


def lambda_handler(event, context):
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )

    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(
            {
                "ok": True,
                "message": "Authenticated request.",
                "user": {
                    "sub": claims.get("sub"),
                    "email": claims.get("email"),
                    "email_verified": claims.get("email_verified"),
                    "username": claims.get("username"),
                    "cognito_username": claims.get("cognito:username"),
                },
            }
        ),
    }
