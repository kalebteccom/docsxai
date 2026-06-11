export function register(api) {
  api.log.info("registering fixture artifacts");

  api.registerPublisher("wiki", {
    publish: async (ctx) => ({
      ok: true,
      target: api.workspacePath("docs", "published"),
      pages: [{ id: "p1", url: "http://127.0.0.1:9/p1", action: "created" }],
      warnings: ctx.config.warn ? ["configured warning"] : [],
    }),
  });

  api.registerPublisher("escape-probe", {
    publish: async () => ({
      ok: true,
      target: api.workspacePath("..", "outside-the-workspace"),
      pages: [],
      warnings: [],
    }),
  });

  api.registerRenderer("markdown", {
    render: async (ctx) => ({ ok: true, outputs: [`${ctx.outDir}/out.md`], warnings: [] }),
  });

  api.registerLintRules("extra", [
    { code: "X100", check: () => [] },
    { code: "X101", check: () => [] },
  ]);

  api.registerAuthStrategy("token", {
    authenticate: async () => ({ storageState: { cookies: [], origins: [] } }),
  });
}
