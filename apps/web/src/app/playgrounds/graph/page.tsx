import GraphPlayground from "./GraphPlayground";

export const metadata = {
  title: "Graph Playground",
  description:
    "Build a graph and watch DFS traverse it. Powered by a C++ microservice.",
};

export default function Page() {
  return <GraphPlayground />;
}
