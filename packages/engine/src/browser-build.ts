// The browser build a run captured with, for `browser_build` in annotations.json. Screenshots are
// byte-identical per docsxai and browser build, so the build is worth keeping next to them.

/** `Chromium <version>` from what the session's browser reports, or undefined when it reports none. */
export function browserBuildOf(session: {
  browser?: { version?: () => string } | undefined;
}): string | undefined {
  try {
    const version = session.browser?.version?.();
    return version ? `Chromium ${version}`.slice(0, 100) : undefined;
  } catch {
    return undefined;
  }
}
