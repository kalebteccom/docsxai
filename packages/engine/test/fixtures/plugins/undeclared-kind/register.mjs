export function register(api) {
  api.registerPublisher("honest", {
    publish: async () => ({ ok: true, target: "t", pages: [], warnings: [] }),
  });
  api.registerRenderer("undisclosed", {
    render: async () => ({ ok: true, outputs: [], warnings: [] }),
  });
}
