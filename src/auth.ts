export type AuthResult =
  | { ok: true }
  | { ok: false; error: string };

export function verifyBearerToken(
  request: Request,
  expectedToken: string
): AuthResult {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return { ok: false, error: "missing_authorization_header" };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return { ok: false, error: "invalid_authorization_format" };
  }

  const token = parts[1];
  if (token !== expectedToken) {
    return { ok: false, error: "invalid_token" };
  }

  return { ok: true };
}
