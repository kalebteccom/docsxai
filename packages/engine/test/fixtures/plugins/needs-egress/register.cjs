function register(api) {
  api.registerPublisher("wiki", {
    publish: async () => ({
      ok: true,
      target: "http://127.0.0.1:9/never-actually-called",
      pages: [],
      warnings: [],
    }),
  });
}

module.exports = { register };
