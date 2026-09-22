export interface JwtAccessPayload {
  sub: string; // user id
  email: string;
  role: string;
  type: 'access';
}

export interface JwtRefreshPayload {
  sub: string;
  jti: string; // refresh token id, used to look it up / revoke it
  type: 'refresh';
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
