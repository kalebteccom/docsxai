export function register(api) {
  api.registerRenderer("never", {
    render: async () => ({ ok: true, outputs: [], warnings: [] }),
  });
}
