export const AUTH_INPUT_LIMITS = {
  emailCharacters: 254,
  loginPasswordCharacters: 256,
  newPasswordCharacters: 72,
  bcryptPasswordBytes: 72,
} as const;

const utf8Encoder = new TextEncoder();

export function fitsBcryptPasswordLimit(value: string) {
  if (value.length > AUTH_INPUT_LIMITS.newPasswordCharacters) return false;
  return utf8Encoder.encode(value).byteLength <= AUTH_INPUT_LIMITS.bcryptPasswordBytes;
}
