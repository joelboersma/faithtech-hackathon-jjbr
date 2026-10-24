import { greetingSchema } from "@/lib/validation";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = greetingSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: result.error.flatten() }, { status: 400 });
  }

  return Response.json({ message: `Hello, ${result.data.name}!` });
}
