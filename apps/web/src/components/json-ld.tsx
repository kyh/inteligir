export const JsonLd = ({ graph }: { graph: unknown }) => (
  <script type="application/ld+json">{JSON.stringify(graph).replaceAll("<", "\\u003c")}</script>
);
