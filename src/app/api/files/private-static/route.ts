export const dynamic = "force-dynamic";

function notFound() {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = notFound;
export const HEAD = notFound;
