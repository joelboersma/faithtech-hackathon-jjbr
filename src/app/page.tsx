const stack = ["Next.js + React + TypeScript", "Supabase", "Prisma + PostgreSQL", "Model Context Protocol", "Zod", "Sinch"];

export default function Home() {
  return (
    <main>
      <p className="eyebrow">FaithTech Hackathon</p>
      <h1>Ready to build.</h1>
      <p>Your starter is set up. Add your credentials in <code>.env</code> and bring your idea to life.</p>
      <ul>{stack.map((item) => <li key={item}>{item}</li>)}</ul>
      <p>Start with <code>src/app/page.tsx</code>. See <code>README.md</code> for integration setup.</p>
    </main>
  );
}
