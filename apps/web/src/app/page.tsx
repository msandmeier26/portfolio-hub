import Link from "next/link";

const playgrounds = [
  {
    href: "/playgrounds/graph",
    title: "Graph DFS",
    description:
      "Build a graph and watch depth-first search traverse it. Powered by C++ compiled to WebAssembly, running on your device.",
    status: "Live",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
      <main className="flex-1 w-full max-w-3xl mx-auto px-8 py-24 flex flex-col gap-12">
        <header className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold tracking-tight">Portfolio Hub</h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-xl">
            Interactive playgrounds for algorithms and data structures I&apos;ve
            implemented as standalone microservices.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Playgrounds
          </h2>
          <ul className="flex flex-col gap-3">
            {playgrounds.map((p) => (
              <li key={p.href}>
                <Link
                  href={p.href}
                  className="block rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-5 py-4 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{p.title}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {p.status}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                    {p.description}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
