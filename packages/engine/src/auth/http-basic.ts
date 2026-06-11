// `http-basic` — connection-level auth: the browser context answers 401 challenges with the
// role's credentials. Nothing to capture; the strategy emits `contextOptions.httpCredentials`
// and an empty storageState.

import {
  AuthStrategyConfigError,
  emptyStorageState,
  maskSecret,
  type AuthContext,
  type AuthResult,
  type AuthStrategy,
} from "./types.js";

export class HttpBasicStrategy implements AuthStrategy {
  readonly name = "http-basic" as const;

  authenticate(ctx: AuthContext): Promise<AuthResult> {
    const { username, password } = ctx.creds;
    if (!username || !password) {
      return Promise.reject(
        new AuthStrategyConfigError(
          `http-basic: creds_env must map "username" (${maskSecret(username)}) and "password" (${maskSecret(password)})`,
        ),
      );
    }
    return Promise.resolve({
      storageState: emptyStorageState(),
      contextOptions: { httpCredentials: { username, password } },
    });
  }
}
